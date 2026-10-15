/**
 * OneloEventStream — one browser `EventSource` connection to
 * `GET /api/sdk/features/stream`, multiplexed for every module (features,
 * auth, …). Mirrors the Swift `OneloEventStream`: a single connection per app,
 * a name→handlers registry, and bounded-backoff reconnection.
 *
 * Credential: a **Stream Token**, minted by `POST /api/sdk/features/stream-token`
 * with the Publishable Key in an `X-Publishable-Key` header, and then carried in
 * the stream URL's `?token=`. A browser `EventSource` takes a URL and nothing
 * else (WHATWG SSE), so its credential can only travel in the query string —
 * which writes it into the reverse proxy's access.log on every connect. A token
 * is App-scoped and expires in minutes, so a captured one is worth far less than
 * the Publishable Key it replaces. ADR-0003 records why this SDK alone keeps the
 * token while every header-capable SDK sends the key in a request header.
 *
 * The token is minted fresh on EVERY connect and never stored: a live connection
 * is authenticated once, at connect, so an expiring token cannot break it, and a
 * reconnect after any lapse of time always carries a valid one. That is also why
 * expiry needs no bookkeeping here — there is no cached token to go stale.
 *
 * The signed-in user rides the same mint (#518): `EventSource` cannot send an
 * `Authorization` header, so the user's access token goes on the
 * `/stream-token` POST, which binds the user into the Stream Token; the stream
 * then ignores `?userId`. The access token is read fresh on every connect, so
 * every reconnect proves the user with a current one. A refused token is
 * refreshed once and retried once; refused again, that connection is opened
 * anonymous (no token, no `?userId`) and the next reconnect tries again.
 *
 * The native `EventSource` implements the WHATWG SSE parser (per-event dispatch,
 * keepalive comments, `retry:`), so unlike Swift there is nothing to hand-roll.
 *
 * Lifecycle is owned by the composition root (`Onelo`), not by any single
 * consumer: consumers only `on()` (register handlers) and `addParamProvider()`;
 * `Onelo` calls `start()/stop()/destroy()` (driven today by the features
 * identity bridge).
 */
import { httpPost } from '@onelo/core'
import { bearerHeader, sendWithUserToken, type UserTokenSource } from './user-token'

export type SseHandler = (data: Record<string, unknown>) => void
type ParamProvider = () => Record<string, string>

/** Identity attached to the currently open stream connection. `anonymousFallback`
 * is true when a signed-in token was refused and the stream was opened without
 * a user; that connection must never replace a signed-in snapshot. */
export interface StreamConnectionIdentity {
  userId: string | null
  anonymousFallback: boolean
}

// Bounded backoff — near-instant recovery for a WiFi blip, no tight loop on a
// hard failure. Lifted verbatim from the previous features SSE client.
const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000]

/**
 * Ceiling on the mint. A `fetch` that never settles — a black-holing proxy, a
 * tab frozen mid-request — would otherwise strand the stream for good: `minting`
 * would stay `true`, so `reconnectIfStale()` returns early on every
 * `visibilitychange`/`online`; no backoff timer is armed, because `_connect()`
 * cleared the old one and a new one is armed only on a SETTLED rejection; and
 * `refused` is false, so nothing else can revive it either.
 *
 * The pre-token `_connect()` was synchronous and always had an authoritative
 * `EventSource.readyState` to read, so it had no such window. Aborting turns the
 * hang back into an ordinary transient failure, which backs off and retries.
 *
 * 15s is well past any healthy mint (a small POST) and well under the browser's
 * own request timeout, so it is the shorter, more responsive of the two.
 */
const MINT_TIMEOUT_MS = 15_000

/** The mint answered 401/403 — the credential itself is bad, so no retry can
 *  fix it. Distinguished from every other mint failure, which is transient. */
class StreamCredentialRefused extends Error {
  constructor(readonly status: number) {
    super(`stream-token refused (${status})`)
  }
}

