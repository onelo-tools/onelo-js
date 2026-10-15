import { version as SDK_VERSION } from '../../package.json'
import { scrubText, scrubMeta } from './scrubber'
import { classifyErrorOrigin, type ErrorOrigin } from '@onelo/core'

export interface MonitorEventOptions {
  ok: boolean
  durationMs?: number
  error?: string
  meta?: Record<string, unknown>
}

/** Always-on context the SDK attaches to every event's meta (mirrors Swift's enrichMeta). */
export interface MonitorContext {
  appVersion?: string
  appBuild?: string
  bundleId?: string
  environment?: string
}

const SDK_NAME = '@onelo/js'

type EventSource = 'feature_call' | 'track' | 'event' | 'global_error'

interface BufferedEvent {
  /**
   * ISO-8601 UTC, stamped when the event HAPPENED — not when it is sent.
   *
   * The backend clamps this to a 1h staleness window and falls back to ingest
   * time when it is absent (`_resolve_event_ts` in sdk_monitor.py), so without
   * it a batch that waited out an outage is recorded as having happened the
   * moment the outage ended. Parity with onelo-python / node / php, which have
   * always sent it.
   */
  ts: string
  featureName: string
  ok: boolean
  durationMs?: number
  error?: string
  meta?: Record<string, unknown>
  source: EventSource
  userId?: string
  sessionId: string
  platform: string
}

const MAX_BUFFER_SIZE = 200
const MAX_FLAGS = 100 // LRU cap on the flag snapshot (parity with Swift's MonitorFeatureFlagBuffer)
const MAX_BREADCRUMBS = 100 // ring buffer (parity with Swift's MonitorBreadcrumbBuffer)
// Delivery policy: ONE attempt per flush. A batch the server did not accept goes
// back in the buffer and rides the next 15s tick — the timer IS the retry, so a
// backend outage never multiplies inbound request volume (an in-flight retry
// loop would have tripled it at the worst possible moment) and a drain always
// stays milliseconds long, which is what keeps every teardown path bounded.
const MAX_RETRY_AFTER_MS = 3_600_000

/**
 * What one delivery attempt means for the batch:
 * `done`    — the server ACCEPTED it. Settled; never send again.
 * `requeue` — the server did NOT take it (429, 5xx, network). Put it back and
 *             let the next flush carry it.
 * `drop`    — permanently rejected (4xx other than 429: bad key, malformed
 *             payload). Re-sending would fail identically forever, so we discard
 *             it — but LOUDLY, never silently.
 */
type SendOutcome = 'done' | 'requeue' | 'drop'

// eslint-disable-next-line no-console
const _warn = (...args: unknown[]): void => console.warn('[onelo.monitor]', ...args)

/** Seconds-form `Retry-After` → ms, clamped. Tolerates a header-less response
 *  (test doubles, opaque responses) — never throws. */
function _parseRetryAfter(res: Response): number {
  let raw: string | null = null
  try {
    raw = res.headers?.get?.('Retry-After') ?? null
  } catch { /* no headers — treat as absent */ }
  if (!raw) return 0
  const seconds = Number(raw.trim())
  if (!Number.isFinite(seconds)) return 0
  return Math.max(0, Math.min(seconds * 1000, MAX_RETRY_AFTER_MS))
}

const PLATFORM = 'js'
const SESSION_KEY = 'onelo_monitor_session'

/** A trail entry leading up to an error. */
interface Breadcrumb { category: string; message: string; ts: number; data?: Record<string, string> }

/**
 * Session id, persisted in localStorage so events from one browser install
 * group across page reloads (parity with Swift's persistent install-id used as
 * sessionId). Falls back to a per-instance id when storage is unavailable.
 */
function _resolveSessionId(): string {
  try {
    if (typeof localStorage !== 'undefined') {
      const existing = localStorage.getItem(SESSION_KEY)
      if (existing) return existing
      const id = crypto.randomUUID()
      localStorage.setItem(SESSION_KEY, id)
      return id
    }
  } catch { /* private mode / quota — fall through to a volatile id */ }
  return crypto.randomUUID()
}

