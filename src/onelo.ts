import { OneloAuth } from './auth/auth'
import { OneloFeatures } from './features/features'
import { OneloMonitor } from './monitor/monitor'
import { OneloFeedback } from './feedback/feedback'
import { OneloConfig } from '@onelo/core'

export class Onelo {
  readonly auth: OneloAuth
  readonly features: OneloFeatures
  readonly monitor: OneloMonitor
  readonly feedback: OneloFeedback
  private authUnsubscribe: (() => void) | null = null

  constructor(config: OneloConfig) {
    this.auth = new OneloAuth(config)
    this.monitor = new OneloMonitor(config.publishableKey, config.apiUrl)
    this.features = new OneloFeatures(config.apiUrl, config.publishableKey, this.monitor)
    this.feedback = new OneloFeedback(config.apiUrl, config.publishableKey, () => this.features.getActiveFeatures())

    // Auth → features identity bridge: reload features when session changes
    this.authUnsubscribe = this.auth.onAuthStateChange((session) => {
      this.monitor.setUserId(session?.user.id ?? null)
      void this.features.load(session?.user.id ?? null)
    })

    void this.features.load(null)
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
