import type { _OneloClient } from './client'
import type { FeatureStatus, ResolveResponse } from './types'

export class OneloFeatures {
  private readonly _client: _OneloClient
  private _cache: Map<string, FeatureStatus> = new Map()
  private _pendingPing: Set<string> = new Set()
  private _pingTimer: ReturnType<typeof setTimeout> | null = null

  constructor(client: _OneloClient) {
    this._client = client
  }

  async _resolve(plan?: string): Promise<void> {
    this._cache.clear()
    try {
      const data = await this._client.post<ResolveResponse>(
        '/api/sdk/features/resolve',
        { publishableKey: this._client.publishableKey, userPlan: plan }
      )
      for (const [name, state] of Object.entries(data.features)) {
        this._cache.set(name, state.status)
      }
    } catch {
      // network error — keep empty cache, fall back to 'hidden'
    }
  }

  status(name: string): FeatureStatus {
    if (this._cache.has(name)) {
      return this._cache.get(name)!
    }
    this._pendingPing.add(name)
    this._schedulePing()
    return 'hidden'
  }

  isEnabled(name: string): boolean {
    return this.status(name) === 'enabled'
  }

  private _schedulePing(): void {
    if (this._pingTimer !== null) return
    this._pingTimer = setTimeout(() => {
      this._pingTimer = null
      const features = Array.from(this._pendingPing)
      this._pendingPing.clear()
      this._client
        .post('/api/sdk/features/batch-ping', {
          publishableKey: this._client.publishableKey,
          features,
        })
        .catch(() => {})
    }, 0)
  }
}
