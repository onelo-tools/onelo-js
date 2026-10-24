import { generateCodeVerifier, generateCodeChallenge } from '@onelo/core'
import { hostOS } from '../core/host-os'
import { httpGet, httpPost, checkHostedFlowRequired } from '@onelo/core'
import { mapSession } from '@onelo/core'
import { TokenStorage, TOKEN_KEYS } from '../core/storage'
import { publishSessionCreated } from '../core/session-channel'
import { coverPage, removeCover, showHandedOverNotice } from '../core/handed-over-notice'
import { forgetStoreReturnLook, recallStoreReturnLook, signingInText } from '../core/store-return-look'
import { OneloEventStream } from '../core/event-stream'
import { isUserRevokedRefusal } from '../core/user-revoked'
import { AuthModal, MINIMAL_AUTH_SKELETON_SHAPE, isExpiredAuthError, type AuthPresentMode, type AuthSkeletonShape } from './auth-modal'
import type { PlanChange } from '../core/plan-change'
import {
  exchangeExternalToken,
  renewalLeadSeconds,
  DEFAULT_EXTERNAL_LEAD_SECONDS,
  type ExternalTokenGetter,
} from './external-token'
import {
  OneloConfig,
  OneloSession,
  OneloUser,
  OneloEntitlement,
  OneloError,
  isSessionEndError,
  ResolvedSDKConfig,
  brandTokensFromResponse,
  NEUTRAL_BRAND_TOKENS,
} from '@onelo/core'
import { SDK_HEADERS } from '../core/sdk-headers'
import { BrandSource, resendVerificationEmail as postResendVerification, confirmEmail as postConfirmEmail, mergeAccessAnswer, type ResendVerificationResult } from '@onelo/core'
import {
  configLanguageParam,
  signUpConsentFields,
  signupMarketingConsentFromConfig,
  NO_SIGNUP_MARKETING_CONSENT,
  type SignUpOptions,
  type SignupMarketingConsent,
} from '@onelo/core'

// Lives in auth-modal.ts (the popup has to outlive an expiry, #625); re-exported
// here so callers and tests keep importing it from the auth module.
export { isExpiredAuthError }

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

/**
 * Before restarting on a spent addressing token, must the local session go?
 *
 * Only when the user chose to leave: the ✕ and "Use a different account"
 * report `invalid_token` after signing out server-side, and on a surface
 * stamped `exit=signout` re-resolving with the old tokens would reopen the same
 * screen. A link that merely DIED (`token_expired`, #619 — the access-gate store
 * outlived its link) is not a choice to leave: the user stays signed in and the
 * restart brings the same store back on a fresh link.
 */
/** Shared by every tab of the App: set by an external-mode signOut(), removed
 *  by useExternalToken() (#836). */
const EXTERNAL_SIGNED_OUT_KEY = 'onelo_external_signed_out'

export function signOutBeforeRestart(message: string, url: string): boolean {
  return message === 'invalid_token' && closingMeansSignOut(url)
}

export class OneloAuth {
  /** Lets the auth/store modal answer a checkout's portal renewal (#642).
   *  Set by `Onelo` to the customer portal's `renewReply`. */
  private renewPortal: ((requestId: string) => Promise<Record<string, unknown>>) | null = null
  setPortalRenewer(fn: ((requestId: string) => Promise<Record<string, unknown>>) | null): void {
    this.renewPortal = fn
  }

  /** Told when a hosted flow this class presented ended in a purchase or a
   *  plan switch (#659). Set by `Onelo` to its plan-change refresher. */
  private onPlanChange: ((change: PlanChange) => void) | null = null
  setPlanChangeHandler(fn: ((change: PlanChange) => void) | null): void {
    this.onPlanChange = fn
  }

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
   *  Locks issues #1594/#2111). On timeout this tab never refreshes on its own
   *  (that would resend the token the holder has in flight): it adopts the
   *  holder's result if it has landed, else keeps the session and retries. */
  private static readonly REFRESH_LOCK_TIMEOUT_MS = 5000
  /** Retry a TRANSIENT refresh failure (offline, a lost response, 429, 5xx —
   *  incl. `503 refresh_unavailable`) with backoff: 5 s, 10 s, 20 s, 40 s,
   *  then every 60 s. The session is kept. The first retry lands inside the
   *  server's 30 s refresh-token grace window, so a request whose response was
   *  lost is retried while the server still accepts that token. */
  private static readonly REFRESH_RETRY_BASE_MS = 5000
  private static readonly REFRESH_RETRY_MAX_MS = 60_000
  private refreshRetryAttempt = 0
  /** Until this time (ms) getSession() does not start another refresh on its
   *  own — the scheduled retry owns it. Stops an app that reads the session
   *  often from hammering /auth/refresh during an outage. */
  private refreshBackoffUntil = 0
  // ── External sign-in (#798, ADR-0032) ──────────────────────────────────────
  /** The App's own sign-in provider, once handed over with useExternalToken().
   *  While set, the session is renewed by exchanging a fresh provider token
   *  (there is no refresh token) and no Onelo sign-in screen is ever shown. */
  private externalToken: ExternalTokenGetter | null = null
  /** True while the `storage` listener that keeps external sign-out in step
   *  across tabs is attached (#836). */
  private externalStorageListener: ((e: StorageEvent) => void) | null = null
  /** The last exchange was refused because the provider's token was outside
   *  its validity window (#836). Once the Onelo access token has expired too,
   *  the session ends instead of being retried forever. */
  private externalTokenStale = false
  /** This tab has already told its listeners about the external sign-out, so
   *  a later renewal attempt that finds the mark stays silent (#836). */
  private externalSignOutHeard = false
  /** Seconds before expiry at which the external session is renewed: set with
   *  jitter by each exchange this tab makes. */
  private externalLeadSeconds = DEFAULT_EXTERNAL_LEAD_SECONDS
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

  /** The SDK's one brand-token model (#681), shared with every modal. `Onelo`
   *  passes its own; a standalone OneloAuth keeps a private one. */
  readonly brand: BrandSource