export class OneloEventStream {
  private source: EventSource | null = null
  private readonly handlers = new Map<string, SseHandler[]>()
  private readonly paramProviders: ParamProvider[] = []
  private readonly connectionListeners: Array<(identity: StreamConnectionIdentity | null) => void> = []
  private userId: string | null = null
  private started = false
  private destroyed = false
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  // Connect is async (it mints a Stream Token first). `connectGeneration`
  // invalidates a mint whose connect has been superseded; `minting` tells the
  // lifecycle reconnect that a connect is already under way, so a `null` socket
  // during the mint is not mistaken for a dropped one.
  private connectGeneration = 0
  private minting = false
  // Set once the mint refuses the credential (401/403). Permanent for the life
  // of this stream — nothing but a new Onelo instance clears it.
  private refused = false
  private lifecycleBound = false
  private userTokenRefusedWarned = false
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
    /** The signed-in user's access token, sent on the Stream Token mint. */
    private readonly userToken?: UserTokenSource,
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

  /**
   * Observe which identity the current socket actually authenticated. This is
   * distinct from the requested user: a refused user token opens an anonymous
   * fallback stream while retaining the requested userId for the next retry.
   */
  onConnectionIdentity(fn: (identity: StreamConnectionIdentity | null) => void): void {
    this.connectionListeners.push(fn)
  }

  private _setConnectionIdentity(identity: StreamConnectionIdentity | null): void {
    for (const listener of this.connectionListeners) {
      try { listener(identity) } catch { /* a listener error must not break the stream */ }
    }
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
    this._setConnectionIdentity(null)
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
    if (this.destroyed || !this.started || !this._supported() || this.refused) return
    // A connect already under way owns no socket yet (the mint is in flight).
    // Without this the `source === null` test below would read that as a drop
    // and start a second, redundant mint on every lifecycle event.
    if (this.minting) return
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
    // `fetch` is as load-bearing as `EventSource` now: without it there is no
    // way to mint the credential the stream needs.
    return typeof EventSource !== 'undefined' && typeof fetch !== 'undefined'
  }

  /**
   * Mint one Stream Token. The Publishable Key travels here — in a header, on a
   * POST — and never anywhere near the stream URL.
   *
   * Throws `StreamCredentialRefused` on 401/403 (a dead key: permanent) and a
   * plain Error on anything else (offline, 5xx, a token-less body: transient).
   * A 503 from an unreachable key lookup therefore retries rather than killing
   * the stream, which is the Reachability invariant the backend upholds.
   *
   * The status branch below sees a 401/403 whatever content-type it arrives in.
   * `httpPost` used to parse the body BEFORE anyone could read the status
   * (`onelo-core/src/http.ts`), so a WAF or proxy rendering a GENUINE refusal as
   * an HTML page threw a network error, landed in the transient branch, and was
   * retried forever — straight past this brake. It now reads the status first
   * and hands a refusal back with an empty `json`, so the check below catches it
   * (#97; `event-stream.test.ts` proves the brake stops on an HTML 403).
   *
   * The inverse still holds, and is what keeps this honest: an HTML 5xx is an
   * unreachable intermediary, not a verdict on the key, and stays transient —
   * so does any other unparseable answer. Only 401 and 403 brake.
   *
   * The mint is bounded by `MINT_TIMEOUT_MS` via an `AbortController`; see that
   * constant for the hang it exists to end.
   *
   * `X-Publishable-Key` and, when a user is signed in, `Authorization: Bearer
   * <access token>` are the only headers sent. Platform and version stay on the
   * stream URL, where the connection they describe actually is.
   *
   * Resolves to the token plus whether it had to be minted anonymous because
   * the user's access token was refused even after a refresh.
   *
   * The environment is deliberately NOT sent: `?environment=` on the stream URL
   * (supplied by the features param provider) overrides the token's pinned env
   * server-side, so pinning it twice would just be a second place to drift.
   */
  private async _mintStreamToken(): Promise<{ token: string; anonymous: boolean }> {
    const controller = new AbortController()
    const ceiling = setTimeout(() => controller.abort(), MINT_TIMEOUT_MS)
    try {
      let anonymous = false
      const { status, json } = await sendWithUserToken(
        this.userToken,
        (attempt) => {
          anonymous = attempt.anonymous
          return httpPost(
            `${this.apiUrl}/api/sdk/features/stream-token`,
            {},
            { 'X-Publishable-Key': this.publishableKey, ...bearerHeader(attempt.token) },
            controller.signal,
          )
        },
        () => this._warnUserTokenRefused(),
      )
      if (status === 401 || status === 403) throw new StreamCredentialRefused(status)
      if (status < 200 || status >= 300) throw new Error(`stream-token ${status}`)
      const token = (json as { token?: unknown } | null)?.token
      if (typeof token !== 'string' || token.length === 0) {
        throw new Error('stream-token: response carried no token')
      }
      return { token, anonymous }
    } finally {
      // However this ended — token, refusal, abort — the ceiling has no more
      // work to do, and a live timer would keep the tab awake for nothing.
      clearTimeout(ceiling)
    }
  }