/** Best-effort browser device context (parity with Swift's meta.device). */
function _deviceContext(): Record<string, unknown> {
  const d: Record<string, unknown> = {}
  if (typeof navigator !== 'undefined') {
    if (navigator.userAgent) d['userAgent'] = navigator.userAgent
    if (navigator.language) d['language'] = navigator.language
    const conn = (navigator as { connection?: { effectiveType?: string } }).connection
    if (conn?.effectiveType) d['connection'] = conn.effectiveType
    const mem = (navigator as { deviceMemory?: number }).deviceMemory
    if (typeof mem === 'number') d['deviceMemoryGb'] = mem
  }
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (tz) d['timezone'] = tz
  } catch { /* Intl unavailable — omit */ }
  return d
}

/** Normalize any thrown value into { message, stack, errorType }. */
function _extractError(err: unknown): { message: string; stack?: string; errorType?: string } {
  if (err instanceof Error) return { message: err.message, stack: err.stack, errorType: err.name }
  return { message: String(err) }
}

// Global window-error handlers are installed ONCE at module scope and route to
// the CURRENT live monitor (latest-wins, mirroring Swift's static globalSink).
// This fixes the dual-instance bug: a SECOND OneloMonitor (two Onelo instances,
// micro-frontends, HMR, tests) becomes the active target instead of being
// silently ignored by a stuck one-shot flag, and after destroy() no window
// error routes into a dead instance.
let _activeMonitor: OneloMonitor | null = null
let _handlersInstalled = false

function _installGlobalHandlers(): void {
  if (_handlersInstalled) return
  // Browser: window error/rejection + a beacon flush when the page goes away.
  if (typeof window !== 'undefined') {
    _handlersInstalled = true
    window.addEventListener('unhandledrejection', (e) => {
      _activeMonitor?._onGlobalError(
        e.reason instanceof Error ? e.reason.message : String(e.reason),
        e.reason instanceof Error ? e.reason.stack : undefined,
        classifyErrorOrigin(e.reason),
      )
    })
    window.addEventListener('error', (e) => {
      const stack = e.error instanceof Error ? e.error.stack : undefined
      _activeMonitor?._onGlobalError(e.message ?? 'Unknown error', stack, classifyErrorOrigin(e.error, stack))
    })
    // Deliver anything buffered before the page unloads.
    const beacon = () => { void _activeMonitor?.flush(true) }
    window.addEventListener('beforeunload', beacon)
    window.addEventListener('pagehide', beacon)
    return
  }
  // Node / server (onelo.ts supports server usage): capture uncaught errors +
  // rejections. Reach `process` via globalThis so bundlers don't polyfill it
  // into browser builds (see feedback_env_isserver_detection).
  const proc = (globalThis as { process?: { on?: (e: string, fn: (v: unknown) => void) => void } }).process
  if (proc && typeof proc.on === 'function') {
    _handlersInstalled = true
    // `uncaughtExceptionMonitor` OBSERVES the fatal error WITHOUT suppressing
    // Node's default crash-and-exit — a plain `uncaughtException` listener would
    // leave the host running in a corrupt state (Swift chains to the previous
    // handler for the same reason). We deliberately do NOT register
    // `unhandledRejection` in Node: any listener there overrides the host's
    // termination policy, which a monitoring SDK must never silently change.
    // (Browser rejections are safe to observe — the page doesn't crash on them.)
    proc.on('uncaughtExceptionMonitor', (err: unknown) => {
      const { message, stack } = _extractError(err)
      _activeMonitor?._onGlobalError(message, stack, classifyErrorOrigin(err))
    })
  }
}

export class OneloMonitor {
  private readonly publishableKey: string
  private readonly apiUrl: string
  private readonly sessionId: string = _resolveSessionId()
  private buffer: BufferedEvent[] = []
  // Rolling snapshot of the most recently evaluated feature flags (name→status),
  // LRU-capped. Attached to ERROR events so a captured error carries the active
  // flag state — the flag↔error correlation feature (parity with Swift).
  private readonly flags = new Map<string, string>()
  // Ring buffer of breadcrumbs (the trail leading up to an error). Snapshotted
  // into meta.breadcrumbs on error events (parity with Swift).
  private readonly breadcrumbs: Breadcrumb[] = []
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private currentUserId: string | null = null
  /** Serialises all drains so a timer flush and an error flush can't overlap. */
  private flushChain: Promise<void> = Promise.resolve()
  /** Epoch ms until which we hold off sending (set from a 429 `Retry-After`). */
  private retryAfterUntil = 0
  /** Pre-built static meta merged into every event (sdk + app). Computed once. */
  private readonly staticMeta: Record<string, unknown>
  private readonly environment?: string

