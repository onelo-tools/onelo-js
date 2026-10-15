import { OneloAuth } from './auth/auth'
import { OneloFeatures } from './features/features'
import { OneloMonitor } from './monitor/monitor'
import { OneloFeedback } from './feedback/feedback'
import { OneloPaywall } from './paywall/paywall'
import { OneloForms } from './forms/forms'
import { OneloWaitlist } from './waitlist/waitlist'
import { OneloCustomerPortal } from './customer-portal/customer-portal'
import { OneloConsent } from './consent/consent'
import { OneloEventStream } from './core/event-stream'
import { PlanChangeRefresher, type PlanChange } from './core/plan-change'
import { resetUserTokenRefusal, type UserTokenSource } from './core/user-token'
import { OneloConfig, BrandSource } from '@onelo/core'
import { version as SDK_VERSION } from '../package.json'

export class Onelo {
  readonly auth: OneloAuth
  readonly features: OneloFeatures
  readonly monitor: OneloMonitor
  readonly feedback: OneloFeedback
  readonly paywall: OneloPaywall
  readonly forms: OneloForms
  readonly waitlist: OneloWaitlist
  readonly customerPortal: OneloCustomerPortal
  /** Legal-consent gate (Terms/Privacy updates for signed-in users). */
  readonly consent: OneloConsent
  private authUnsubscribe: (() => void) | null = null
  // ONE multiplexed SSE connection per app, shared by features + auth. Owned
  // here (composition root); consumers only register handlers/params on it.
  private readonly eventStream: OneloEventStream
  private readonly planChange: PlanChangeRefresher

  constructor(config: OneloConfig) {
    // The signed-in user's access token, proving the user on every Features call
    // and on the Event Stream mint (#518). getSession() refreshes a token near
    // expiry, so a stale one is never sent. Read lazily: auth is created below.
    const userToken: UserTokenSource = {
      current: () => this.auth.getSession().then(s => s?.accessToken ?? null),
      refresh: () => this.auth.refreshSession().then(s => s?.accessToken ?? null),
    }
    this.eventStream = new OneloEventStream(config.apiUrl, config.publishableKey, SDK_VERSION, userToken)
    // ONE brand-token model (#681): config sets it, initiate responses refresh
    // it, every modal paints its chrome from it.
    const brand = new BrandSource()
    this.auth = new OneloAuth(config, brand)
    // Register auth's session.revoked listener BEFORE any session loads so no
    // revoke is missed. The connection itself is opened by the features bridge.
    this.auth.attachEventStream(this.eventStream)
    this.paywall = new OneloPaywall(
      config.apiUrl,
      config.publishableKey,
      () => this.auth.getSession().then(s => s?.accessToken ?? null),
      (session) => this.auth.importSession(session),
      () => this.auth.getSession(),
      () => this.auth.storeLinkChallenge(),
    )
    this.customerPortal = new OneloCustomerPortal(
      config.apiUrl,
      config.publishableKey,
      () => this.auth.getSession().then(s => s?.accessToken ?? null),
      () => { void this.auth.signOut() },
    )
    // #642: a checkout opened from the store asks for a fresh portal token
    // when its pre-auth chain ends; the signed-in user's portal answers it.
    const renewPortal = (requestId: string) => this.customerPortal.renewReply(requestId)
    this.paywall.setPortalRenewer(renewPortal)
    this.paywall.setBrandSource(brand)
    this.customerPortal.setBrandSource(brand)
    this.auth.setPortalRenewer(renewPortal)
    this.forms = new OneloForms(config.apiUrl, config.publishableKey)
    this.waitlist = new OneloWaitlist(config.apiUrl, config.publishableKey)
    this.monitor = new OneloMonitor(config.publishableKey, config.apiUrl, {
      appVersion: config.appVersion,
      appBuild: config.appBuild,
      bundleId: config.bundleId,
      environment: config.environment,
    })
    // Feature environment: explicit config wins; on the server (Node) fall back
    // to ONELO_FEATURE_ENVIRONMENT. Server detection uses `typeof window` — NOT
    // `typeof process`, which Webpack polyfills into client bundles (see memory
    // feedback_env_isserver_detection). Normalize to 'test'|'live' so a stray
    // value never ships as a junk query param.
    let envFromProcess: string | undefined
    if (typeof window === 'undefined') {
      // Read process.env via globalThis with a local type so the browser build
      // doesn't need @types/node and the bundler can't pull `process` in.
      const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
      envFromProcess = proc?.env?.['ONELO_FEATURE_ENVIRONMENT']
    }
    const rawFeatureEnv = config.featureEnvironment ?? envFromProcess
    const featureEnvironment = rawFeatureEnv === 'test' || rawFeatureEnv === 'live' ? rawFeatureEnv : undefined
    this.features = new OneloFeatures(config.apiUrl, config.publishableKey, this.monitor, {
      suppressIdentifyWarning: config.suppressIdentifyWarning ?? false,
      featureEnvironment,
      featureDefaultStatus: config.featureDefaultStatus,
      userToken,
    })
    // Features drives the shared connection's userId (via load) + supplies its
    // since_version/environment params. This opens/points the ONE stream that
    // auth's session.revoked listener also rides.
    this.features.attachStream(this.eventStream)
    // #659: a purchase / plan switch handed back by any hosted container
    // reconciles features + entitlement at once, instead of waiting for the
    // stream. One refresher, so the three containers cannot drift.
    this.planChange = new PlanChangeRefresher({
      refreshFeatures: () => this.features.refresh(true),
      revalidateEntitlement: () => this.auth.revalidateEntitlement(),
      snapshot: () => this.features.snapshotKey(),
    })
    const onPlanChange = (change: PlanChange) => { void this.planChange.handBack(change) }
    this.auth.setPlanChangeHandler(onPlanChange)
    this.paywall.setPlanChangeHandler(onPlanChange)
    this.customerPortal.setPlanChangeHandler(onPlanChange)
    this.feedback = new OneloFeedback(config.apiUrl, config.publishableKey, () => this.features.getActiveFeatures(), userToken)
    this.feedback.setBrandSource(brand)

    // Legal-consent gate. Auto-presents on sign-in + on `legal.consent_required`
    // (over the shared stream) unless `autoPresentConsentGate:false`, in which
    // case the dev drives their own UI via consent.requiredConsents() /
    // onConsentRequired(). A blocking Terms/Privacy update then hard-blocks the
    // app (full-screen non-dismissible gate) until accepted; decline signs out.
    const autoPresentConsent = config.autoPresentConsentGate ?? true
    this.consent = new OneloConsent(config.apiUrl, config.publishableKey, this.auth, autoPresentConsent)
    this.consent.attachEventStream(this.eventStream)

    // Auth → features identity bridge: reload features when session changes.
    // Also re-check consent on sign-in (a blocking legal version may have taken
    // effect while the user was away) — no-ops when signed out or nothing blocks.
    let boundUserId: string | null = null
    this.authUnsubscribe = this.auth.onAuthStateChange((session) => {
      // A different user starts a new token-refusal episode. The same user
      // (a refresh re-publishing the session) does not: that is what keeps a
      // persistently refused token from looping refresh → load → refresh.
      const userId = session?.user.id ?? null
      if (userId !== boundUserId) resetUserTokenRefusal(userToken)
      boundUserId = userId
      this.monitor.setUserId(session?.user.id ?? null)
      void this.features.load(session?.user.id ?? null)
      if (session?.user.id && autoPresentConsent) void this.consent.presentGateIfNeeded()
    })

    // Let auth restore the persisted session before the first Features load.
    // Starting an anonymous resolve here races the restore and can overwrite a
    // returning user's snapshot with a partial anonymous answer.
    void this.auth.getSession().then((session) => {
      if (!session) void this.features.load(null)
    }).catch(() => { void this.features.load(null) })
  }

