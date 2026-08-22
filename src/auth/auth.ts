import { generateCodeVerifier, generateCodeChallenge } from '@onelo/core'
import { hostOS } from '../core/host-os'
import { httpGet, httpPost, checkHostedFlowRequired } from '@onelo/core'
import { mapSession } from '@onelo/core'
import { TokenStorage, TOKEN_KEYS } from '../core/storage'
import { publishSessionCreated } from '../core/session-channel'
import { coverPage, removeCover, showHandedOverNotice } from '../core/handed-over-notice'
import { OneloEventStream } from '../core/event-stream'
import { AuthModal, type AuthPresentMode } from './auth-modal'
import {
  OneloConfig,
  OneloSession,
  OneloUser,
  OneloEntitlement,
  OneloError,
  ResolvedSDKConfig,
} from '@onelo/core'
import { version as SDK_VERSION } from '../../package.json'

/**
 * Is this `?error=` value the hosted page saying its addressing token is spent?
 *
 * NOT a catch-all: a genuine failure must still surface as an error. Reloading
 * on every error would loop forever on one. Exported so the rule is tested
 * directly rather than re-implemented in a test, which would stay green after
 * the behaviour was deleted.
 */
export function isExpiredAuthError(err: string | null | undefined): boolean {
  return err === 'invalid_token' || err === 'expired_token' || err === 'token_expired'
}

/**
 * Does closing THIS surface have to sign the user out?
 *
 * The backend stamps `exit=signout` on a store or no-plan URL it hands out
 * because the user only got there by authenticating with no plan — so the screen
 * behind it is sign-in, not the app. Closing must therefore end at sign-in, which
 * means dropping the session; dismissing into an app they cannot use would strand
 * them. A store opened by `openUpgrade()` on an entitled user carries no marker
 * and closes back into the app.
 *
 * Exported so the rule is tested directly rather than re-implemented in a test —
 * a copy in a test stays green after the behaviour it describes is deleted.
 */
export function closingMeansSignOut(url: string): boolean {
  try {
    return new URL(url).searchParams.get('exit') === 'signout'
  } catch {
    return false
  }
}

export class OneloAuth {
  private storage: TokenStorage
  private apiUrl: string
  private publishableKey: string
  private pkceVerifier: string | null = null
  private resolvedConfig: ResolvedSDKConfig | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private refreshTimer: ReturnType<typeof setTimeout> | null = null
  private static readonly HEARTBEAT_MS = 13 * 60 * 1000
  /** Refresh this many seconds before the access token expires. */
  private static readonly REFRESH_LEAD_SECONDS = 60
  // ── Refresh coordination (fixes multi-tab / concurrent forced-logout) ──────
  // The backend rotates the refresh token on every refresh and HARD-revokes the
  // whole session family if an already-rotated token is reused (sdk_auth.py
  // reuse detection). So two refreshes with the SAME token — two tabs sharing
  // one localStorage token, or a reload racing the background refresh timer, or
  // concurrent getSession() calls — make the second look like a stolen-token
  // replay and log the user out. Two layers stop that:
  //  1. `refreshInFlight` — single-flight WITHIN this tab: concurrent callers
  //     collapse onto one in-progress refresh instead of each firing their own.
  //  2. a cross-tab Web Lock (see _refreshCoordinated) so only one tab refreshes
  //     at a time, and each reads the freshest token INSIDE the lock.
  private refreshInFlight: Promise<OneloSession | null> | null = null
  /** Web Lock name — scoped per publishable key so sibling apps don't serialise
   *  against each other. */
  private static readonly REFRESH_LOCK_PREFIX = 'onelo_auth_refresh'
  /** Bound the WAIT for the cross-tab lock. A stuck/orphaned holder must never
   *  hang refresh forever (the class of bug that froze supabase-js auth — Web
   *  Locks issues #1594/#2111); on timeout we fall back to an un-serialised
   *  refresh, which is strictly better than hanging or dropping the session. */
  private static readonly REFRESH_LOCK_TIMEOUT_MS = 5000
  private initPromise: Promise<void>
  private authStateListeners: Array<(session: OneloSession | null) => void> = []

  isReady = false
  isRevoked = false
  /** True once the backend reports this USER's session is no longer valid
   *  (revoked / banned / all sessions server-revoked) — surfaced via the
   *  heartbeat 401 or a refresh user_revoked. Parity with Swift isUserRevoked. */
  isUserRevoked = false
  // Monotonic sign-out counter. signOut() bumps it; any in-flight refresh /
  // revalidate captures it before its network await and bails BEFORE writing
  // tokens back if it moved — prevents the "logged out but bounced right back"
  // race (a proactive refresh completing just after sign-out). Parity with
  // Swift's _signOutEpoch.
  private signOutEpoch = 0
  /** True once this tab has handed a magic-link sign-in to another tab.
   *
   *  It is then DONE: it shows "continue in the other tab" and must present
   *  nothing else. Without this the host app's own startup call to
   *  loadAuthView() opened a sign-in form on top of that notice, so the tab the
   *  user was told to leave asked them to log in again (reported 2026-08-19). */
  private handedOverToAnotherTab = false
  allowCustomBranding = false
  appName: string = 'App'
  appLogoUrl: string | null = null
  paywallEnabled = false
  /** False when Paywall → Access Gate is "Sign in only": this app never sells
   *  in-app. Read it before offering ANY upgrade CTA — see isStoreAvailable(). */
  inAppStoreAllowed = true
  /**
   * Which hosted surface `loadAuthView()` last opened: `sign_in`, `store`,
   * `no_plan`, or null when nothing was presented (the caller was already
   * authorized, or the flow never got that far).
   *
   * `/api/sdk/flow/init` decides this centrally and the SDK used to drop it, so
   * a host app that got `null` back could not tell "cancelled the sign-in" from
   * "declined to buy" from "was shown 'no active plan'". The return type stays
   * `OneloSession | null` — this is additive, and reading it is optional.
   */
  lastPresentedSurface: string | null = null
  waitlistMode = false
  sdkRedirectUrl: string | null = null
  storeUrl: string | null = null
  manageUrl: string | null = null

  constructor(config: OneloConfig) {
    if (!config.apiUrl) throw new Error('[Onelo] apiUrl is required')
    if (!config.publishableKey) throw new Error('[Onelo] publishableKey is required')
    this.apiUrl = config.apiUrl
    this.publishableKey = config.publishableKey
    this.storage = new TokenStorage()
    this.initPromise = this.initialize()
  }