  constructor(publishableKey: string, apiUrl: string, context?: MonitorContext) {
    this.publishableKey = publishableKey
    this.apiUrl = apiUrl
    const app: Record<string, string> = {}
    if (context?.appVersion) app.version = context.appVersion
    if (context?.appBuild) app.build = context.appBuild
    if (context?.bundleId) app.bundleId = context.bundleId
    this.staticMeta = {
      sdk: { name: SDK_NAME, version: SDK_VERSION },
      ...(Object.keys(app).length > 0 ? { app } : {}),
    }
    this.environment = context?.environment
    this.flushTimer = setInterval(() => { void this.flush() }, 15000)
    // Latest-wins: become the active target for global window errors, and
    // install the shared handlers once.
    _activeMonitor = this
    _installGlobalHandlers()
    // Auto-emit one unconditional event per construction. An app that gates
    // every instrumented operation behind sign-in/paywall/consent would
    // otherwise emit NOTHING on a cold start — the dashboard would look
    // "not integrated" even though every line of the snippet was followed
    // correctly. This event needs no gate to exist: it fires the moment the
    // SDK is constructed, so Feature Health always has at least one row.
    this._push('session_opened', true, undefined, undefined, undefined, 'event')
  }

  /**
   * Returns a new meta object with always-on context merged in. SDK-owned keys
   * (`sdk`, `app`) are authoritative and override any caller-supplied value;
   * `environment` is only filled when the caller did not set it per-event.
   * Never mutates the caller's meta.
   */
  private _enrich(meta?: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = { ...(meta ?? {}), ...this.staticMeta }
    if (this.environment != null && out['environment'] == null) {
      out['environment'] = this.environment
    }
    return out
  }

  /** Sets the current user ID attached to all subsequent monitor events. Call after login/logout if not using Onelo Auth. */
  setUserId(userId: string | null): void {
    this.currentUserId = userId
  }

  _trackFeatureCall(featureName: string): void {
    this._push(featureName, true, undefined, undefined, undefined, 'feature_call')
  }

  /**
   * Record the current value of a feature flag for flag↔error correlation.
   * Called by OneloFeatures on every evaluation. LRU: re-recording a key moves
   * it to most-recent; the buffer is capped at MAX_FLAGS. Not an event — just
   * updates the snapshot attached to future error captures.
   */
  recordFlag(key: string, value: string): void {
    if (this.flags.has(key)) this.flags.delete(key) // move-to-end (LRU)
    this.flags.set(key, value)
    if (this.flags.size > MAX_FLAGS) {
      const oldest = this.flags.keys().next().value
      if (oldest !== undefined) this.flags.delete(oldest)
    }
  }

  async track<T>(featureName: string, fn: () => Promise<T> | T, options?: { meta?: Record<string, unknown> }): Promise<T> {
    const start = Date.now()
    try {
      const result = await fn()
      this._push(featureName, true, Date.now() - start, undefined, options?.meta, 'track')
      return result
    } catch (err) {
      const { message, stack, errorType } = _extractError(err)
      this._push(featureName, false, Date.now() - start, message, this._withError(options?.meta, stack, errorType), 'track')
      throw err
    }
  }

  event(featureName: string, opts: MonitorEventOptions): void {
    this._push(featureName, opts.ok, opts.durationMs, opts.error, opts.meta, 'event')
  }

  /**
   * Add a breadcrumb — a step in the trail leading to an error. Snapshotted into
   * `meta.breadcrumbs` on the next error capture. Ring-buffered (cap 100). The
   * message is scrubbed of secrets on the way in. Parity with Swift.
   */
  breadcrumb(message: string, opts?: { category?: string; data?: Record<string, string> }): void {
    this.breadcrumbs.push({
      category: opts?.category ?? 'info',
      message: scrubText(message),
      ts: Date.now(),
      ...(opts?.data ? { data: opts.data } : {}),
    })
    if (this.breadcrumbs.length > MAX_BREADCRUMBS) this.breadcrumbs.shift()
  }