  /**
   * Open the sign-in flow. The routing (sign-in vs store vs "already have
   * access") is decided by the backend `/api/sdk/flow/init`, so behaviour is
   * identical across every SDK — no client logic to drift.
   * - waitlist_mode + sdk_redirect_url → opens developer's waitlist/store page
   * - otherwise → the backend flow picks sign-in or store and chains them; the
   *   hosted page returns once the user has access.
   * Presentation defaults to an inline iframe (`mode:'embedded'`), matching
   * Swift's inline WKWebView; pass `mode:'popup'` for a top-level window.
   */
  async loadAuthView(
    options?: { mode?: import('./auth/auth-modal').AuthPresentMode },
  ): Promise<import('@onelo/core').OneloSession | null> {
    return this.auth.loadAuthView({ mode: options?.mode })
  }

  /**
   * @deprecated The signed-in Onelo user is used automatically: Features calls
   * prove them with their access token. `userIdHash` is ignored (Secure Mode is
   * retired). Kept so existing code compiles.
   */
  async identify(userId: string, userIdHash?: string): Promise<void> {
    await this.features.load(userId, userIdHash)
  }

  /**
   * Open the upgrade flow for a plan-blocked feature — call it when the user taps
   * a gated tile whose `feature.upgradeCta` is set. Routes by billing state:
   *   - entitled user → straight to where the backend resolves the upgrade
   *     (`/upgrade-initiate`, the same decision as every other SDK): the plan
   *     picker for a subscriber, the store for a free-tier user's first
   *     purchase, or the portal's explanation when plan changes are off. Opened
   *     in the Customer Portal's modal; no portal page in front of it (#670).
   *   - otherwise → `paywall.openStore()` (pick + buy a plan).
   *
   * `plan` is accepted for cross-platform call-site parity (Swift/Electron/RN pass
   * `feature.requiredPlan`); on web the buyer picks in the store, so it is
   * advisory only. The resulting plan change is reconciled the moment the page
   * hands back (#659) and fires `features.subscribe()`. Requires a signed-in
   * Onelo Auth user.
   */
  async openUpgrade(_plan?: string): Promise<void> {
    // "Sign in only" means this app sells nothing in-app — no store, and no
    // upgrade path that ends in one. This method is what the official snippet
    // wires to `feature.upgradeCta`, so without this check every developer who
    // follows our own documentation opens the store the dashboard switched off.
    // The backend refuses it (409) either way; failing here keeps the user from
    // watching a window open onto an error.
    await this.auth.whenReady()
    if (await this.auth.hasActiveAccess()) {
      if (!this.auth.isStoreAvailable()) {
        // Still allowed under "Sign in only": managing an EXISTING subscription
        // is not selling. The portal hides its own buy / change-plan actions.
        await this.customerPortal.open({ intent: 'change_plan' })
        return
      }
      await this.customerPortal.openUpgrade()
    } else {
      if (!this.auth.isStoreAvailable()) return
      await this.paywall.openStore()
    }
  }

  /** Release background timers. Call when the SDK instance is no longer needed. */
  destroy(): void {
    this.authUnsubscribe?.()
    this.planChange.cancel()
    this.eventStream.destroy()
    this.features.stopPolling()
    this.monitor.destroy()
    this.consent.dispose()
  }
}