  private async initialize(): Promise<void> {
    // Cover the page on the FIRST tick, before anything is awaited. A tab
    // carrying a one-time code is a magic-link return, and the host app starts
    // rendering immediately — waiting even for the config request left a window
    // in which it could paint itself.
    if (typeof window !== 'undefined') {
      try {
        const q = new URL(window.location.href).searchParams
        if (q.get('onelo_code') || q.get('onelo_gate')) coverPage()
      } catch { /* an unparsable location is not ours to fix */ }
    }

    try {
      const verifier = generateCodeVerifier()
      this.pkceVerifier = verifier
      const challenge = await generateCodeChallenge(verifier)
      const url = `${this.apiUrl}/api/sdk/config?key=${encodeURIComponent(this.publishableKey)}&code_challenge=${encodeURIComponent(challenge)}`
      // X-Onelo-OS decides whether the "Require plan on sign-up" gate applies:
      // inside a Capacitor/Cordova iOS shell this SDK runs in an App Store app,
      // where showing the store in-app is not allowed. A plain browser reports
      // 'web' and nothing changes. See core/host-os.ts.
      const { status, json } = await httpGet(url, {
        'X-SDK-Version': SDK_VERSION,
        'X-Onelo-OS': hostOS(),
      })
      if (status === 401 || status === 404) throw OneloError.invalidKey('Server rejected the key')
      if (status !== 200) throw OneloError.server(`Config request failed: HTTP ${status}`)
      const j = json as Record<string, unknown>
      this.resolvedConfig = {
        supabaseUrl: j['supabase_url'] as string,
        supabaseAnonKey: j['supabase_anon_key'] as string,
        tenantId: j['tenant_id'] as string,
        allowCustomBranding: (j['allow_custom_branding'] as boolean) ?? false,
        appName: (j['app_name'] as string | null) ?? null,
        appLogoUrl: (j['app_logo_url'] as string | null) ?? null,
        paywallEnabled: (j['paywall_enabled'] as boolean) ?? false,
        // Access Gate. The backend has always sent this; the parser dropped it,
        // so nothing downstream could tell "Sign in only" from "Show the store".
        // Defaults TRUE — an older backend that omits it behaves as before.
        inAppStoreAllowed: (j['in_app_store_allowed'] as boolean) ?? true,
        waitlistMode: (j['waitlist_mode'] as boolean) ?? false,
        sdkRedirectUrl: (j['sdk_redirect_url'] as string | null) ?? null,
        storeUrl: (j['store_url'] as string | null) ?? null,
        manageUrl: (j['manage_url'] as string | null) ?? null,
        // Branding page background (--onelo-page-bg / checkout_bg_color). Required
        // by the shared ResolvedSDKConfig; parity with RN's resolver. Default dark.
        pageBackgroundColor: (j['checkout_bg_color'] as string) || '#111111',
      }
      this.allowCustomBranding = this.resolvedConfig.allowCustomBranding
      if (this.resolvedConfig.appName) this.appName = this.resolvedConfig.appName
      this.appLogoUrl = this.resolvedConfig.appLogoUrl
      this.paywallEnabled = this.resolvedConfig.paywallEnabled
      this.inAppStoreAllowed = this.resolvedConfig.inAppStoreAllowed ?? true
      this.waitlistMode = this.resolvedConfig.waitlistMode
      this.sdkRedirectUrl = this.resolvedConfig.sdkRedirectUrl
      this.storeUrl = this.resolvedConfig.storeUrl
      this.manageUrl = this.resolvedConfig.manageUrl
      this.isReady = true

      // Finish a magic-link sign-in if the browser just came back carrying a
      // code. Done HERE so `await onelo.auth.whenReady()` is all a developer
      // needs — requiring an extra call would mean the flow silently does
      // nothing for anyone who did not read that line of the docs, which is how
      // magic link stayed broken on the web in the first place.
      //
      // A failed exchange must not take the whole SDK down with it: an expired
      // or already-spent code is a normal thing to land on (a reload, a
      // prefetching mail scanner). It is logged and the app continues signed
      // out, which is the state the user can act on.
      try {
        await this.exchangeCodeFromUrl()
      } catch (err) {
        console.warn('[Onelo] magic-link sign-in could not be completed:', err)
      }
    } catch (e) {
      if (e instanceof OneloError && e.code === 'invalid_publishable_key') {
        this.isRevoked = true
      }
    }
  }

  async whenReady(): Promise<void> {
    await this.initPromise
  }

  // ── Hosted flow ─────────────────────────────────────────────────────────────

