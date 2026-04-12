import { _OneloClient } from './client'
import { OneloFeatures } from './features'
import { OneloPaywall } from './paywall'
import { OneloForms } from './forms'
import { OneloWaitlist } from './waitlist'
import type { OneloConfig, IdentifyOptions } from './types'

export class Onelo {
  private readonly _client: _OneloClient
  private readonly _features: OneloFeatures
  private readonly _paywall: OneloPaywall
  private readonly _forms: OneloForms
  private readonly _waitlist: OneloWaitlist

  constructor(config: OneloConfig) {
    if (!config.publishableKey) {
      throw new Error('[Onelo] publishableKey is required')
    }
    this._client = new _OneloClient(config.publishableKey, config.baseUrl)
    this._features = new OneloFeatures(this._client)
    this._paywall = new OneloPaywall(this._client)
    this._forms = new OneloForms(this._client)
    this._waitlist = new OneloWaitlist(this._client)
  }

  async identify(userId: string, options?: IdentifyOptions): Promise<void> {
    this._client.setIdentity(userId, options?.plan)
    await this._features._resolve(options?.plan)
  }

  get features(): OneloFeatures { return this._features }
  get paywall(): OneloPaywall { return this._paywall }
  get forms(): OneloForms { return this._forms }
  get waitlist(): OneloWaitlist { return this._waitlist }
}
