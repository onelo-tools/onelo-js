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
import { OneloConfig } from '@onelo/core'
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

  constructor(config: OneloConfig) {
    this.eventStream = new OneloEventStream(config.apiUrl, config.publishableKey, SDK_VERSION)
    this.auth = new OneloAuth(config)
    // Register auth's session.revoked listener BEFORE any session loads so no
    // revoke is missed. The connection itself is opened by the features bridge.
    this.auth.attachEventStream(this.eventStream)
    this.paywall = new OneloPaywall(
      config.apiUrl,
      config.publishableKey,
      () => this.auth.getSession().then(s => s?.accessToken ?? null),
      (session) => this.auth.importSession(session),
    )
    this.customerPortal = new OneloCustomerPortal(
      config.apiUrl,
      config.publishableKey,
      () => this.auth.getSession().then(s => s?.accessToken ?? null),
      () => { void this.auth.signOut() },
    )
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
    })
    // Features drives the shared connection's userId (via load) + supplies its
    // since_version/environment params. This opens/points the ONE stream that
    // auth's session.revoked listener also rides.
    this.features.attachStream(this.eventStream)
    this.feedback = new OneloFeedback(config.apiUrl, config.publishableKey, () => this.features.getActiveFeatures())

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
    this.authUnsubscribe = this.auth.onAuthStateChange((session) => {
      this.monitor.setUserId(session?.user.id ?? null)
      void this.features.load(session?.user.id ?? null)
      if (session?.user.id && autoPresentConsent) void this.consent.presentGateIfNeeded()
    })

    void this.features.load(null)
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
   * Only needed when NOT using Onelo Auth (own auth system). Pass `userIdHash`
   * (HMAC-SHA256 computed on YOUR server, `"user:"+userId`) to satisfy Secure
   * Mode targeting — the SDK forwards it and never computes it.
   */
  async identify(userId: string, userIdHash?: string): Promise<void> {
    await this.features.load(userId, userIdHash)
  }

  /**
   * Open the upgrade flow for a plan-blocked feature — call it when the user taps
   * a gated tile whose `feature.upgradeCta` is set. Routes to the right WORKING
   * web surface by billing state:
   *   - active subscriber → `customerPortal.open()` (the Portal's "Change plan" —
   *     upgrade / downgrade / interval switch, all handled + confirmed there).
   *   - otherwise         → `paywall.openStore()` (pick + buy a plan).
   *
   * Unlike the native SDKs, `@onelo/js` does NOT drive `/upgrade-initiate`'s
   * `store_switch` checkout: that flow completes via a deep-link / postMessage the
   * in-iframe store-switch terminals don't emit, so it would hang the modal. The
   * Portal is the web-correct door for an existing subscriber's plan change.
   *
   * `plan` is accepted for cross-platform call-site parity (Swift/Electron/RN pass
   * `feature.requiredPlan`); on web the Portal/Store show the plans, so it is
   * advisory only. Fire-and-forget: the resulting plan change reaches the SDK via
   * SSE and fires `features.subscribe()`. Requires a signed-in Onelo Auth user.
   */
  async openUpgrade(_plan?: string): Promise<void> {
    if (await this.auth.hasActiveAccess()) {
      // Subscriber → straight into the plan picker (portal auto-runs "Change
      // plan"), not the management home — the plans are the point of an upsell tap.
      await this.customerPortal.open({ intent: 'change_plan' })
    } else {
      await this.paywall.openStore()
    }
  }

  /** Release background timers. Call when the SDK instance is no longer needed. */
  destroy(): void {
    this.authUnsubscribe?.()
    this.eventStream.destroy()
    this.features.stopPolling()
    this.monitor.destroy()
    this.consent.dispose()
  }
}