  /**
   * Open the Onelo hosted flow (sign-in → store → content).
   *
   * The routing decision is CENTRALISED on the backend (`/api/sdk/flow/init`)
   * so every SDK behaves identically — there is no per-SDK paywall / sign-in-vs-
   * store logic left to drift (the class of bug that let JS jump straight to the
   * store and skip sign-in). We send our current session (if any); the backend
   * decides ONCE:
   *   - authorized      → we already have access → return the session (content).
   *   - present sign-in → open /auth/hosted (it chains sign-in → store → done
   *                       itself when a paywall applies).
   *   - present store   → signed-in, no plan → open /store/hosted (bound to us).
   * Either "present" surface ends by postMessaging ONE final code, which we
   * exchange for a session. Waitlist redirect stays here — it's a plain
   * redirect, not a routing decision the backend flow owns.
   *
   * @param options.mode  'embedded' (default) renders the hosted page inline in
   *   an iframe — the web equivalent of Swift's WKWebView, never popup-blocked
   *   (requires the app origin in allowed origins; localhost works on a test
   *   key). 'popup' opens a top-level window.
   */
  async loadAuthView(
    options?: { mode?: AuthPresentMode },
  ): Promise<OneloSession | null> {
    await this.initPromise
    if (this.isRevoked) throw OneloError.invalidKey('Application key has been revoked')

    // This tab handed its sign-in to the tab the user started in and is showing
    // them the way back. Presenting anything now — including the app's own
    // startup call to this method — puts a sign-in form over that message and
    // asks the user to log in again in the tab we just told them to leave.
    if (this.handedOverToAnotherTab) return null

    const mode: AuthPresentMode = options?.mode ?? 'embedded'

    if (this.waitlistMode && this.sdkRedirectUrl) {
      window.open(this.sdkRedirectUrl, '_blank')
      return null
    }

    // Ask the backend for the single next step, sending our current session so
    // it can decide authorized vs sign-in vs store. This REPLACES the SDK-side
    // paywall gate — the decision now lives once, in /api/sdk/flow/init.
    const existing = await this.getSession()
    const decision = await this.resolveFlow(existing?.accessToken ?? null)

    // Record what the backend chose BEFORE presenting, so it is readable even if
    // the user closes the surface and we resolve with null.
    this.lastPresentedSurface = decision.action === 'present' ? (decision.surface || null) : null

    if (decision.action === 'authorized') {
      // Backend confirmed access via a LIVE entitlement check. Sync our cached
      // entitlement so hasActiveAccess() agrees, then return the session.
      if (this.paywallEnabled) await this.revalidateEntitlement().catch(() => {})
      return (await this.getSession()) ?? existing
    }

    // present → open the hosted flow; it chains to the store itself when needed,
    // so we wait for exactly ONE final code and exchange it.
    const modal = new AuthModal()
    const result = await modal.open(this.withReturnTo(decision.url), mode, { watchCrossTabSession: true })

    if (result.type === 'cancelled') {
      // Same rule for a surface reached directly: a store stamped `exit=signout`
      // sits in front of sign-in, so closing it returns there.
      if (closingMeansSignOut(decision.url)) {
        await this.signOut()
        return this.loadAuthView(options)
      }
      return null
    }
    if (result.type === 'error') {
      // `invalid_token` is NOT a failure. It is what "Use a different account"
      // on the no-plan page sends after signing the user out, and what an idle
      // expiry sends: the addressing token is spent, nothing more. Throwing at
      // the caller showed the developer's users a raw error string for a routine
      // sign-out. Re-resolve and reopen instead — /flow/init now answers
      // `sign_in`, so they land on a clean form. Parity with Swift's
      // `onSessionExpired`, Electron's reload branch and RN's `expired` result.
      //
      // Recursion terminates because each pass mints a FRESH addressing token;
      // the page only emits this after an explicit sign-out.
      if (isExpiredAuthError(result.message)) {
        // Clear the LOCAL session first when the surface was a sign-out surface.
        //
        // The hosted ✕ revokes server-side and reports `invalid_token`, but the
        // tokens are still in this tab's storage — so re-resolving sent them as a
        // Bearer, the backend answered "signed in, no plan", and the SDK reopened
        // THE SAME STORE. The screen closed and instantly came back, which is
        // indistinguishable from the button doing nothing (reported 2026-08-19).
        //
        // Scoped to `exit=signout`: the same code also arrives when an addressing
        // token simply went stale under a user who IS entitled, and signing that
        // person out would be a regression, not a fix.
        if (closingMeansSignOut(decision.url)) await this.signOut()
        return this.loadAuthView(options)
      }
      throw OneloError.server(result.message)
    }

    // Another tab completed a magic-link sign-in and wrote the session to shared
    // storage. Nothing to exchange — reading it back IS the result. Listeners
    // are notified so an app that reacts to auth state (rather than awaiting
    // this call) updates in this tab too.
    if (result.type === 'session') {
      const restored = await this.getSession()
      if (restored) {
        this.notifyListeners(restored)
        return restored
      }
      // Signed in elsewhere, but there is no session HERE — the magic-link
      // "no plan" case: the other tab proved who the user is, the Access Gate
      // refused entry, and no session was ever issued.
      //
      // Present the screen the OTHER TAB was handed. Re-resolving instead looks
      // right and is wrong: with no session the backend answers "nobody is
      // signed in" and hands back the sign-in form, which is what BOTH tabs
      // showed on 2026-08-18. The surface cannot be re-derived here, so it
      // travels over the channel.
      if (result.surfaceUrl) {
        const surface = result.surfaceUrl
        const gate = await new AuthModal().open(surface, mode)
        // The ✕ resolves `cancelled`. On a surface stamped `exit=signout` that
        // has to mean "back to sign-in", not "dismiss into an app you cannot
        // use" — so drop the session and re-resolve, which now answers sign_in.
        if (gate.type === 'cancelled' && closingMeansSignOut(surface)) {
          await this.signOut()
          return this.loadAuthView(options)
        }
        // "Use a different account" on that screen signs the user out and
        // reports `invalid_token` — the same "start over" the expired-token path
        // below handles, and re-resolving is then correct because the state
        // really did change.
        if (gate.type === 'error' && isExpiredAuthError(gate.message)) {
          // As above: drop the local session, or the re-resolve reopens the very
          // screen the user just closed.
          if (closingMeansSignOut(surface)) await this.signOut()
          return this.loadAuthView(options)
        }
        // Bought a plan in the store → a code comes back and is exchanged like
        // any other. Closed it instead → null, and the app keeps its locked
        // screen.
        if (gate.type === 'code') return this.exchangeHostedCode(gate.code)
        return null
      }

      // No surface named: nothing was decided for us, so ask.
      return this.loadAuthView(options)
    }

    return this.exchangeHostedCode(result.code)
  }

  /** Trade a one-time hosted code for a session. One implementation, because
   *  the hosted flow can hand a code back from more than one surface. */
  private async exchangeHostedCode(code: string): Promise<OneloSession> {
    const { status, json } = await httpPost(
      `${this.apiUrl}/api/sdk/auth/hosted-callback`,
      { publishableKey: this.publishableKey, code, code_verifier: this.pkceVerifier },
      { 'X-SDK-Version': SDK_VERSION }
    )
    if (status !== 200) throw OneloError.server('Hosted callback failed')
    const session = mapSession(json as Record<string, unknown>)
    // Announce: a tab that was waiting on "Check your inbox" for the SAME user
    // has no other way to learn this happened.
    await this.saveSession(session, { announce: true })
    return session
  }

