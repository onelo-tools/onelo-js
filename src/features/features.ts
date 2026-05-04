import { httpPost } from '@onelo/core'

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

// SSE reconnect schedule. The bounded backoff prevents tight loops on hard
// network failures while keeping the typical "WiFi blip" recovery near-instant.
const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000]
const CACHE_KEY_PREFIX = 'onelo_features_'

export interface OneloFeaturesOptions {
  /** Suppress the anonymous-mode identify() warning. See OneloConfig.suppressIdentifyWarning. */
  suppressIdentifyWarning?: boolean
}

interface CachedSnapshot {
  configVersion: number
  features: Record<string, FeatureStatus>
}

export class OneloFeatures {
  private readonly apiUrl: string
  private readonly publishableKey: string
  private cache: Map<string, FeatureStatus> = new Map()
  private discoveredNames: Set<string> = new Set()
  private configVersion = 0
  private pingDebounce: ReturnType<typeof setTimeout> | null = null
  private currentUserId: string | null = null
  private monitor: { _trackFeatureCall: (name: string) => void } | null = null
  private suppressIdentifyWarning: boolean
  private anonymousWarningLogged = false
  // SSE — primary channel for live deploys. Replaces the legacy 60s poll.
  private sseSource: EventSource | null = null
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private destroyed = false

  constructor(
    apiUrl: string,
    publishableKey: string,
    monitor?: { _trackFeatureCall: (name: string) => void },
    options?: OneloFeaturesOptions,
  ) {
    this.apiUrl = apiUrl
    this.publishableKey = publishableKey
    if (monitor) this.monitor = monitor
    this.suppressIdentifyWarning = options?.suppressIdentifyWarning ?? false
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

  /** Load features for a user (or anonymous). Called by Onelo orchestrator.
   * Restores cache for instant UI, then opens an SSE channel that delivers
   * live updates whenever an admin clicks Deploy in the dashboard. */
  async load(userId: string | null): Promise<void> {
    this.currentUserId = userId
    this._loadCache(userId)
    await this._batchPing()
    if (this._supportsSse()) {
      this._connectSSE(userId)
    } else {
      // Environments without EventSource (some SSR contexts) fall back to a
      // single one-shot resolve — no real-time updates, but at least correct
      // initial state. Browsers and modern Node always have EventSource.
      await this._resolve(userId)
    }
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

  /** Tear down the SSE connection. Call when the SDK instance is no longer needed
   * (e.g. on app shutdown). Kept named `stopPolling` for back-compat with the
   * old polling-based API. */
  stopPolling(): void {
    this.destroyed = true
    this._closeSse()
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
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
    this._writeCache()
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
        this._applySnapshot(typeof j['config_version'] === 'number' ? (j['config_version'] as number) : this.configVersion, features)
      }
      this._maybeWarnAnonymous(j)
    } catch {
      // keep existing cache
    }
  }

  /**
   * Logs a one-time warning when the backend reports anonymous mode (no userId)
   * AND at least one targeted feature was hidden purely because of it. Helps
   * developers using their own auth system catch missing identify() calls.
   * Suppressed via OneloConfig.suppressIdentifyWarning.
   */
  private _maybeWarnAnonymous(response: Record<string, unknown>): void {
    if (this.suppressIdentifyWarning || this.anonymousWarningLogged) return
    if (response['anonymous'] !== true) return
    const misses = typeof response['targeting_misses'] === 'number' ? (response['targeting_misses'] as number) : 0
    if (misses <= 0) return
    this.anonymousWarningLogged = true
    // eslint-disable-next-line no-console
    console.warn(
      `[Onelo] ${misses} feature(s) hidden because no user is identified.\n` +
      `If you handle auth yourself, call onelo.identify(userId) after login so per-user/per-plan targeting can apply.\n` +
      `If your app is intentionally anonymous, pass suppressIdentifyWarning: true in OneloConfig to silence this.`
    )
  }

  // ── SSE ──────────────────────────────────────────────────────────────────────

