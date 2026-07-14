/**
 * OneloEventStream — one browser `EventSource` connection to
 * `GET /api/sdk/features/stream`, multiplexed for every module (features,
 * auth, …). Mirrors the Swift `OneloEventStream`: a single connection per app,
 * a name→handlers registry, and bounded-backoff reconnection.
 *
 * The endpoint authenticates via the `key` query param (publishable key), so
 * it is fully compatible with browser `EventSource` — which cannot set an
 * `Authorization` header. The native `EventSource` implements the WHATWG SSE
 * parser (per-event dispatch, keepalive comments, `retry:`), so unlike Swift
 * there is nothing to hand-roll.
 *
 * Lifecycle is owned by the composition root (`Onelo`), not by any single
 * consumer: consumers only `on()` (register handlers) and `addParamProvider()`;
 * `Onelo` calls `start()/stop()/destroy()` (driven today by the features
 * identity bridge).
 */
export type SseHandler = (data: Record<string, unknown>) => void
type ParamProvider = () => Record<string, string>

// Bounded backoff — near-instant recovery for a WiFi blip, no tight loop on a
// hard failure. Lifted verbatim from the previous features SSE client.
const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000]

export class OneloEventStream {
  private source: EventSource | null = null
  private readonly handlers = new Map<string, SseHandler[]>()
  private readonly paramProviders: ParamProvider[] = []
  private userId: string | null = null
  private started = false
  private destroyed = false
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private lifecycleBound = false
  private readonly lifecycleListeners: Array<() => void> = []
  // Arrow fields so the same reference can be removed on destroy.
  private readonly _onVisibility = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      this.reconnectIfStale()
      this._notifyLifecycle()
    }
  }
  private readonly _onOnline = (): void => { this.reconnectIfStale(); this._notifyLifecycle() }

  constructor(
    private readonly apiUrl: string,
    private readonly publishableKey: string,
    private readonly sdkVersion?: string,
  ) {}

  /**
   * Register a handler for a named server event (`connected`, `features_updated`,
   * `session.revoked`, …). Survives reconnects. Register BEFORE `start()` (e.g.
   * in a module constructor) so no event is missed between connect and sign-in.
   */
  on(event: string, handler: SseHandler): void {
    const arr = this.handlers.get(event) ?? []
    arr.push(handler)
    this.handlers.set(event, arr)
  }

  /**
   * Extra query params, read fresh on EVERY (re)connect — used for values that
   * change over the connection's life (e.g. features' `since_version`), so a
   * reconnect always sends the current value.
   */
  addParamProvider(fn: ParamProvider): void {
    this.paramProviders.push(fn)
  }

  /**
   * Register a callback fired on a lifecycle resume — the tab becomes visible or
   * the network comes back online (the same signals that drive
   * reconnectIfStale). Consumers use this to reconcile state via REST in
   * parallel with the SSE catch-up (e.g. OneloFeatures.refresh()). Survives for
   * the stream's life; there is no unregister (listeners live as long as the
   * stream). A listener throwing never breaks the stream.
   */
  onLifecycleResume(fn: () => void): void {
    this.lifecycleListeners.push(fn)
  }

  private _notifyLifecycle(): void {
    for (const fn of this.lifecycleListeners) {
      try { fn() } catch { /* a listener error must never break the stream */ }
    }
  }

  /**
   * Open (or re-open) the connection for a user. Idempotent: a repeat call with
   * the same userId while already connected is a no-op (no needless reconnect).
   * A changed userId reconnects so per-user routing (features + session.revoked
   * targeting) is correct.
   */
  start(userId: string | null): void {
    if (this.destroyed) return
    const changed = userId !== this.userId || !this.started
    this.userId = userId
    this.started = true
    this._bindLifecycle()
    if (changed) this._connect()
  }

  /** Close the connection and cancel any pending reconnect. */
  stop(): void {
    this.started = false
    this._clearReconnect()
    this._close()
  }

  /** Permanent teardown — cannot be restarted. */
  destroy(): void {
    this.destroyed = true
    this._unbindLifecycle()
    this.stop()
  }

  /**
   * Reconnect ONLY if the connection actually dropped — the browser throttled
   * or closed it while the tab was backgrounded, or the network changed.
   * `EventSource.readyState` (0 CONNECTING · 1 OPEN · 2 CLOSED) is authoritative
   * for a real drop.
   *
   * We deliberately do NOT run a silence-based watchdog timer (as the Swift SDK
   * does): the browser `EventSource` hides the server's `:keepalive` comments,
   * so "no named event in N seconds" does NOT imply a dead connection on a quiet
   * app — a periodic reconnect would false-positive and worsen connection-pool
   * pressure (the 2026-07 exhaustion outage). Lifecycle events (visibility /
   * online) are the correct, false-positive-free browser signal.
   */
  reconnectIfStale(): void {
    if (this.destroyed || !this.started || !this._supported()) return
    // Reconnect only when the socket is gone (null) or CLOSED (2). Do NOT
    // reconnect on CONNECTING (0): that would restart an in-flight handshake if
    // two lifecycle events (online + visibilitychange) fire back-to-back on
    // recovery. A genuinely stuck CONNECTING socket is handled by the browser's
    // own connect-timeout → onerror → backoff reconnect.
    if (this.source === null || this.source.readyState === 2 /* CLOSED */) this._connect()
  }

  private _bindLifecycle(): void {
    if (this.lifecycleBound) return
    this.lifecycleBound = true
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', this._onVisibility)
    }
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('online', this._onOnline)
    }
  }

  private _unbindLifecycle(): void {
    if (!this.lifecycleBound) return
    this.lifecycleBound = false
    if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
      document.removeEventListener('visibilitychange', this._onVisibility)
    }
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('online', this._onOnline)
    }
  }

  /**
   * Force a fresh connection NOW, re-reading all params (base + providers).
   * Used after a consumer resets a provider value — e.g. features'
   * `invalidateCache()` sets `since_version = 0`, and only a reconnect makes
   * the server resend a full snapshot (a live connection stays silent).
   * No-op when not started or destroyed.
   */
  reconnect(): void {
    if (this.destroyed || !this.started) return
    this._connect()
  }

  private _supported(): boolean {
    return typeof EventSource !== 'undefined'
  }

  private _connect(): void {
    if (this.destroyed || !this.started || !this._supported()) return
    // This connection supersedes any pending backoff reconnect — cancel it so a
    // stale timer can't tear down the fresh connection a moment later (the
    // lifecycle-reconnect-during-backoff collision).
    this._clearReconnect()
    this._close()

    const params = new URLSearchParams({ key: this.publishableKey, sdk_platform: 'js' })
    if (this.sdkVersion) params.set('sdk_version', this.sdkVersion)
    if (this.userId) params.set('userId', this.userId)
    for (const provide of this.paramProviders) {
      for (const [k, v] of Object.entries(provide())) params.set(k, v)
    }
    const url = `${this.apiUrl}/api/sdk/features/stream?${params.toString()}`

    let source: EventSource
    try {
      source = new EventSource(url)
    } catch {
      // Construction can throw on a malformed URL — treat as transient.
      this._scheduleReconnect()
      return
    }
    this.source = source

    for (const [event, handlers] of this.handlers) {
      source.addEventListener(event, (e: MessageEvent) => {
        // A delivered frame proves the connection is healthy — reset backoff.
        this.reconnectAttempts = 0
        let data: Record<string, unknown> = {}
        if (typeof e.data === 'string' && e.data.length > 0) {
          try { data = JSON.parse(e.data) as Record<string, unknown> } catch { /* some events carry empty data */ }
        }
        for (const handler of handlers) {
          try { handler(data) } catch { /* a handler error must never break the stream */ }
        }
      })
    }

    source.onerror = () => {
      // Close + manual backoff reconnect (overrides the browser's default 3s
      // retry so a hard-failure loop stays bounded).
      this._close()
      if (!this.destroyed && this.started) this._scheduleReconnect()
    }
  }

  private _scheduleReconnect(): void {
    if (this.destroyed || !this.started) return
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer)
    const base = RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempts, RECONNECT_DELAYS_MS.length - 1)]
    this.reconnectAttempts++
    // Full jitter over [0, base) — parity with the Swift SDK and honours the
    // backend's random `retry:` hint (which the manual reconnect otherwise
    // discards). Desynchronises a fleet reconnecting after a deploy/restart so
    // they don't stampede the connection pool (2026-07 pool-exhaustion outage).
    const delay = Math.floor(Math.random() * base)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this._connect()
    }, delay)
  }

  private _clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private _close(): void {
    if (this.source !== null) {
      this.source.close()
      this.source = null
    }
  }
}