  /** #948: the hosted form's sign-in methods for the loading skeleton. Before
   *  config (or on an older backend) the minimal shape: never a pill the page
   *  will not draw. */
  authSkeletonShape(): AuthSkeletonShape {
    const c = this.resolvedConfig
    if (!c) return MINIMAL_AUTH_SKELETON_SHAPE
    return { socialCount: c.oauthProviders?.length ?? 0, magicLink: c.magicLinkEnabled === true }
  }

  constructor(config: OneloConfig, brand: BrandSource = new BrandSource()) {
    this.brand = brand
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
        if (q.get('onelo_store_code')) this.coverStoreReturn()
        else if (q.get('onelo_code') || q.get('onelo_gate') || q.get('onelo_link')) coverPage(this.brand.current())
      } catch { /* an unparsable location is not ours to fix */ }
    }

    try {
      const verifier = generateCodeVerifier()
      this.pkceVerifier = verifier
      const challenge = await generateCodeChallenge(verifier)
      // #818: `lang` puts the sign-up Marketing Consent text in the browser's language.
      const url = `${this.apiUrl}/api/sdk/config?key=${encodeURIComponent(this.publishableKey)}&code_challenge=${encodeURIComponent(challenge)}${configLanguageParam()}`
      // X-Onelo-OS decides whether the "Require plan on sign-up" gate applies:
      // inside a Capacitor/Cordova iOS shell this SDK runs in an App Store app,
      // where showing the store in-app is not allowed. A plain browser reports
      // 'web' and nothing changes. See core/host-os.ts.
      const { status, json } = await httpGet(url, {
        ...SDK_HEADERS,
        'X-Onelo-OS': hostOS(),
      })
      if (status === 401 || status === 404) throw OneloError.invalidKey('Server rejected the key')
      if (status !== 200) throw OneloError.server(`Config request failed: HTTP ${status}`)
      const j = json as Record<string, unknown>
      // #681: `brand_tokens`, or the shape the legacy colours imply.
      const brandTokens = brandTokensFromResponse(j) ?? NEUTRAL_BRAND_TOKENS
      this.brand.set(brandTokens)
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
        // Branding page background — the token's page_bg (#681).
        pageBackgroundColor: brandTokens.page_bg,
        brandTokens,
        signupMarketingConsent: signupMarketingConsentFromConfig(j),
        // #948: the sign-in skeleton draws the hosted form's shape from these.
        oauthProviders: Array.isArray(j['oauth_providers']) ? (j['oauth_providers'] as string[]) : [],
        magicLinkEnabled: j['magic_link_enabled'] === true,
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

    // External sign-in (#798): the App's own provider signs the user in, so
    // there is no Onelo screen to open. The answer is the session the provider's
    // token was exchanged for, or null when the provider has no user.
    if (this.externalToken) return this.getSession()

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

    // Keep this tab's verifier where a magic link opened in THIS browser can find
    // it (#535). The developer's page it returns to proves "same browser" by
    // holding it, and completes in one click; any other browser does not have it
    // and is sent to type the code this tab's hosted page shows. Best effort:
    // without durable storage the same-browser case falls back to the code too.
    // One slot per browser, deliberately: if another tab of this app opens the
    // sign-in later, it overwrites this value, and a link requested HERE then
    // takes the code path in this browser as well. That is the safe direction —
    // slower, never wrong — and keying per flow would need the link to carry
    // which flow it belongs to.
    if (this.pkceVerifier) await this.persistMagicLinkVerifier(this.pkceVerifier)

    // present → open the hosted flow; it chains to the store itself when needed,
    // so we wait for exactly ONE final code and exchange it.
    const modal = new AuthModal(this.brand, () => this.authSkeletonShape())
    const result = await modal.open(this.withReturnTo(decision.url), mode, {
      watchCrossTabSession: true,
      renewPortal: this.renewPortal ?? undefined,
    })

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
        return this.restartFlow(options, signOutBeforeRestart(result.message, decision.url))
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
        const gate = await new AuthModal(this.brand).open(surface, mode, { renewPortal: this.renewPortal ?? undefined })
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
          return this.restartFlow(options, signOutBeforeRestart(gate.message, surface))
        }
        // Bought a plan in the store → a code comes back and is exchanged like
        // any other. Closed it instead → null, and the app keeps its locked
        // screen.
        if (gate.type === 'code') return this.exchangeStoreCode(gate.code)
        return null
      }

      // No surface named: nothing was decided for us, so ask.
      return this.loadAuthView(options)
    }

    // The store reached through the flow finished a plan switch with no code
    // (#599). Nothing to exchange: the caller is the signed-in user.
    if (result.type === 'done') {
      this.onPlanChange?.({ kind: 'switched', reason: result.reason })
      return this.getSession()
    }

    return this.exchangeStoreCode(result.code)
  }

  /** A code from a hosted flow that may have chained into the store: exchange
   *  it, then reconcile the plan at once (#659) instead of waiting for the
   *  stream — a sign-in without a purchase only costs one extra resolve. */
  private async exchangeStoreCode(code: string): Promise<OneloSession> {
    const session = await this.exchangeHostedCode(code)
    this.onPlanChange?.({ kind: 'purchase' })
    return session
  }

  /**
   * Start the hosted flow over after the page reported its flow token spent.
   *
   * The popup the page ran in was parked by AuthModal rather than closed, so
   * the new flow reuses it instead of calling `window.open` without a user
   * gesture, which browsers block (#625). Whatever the new pass does, a popup
   * it did not adopt (it answered "authorized", or it failed) is closed here.
   */
  private async restartFlow(
    options: Parameters<OneloAuth['loadAuthView']>[0],
    signOutFirst: boolean,
  ): Promise<OneloSession | null> {
    try {
      if (signOutFirst) await this.signOut()
      return await this.loadAuthView(options)
    } finally {
      AuthModal.discardParkedPopup()
    }
  }

  /** Trade a one-time hosted code for a session. One implementation, because
   *  the hosted flow can hand a code back from more than one surface. */
  private async exchangeHostedCode(code: string): Promise<OneloSession> {
    const { status, json } = await httpPost(
      `${this.apiUrl}/api/sdk/auth/hosted-callback`,
      { publishableKey: this.publishableKey, code, code_verifier: this.pkceVerifier },
      { ...SDK_HEADERS }
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
    const headers: Record<string, string> = { ...SDK_HEADERS }
    // Same Bearer pattern the SDK already uses for GET /api/sdk/auth/user
    // (revalidateEntitlement) — CORS on /api/sdk/* already allows Authorization.
    if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`
    // PKCE for the hosted flow (#535). Without a challenge on the flow token, a
    // code the hosted page hands out — and the magic link it requests — is a
    // bearer credential: whoever holds it signs in. Bound to `pkceVerifier`,
    // only this tab can exchange it, which is what lets a link opened on another
    // device sign THIS tab in without giving that device anything.
    const challenge = this.pkceVerifier ? await generateCodeChallenge(this.pkceVerifier) : null
    const challengeParam = challenge ? `&code_challenge=${encodeURIComponent(challenge)}` : ''
    const { status, json } = await httpGet(
      `${this.apiUrl}/api/sdk/flow/init?key=${encodeURIComponent(this.publishableKey)}&callback_scheme=onelo-callback${challengeParam}`,
      headers,
    )
    if (status !== 200) {
      if (isUserRevokedRefusal(json)) {
        this.isUserRevoked = true
        throw OneloError.userRevoked()
      }
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
      { ...SDK_HEADERS }
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

  /**
   * #818 — should your own sign-up screen show the optional Marketing Consent
   * checkbox, and with what text? Set on the parent App in Auth → Sign-up; an
   * App that sells asks at Checkout instead (`asked` false). Show `text`
   * unticked and pass the person's choice to `signUp(..., { marketingConsent })`.
   * Accurate after `whenReady()`.
   */
  getSignupMarketingConsent(): SignupMarketingConsent {
    return this.resolvedConfig?.signupMarketingConsent ?? NO_SIGNUP_MARKETING_CONSENT
  }

  async signUp(email: string, password: string, options?: SignUpOptions): Promise<OneloSession> {
    await this.initPromise
    if (!this.allowCustomBranding) throw OneloError.planRequired()
    if (!this.pkceVerifier) this.pkceVerifier = generateCodeVerifier()
    const { status, json } = await httpPost(
      `${this.apiUrl}/api/sdk/auth/signup`,
      {
        email, password, publishableKey: this.publishableKey, code_verifier: this.pkceVerifier,
        // #818: only when the person ticked it, in the language of the text shown.
        ...signUpConsentFields(options, this.getSignupMarketingConsent()),
      },
      { ...SDK_HEADERS }
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
    // External sign-in: the provider would hand out a token again at the next
    // renewal. Stop until useExternalToken() is called again — in EVERY tab
    // (#836): the mark is written to the storage all tabs share, so another
    // tab's renewal timer finds it instead of signing the user back in.
    const external = this.externalToken !== null
    if (external) this.externalSignOutHeard = true
    this.stopHeartbeat()
    this.clearRefreshTimer()
    // Tear down ALL local state up-front, BEFORE the network await below —
    // otherwise a proactive refresh (token still in storage) could fire during
    // the await and re-establish the session. Capture the token first for the
    // best-effort server revoke.
    const accessToken = await this.storage.get(TOKEN_KEYS.ACCESS_TOKEN)
    await this.storage.clear()
    if (external) await this.storage.set(EXTERNAL_SIGNED_OUT_KEY, String(Date.now()))
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
            ...SDK_HEADERS,
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
    if (!accessToken || !this._hasRenewal(refreshToken) || !userJson) return null
    // External sign-in ended in another tab (#836).
    if (this.externalToken && await this._externalSignedOut()) return null
    const expiresAt = parseInt(expiresAtStr ?? '0', 10)
    if (Date.now() / 1000 > expiresAt - this._refreshLeadSeconds()) {
      // The provider keeps handing out an expired token and the Onelo access
      // token has now expired as well: the user is signed out, not "renewing".
      if (this.externalToken && this.externalTokenStale && Date.now() / 1000 >= expiresAt) {
        await this._endSession()
        return null
      }
      // A transient failure already scheduled a retry: don't start another
      // refresh per read. The access token may still be good for a moment.
      if (Date.now() < this.refreshBackoffUntil) return this._storedSession()
      // A refused refresh is an expected state change, not an error of the
      // caller's: the session is already cleared and onAuthStateChange(null)
      // has fired. getSession() answers "no session" for it — it is called from
      // timers and background tasks (heartbeat, Features, the Event Stream), and
      // a throw there surfaced to Monitor as an `unhandled` error. Call
      // refreshSession() directly to learn WHY the session ended.
      //
      // A TRANSIENT failure (offline, 429, 5xx, a busy other tab) is not a
      // sign-out either: the session is kept and a retry is scheduled, so the
      // read answers with the stored session (its access token may be stale
      // until the retry lands) instead of throwing into the caller.
      return this.refreshSession().catch((e: unknown) => {
        if (isSessionEndError(e)) return null
        return this._storedSession()
      })
    }
    const session: OneloSession = { accessToken, refreshToken: refreshToken ?? '', expiresAt, user: JSON.parse(userJson) as OneloUser }
    // External sign-in: only the renewal timer. There is no restore to announce
    // (useExternalToken() exchanges on every start and that announces), and no
    // heartbeat (see saveSession).
    if (this.externalToken) {
      this.externalSignOutHeard = false
      this.scheduleRefresh(session)
      return session
    }
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
          ...SDK_HEADERS,
          Authorization: `Bearer ${session.accessToken}`,
          'X-Publishable-Key': this.publishableKey,
        },
      )
      if (status !== 200) {
        if (isUserRevokedRefusal(json)) this.isUserRevoked = true
        return session.user.entitlement
      }
      const body = json as Record<string, unknown>
      const next: OneloEntitlement = body['entitlement'] === 'active' ? 'active' : 'none'

      // Refresh the SERVER'S ANSWER too, not just the ingredient. This call is
      // what runs right after a purchase, and `isAllowedIn()` now reads
      // `allowedIn` — so updating only `entitlement` would leave the stored
      // answer saying "no" for someone who had just paid. They would be locked
      // out of the thing they bought, by the very refresh meant to let them in.
      // #819: allowedIn, emailVerified and accessReason move together — a
      // just-verified user must not keep a stored "not allowed".
      const nextUser = mergeAccessAnswer({ ...session.user, entitlement: next }, body)

      // Don't resurrect a session that was signed out while this request was
      // in flight (epoch guard, parity with Swift).
      const changed = next !== session.user.entitlement
        || nextUser.allowedIn !== session.user.allowedIn
        || nextUser.emailVerified !== session.user.emailVerified
        || nextUser.accessReason !== session.user.accessReason
      if (changed && epoch === this.signOutEpoch) {
        await this.saveSession({ ...session, user: nextUser })
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
   *  Layer 2: a cross-tab Web Lock. Falls back to a plain refresh only where
   *  Web Locks are unavailable; a lock-wait timeout adopts the other tab's
   *  result or reports a transient `timeout` — it never resends the token. */
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
    // The token this tab would rotate, read BEFORE waiting. While we wait,
    // another tab may rotate it; comparing against this tells us so, and then
    // that tab's result is ours too — no second refresh at all.
    const seen = await this.storage.get(this._renewalKey())
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), OneloAuth.REFRESH_LOCK_TIMEOUT_MS)
    // Was the lock actually GRANTED (did the callback start)? Once `_doRefresh`
    // has started it owns the refresh token: re-running it on a late abort
    // (timeout firing during a slow-then-failing POST) would send the same,
    // possibly already-rotated, token a SECOND time → the reuse-detection
    // revoke this whole fix exists to prevent. (Caught in adversarial review.)
    let started = false
    try {
      // Callback form: the lock auto-releases when this promise settles, so a
      // throw/abort can never orphan it (supabase-js #2111). The `signal` bounds
      // only the WAIT for the lock — never the held lock or the in-flight refresh.
      return await locks.request(
        `${OneloAuth.REFRESH_LOCK_PREFIX}:${this.publishableKey}`,
        { signal: controller.signal },
        async () => {
          started = true
          // Another tab refreshed while we waited: adopt its session.
          const adopted = await this._adoptOtherTabRefresh(seen)
          if (adopted !== undefined) return adopted
          return this._doRefresh(epoch)
        },
      )
    } catch (e) {
      // The lock was never granted (our wait timed out, or the LockManager
      // rejected pre-grant). Another tab still holds it with the SAME token in
      // flight, so refreshing now would replay that token. Re-read storage and
      // use the other tab's result if it has landed; otherwise report a
      // transient failure and keep the session — the next read retries through
      // the lock. Never hang, never replay.
      if (!started && (controller.signal.aborted || (e instanceof DOMException && e.name === 'AbortError'))) {
        const adopted = await this._adoptOtherTabRefresh(seen)
        if (adopted !== undefined) return adopted
        if (epoch === this.signOutEpoch) this._scheduleRefreshRetry()
        throw OneloError.timeout('Another tab is still refreshing the session')
      }
      throw e
    } finally {
      clearTimeout(timer)
    }
  }

  /** If another tab changed the stored refresh token since `seen` was read,
   *  return the outcome it left in storage: its rotated session, or null when
   *  it ended the session. `undefined` = nothing changed, this tab must act. */
  private async _adoptOtherTabRefresh(seen: string | null): Promise<OneloSession | null | undefined> {
    if (!seen) return undefined
    const current = await this.storage.get(this._renewalKey())
    if (current === seen) return undefined
    const session = current ? await this._storedSession() : null
    if (!session) {
      // The other tab's refresh was refused and it cleared the shared storage.
      this.clearRefreshTimer()
      this.notifyListeners(null)
      return null
    }
    this.refreshRetryAttempt = 0
    this.refreshBackoffUntil = 0
    this.scheduleRefresh(session)
    // External sign-in: this tab's listeners hear about a session only from an
    // exchange it made itself (getSession() announces no restore in that mode).
    // An adopted one, on start or after the provider's user changed in another
    // tab, has to be announced here, or Features, Monitor and Consent stay
    // bound to nobody or to the previous user. An Onelo Auth refresh adopted
    // from another tab is the same user and stays silent, as before.
    if (this.externalToken) this.notifyListeners(session)
    return session
  }

  /** The complete session in storage, or null. */
  private async _storedSession(): Promise<OneloSession | null> {
    const [accessToken, refreshToken, expiresAtStr, userJson] = await Promise.all([
      this.storage.get(TOKEN_KEYS.ACCESS_TOKEN),
      this.storage.get(TOKEN_KEYS.REFRESH_TOKEN),
      this.storage.get(TOKEN_KEYS.EXPIRES_AT),
      this.storage.get(TOKEN_KEYS.USER_JSON),
    ])
    if (!accessToken || !this._hasRenewal(refreshToken) || !userJson) return null
    try {
      const user = JSON.parse(userJson) as OneloUser
      return { accessToken, refreshToken: refreshToken ?? '', expiresAt: parseInt(expiresAtStr ?? '0', 10), user }
    } catch {
      return null
    }
  }

  /** True when the stored session can be renewed: an Onelo Auth session by its
   *  refresh token, an external one (which has none) by the provider function. */
  private _hasRenewal(refreshToken: string | null): boolean {
    return this.externalToken ? true : !!refreshToken
  }

  /** The stored value that changes whenever ANY tab renews the session: the
   *  refresh token rotates for Onelo Auth; an external session has only its
   *  access token. */
  private _renewalKey(): typeof TOKEN_KEYS.REFRESH_TOKEN | typeof TOKEN_KEYS.ACCESS_TOKEN {
    return this.externalToken ? TOKEN_KEYS.ACCESS_TOKEN : TOKEN_KEYS.REFRESH_TOKEN
  }

  /** How long before expiry the session is renewed. */
  private _refreshLeadSeconds(): number {
    return this.externalToken ? this.externalLeadSeconds : OneloAuth.REFRESH_LEAD_SECONDS
  }

  /**
   * Use the App's own sign-in (Supabase, Clerk, Firebase or any OpenID Connect
   * issuer) instead of Onelo Auth (#798, ADR-0032). The App's Sign-in Mode must
   * be set to that provider in the Onelo dashboard.
   *
   * `getToken` returns the provider's CURRENT token, or nothing when no user is
   * signed in there. The SDK exchanges it for an Onelo session at once, keeps
   * that session where every Module reads it, and asks `getToken` again to
   * renew it before it lapses (the session lasts 30 minutes; renewal happens
   * after about 80% of that). When `getToken` returns nothing the session ends
   * and `onAuthStateChange(null)` fires. No Onelo sign-in screen is ever shown.
   *
   * Call it once on start, and again whenever the provider's user changes
   * (sign-in, sign-out, a different account).
   *
   * Resolves to the session, or null when the provider has no user. Rejects
   * with an `OneloError` when Onelo refuses the token (`session_ended`,
   * `user_revoked`, `no_active_plan`) or cannot be reached; a failure that can
   * pass (offline, a rate limit) is retried in the background.
   */
  async useExternalToken(getToken: ExternalTokenGetter): Promise<OneloSession | null> {
    if (typeof getToken !== 'function') {
      throw new TypeError('[Onelo] useExternalToken() needs a function that returns your provider\'s token')
    }
    await this.initPromise
    // A renewal already in flight was started for the previous function (or
    // for an Onelo Auth session). Let it settle, then exchange for THIS one.
    if (this.refreshInFlight) await this.refreshInFlight.catch(() => { /* its own caller hears it */ })
    this.stopHeartbeat()
    this.clearRefreshTimer()
    this.refreshRetryAttempt = 0
    this.refreshBackoffUntil = 0
    // A session left by Onelo Auth is not this provider's user. Dropped, never
    // refreshed: the exchange below decides who is signed in.
    if (await this.storage.get(TOKEN_KEYS.REFRESH_TOKEN)) await this.storage.clear()
    this.externalToken = getToken
    this.externalTokenStale = false
    this.externalSignOutHeard = false
    // A new provider sign-in lifts a sign-out made in any tab (#836).
    await this.storage.delete(EXTERNAL_SIGNED_OUT_KEY)
    this._listenForOtherTabs()
    return this.refreshSession()
  }

  /** Renew an external session: ask the provider for its current token and
   *  exchange it. The single-flight and the cross-tab lock above apply as for a
   *  refresh, so concurrent callers share one exchange. */
  private async _doExternalExchange(getToken: ExternalTokenGetter, epoch: number): Promise<OneloSession | null> {
    if (await this._externalSignedOut()) {
      // Signed out here or in another tab: stay signed out, do not ask the
      // provider (it would still hand out a token) until useExternalToken().
      if (epoch === this.signOutEpoch && !this.externalSignOutHeard) {
        this.externalSignOutHeard = true
        await this._endSession()
      }
      return null
    }
    let token: string | null | undefined
    try {
      token = await getToken()
    } catch (e) {
      // The provider failed to answer (its own network call, a client still
      // loading). That is not "no user": keep the session and ask again.
      if (epoch === this.signOutEpoch) this._scheduleRefreshRetry()
      throw e
    }
    if (epoch !== this.signOutEpoch) return null
    if (typeof token !== 'string' || token.length === 0) {
      // Nobody is signed in at the provider: the Onelo session ends with it.
      await this._endSession()
      return null
    }
    let outcome: Awaited<ReturnType<typeof exchangeExternalToken>>
    try {
      outcome = await exchangeExternalToken(this.apiUrl, this.publishableKey, token)
    } catch (e) {
      if (epoch === this.signOutEpoch) this._scheduleRefreshRetry()
      throw e
    }
    if (outcome.kind === 'transient') {
      if (epoch !== this.signOutEpoch) throw outcome.error
      this.externalTokenStale = outcome.staleToken
      // Only an expired provider token, retried until the Onelo access token
      // has expired too, ends the session (#836). An outage keeps retrying.
      const stored = outcome.staleToken ? await this._storedSession() : null
      if (outcome.staleToken && (!stored || Date.now() / 1000 >= stored.expiresAt)) {
        await this._endSession()
        throw new OneloError(
          'session_ended',
          'The sign-in provider only returned expired tokens and the Onelo session has expired',
        )
      }
      this._scheduleRefreshRetry()
      throw outcome.error
    }
    // Sign-out raced the exchange: do not write a session back.
    if (epoch !== this.signOutEpoch) return null
    if (outcome.kind === 'ended') {
      await this._endSession()
      if (outcome.error.code === 'user_revoked') this.isUserRevoked = true
      throw outcome.error
    }
    const tokens = outcome.json['session'] as Record<string, unknown> | undefined
    const expiresIn = tokens?.['expires_in']
    // An external session has no refresh token; the field stays a string.
    const session: OneloSession = { ...mapSession(outcome.json), refreshToken: '' }
    if (typeof expiresIn === 'number' && expiresIn > 0) {
      this.externalLeadSeconds = renewalLeadSeconds(expiresIn)
    }
    this.isUserRevoked = false
    this.externalTokenStale = false
    await this.saveSession(session)
    return session
  }

  /** True when an external session was signed out, in this tab or another one
   *  sharing the storage, and no new provider sign-in has happened since. */
  private async _externalSignedOut(): Promise<boolean> {
    return (await this.storage.get(EXTERNAL_SIGNED_OUT_KEY)) !== null
  }

  /** Keep this tab in step with the others (#836). The browser fires `storage`
   *  in every OTHER tab of the origin when one writes localStorage: a sign-out
   *  there ends the session here at once, and a new session written there (a
   *  new provider sign-in) is adopted and renewed here. */
  private _listenForOtherTabs(): void {
    if (this.externalStorageListener) return
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return
    this.externalStorageListener = (e: StorageEvent) => {
      if (!this.externalToken) return
      if (e.key === EXTERNAL_SIGNED_OUT_KEY && e.newValue !== null) {
        this.signOutEpoch++
        this.externalSignOutHeard = true
        this.refreshRetryAttempt = 0
        this.refreshBackoffUntil = 0
        this.clearRefreshTimer()
        this.notifyListeners(null)
      } else if (e.key === EXTERNAL_SIGNED_OUT_KEY && e.newValue === null) {
        // Also drops this tab's in-memory copy of the mark.
        void this.storage.delete(EXTERNAL_SIGNED_OUT_KEY)
      } else if (e.key === TOKEN_KEYS.ACCESS_TOKEN && e.newValue) {
        void (async () => {
          await this.storage.delete(EXTERNAL_SIGNED_OUT_KEY)
          const session = await this._storedSession()
          if (!session || session.accessToken !== e.newValue) return
          this.refreshRetryAttempt = 0
          this.refreshBackoffUntil = 0
          this.externalTokenStale = false
          this.externalSignOutHeard = false
          this.scheduleRefresh(session)
          this.notifyListeners(session)
        })()
      }
    }
    window.addEventListener('storage', this.externalStorageListener as EventListener)
  }

  /** Clear the stored session and tell listeners. */
  private async _endSession(): Promise<void> {
    this.stopHeartbeat()
    this.clearRefreshTimer()
    // Keep an external sign-out mark (#836): it is not part of the session,
    // and dropping it would let the next renewal sign the user back in.
    const signedOut = await this.storage.get(EXTERNAL_SIGNED_OUT_KEY)
    await this.storage.clear()
    if (signedOut !== null) await this.storage.set(EXTERNAL_SIGNED_OUT_KEY, signedOut)
    this.notifyListeners(null)
  }

  private async _doRefresh(epoch: number): Promise<OneloSession | null> {
    if (this.externalToken) return this._doExternalExchange(this.externalToken, epoch)
    const refreshToken = await this.storage.get(TOKEN_KEYS.REFRESH_TOKEN)
    if (!refreshToken) return null
    let res: Awaited<ReturnType<typeof httpPost>>
    try {
      res = await httpPost(
        `${this.apiUrl}/api/sdk/auth/refresh`,
        // Wire key MUST be snake_case `refresh_token`: the backend
        // RefreshRequest model (sdk_auth.py) requires it and rejects a
        // camelCase `refreshToken` with a hard 422 (the handler never runs).
        // Matches every response payload + the Swift SDK request.
        { publishableKey: this.publishableKey, refresh_token: refreshToken },
        { ...SDK_HEADERS }
      )
    } catch (e) {
      // Offline, or the response was lost after the server rotated the token.
      // Keep the session; the retry re-reads storage (another tab may have
      // finished) and lands inside the server's grace window.
      if (epoch === this.signOutEpoch) this._scheduleRefreshRetry()
      throw e
    }
    const { status, json } = res
    checkHostedFlowRequired(json)
    const j = json as Record<string, unknown>
    if (status === 429 || status >= 500) {
      // Transient — incl. 503 `refresh_unavailable`: the server could not
      // record the rotation and the presented token is STILL VALID. Never
      // clear the session for it; retry later with backoff.
      if (epoch === this.signOutEpoch) this._scheduleRefreshRetry()
      throw OneloError.server(`Session refresh is temporarily unavailable (HTTP ${status})`)
    }
    if (status !== 200) {
      // Any non-200 invalidates the session locally. The backend returns the
      // reason in an HTTPException body: { detail: { error | error_code } }
      // (NOT a top-level `error` — the old branches here were dead).
      this.clearRefreshTimer(); await this.storage.clear(); this.notifyListeners(null)
      const detail = j['detail'] as Record<string, unknown> | undefined
      const reason = (detail?.['error'] ?? detail?.['error_code']) as string | undefined
      // Only a real ban says "suspended". `session_compromised` is NOT a ban:
      // it means this refresh token was presented again outside the server's
      // grace window (a lost response, a second tab, a restored backup) — the
      // user just signs in again.
      if (reason === 'banned') {
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
      // session_compromised / session_expired / session_invalid (and any other
      // refusal): the session is over — say so neutrally.
      throw OneloError.sessionEnded()
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
    // #635: the user's grant changed (purchase, switch, refund, pause…). The
    // backend sends it only to this user's streams, right after the fresh
    // `features_updated`; re-read the entitlement so hasActiveAccess() follows.
    stream.on('paywall.access_changed', () => { void this.revalidateEntitlement() })
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
      try {
        // getSession() is INSIDE the try: near expiry it refreshes, and a
        // transient refresh failure must not escape this detached callback as
        // an unhandled rejection.
        const session = await this.getSession()
        if (!session) { this.stopHeartbeat(); return }
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
    // A retry after a transient failure is pending: it owns the timer. (Every
    // getSession() re-arms this schedule and would otherwise cancel it.)
    if (Date.now() < this.refreshBackoffUntil) return
    this.clearRefreshTimer()
    const nowSec = Date.now() / 1000
    const delaySec = session.expiresAt - nowSec - this._refreshLeadSeconds()
    const delayMs = delaySec > 0 ? delaySec * 1000 : 0
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null
      void this.refreshSession().catch(() => {
        // Expected: an ended session is already cleared + announced via
        // onAuthStateChange(null); a transient failure keeps the session and
        // the next getSession() retries. Never escapes the timer.
      })
    }, delayMs)
  }

  private clearRefreshTimer(): void {
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = null
    }
  }

  /** Re-arm the refresh after a transient failure, with backoff (see
   *  REFRESH_RETRY_BASE_MS). Reset by the next saved session. */
  private _scheduleRefreshRetry(): void {
    const delay = Math.min(
      OneloAuth.REFRESH_RETRY_BASE_MS * 2 ** this.refreshRetryAttempt,
      OneloAuth.REFRESH_RETRY_MAX_MS,
    )
    this.refreshRetryAttempt++
    this.refreshBackoffUntil = Date.now() + delay
    this.clearRefreshTimer()
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null
      this.refreshBackoffUntil = 0
      void (async () => {
        // Another tab may have refreshed meanwhile: a still-fresh stored session
        // needs no second rotation — just schedule its normal refresh.
        const stored = await this._storedSession()
        if (stored && Date.now() / 1000 < stored.expiresAt - this._refreshLeadSeconds()) {
          this.refreshRetryAttempt = 0
          this.scheduleRefresh(stored)
          return
        }
        await this.refreshSession()
      })().catch(() => {
        // A further transient failure re-arms itself; an ended session is
        // already cleared + announced. Never escapes the timer.
      })
    }, delay)
  }

  /**
   * @param announce Tell OTHER TABS a sign-in just happened. Only a genuine
   *   sign-in announces. A token REFRESH must not: a tab sitting on the
   *   sign-in screen would settle its modal, look for the session, find none
   *   (the refresh happened in a different tab, not this one) and report a
   *   cancelled sign-in — worse than the waiting it replaced.
   */
  private async saveSession(session: OneloSession, { announce = false } = {}): Promise<void> {
    this.refreshRetryAttempt = 0
    this.refreshBackoffUntil = 0
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
    //
    // No heartbeat for an external session (#798): the presence heartbeat
    // answers 401 for an App User with no session row, and the exchange door
    // writes none, so it would sign the user out. Removal at the provider ends
    // the session at the next renewal; a ban arrives over the event stream.
    if (!this.externalToken) this.startHeartbeat(session.accessToken)
    this.scheduleRefresh(session)
    this.notifyListeners(session)
    // Fire-and-forget: nothing here depends on whether another tab heard.
    if (announce) void publishSessionCreated()
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
    const { status: mlStatus, json: mlJson } = await httpPost(`${this.apiUrl}/api/sdk/auth/magic-link`, body, { ...SDK_HEADERS })
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
  private finishAsMessengerTab(heard: Promise<boolean>): void {
    this.handedOverToAnotherTab = true
    // Claim nothing until a waiting tab has answered: "continue in the tab you
    // started from" is only true when one did (#535).
    showHandedOverNotice(this.appName, null, this.brand.current())
    void heard.then((waitingTab) => {
      if (this.handedOverToAnotherTab) showHandedOverNotice(this.appName, waitingTab, this.brand.current())
    })
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
   * The challenge a store magic link is paired to (#727), or null.
   *
   * The embedded store runs in an iframe whose storage the browser partitions
   * under this site, so the tab an e-mailed link opens can never read a
   * verifier the store kept. This page's own storage it can: the verifier stays
   * here (the same one-per-browser slot the hosted sign-in uses) and only its
   * challenge goes to `/store-initiate`. The link then returns through this
   * page, which proves "same browser" in `completePairedLink`. Null when the
   * verifier cannot be kept durably — the store then keeps the code screen.
   */
  async storeLinkChallenge(): Promise<string | null> {
    await this.initPromise.catch(() => {})
    const verifier = this.pkceVerifier
    if (!verifier) return null
    if (!(await this.persistMagicLinkVerifier(verifier))) return null
    return generateCodeChallenge(verifier)
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
      this.finishAsMessengerTab(publishSessionCreated(gateSurface))

      // Null, not an error: "you have no plan" is an answer, not a failure.
      return null
    }

    const linkToken = url.searchParams.get('onelo_link')
    if (linkToken) return this.completePairedLink(url, linkToken)

    const storeCode = url.searchParams.get('onelo_store_code')
    if (storeCode) return this.completeStoreReturn(url, storeCode)

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
    coverPage(this.brand.current())

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
      { ...SDK_HEADERS },
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
    await this.saveSession(session)

    // ── This tab is a messenger, never the app ───────────────────────────────
    // It exists only because a magic link opens its own tab. It had to finish the
    // exchange — no other origin may write this origin's storage — and then it is
    // done: a farewell message and nothing else, whether or not another tab was
    // listening. Signing in happens in the tab the user started from, full stop
    // (Adrian, 2026-08-19).
    this.finishAsMessengerTab(publishSessionCreated())

    return session
  }

  /** #728: the store return's "Signing you in…" in the Branding and language
   *  of the store the buyer just left (remembered when it opened); the config
   *  is not in yet on the first tick. */
  private coverStoreReturn(): void {
    const look = recallStoreReturnLook(this.publishableKey)
    // The store's own language when it was opened from here (none given →
    // the store spoke English, so does this); the browser's only without a
    // remembered look.
    const lang = look ? look.lang : (typeof navigator !== 'undefined' ? navigator.language : null)
    coverPage(look?.tokens ?? this.brand.current(), signingInText(lang))
  }

  /**
   * The store brought the buyer back to this page (#726).
   *
   * The embedded store sent this window to provider sign-in and the checkout;
   * when the purchase is done it returns here with the store's one-time code.
   * Unlike a magic-link tab this IS the app: exchange, sign in, report the
   * purchase, carry on. The code is single-use and was minted for the store
   * token this SDK opened; the backend's hosted-callback is the same exchange
   * the in-frame store uses.
   */
  private async completeStoreReturn(url: URL, code: string): Promise<OneloSession | null> {
    this.coverStoreReturn()
    // Strip first, whatever the outcome: the code is a credential in the URL.
    url.searchParams.delete('onelo_store_code')
    try { window.history.replaceState({}, '', url.toString()) } catch { /* non-browser host */ }

    const { status, json } = await httpPost(
      `${this.apiUrl}/api/sdk/auth/hosted-callback`,
      { publishableKey: this.publishableKey, code },
      { ...SDK_HEADERS },
    )
    forgetStoreReturnLook()
    if (status !== 200) {
      removeCover()
      throw OneloError.server(`Store sign-in failed: HTTP ${status}`)
    }
    const session = mapSession(json as Record<string, unknown>)
    await this.saveSession(session)
    removeCover()
    this.onPlanChange?.({ kind: 'purchase' })
    return session
  }

  /**
   * A paired magic link (#535) arrived on this page, UNSPENT.
   *
   * The link page cannot tell which browser it is in; this page can. If this
   * browser holds the verifier the requesting tab stored, it IS that browser:
   * the backend spends the link and answers with a code, and this finishes in
   * one click exactly like `onelo_code` below. If not — another browser, another
   * device, a mail scanner — the backend spends nothing and names the screen
   * where the person types the code the requesting tab shows. This tab then
   * leaves for it and signs nobody in.
   */
  private async completePairedLink(url: URL, token: string): Promise<OneloSession | null> {
    coverPage(this.brand.current())
    // Strip first, whatever the outcome: the token is a credential in the URL.
    url.searchParams.delete('onelo_link')
    try { window.history.replaceState({}, '', url.toString()) } catch { /* non-browser host */ }

    const codeVerifier = await this.storage.get(TOKEN_KEYS.MAGIC_LINK_VERIFIER)
    const { status, json } = await httpPost(
      `${this.apiUrl}/api/sdk/auth/magic-link/consume`,
      { publishableKey: this.publishableKey, token, code_verifier: codeVerifier },
      { ...SDK_HEADERS },
    )
    const j = (json ?? {}) as Record<string, unknown>
    const detail = j['detail'] as Record<string, unknown> | undefined

    if (status === 409 && detail?.['error'] === 'confirm_required' && typeof detail['confirm_url'] === 'string') {
      // Not the requesting browser. Built by the backend, never read from the
      // URL — but still only followed when it is a web address.
      const confirmUrl = detail['confirm_url']
      if (/^https?:\/\//i.test(confirmUrl)) {
        this.handedOverToAnotherTab = true
        window.location.replace(confirmUrl)
        return null
      }
    }
    if (status !== 200) {
      removeCover()
      throw OneloError.server(`Magic link sign-in failed: HTTP ${status}`)
    }

    const resumeUrl = j['resume_url']
    if (typeof resumeUrl === 'string') {
      // A link the embedded store asked for (#727). The store's own storage is
      // partitioned under this site, so the proof had to run here; proven, the
      // backend answers with the store checkout to reopen, signed in, in this
      // tab. Built by the backend, never read from the URL — still followed only
      // when it is a web address. The checkout returns to this page afterwards.
      await this.storage.delete(TOKEN_KEYS.MAGIC_LINK_VERIFIER)
      if (/^https?:\/\//i.test(resumeUrl)) {
        this.handedOverToAnotherTab = true
        window.location.replace(resumeUrl)
        return null
      }
      removeCover()
      throw OneloError.server('Magic link sign-in failed: invalid store address')
    }

    const gateUrl = j['gate_url']
    if (typeof gateUrl === 'string') {
      // Same browser, but the Access Gate refused entry: same as `onelo_gate`.
      await this.storage.delete(TOKEN_KEYS.MAGIC_LINK_VERIFIER)
      this.finishAsMessengerTab(publishSessionCreated(gateUrl))
      return null
    }
    const code = j['code']
    if (typeof code !== 'string') {
      removeCover()
      throw OneloError.server('Magic link sign-in failed: no code')
    }
    const exchanged = await httpPost(
      `${this.apiUrl}/api/sdk/auth/hosted-callback`,
      { publishableKey: this.publishableKey, code, code_verifier: codeVerifier },
      { ...SDK_HEADERS },
    )
    await this.storage.delete(TOKEN_KEYS.MAGIC_LINK_VERIFIER)
    if (exchanged.status !== 200) {
      removeCover()
      throw OneloError.server(`Magic link sign-in failed: HTTP ${exchanged.status}`)
    }
    const session = mapSession(exchanged.json as Record<string, unknown>)
    await this.saveSession(session)
    this.finishAsMessengerTab(publishSessionCreated())
    return session
  }

  /**
   * Send the signed-in user a fresh Email Verification link (#819).
   *
   * Only for Apps with their own screen: when the parent App requires Email
   * Verification, Onelo's hosted flow already shows "check your inbox" with a
   * resend button and hands the session back by itself. The previous link
   * stops working; at most 3 e-mails an hour (`verification_rate_limited`).
   * Throws `email_verification_off` when the App has Email verification Off.
   *
   * `redirectTo` — your own landing page (an allowed web origin) or
   * `<your-scheme>://…`; the link then carries `onelo_verify_token` for
   * `confirmEmail`. Omitted, the link opens Onelo's hosted page.
   */
  async resendVerificationEmail(options: { redirectTo?: string } = {}): Promise<ResendVerificationResult> {
    await this.initPromise
    const session = await this.getSession()
    if (!session) throw OneloError.notAuthenticated()
    return postResendVerification({
      apiUrl: this.apiUrl,
      publishableKey: this.publishableKey,
      post: httpPost,
      accessToken: session.accessToken,
      headers: { ...SDK_HEADERS },
      redirectTo: options.redirectTo,
    })
  }

  /**
   * Confirm the user's address with the `onelo_verify_token` your own landing
   * page received from the verification link (#819). Single use. When a
   * session is signed in on this device, it is refreshed so `isAllowedIn()`
   * opens the app without waiting for the next scheduled refresh.
   */
  async confirmEmail(token: string): Promise<void> {
    await this.initPromise
    await postConfirmEmail({
      apiUrl: this.apiUrl,
      publishableKey: this.publishableKey,
      post: httpPost,
      token,
      headers: { ...SDK_HEADERS },
    })
    // Refresh, not revalidateEntitlement: /api/sdk/auth/user caches its answer
    // per access token for 30 s, so a read right after confirming could still
    // say "not allowed". /refresh builds the access answer fresh and rotates
    // the token. Best-effort: the address IS confirmed; on failure the next
    // scheduled refresh or foreground revalidation carries the new answer.
    if (await this.getSession()) {
      try {
        await this.refreshSession()
      } catch (e) {
        console.warn('[onelo] confirmEmail: session refresh after confirming failed', e)
      }
    }
  }

  async sendPasswordReset(email: string, redirectTo?: string): Promise<void> {
    await this.initPromise
    const body: Record<string, unknown> = { publishableKey: this.publishableKey, email }
    if (redirectTo) body.redirectTo = redirectTo
    const { status: prStatus } = await httpPost(`${this.apiUrl}/api/sdk/auth/reset-password/request`, body, { ...SDK_HEADERS })
    if (prStatus >= 400) throw OneloError.server(`Password reset request failed: HTTP ${prStatus}`)
  }
}
