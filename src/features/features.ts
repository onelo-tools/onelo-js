import { httpPost, httpGet } from '@onelo/core'

export type FeatureStatus =
  | 'enabled'
  | 'disabled'
  | 'greyed'
  | 'hidden'
  | 'upsell'
  | 'new'
  | 'beta'
  | 'coming_soon'

export class FeatureState {
  readonly name: string
  readonly status: FeatureStatus

  constructor(name: string, status: FeatureStatus) {
    this.name = name
    this.status = status
  }

  get isEnabled(): boolean { return this.status === 'enabled' || this.status === 'new' || this.status === 'beta' }
  get isDisabled(): boolean { return this.status === 'disabled' }
  get isVisible(): boolean { return this.status !== 'hidden' }
  get isGreyed(): boolean { return this.status === 'greyed' }
  get isUpsell(): boolean { return this.status === 'upsell' }
  get isNew(): boolean { return this.status === 'new' }
  get isBeta(): boolean { return this.status === 'beta' }
  get isComingSoon(): boolean { return this.status === 'coming_soon' }

  get badgeLabel(): string | null {
    if (this.status === 'new') return 'New'
    if (this.status === 'beta') return 'Beta'
    if (this.status === 'coming_soon') return 'Coming Soon'
    return null
  }
}

const POLL_INTERVAL_MS = 60_000

export class OneloFeatures {
  private readonly apiUrl: string
  private readonly publishableKey: string
  private cache: Map<string, FeatureStatus> = new Map()
  private discoveredNames: Set<string> = new Set()
  private configVersion = 0
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private pingDebounce: ReturnType<typeof setTimeout> | null = null
  private currentUserId: string | null = null
  private monitor: { _trackFeatureCall: (name: string) => void } | null = null

  constructor(apiUrl: string, publishableKey: string, monitor?: { _trackFeatureCall: (name: string) => void }) {
    this.apiUrl = apiUrl
    this.publishableKey = publishableKey
    if (monitor) this.monitor = monitor
  }

  /** Declare feature names upfront — triggers a batch-ping immediately. */
  declare(names: string[]): void {
    for (const name of names) this.discoveredNames.add(name)
    this._scheduleBatchPing()
  }

  /** Returns the current state for a feature. Auto-registers on first call. */
  feature(name: string): FeatureState {
    const isNew = !this.discoveredNames.has(name)
    this.discoveredNames.add(name)
    if (isNew) this._scheduleBatchPing()
    if (isNew) this.monitor?._trackFeatureCall(name)
    const status = this.cache.get(name) ?? 'hidden'
    return new FeatureState(name, status)
  }

  /** Load features for a user (or anonymous). Called by Onelo orchestrator. */
  async load(userId: string | null): Promise<void> {
    this.currentUserId = userId
    await this._batchPing()
    await this._resolve(userId)
    this._startPolling(userId)
  }

  /** Returns names of all features with an active status (enabled, new, or beta). */
  getActiveFeatures(): string[] {
    const active: string[] = []
    for (const [name, status] of this.cache) {
      if (status === 'enabled' || status === 'new' || status === 'beta') {
        active.push(name)
      }
    }
    return active
  }

  /** Stop background polling. Call when SDK is no longer needed. */
  stopPolling(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    if (this.pingDebounce !== null) {
      clearTimeout(this.pingDebounce)
      this.pingDebounce = null
    }
  }

  /** Clears the local feature cache and resets the config version. The next feature() call will re-fetch. */
  invalidateCache(): void {
    this.cache.clear()
    this.configVersion = 0
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private _scheduleBatchPing(): void {
    if (this.pingDebounce !== null) clearTimeout(this.pingDebounce)
    this.pingDebounce = setTimeout(() => {
      this.pingDebounce = null
      void this._batchPing()
    }, 1000)
  }

  private async _batchPing(): Promise<void> {
    const names = Array.from(this.discoveredNames)
    if (names.length === 0) return
    try {
      await httpPost(`${this.apiUrl}/api/sdk/features/batch-ping`, {
        publishableKey: this.publishableKey,
        features: names,
      })
    } catch {
      // best-effort
    }
  }

  private async _resolve(userId: string | null): Promise<void> {
    try {
      const body: Record<string, unknown> = { publishableKey: this.publishableKey }
      if (userId) body['userId'] = userId
      const { status, json } = await httpPost(`${this.apiUrl}/api/sdk/features/resolve`, body)
      if (status !== 200) return
      const j = json as Record<string, unknown>
      const features = j['features'] as Record<string, { status: string }> | undefined
      if (features) {
        this.cache.clear()
        for (const [name, state] of Object.entries(features)) {
          this.cache.set(name, state.status as FeatureStatus)
        }
      }
      if (typeof j['config_version'] === 'number') {
        this.configVersion = j['config_version'] as number
      }
    } catch {
      // keep existing cache
    }
  }

  private async _poll(userId: string | null): Promise<void> {
    try {
      const params = new URLSearchParams({
        key: this.publishableKey,
        version: String(this.configVersion),
      })
      if (userId) params.set('userId', userId)
      const { status, json } = await httpGet(
        `${this.apiUrl}/api/sdk/features/poll?${params.toString()}`
      )
      if (status !== 200) return
      const j = json as Record<string, unknown>
      if (j['changed'] === false) return
      const features = j['features'] as Record<string, { status: string }> | undefined
      if (features) {
        this.cache.clear()
        for (const [name, state] of Object.entries(features)) {
          this.cache.set(name, state.status as FeatureStatus)
        }
      }
      if (typeof j['config_version'] === 'number') {
        this.configVersion = j['config_version'] as number
      }
      if (j['discovery_requested'] === true) {
        await this._batchPing()
      }
    } catch {
      // ignore — will retry on next tick
    }
  }

  private _startPolling(userId: string | null): void {
    if (this.pollTimer !== null) clearInterval(this.pollTimer)
    this.pollTimer = setInterval(() => {
      void this._poll(userId)
    }, POLL_INTERVAL_MS)
  }
}