  private _connect(): void {
    if (this.destroyed || !this.started || !this._supported() || this.refused) return
    // This connection supersedes any pending backoff reconnect — cancel it so a
    // stale timer can't tear down the fresh connection a moment later (the
    // lifecycle-reconnect-during-backoff collision).
    this._clearReconnect()
    this._setConnectionIdentity(null)
    this._close()
    // Every connect gets a generation. The mint below is async, so a `stop()`,
    // a `destroy()` or a newer `_connect()` can land while it is in flight; the
    // generation is what tells the resumed continuation it has been superseded
    // and must not install a socket.
    const generation = ++this.connectGeneration
    this.minting = true
    void this._openWithToken(generation)
  }

  private async _openWithToken(generation: number): Promise<void> {
    try {
      await this._mintAndOpen(generation)
    } finally {
      // One place that states the invariant: this connect is no longer in
      // flight — however it ended, including a `stop()` mid-mint. Skipped when
      // a newer connect has taken over, because the flag is then ITS flag.
      if (generation === this.connectGeneration) this.minting = false
    }
  }

  private _warnUserTokenRefused(): void {
    if (this.userTokenRefusedWarned) return
    this.userTokenRefusedWarned = true
    console.warn(
      '[Onelo] The signed-in user\'s access token was refused by the Event Stream (invalid_user_token) ' +
      'even after a refresh, so the stream was opened without a user.',
    )
  }

  private async _mintAndOpen(generation: number): Promise<void> {
    let token: string
    let anonymous: boolean
    try {
      ({ token, anonymous } = await this._mintStreamToken())
    } catch (err) {
      if (generation !== this.connectGeneration) return // superseded
      if (err instanceof StreamCredentialRefused) {
        // A genuine 401/403: this key is not going to start working on a retry,
        // and a fleet of browsers retrying a dead key forever is the 2026-07
        // connection-pool storm. Stop for the life of this stream.
        //
        // The brake lives HERE and only here, deliberately: the mint is a
        // `fetch` and can read a status code, while `EventSource.onerror`
        // cannot (WHATWG SSE gives it no status). So a refusal on the stream
        // GET itself is still indistinguishable from a dropped socket and
        // still backs off — unchanged, and unfixable without abandoning
        // `EventSource`. Moving the credential check to a request that CAN
        // see its own status is what makes a permanent brake possible at all.
        this.refused = true
        console.warn(
          `[Onelo] Event Stream credential refused (HTTP ${err.status}) — stream stopped. ` +
          'Check the publishableKey and apiUrl passed to Onelo.',
        )
        return
      }
      // Anything else (offline, 5xx, a proxy's HTML error page) is transient.
      this._scheduleReconnect()
      return
    }
    // Re-check every reason not to connect: all of them can have changed while
    // the mint was in flight.
    if (generation !== this.connectGeneration || this.destroyed || !this.started) return

    // Params are read AFTER the mint so a provider's value (features'
    // `since_version`) is the one current at connect, not at mint.
    const params = new URLSearchParams({ token, sdk_platform: 'js' })
    if (this.sdkVersion) params.set('sdk_version', this.sdkVersion)
    // A connection whose user token was refused is anonymous: no `?userId`.
    if (this.userId && !anonymous) params.set('userId', this.userId)
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
    this._setConnectionIdentity({ userId: this.userId, anonymousFallback: anonymous })

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