  private _supportsSse(): boolean {
    return typeof EventSource !== 'undefined'
  }

  private _connectSSE(userId: string | null): void {
    if (this.destroyed) return
    this._closeSse()

    const params = new URLSearchParams({
      key: this.publishableKey,
      since_version: String(this.configVersion),
    })
    if (userId) params.set('userId', userId)
    const url = `${this.apiUrl}/api/sdk/features/stream?${params.toString()}`
    let sse: EventSource
    try {
      sse = new EventSource(url)
    } catch {
      // Construction can throw on invalid URLs; treat as a transient error.
      this._scheduleReconnect(userId)
      return
    }
    this.sseSource = sse

    // Server sends `connected` only when current_version > since_version.
    sse.addEventListener('connected', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { config_version?: number; features?: Record<string, { status: string }> }
        if (data.features) {
          this._applySnapshot(data.config_version ?? this.configVersion, data.features)
        }
        this.reconnectAttempts = 0
      } catch {
        // ignore malformed payloads
      }
    })

    // Server sends `up_to_date` when client's since_version matches current.
    // No payload needed beyond confirmation; cache stays as-is.
    sse.addEventListener('up_to_date', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { config_version?: number }
        if (typeof data.config_version === 'number') this.configVersion = data.config_version
        this.reconnectAttempts = 0
      } catch {
        // ignore
      }
    })

    // Server pushes this whenever an admin clicks Deploy.
    sse.addEventListener('features_updated', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { config_version?: number; features?: Record<string, { status: string }> }
        if (data.features) {
          this._applySnapshot(data.config_version ?? this.configVersion, data.features)
        }
      } catch {
        // ignore
      }
    })

    sse.onerror = () => {
      // EventSource auto-retries internally for some error classes, but we
      // close + manually reconnect to apply our exponential backoff. This
      // also avoids the browser's default 3s retry in tight failure loops.
      this._closeSse()
      if (this.destroyed) return
      this._scheduleReconnect(userId)
    }
  }

  private _scheduleReconnect(userId: string | null): void {
    if (this.destroyed) return
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer)
    const delay = RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempts, RECONNECT_DELAYS_MS.length - 1)]
    this.reconnectAttempts++
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this._connectSSE(userId)
    }, delay)
  }

  private _closeSse(): void {
    if (this.sseSource !== null) {
      this.sseSource.close()
      this.sseSource = null
    }
  }

  // ── Cache ───────────────────────────────────────────────────────────────────

  private _cacheKey(userId: string | null): string {
    return `${CACHE_KEY_PREFIX}${this.publishableKey}_${userId ?? 'anon'}`
  }

  private _loadCache(userId: string | null): void {
    if (typeof localStorage === 'undefined') return
    try {
      const raw = localStorage.getItem(this._cacheKey(userId))
      if (!raw) return
      const parsed = JSON.parse(raw) as CachedSnapshot
      if (typeof parsed.configVersion !== 'number' || !parsed.features) return
      this.configVersion = parsed.configVersion
      this.cache.clear()
      for (const [name, status] of Object.entries(parsed.features)) {
        this.cache.set(name, status as FeatureStatus)
      }
    } catch {
      // corrupted cache — ignore
    }
  }

  private _writeCache(): void {
    if (typeof localStorage === 'undefined') return
    try {
      const features: Record<string, FeatureStatus> = {}
      for (const [name, status] of this.cache) features[name] = status
      const snapshot: CachedSnapshot = { configVersion: this.configVersion, features }
      localStorage.setItem(this._cacheKey(this.currentUserId), JSON.stringify(snapshot))
    } catch {
      // localStorage quota / private mode — ignore
    }
  }

  private _applySnapshot(version: number, features: Record<string, { status: string }>): void {
    this.configVersion = version
    this.cache.clear()
    for (const [name, state] of Object.entries(features)) {
      this.cache.set(name, state.status as FeatureStatus)
    }
    this._writeCache()
  }
}