  /**
   * Manually capture an error/exception with its stack + the active breadcrumbs
   * and feature flags (parity with Swift's `capture`). Use for caught errors you
   * still want reported. Never throws.
   */
  capture(error: unknown, opts?: { featureName?: string; meta?: Record<string, unknown> }): void {
    const { message, stack, errorType } = _extractError(error)
    this._push(opts?.featureName ?? 'captured', false, undefined, message, this._withError(opts?.meta, stack, errorType), 'event')
  }

  /** Fold stack/errorType into a caller's meta without mutating it. */
  private _withError(meta: Record<string, unknown> | undefined, stack?: string, errorType?: string): Record<string, unknown> {
    return {
      ...(meta ?? {}),
      ...(stack ? { stack } : {}),
      ...(errorType ? { errorType } : {}),
    }
  }

  /**
   * Flush the buffered events. `useBeacon` (set on the crash/unload path) prefers
   * `navigator.sendBeacon` + `keepalive` so the batch survives the page going
   * away — the browser analog of Swift's synchronous `_flushSync`.
   *
   * Drains are SERIALISED through one promise chain: the 15s timer, an error
   * auto-flush and an explicit `flush()` must never drain concurrently, because
   * a retried send now spans seconds and two overlapping drains would interleave
   * batches (and the second would observe an empty buffer and report "sent").
   */
  async flush(useBeacon = false): Promise<void> {
    this.flushChain = this.flushChain.then(() => this._drain(useBeacon)).catch(() => {})
    return this.flushChain
  }

  private async _drain(useBeacon: boolean): Promise<void> {
    if (this.buffer.length === 0) return
    const url = `${this.apiUrl}/api/sdk/monitor/events/batch`
    if (useBeacon) {
      this._sendBeacon(url, this.buffer.splice(0))
      return
    }
    // Server told us to back off (429/Retry-After). Leave the events buffered —
    // they'll go out on the next flush after the hold-off expires.
    if (Date.now() < this.retryAfterUntil) return
    const events = this.buffer.splice(0)
    const body = JSON.stringify({ publishableKey: this.publishableKey, events })
    // ONE attempt. Anything the server did not accept goes straight back in the
    // buffer and rides the next 15s tick — the flush timer IS the retry.
    if (await this._sendOnce(url, body) === 'requeue') this._requeue(events)
  }