  /**
   * Resolve the next flow step from the backend. Sends the current access token
   * (if any) as a Bearer so the backend sees whether we're signed in + entitled,
   * then returns 'authorized' (no UI) or 'present' with the hosted URL to open.
   */
  private async resolveFlow(
    accessToken: string | null,
  ): Promise<{ action: 'authorized' } | { action: 'present'; surface: string; url: string }> {
    const headers: Record<string, string> = { 'X-SDK-Version': SDK_VERSION }
    // Same Bearer pattern the SDK already uses for GET /api/sdk/auth/user
    // (revalidateEntitlement) — CORS on /api/sdk/* already allows Authorization.
    if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`
    const { status, json } = await httpGet(
      `${this.apiUrl}/api/sdk/flow/init?key=${encodeURIComponent(this.publishableKey)}&callback_scheme=onelo-callback`,
      headers,
    )
    if (status !== 200) {
      // Surface the backend's reason (e.g. "store_not_configured",
      // "Invalid publishable key") instead of a bare status — a dev with a
      // paywall on but no store options built needs to see WHY the flow failed.
      const detail = (json as Record<string, unknown> | null)?.['detail']
      const reason = typeof detail === 'string' ? detail : `HTTP ${status}`
      throw OneloError.server(`Failed to resolve auth flow: ${reason}`)
    }
    const j = json as Record<string, unknown>
    if (j['action'] === 'authorized') return { action: 'authorized' }
    if (j['action'] === 'present' && typeof j['url'] === 'string') {
      if (j['app_name']) this.appName = j['app_name'] as string
      if (j['app_logo_url']) this.appLogoUrl = j['app_logo_url'] as string
      return { action: 'present', surface: String(j['surface'] ?? ''), url: j['url'] as string }
    }
    throw OneloError.server('Invalid flow response')
  }

  // ── Custom UI (paid plans only) ─────────────────────────────────────────────

  async signIn(email: string, password: string): Promise<OneloSession> {
    await this.initPromise
    if (!this.allowCustomBranding) throw OneloError.planRequired()
    if (!this.pkceVerifier) this.pkceVerifier = generateCodeVerifier()
    const { status, json } = await httpPost(
      `${this.apiUrl}/api/sdk/auth/signin`,
      { email, password, publishableKey: this.publishableKey, code_verifier: this.pkceVerifier },
      { 'X-SDK-Version': SDK_VERSION }
    )
    checkHostedFlowRequired(json)
    const j = json as Record<string, unknown>
    if (status === 403) {
      const detail = j['detail'] as Record<string, unknown> | undefined
      if (detail?.['error'] === 'user_revoked') throw OneloError.userRevoked()
      throw OneloError.server((detail?.['message'] ?? j['error']) as string)
    }
    if (status !== 200) throw OneloError.server(`Sign in failed: HTTP ${status}`)
    this.pkceVerifier = null
    const session = mapSession(j)
    await this.saveSession(session)
    return session
  }

  async signUp(email: string, password: string): Promise<OneloSession> {
    await this.initPromise
    if (!this.allowCustomBranding) throw OneloError.planRequired()
    if (!this.pkceVerifier) this.pkceVerifier = generateCodeVerifier()
    const { status, json } = await httpPost(
      `${this.apiUrl}/api/sdk/auth/signup`,
      { email, password, publishableKey: this.publishableKey, code_verifier: this.pkceVerifier },
      { 'X-SDK-Version': SDK_VERSION }
    )
    checkHostedFlowRequired(json)
    const j = json as Record<string, unknown>
    if (status !== 200) throw OneloError.server(`Sign up failed: HTTP ${status}`)
    this.pkceVerifier = null
    const session = mapSession(j)
    await this.saveSession(session)
    return session
  }

  // ── Session management ──────────────────────────────────────────────────────

  async signOut(): Promise<void> {
    // Invalidate any in-flight refresh/revalidate BEFORE any await, so they
    // can't write the just-cleared tokens back after we sign out.
    this.signOutEpoch++
    this.stopHeartbeat()
    this.clearRefreshTimer()
    // Tear down ALL local state up-front, BEFORE the network await below —
    // otherwise a proactive refresh (token still in storage) could fire during
    // the await and re-establish the session. Capture the token first for the
    // best-effort server revoke.
    const accessToken = await this.storage.get(TOKEN_KEYS.ACCESS_TOKEN)
    await this.storage.clear()
    this.notifyListeners(null)
    // Revoke server-side so the refresh token can't be reused after logout.
    // The backend reads the token from Authorization and the app from
    // X-Publishable-Key, then soft-revokes ALL of this user's sessions.
    // Fail-open — a network error must never block the (already-done) sign-out.
    if (accessToken) {
      try {
        await httpPost(
          `${this.apiUrl}/api/sdk/auth/signout`,
          {},
          {
            'X-SDK-Version': SDK_VERSION,
            Authorization: `Bearer ${accessToken}`,
            'X-Publishable-Key': this.publishableKey,
          }
        )
      } catch {
        // fail-open — already cleared locally
      }
    }
  }

  async getSession(): Promise<OneloSession | null> {
    const [accessToken, refreshToken, expiresAtStr, userJson] = await Promise.all([
      this.storage.get(TOKEN_KEYS.ACCESS_TOKEN),
      this.storage.get(TOKEN_KEYS.REFRESH_TOKEN),
      this.storage.get(TOKEN_KEYS.EXPIRES_AT),
      this.storage.get(TOKEN_KEYS.USER_JSON),
    ])
    if (!accessToken || !refreshToken || !userJson) return null
    const expiresAt = parseInt(expiresAtStr ?? '0', 10)
    if (Date.now() / 1000 > expiresAt - 60) {
      return this.refreshSession()
    }
    const session: OneloSession = { accessToken, refreshToken, expiresAt, user: JSON.parse(userJson) as OneloUser }
    // Arm the background refresh + the revocation heartbeat on restore (the
    // common web case: page reload — saveSession only runs on sign-in).
    // Guard on heartbeatTimer === null: getSession is ALSO called from inside
    // the heartbeat tick and by the app, so re-arming on every call would keep
    // pushing the 13-min timer out and it would never actually fire.
    this.scheduleRefresh(session)
    if (this.heartbeatTimer === null) {
      this.startHeartbeat(session.accessToken)
      // First read after a page reload: saveSession did NOT run this page load,
      // so the auth-state listeners never learned about the restored session —
      // and via the Onelo bridge (onAuthStateChange → features.load + monitor
      // .setUserId) that leaves features' per-user targeting + monitor bound to
      // the anonymous init state until the next sign-in. Republish once here so
      // a reload re-binds identity, matching Swift's restoreSession. The
      // heartbeatTimer guard keeps this to exactly one notify per restore.
      this.notifyListeners(session)
      // The stored entitlement may also be stale; refresh it once, best-effort,
      // when the app uses the paywall (mirrors Swift's revalidateEntitlement()
      // on restore). Runs after the notify so listeners see the restored session
      // first, then a second notify only if the entitlement actually changed.
      if (this.paywallEnabled) void this.revalidateEntitlement()
    }
    return session
  }

  /**
   * True when the current session's user has an active paid entitlement.
   * Snapshot read of the persisted session (no network) — mirrors Swift's
   * `hasActiveAccess`. Returns false when there is no session.
   */
  async hasActiveAccess(): Promise<boolean> {
    const session = await this.getSession()
    return session?.user.entitlement === 'active'
  }

  /**
   * True when this app has the paywall enabled (from `/api/sdk/config`).
   *
   * Parity with the Electron and React Native SDKs, which have had this since
   * the launch gates were written. It was MISSING here — and the JS auth snippet
   * shipped `onelo.auth.isPaywallEnabled()` anyway, so every developer who
   * followed our own web documentation called a function that did not exist.
   *
   * Accurate only after `whenReady()` resolves; false before config loads.
   */
  isPaywallEnabled(): boolean {
    return this.paywallEnabled
  }

  /**
   * May this app open a store at all?
   *
   * False when the developer chose Paywall → Access Gate → "Sign in only":
   * buyers pay on their website, so nothing in the app may show plans, a
   * checkout, or an "upgrade" CTA that leads to one.
   *
   * Check it before rendering any upsell. The backend refuses store-initiate in
   * that state (409 `in_app_store_not_allowed`), so ignoring this only turns a
   * hidden button into a dead one — but a dead button is still a broken screen.
   *
   * Accurate after `whenReady()`; true before config loads, so an early call
   * cannot hide a store the developer does sell through.
   */
  isStoreAvailable(): boolean {
    return this.inAppStoreAllowed
  }

  /**
   * **Should this user see your app?** The ONE signal to gate your UI on.
   *
   * `signed in && (no paywall || has paid access)`.
   *
   * Gating on a session alone is a paid-product giveaway: the session says WHO
   * someone is and nothing about whether they may be here. That is not
   * hypothetical — it is what happened when the gate had to be hand-assembled
   * from three separate reads, which is what this method replaces. Mirrors
   * Swift's `isAllowedIn` and the Flutter getter of the same name.
   *
   * Call it AFTER `whenReady()`: `isPaywallEnabled()` is false until config
   * loads, so an early call can answer true for an unentitled user. The Swift
   * property folds `isReady` in because it is observable; here readiness is
   * awaited, not observed, so awaiting is the caller's half of the contract.
   */
  async isAllowedIn(): Promise<boolean> {
    // WAIT for config, do not merely document that the caller should. Before it
    // resolves `paywallEnabled` is still false, so `!paywallEnabled` was true
    // and this returned TRUE — a plan-less user walked straight into a paid app
    // whenever the gate was consulted on load, which is exactly when apps
    // consult it. The docstring said "call after whenReady()"; a warning in a
    // comment is not a guard. The method is already async, so awaiting costs
    // the caller nothing. Swift folds `isReady` into the same signal and
    // Flutter into a tri-state — this is the JS half of that rule.
    await this.initPromise

    // Config never resolved (offline, 403, 5xx). We do not KNOW whether a plan
    // is required, and `paywallEnabled` is false only because nothing set it —
    // indistinguishable from "this app has no paywall". Unknown must DENY:
    // withholding access is recoverable, giving a paid product away is not.
    if (!this.resolvedConfig) return false

    const session = await this.getSession()
    if (!session) return false

    // ── The server's answer, when it gave one ────────────────────────────────
    // Onelo computes this in app/lib/access_gate.user_access_payload and ships
    // it with the user. Re-deriving it here is what produced three copies of one
    // rule across three SDKs — and the copy in THIS file is the one that
    // answered true for an unentitled user while config was loading.
    if (typeof session.user.allowedIn === 'boolean') return session.user.allowedIn

    // Older backend: no `allowed_in` in the payload. Fall back to the historical
    // derivation rather than locking users out of an app that has not deployed
    // yet — and note this is a COMPATIBILITY path, not a second source of truth.
    // It goes away once the field is everywhere.
    if (!this.paywallEnabled) return true
    return session.user.entitlement === 'active'
  }

  /**
   * Re-fetch the user's entitlement from the backend and, if it changed,
   * rebuild + persist the session so `hasActiveAccess()` and auth-state
   * listeners see the new value. Call after an external checkout or on app
   * resume. Best-effort: returns the currently-cached entitlement on any
   * non-200/network failure and never throws (mirrors Swift
   * `revalidateEntitlement`).
   */
  async revalidateEntitlement(): Promise<OneloEntitlement> {
    const epoch = this.signOutEpoch
    const session = await this.getSession()
    if (!session) return 'none'
    try {
      const { status, json } = await httpGet(
        `${this.apiUrl}/api/sdk/auth/user`,
        {
          'X-SDK-Version': SDK_VERSION,
          Authorization: `Bearer ${session.accessToken}`,
          'X-Publishable-Key': this.publishableKey,
        },
      )
      if (status !== 200) return session.user.entitlement
      const body = json as Record<string, unknown>
      const next: OneloEntitlement = body['entitlement'] === 'active' ? 'active' : 'none'

      // Refresh the SERVER'S ANSWER too, not just the ingredient. This call is
      // what runs right after a purchase, and `isAllowedIn()` now reads
      // `allowedIn` — so updating only `entitlement` would leave the stored
      // answer saying "no" for someone who had just paid. They would be locked
      // out of the thing they bought, by the very refresh meant to let them in.
      const nextAllowedIn = typeof body['allowed_in'] === 'boolean'
        ? (body['allowed_in'] as boolean)
        : session.user.allowedIn

      // Don't resurrect a session that was signed out while this request was
      // in flight (epoch guard, parity with Swift).
      const changed = next !== session.user.entitlement
        || nextAllowedIn !== session.user.allowedIn
      if (changed && epoch === this.signOutEpoch) {
        await this.saveSession({
          ...session,
          user: { ...session.user, entitlement: next, allowedIn: nextAllowedIn },
        })
      }
      return next
    } catch {
      // Best-effort — never throw; keep the cached value.
      return session.user.entitlement
    }
  }

  /** Refresh the access token, rotating the refresh token. Coordinated so the
   *  SAME refresh token is never sent twice (which the backend treats as a
   *  stolen-token replay and hard-revokes the whole session — the multi-tab /
   *  reload-race forced-logout bug). Layer 1: single-flight within this tab.
   *  Layer 2: a cross-tab Web Lock. Falls back to a plain refresh where Web
   *  Locks are unavailable or the lock wait times out. */
  async refreshSession(): Promise<OneloSession | null> {
    // Layer 1 — single-flight: a concurrent caller rides the in-progress refresh
    // rather than firing a second one with the same (about-to-be-rotated) token.
    if (this.refreshInFlight) return this.refreshInFlight
    // Capture the sign-out epoch SYNCHRONOUSLY here — before any coordination
    // await — and thread it down. The cross-tab lock can delay _doRefresh past a
    // synchronous signOut(); capturing inside _doRefresh would miss that signOut
    // and write the just-cleared tokens back. (Regression the epoch-guard test
    // caught: capture must precede the first await, exactly as the pre-refactor
    // code did.)
    const epoch = this.signOutEpoch
    this.refreshInFlight = this._refreshCoordinated(epoch)
    try {
      return await this.refreshInFlight
    } finally {
      this.refreshInFlight = null
    }
  }

  /** Layer 2 — cross-tab exclusivity via the Web Locks API. Only one tab holds
   *  the lock at a time; the winner's `_doRefresh` reads the refresh token
   *  INSIDE the lock, so a tab that waited reads the already-rotated token (or a
   *  still-fresh one) rather than the stale token another tab just used. */
  private async _refreshCoordinated(epoch: number): Promise<OneloSession | null> {
    const locks: LockManager | undefined =
      typeof navigator !== 'undefined' ? navigator.locks : undefined
    if (!locks || typeof locks.request !== 'function') {
      // No Web Locks (older Safari / non-browser runtime) → Layer-1 single-flight
      // is the only coordination available. Correct for the common single-tab case.
      return this._doRefresh(epoch)
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), OneloAuth.REFRESH_LOCK_TIMEOUT_MS)
    // Was the lock actually GRANTED (did `_doRefresh` start)? Only a genuine
    // lock-WAIT timeout — callback never ran — may fall back to an un-serialised
    // refresh. Once `_doRefresh` has started it owns the refresh token: re-running
    // it on a late abort (timeout firing during a slow-then-failing POST) would
    // send the same, possibly already-rotated, token a SECOND time → the exact
    // reuse-detection hard-revoke this whole fix exists to prevent. (Caught in
    // adversarial review.)
    let started = false
    try {
      // Callback form: the lock auto-releases when this promise settles, so a
      // throw/abort can never orphan it (supabase-js #2111). The `signal` bounds
      // only the WAIT for the lock — never the held lock or the in-flight refresh.
      return await locks.request(
        `${OneloAuth.REFRESH_LOCK_PREFIX}:${this.publishableKey}`,
        { signal: controller.signal },
        () => { started = true; return this._doRefresh(epoch) },
      )
    } catch (e) {
      // Fall back ONLY when the lock was never acquired (our wait timed out, or
      // the LockManager rejected pre-grant) — refresh un-serialised rather than
      // hang. If `_doRefresh` already started, its error MUST propagate: never
      // resend the token.
      if (!started && (controller.signal.aborted || (e instanceof DOMException && e.name === 'AbortError'))) {
        return this._doRefresh(epoch)
      }
      throw e
    } finally {
      clearTimeout(timer)
    }
  }

  private async _doRefresh(epoch: number): Promise<OneloSession | null> {
    const refreshToken = await this.storage.get(TOKEN_KEYS.REFRESH_TOKEN)
    if (!refreshToken) return null
    const { status, json } = await httpPost(
      `${this.apiUrl}/api/sdk/auth/refresh`,
      // Wire key MUST be snake_case `refresh_token`: the backend
      // RefreshRequest model (sdk_auth.py) requires it and rejects a
      // camelCase `refreshToken` with a hard 422 (the handler never runs).
      // Matches every response payload + the Swift SDK request.
      { publishableKey: this.publishableKey, refresh_token: refreshToken },
      { 'X-SDK-Version': SDK_VERSION }
    )
    checkHostedFlowRequired(json)
    const j = json as Record<string, unknown>
    if (status !== 200) {
      // Any non-200 invalidates the session locally. The backend returns the
      // reason in an HTTPException body: { detail: { error | error_code } }
      // (NOT a top-level `error` — the old branches here were dead).
      this.clearRefreshTimer(); await this.storage.clear(); this.notifyListeners(null)
      const detail = j['detail'] as Record<string, unknown> | undefined
      const reason = (detail?.['error'] ?? detail?.['error_code']) as string | undefined
      // Hard account revocation (banned / session server-revoked) → userRevoked.
      if (reason === 'banned' || reason === 'session_compromised') {
        this.isUserRevoked = true
        throw OneloError.userRevoked()
      }
      // No active plan (lapsed) is NOT an account revocation — surface a
      // plan-accurate error, never "account suspended" (parity with Swift,
      // which never labels no-plan as a revocation). The session is still
      // cleared above: the backend enforces sign-out, so the app should route
      // the buyer to the store / upgrade.
      if (reason === 'no_plan_available') {
        throw OneloError.noActivePlan()
      }
      // benign (session_expired / session_invalid) → just clear + null.
      return null
    }
    // Sign-out (or a hard revoke) raced this refresh while its request was in
    // flight: do NOT write the just-cleared tokens back. Parity with Swift's
    // _signOutEpoch guard.
    if (epoch !== this.signOutEpoch) return null
    const session = mapSession(j)
    await this.saveSession(session)
    return session
  }

  /**
   * Wire the shared event stream (called once by Onelo). Registers a
   * `session.revoked` listener so a server-side revoke (refund lapse, admin
   * force-logout, account deletion, ban) signs the user out in ~sub-second —
   * the real-time complement to the ≤13-min heartbeat fallback. Registered once
   * and survives sign-in/sign-out cycles, exactly like the Swift SDK.
   */
  attachEventStream(stream: OneloEventStream): void {
    stream.on('session.revoked', (data) => { void this._handleSessionRevoked(data) })
  }

  /**
   * Handle a `session.revoked` push. Filters to the current user (one app can
   * have multiple buyers multiplexed on the shared stream); a missing
   * `app_user_id` is treated as "current user" (forward-compat). No session →
   * ignore. Teardown mirrors the heartbeat-401 path exactly.
   */
  private async _handleSessionRevoked(data: Record<string, unknown>): Promise<void> {
    const userJson = await this.storage.get(TOKEN_KEYS.USER_JSON)
    if (!userJson) return // no active session — nothing to revoke
    let currentUserId: string | undefined
    try { currentUserId = (JSON.parse(userJson) as OneloUser).id } catch { /* treat as current user */ }
    const eventUserId = data['app_user_id']
    if (typeof eventUserId === 'string' && currentUserId && eventUserId !== currentUserId) {
      return // targets a different buyer on this shared connection
    }
    this.stopHeartbeat()
    this.clearRefreshTimer()
    await this.storage.clear()
    this.isUserRevoked = true
    this.notifyListeners(null)
  }

  onAuthStateChange(callback: (session: OneloSession | null) => void): () => void {
    this.authStateListeners.push(callback)
    return () => {
      this.authStateListeners = this.authStateListeners.filter(l => l !== callback)
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private startHeartbeat(accessToken: string): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(async () => {
      const session = await this.getSession()
      if (!session) { this.stopHeartbeat(); return }
      try {
        const res = await fetch(`${this.apiUrl}/api/sdk/presence/heartbeat`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.accessToken}` },
        })
        // The backend heartbeat is a validity probe: it returns 401 when the
        // account is revoked/banned OR every session was server-revoked
        // (account deletion, refund-induced logout, admin force-logout). Act on
        // it — otherwise the user stays "logged in" until the token TTL. ONLY
        // 401 signs out; other statuses (204 ok, 5xx) fail open, matching the
        // backend, which fails open on its own DB-lookup errors.
        if (res.status === 401) {
          this.stopHeartbeat()
          this.clearRefreshTimer()
          await this.storage.clear()
          this.isUserRevoked = true
          this.notifyListeners(null)
        }
      } catch {
        // Network error — fail-open; the next tick retries.
      }
    }, OneloAuth.HEARTBEAT_MS)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  /**
   * Schedule a background refresh of the access token to fire `REFRESH_LEAD_SECONDS`
   * before it expires. Idempotent — cancels any pending refresh first. Without this,
   * an idle app would carry a stale token past its TTL and the next request would 401.
   */
  private scheduleRefresh(session: OneloSession): void {
    this.clearRefreshTimer()
    const nowSec = Date.now() / 1000
    const delaySec = session.expiresAt - nowSec - OneloAuth.REFRESH_LEAD_SECONDS
    const delayMs = delaySec > 0 ? delaySec * 1000 : 0
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null
      void this.refreshSession().catch(() => {
        // Errors are already handled inside refreshSession (clears storage / notifies listeners).
      })
    }, delayMs)
  }

  private clearRefreshTimer(): void {
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = null
    }
  }

  /**
   * @param announce Tell OTHER TABS a sign-in just happened. Only a genuine
   *   sign-in announces. A token REFRESH must not: a tab sitting on the
   *   sign-in screen would settle its modal, look for the session, find none
   *   (the refresh happened in a different tab, not this one) and report a
   *   cancelled sign-in — worse than the waiting it replaced.
   */
  private async saveSession(session: OneloSession, { announce = false } = {}): Promise<void> {
    await Promise.all([
      this.storage.set(TOKEN_KEYS.ACCESS_TOKEN, session.accessToken),
      this.storage.set(TOKEN_KEYS.REFRESH_TOKEN, session.refreshToken),
      this.storage.set(TOKEN_KEYS.EXPIRES_AT, String(session.expiresAt)),
      this.storage.set(TOKEN_KEYS.USER_JSON, JSON.stringify(session.user)),
    ])
    // Arm the timers BEFORE notifying so the `heartbeatTimer !== null` invariant
    // holds while listeners run — a listener that synchronously calls getSession
    // must not see a null timer and fire a spurious second notify. (Mirrors the
    // ordering in the getSession restore branch.)
    this.startHeartbeat(session.accessToken)
    this.scheduleRefresh(session)
    this.notifyListeners(session)
    // Fire-and-forget: nothing here depends on whether another tab heard.
    if (announce) publishSessionCreated()
  }

  private notifyListeners(session: OneloSession | null): void {
    for (const cb of this.authStateListeners) cb(session)
  }

  /** Import a session obtained outside of OneloAuth (e.g. from paywall flow). Saves tokens and notifies listeners. */
  async importSession(session: OneloSession): Promise<void> {
    await this.saveSession(session)
  }

  /**
   * Email a sign-in link. **Custom-UI path — paid plans only.**
   *
   * The plan gate matches `signIn()` / `signUp()` above. It was missing here, so
   * on a free plan the call succeeded, the mail went out, and the developer had
   * an API they could never finish: without `allowCustomBranding` they may not
   * build their own sign-in screen at all, which is the only place this method
   * makes sense. Either both are gated or neither; a half-working API is worse
   * than a refused one.
   *
   * On a free plan use the hosted sign-in page (`loadAuthView()`), where magic
   * link is available to everyone and the return trip is already wired.
   */
  async sendMagicLink(email: string, redirectTo?: string): Promise<void> {
    await this.initPromise
    if (!this.allowCustomBranding) throw OneloError.planRequired()
    const body: Record<string, unknown> = { publishableKey: this.publishableKey, email }
    if (redirectTo) body.redirectTo = redirectTo

    // ── PKCE, now that the verifier can outlive the tab ──────────────────────
    // This used to send NO challenge, and the reason was sound: the SDK's
    // `pkceVerifier` lives in memory, a magic link is opened later in a NEW tab,
    // so the verifier would be gone and /hosted-callback would 401 on a link
    // already marked used — a lockout with no recovery. A challenge-less link is
    // weaker; a burnt link is broken.
    //
    // What changed is where the verifier lives. The email opens the same ORIGIN,
    // so a persisted verifier survives the trip and the binding holds: a link
    // forwarded to another device has no matching verifier and cannot complete.
    //
    // If persistence is unavailable (Safari private mode falls back to an
    // in-memory store, which the new tab cannot read), we send no challenge and
    // keep today's behaviour. Degrading to the weaker link beats minting one
    // that is guaranteed to fail.
    const verifier = generateCodeVerifier()
    if (await this.persistMagicLinkVerifier(verifier)) {
      body.code_challenge = await generateCodeChallenge(verifier)
    }
    const { status: mlStatus, json: mlJson } = await httpPost(`${this.apiUrl}/api/sdk/auth/magic-link`, body, { 'X-SDK-Version': SDK_VERSION })
    if (mlStatus >= 400) throw OneloError.server(`Magic link request failed: HTTP ${mlStatus}`)
    // Read the BODY too. A 200 carrying `success: false` used to be reported as
    // a sent mail, so a refusal the backend spelled out reached the developer as
    // silence. Only an explicit `false` throws — an older backend that returns
    // an empty body is still treated as success.
    if ((mlJson as Record<string, unknown> | null)?.['success'] === false) {
      const reason = (mlJson as Record<string, unknown>)['error']
      throw OneloError.server(`Magic link refused${typeof reason === 'string' ? `: ${reason}` : ''}`)
    }
  }

  /** End this tab's part in the flow: show the farewell notice and refuse to
   *  present anything afterwards — including the host app's own startup call to
   *  loadAuthView(), which otherwise opened a login form on top of the notice. */
  private finishAsMessengerTab(): void {
    this.handedOverToAnotherTab = true
    showHandedOverNotice(this.appName)
  }

  /**
   * Tell the hosted page which page to send the browser back to.
   *
   * Only magic link needs this, and only on the web: every other hosted step
   * finishes inside the iframe and answers by postMessage, but a magic link is
   * opened LATER from an email, in a tab that has no way back to this one. The
   * hosted page passes this along when it requests the link, and the BACKEND
   * validates it against the app's allowed origins — so this value is a
   * suggestion, never a trusted input. A page that lies about its own URL only
   * gets a 400.
   */
  private withReturnTo(url: string): string {
    if (typeof window === 'undefined') return url
    try {
      const u = new URL(url)
      const here = new URL(window.location.href)
      // Strip any code already sitting in the address bar: this URL becomes the
      // magic link's destination, and carrying a spent code into it would make
      // the returning page try to exchange the wrong one.
      here.searchParams.delete('onelo_code')
      u.searchParams.set('return_to', here.toString())
      return u.toString()
    } catch {
      // A URL we cannot parse is not one we should be rewriting.
      return url
    }
  }

  /**
   * Write the magic-link verifier somewhere the NEXT tab can read it.
   *
   * Returns false when the value did not actually reach durable storage, which
   * is the only signal `sendMagicLink` needs: no durable verifier → no
   * challenge. `TokenStorage.set` degrades to an in-memory map rather than
   * throwing (Safari private mode, disabled storage), and that map is invisible
   * to the tab the email opens — so a successful `set` is NOT proof of
   * persistence. Reading it back through a fresh instance is.
   */
  private async persistMagicLinkVerifier(verifier: string): Promise<boolean> {
    try {
      await this.storage.set(TOKEN_KEYS.MAGIC_LINK_VERIFIER, verifier)
      return typeof localStorage !== 'undefined'
        && localStorage.getItem(TOKEN_KEYS.MAGIC_LINK_VERIFIER) === verifier
    } catch {
      return false
    }
  }

  /**
   * Finish a magic-link sign-in after the browser has returned to your page.
   *
   * The email opens a new tab on Onelo, which consumes the link and sends the
   * browser to the `redirectTo` you passed to `sendMagicLink`, with a one-time
   * code appended as `onelo_code`. This exchanges that code for a session.
   *
   * Called automatically during `init()`, so most apps never call it directly;
   * it is public for apps that route their own way and want to control when the
   * exchange happens.
   *
   * Resolves to the session, or null when the URL carries no code — the normal
   * case on every ordinary page load, and deliberately not an error.
   */
  async completeFromUrl(): Promise<OneloSession | null> {
    await this.initPromise
    return this.exchangeCodeFromUrl()
  }

  /** The body of `completeFromUrl` WITHOUT the `initPromise` await, so
   *  `initialize()` can run it without waiting on itself. */
  private async exchangeCodeFromUrl(): Promise<OneloSession | null> {
    if (typeof window === 'undefined') return null

    const url = new URL(window.location.href)

    // ── Magic link, stopped by the Access Gate ───────────────────────────────
    // The user proved who they are and has NO plan, so no session exists and
    // there is nothing to exchange. WHICH screen they are owed — the store or
    // "No active plan" — depends on the gate, and this SDK deliberately does not
    // decide: it asks the backend again, the way every other entry point does.
    // The URL is carried, not re-derived: a refused user has no session, so
    // asking the backend again answers "nobody is signed in".
    //
    // This tab is still the only one that can speak to the tab the user started
    // in, which is exactly why the landing page sent the browser back here
    // instead of parking it on an Onelo surface. Announce, and the waiting tab
    // re-resolves and presents the right screen where the user actually is.
    const gateSurface = url.searchParams.get('onelo_gate')
    if (gateSurface) {
      url.searchParams.delete('onelo_gate')
      try { window.history.replaceState({}, '', url.toString()) } catch { /* non-browser host */ }

      // Tell the tab the user started in WHICH screen to show, then stop. This
      // tab does not act on whether anyone heard: it ends with the farewell
      // notice either way. Earlier versions carried on into the app, the store or
      // a login form depending on who was listening, and that timing-dependent
      // behaviour is exactly what is being removed (Adrian, 2026-08-19).
      publishSessionCreated(gateSurface)
      this.finishAsMessengerTab()

      // Null, not an error: "you have no plan" is an answer, not a failure.
      return null
    }

    const code = url.searchParams.get('onelo_code')
    // Plain page load: nothing to do, and DO NOT touch the cover. The automatic
    // run during init() has already handled any marker and stripped it, so by
    // the time a caller invokes this again there is no marker left — tearing the
    // cover down here removed the notice that run had just put up.
    if (!code) return null

    // Cover the page BEFORE the exchange. This tab carries a one-time code, so
    // it is a magic-link return by definition — and the app boots underneath
    // while we work. Waiting until the outcome is known let the app paint itself
    // as signed in first, so the user saw it flash up and get replaced
    // (reported 2026-08-18). Taken away below if nobody was waiting.
    coverPage()

    // Strip the code from the address bar BEFORE the exchange, and do it
    // whatever the outcome. A one-time code in a URL is a credential: it leaks
    // through history, the Referer header and any analytics that logs the path.
    // `replaceState` also stops a reload from re-running a spent exchange.
    url.searchParams.delete('onelo_code')
    try { window.history.replaceState({}, '', url.toString()) } catch { /* non-browser host */ }

    const codeVerifier = await this.storage.get(TOKEN_KEYS.MAGIC_LINK_VERIFIER)

    const { status, json } = await httpPost(
      `${this.apiUrl}/api/sdk/auth/hosted-callback`,
      { publishableKey: this.publishableKey, code, code_verifier: codeVerifier },
      { 'X-SDK-Version': SDK_VERSION },
    )

    // Single-use either way: on success it is spent, on failure it is not going
    // to start working, and keeping it would bind the next link to a stale
    // value. Deleted before the status check so an early return cannot skip it.
    await this.storage.delete(TOKEN_KEYS.MAGIC_LINK_VERIFIER)

    if (status !== 200) {
      // Uncover before failing: the caller shows its own error, and leaving a
      // "Signing you in…" screen over a dead exchange is the worst of both.
      removeCover()
      throw OneloError.server(`Magic link sign-in failed: HTTP ${status}`)
    }
    const session = mapSession(json as Record<string, unknown>)
    await this.saveSession(session, { announce: true })

    // ── This tab is a messenger, never the app ───────────────────────────────
    // It exists only because a magic link opens its own tab. It had to finish the
    // exchange — no other origin may write this origin's storage — and then it is
    // done: a farewell message and nothing else, whether or not another tab was
    // listening. Signing in happens in the tab the user started from, full stop
    // (Adrian, 2026-08-19).
    this.finishAsMessengerTab()

    return session
  }

  async sendPasswordReset(email: string, redirectTo?: string): Promise<void> {
    await this.initPromise
    const body: Record<string, unknown> = { publishableKey: this.publishableKey, email }
    if (redirectTo) body.redirectTo = redirectTo
    const { status: prStatus } = await httpPost(`${this.apiUrl}/api/sdk/auth/reset-password/request`, body, { 'X-SDK-Version': SDK_VERSION })
    if (prStatus >= 400) throw OneloError.server(`Password reset request failed: HTTP ${prStatus}`)
  }
}
