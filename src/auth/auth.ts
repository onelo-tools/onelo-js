import { generateCodeVerifier, generateCodeChallenge } from '@onelo/core'
import { hostOS } from '../core/host-os'
import { httpGet, httpPost, checkHostedFlowRequired } from '@onelo/core'
import { mapSession } from '@onelo/core'
import { TokenStorage, TOKEN_KEYS } from '../core/storage'
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
  allowCustomBranding = false
  appName: string = 'App'
  appLogoUrl: string | null = null
  paywallEnabled = false
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
      this.waitlistMode = this.resolvedConfig.waitlistMode
      this.sdkRedirectUrl = this.resolvedConfig.sdkRedirectUrl
      this.storeUrl = this.resolvedConfig.storeUrl
      this.manageUrl = this.resolvedConfig.manageUrl
      this.isReady = true
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

    if (decision.action === 'authorized') {
      // Backend confirmed access via a LIVE entitlement check. Sync our cached
      // entitlement so hasActiveAccess() agrees, then return the session.
      if (this.paywallEnabled) await this.revalidateEntitlement().catch(() => {})
      return (await this.getSession()) ?? existing
    }

    // present → open the hosted flow; it chains to the store itself when needed,
    // so we wait for exactly ONE final code and exchange it.
    const modal = new AuthModal()
    const result = await modal.open(decision.url, mode)

    if (result.type === 'cancelled') return null
    if (result.type === 'error') throw OneloError.server(result.message)

    const { status, json } = await httpPost(
      `${this.apiUrl}/api/sdk/auth/hosted-callback`,
      { publishableKey: this.publishableKey, code: result.code, code_verifier: this.pkceVerifier },
      { 'X-SDK-Version': SDK_VERSION }
    )
    if (status !== 200) throw OneloError.server('Hosted callback failed')
    const session = mapSession(json as Record<string, unknown>)
    await this.saveSession(session)
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
      const next: OneloEntitlement =
        (json as Record<string, unknown>)['entitlement'] === 'active' ? 'active' : 'none'
      // Don't resurrect a session that was signed out while this request was
      // in flight (epoch guard, parity with Swift).
      if (next !== session.user.entitlement && epoch === this.signOutEpoch) {
        await this.saveSession({ ...session, user: { ...session.user, entitlement: next } })
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

  private async saveSession(session: OneloSession): Promise<void> {
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
  }

  private notifyListeners(session: OneloSession | null): void {
    for (const cb of this.authStateListeners) cb(session)
  }

  /** Import a session obtained outside of OneloAuth (e.g. from paywall flow). Saves tokens and notifies listeners. */
  async importSession(session: OneloSession): Promise<void> {
    await this.saveSession(session)
  }

  async sendMagicLink(email: string, redirectTo?: string): Promise<void> {
    await this.initPromise
    const body: Record<string, unknown> = { publishableKey: this.publishableKey, email }
    if (redirectTo) body.redirectTo = redirectTo
    const { status: mlStatus } = await httpPost(`${this.apiUrl}/api/sdk/auth/magic-link`, body, { 'X-SDK-Version': SDK_VERSION })
    if (mlStatus >= 400) throw OneloError.server(`Magic link request failed: HTTP ${mlStatus}`)
  }

  async sendPasswordReset(email: string, redirectTo?: string): Promise<void> {
    await this.initPromise
    const body: Record<string, unknown> = { publishableKey: this.publishableKey, email }
    if (redirectTo) body.redirectTo = redirectTo
    const { status: prStatus } = await httpPost(`${this.apiUrl}/api/sdk/auth/reset-password/request`, body, { 'X-SDK-Version': SDK_VERSION })
    if (prStatus >= 400) throw OneloError.server(`Password reset request failed: HTTP ${prStatus}`)
  }
}