  /**
   * Unload/crash path. This is genuinely BEST-EFFORT and CANNOT be retried: the
   * document is going away, so there is no later tick in which to try again and
   * no way to observe the result — `sendBeacon` only reports that the request was
   * queued, never that the server accepted it, and a `keepalive` fetch outlives
   * the JS context that would handle its response. Treat these events as
   * "handed to the browser", NOT as delivered.
   *
   * Uses CORS-safelisted `text/plain`: `application/json` forces an OPTIONS
   * preflight that browsers routinely drop during unload, discarding the very
   * batch we're trying to save. The backend parses the JSON body regardless.
   */
  private _sendBeacon(url: string, events: BufferedEvent[]): void {
    const body = JSON.stringify({ publishableKey: this.publishableKey, events })
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      try {
        if (navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }))) return
      } catch {
        // fall through to a keepalive fetch
      }
    }
    void fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body,
      keepalive: true, // best-effort survival past unload; result is unobservable
    }).catch(() => {
      // Nothing to do — the page is unloading, there is no next attempt.
    })
  }

  /**
   * Deliver one batch, retrying network failures and 5xx with bounded
   * exponential backoff. Returns true when the batch is settled (accepted, or
   * rejected in a way retrying cannot fix); false when retries were exhausted
   * and the caller should re-queue.
   */
  /** One POST. Never throws — classifies the result instead. */
  private async _sendOnce(url: string, body: string): Promise<SendOutcome> {
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
    } catch {
      return 'requeue' // network / DNS / CORS-abort — the batch never landed
    }
    // `fetch` does NOT reject on an HTTP error status, so this classification is
    // the only thing standing between a 503 and a silently lost batch.
    const status = res?.status ?? 0
    if (status >= 200 && status < 300) return 'done'
    if (status === 429) {
      const waitMs = _parseRetryAfter(res)
      if (waitMs > 0) this.retryAfterUntil = Math.max(this.retryAfterUntil, Date.now() + waitMs)
      // Rate limited: the server did NOT accept these events. Re-queue them; the
      // hold-off above stops the next flushes until the window reopens.
      return 'requeue'
    }
    if (status >= 400 && status < 500) {
      // 401 bad key, 403 forbidden, 422 malformed — identical every time, so
      // re-queueing would wedge the buffer forever. Drop, but say so.
      _warn(`batch rejected with HTTP ${status} — dropping it (retrying would fail identically)`)
      return 'drop'
    }
    return 'requeue' // 5xx (and anything unrecognised) — server-side; try next flush
  }

  /**
   * Put an undelivered batch back at the FRONT of the buffer so the next flush
   * retries it, then re-apply the cap.
   *
   * Priority policy under a sustained outage: NEWEST EVENTS WIN. The buffer is
   * trimmed from the front, so the oldest re-queued events are the first to go.
   * This matches `_push`'s newest-wins eviction, keeps memory bounded at
   * MAX_BUFFER_SIZE regardless of how long the backend is down, and prevents a
   * stuck batch from starving live telemetry. Drops are reported, never silent.
   */
  private _requeue(events: BufferedEvent[]): void {
    this.buffer.unshift(...events)
    let dropped = 0
    while (this.buffer.length > MAX_BUFFER_SIZE) {
      this.buffer.shift()
      dropped++
    }
    _warn(
      `batch not delivered — ${events.length} event(s) re-queued` +
        (dropped > 0 ? `, ${dropped} oldest dropped (buffer cap ${MAX_BUFFER_SIZE})` : ''),
    )
  }

  destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
    // Stop routing global errors into this (now-dead) instance. The shared
    // window handlers stay installed but no-op until another monitor arms.
    if (_activeMonitor === this) _activeMonitor = null
    // destroy() is a TEARDOWN path — use the beacon flush (sendBeacon, text/plain,
    // no OPTIONS preflight) so the final batch survives the context going away.
    // A plain `flush()` here posts application/json, which forces a preflight that
    // the browser routinely drops mid-teardown → the batch is lost AND Safari logs
    // it as a spurious "access control checks" CORS error. Parity with the
    // pagehide beacon above and Swift's synchronous `_flushSync`.
    void this.flush(true)
  }

  private _push(
    featureName: string,
    ok: boolean,
    durationMs?: number,
    error?: string,
    meta?: Record<string, unknown>,
    source: EventSource = 'event',
  ): void {
    if (this.buffer.length >= MAX_BUFFER_SIZE) this.buffer.shift()
    const isError = !ok || source === 'global_error'
    // On an ERROR, attach device context + the breadcrumb trail BEFORE scrubbing
    // (their string values are free text that may contain secrets, so they must
    // go through the scrubber). Parity with Swift's _pushError enrichment.
    const enriched = this._enrich(meta)
    if (isError) {
      const device = _deviceContext()
      if (Object.keys(device).length > 0) enriched['device'] = device
      if (this.breadcrumbs.length > 0) enriched['breadcrumbs'] = this.breadcrumbs.slice()
    }
    // Scrub secrets before they leave the browser (backend re-scrubs too).
    const scrubbed = scrubMeta(enriched)
    // Flags folded in AFTER scrubbing: keys are feature NAMES + values are
    // statuses (never secrets), so scrubbing them would only risk a
    // false-positive redaction of a flag whose name resembles a PII key.
    if (isError && this.flags.size > 0 && scrubbed) {
      scrubbed['flags'] = Object.fromEntries(this.flags)
    }
    this.buffer.push({
      ts: new Date().toISOString(),
      featureName,
      ok,
      durationMs,
      error: error != null ? scrubText(error) : error,
      meta: scrubbed,
      source,
      userId: this.currentUserId ?? undefined,
      sessionId: this.sessionId,
      platform: PLATFORM,
    })
    if (isError) {
      // A global error may precede a crash/unload — use a keepalive beacon so
      // the batch survives the page going away (parity with Swift's _flushSync).
      void this.flush(source === 'global_error')
    }
  }

  /**
   * Internal: routed here by the module-level window-error handlers (see
   * `_installGlobalHandlers`). Only the current active monitor receives these.
   * `_push` already flushes on a `global_error` source.
   */
  _onGlobalError(message: string, stack?: string, origin: ErrorOrigin = 'app'): void {
    // meta.origin: whose error this is (#548). The backend keeps the SDK's own
    // errors out of the developer's Monitor data — see classifyErrorOrigin.
    this._push('unhandled', false, undefined, message, { ...this._withError(undefined, stack), origin }, 'global_error')
  }
}
