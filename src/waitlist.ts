import type { _OneloClient } from './client'
import type { WaitlistResult } from './types'

export class OneloWaitlist {
  private readonly _client: _OneloClient

  constructor(client: _OneloClient) {
    this._client = client
  }

  async join(slug: string, email: string): Promise<WaitlistResult> {
    return this._client.post<WaitlistResult>('/api/sdk/waitlist/join', {
      publishableKey: this._client.publishableKey,
      slug,
      email,
    })
  }
}
