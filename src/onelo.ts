import { OneloAuth } from './auth/auth'
import { OneloFeatures } from './features/features'
import { OneloMonitor } from './monitor/monitor'
import { OneloFeedback } from './feedback/feedback'
import { OneloPaywall } from './paywall/paywall'
import { OneloForms } from './forms/forms'
import { OneloWaitlist } from './waitlist/waitlist'
import { OneloConfig } from '@onelo/core'

export class Onelo {
  readonly auth: OneloAuth
  readonly features: OneloFeatures
  readonly monitor: OneloMonitor
  readonly feedback: OneloFeedback
  readonly paywall: OneloPaywall
  readonly forms: OneloForms
  readonly waitlist: OneloWaitlist
  private authUnsubscribe: (() => void) | null = null

  constructor(config: OneloConfig) {
    this.auth = new OneloAuth(config)
    this.paywall = new OneloPaywall(
      config.apiUrl,
      config.publishableKey,
      () => this.auth.getSession().then(s => s?.accessToken ?? null),
      (session) => this.auth.importSession(session),
    )
    this.forms = new OneloForms(config.apiUrl, config.publishableKey)
    this.waitlist = new OneloWaitlist(config.apiUrl, config.publishableKey)
    this.monitor = new OneloMonitor(config.publishableKey, config.apiUrl)
    this.features = new OneloFeatures(config.apiUrl, config.publishableKey, this.monitor, {
      suppressIdentifyWarning: config.suppressIdentifyWarning ?? false,
    })
    this.feedback = new OneloFeedback(config.apiUrl, config.publishableKey, () => this.features.getActiveFeatures())

    // Auth → features identity bridge: reload features when session changes
    this.authUnsubscribe = this.auth.onAuthStateChange((session) => {
      this.monitor.setUserId(session?.user.id ?? null)
      void this.features.load(session?.user.id ?? null)
    })

    void this.features.load(null)
  }

  /**
   * Open the sign-in flow. Automatically routes based on app config:
   * - waitlist_mode + sdk_redirect_url → opens developer's waitlist/store page
   * - paywall_enabled → opens hosted store (plan selection + registration)
   * - otherwise → opens hosted sign-in
   */
  async loadAuthView(): Promise<import('@onelo/core').OneloSession | null> {
    return this.auth.loadAuthView(() => this.paywall.openStore())
  }

  /** Only needed when NOT using Onelo Auth (own auth system). */
  async identify(userId: string): Promise<void> {
    await this.features.load(userId)
  }

  /** Release background timers. Call when the SDK instance is no longer needed. */
  destroy(): void {
    this.authUnsubscribe?.()
    this.features.stopPolling()
    this.monitor.destroy()
  }
}
