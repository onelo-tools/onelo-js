import type { _OneloClient } from './client'

const TIER_ORDER: string[] = ['free', 'starter', 'pro', 'enterprise']

function tierRank(plan: string | undefined): number {
  const idx = TIER_ORDER.indexOf(plan ?? 'free')
  return idx === -1 ? 0 : idx
}

export class OneloPaywall {
  private readonly _client: _OneloClient

  constructor(client: _OneloClient) {
    this._client = client
  }

  check(requiredTier: string): boolean {
    return tierRank(this._client.plan) >= tierRank(requiredTier)
  }
}
