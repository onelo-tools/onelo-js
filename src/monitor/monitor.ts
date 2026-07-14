import { version as SDK_VERSION } from '../../package.json'
import { scrubText, scrubMeta } from './scrubber'

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
      )
    })
    window.addEventListener('error', (e) => {
      _activeMonitor?._onGlobalError(e.message ?? 'Unknown error', e.error instanceof Error ? e.error.stack : undefined)
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
      _activeMonitor?._onGlobalError(message, stack)
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
   */
  async flush(useBeacon = false): Promise<void> {
    if (this.buffer.length === 0) return
    const events = this.buffer.splice(0)
    const url = `${this.apiUrl}/api/sdk/monitor/events/batch`
    const body = JSON.stringify({ publishableKey: this.publishableKey, events })
    // On the unload path use CORS-safelisted `text/plain`: `application/json`
    // forces an OPTIONS preflight that browsers routinely drop during unload,
    // discarding the very batch we're trying to save. The backend parses the
    // JSON body regardless of content-type.
    if (useBeacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      try {
        if (navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }))) return
      } catch {
        // fall through to fetch
      }
    }
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': useBeacon ? 'text/plain' : 'application/json' },
        body,
        keepalive: useBeacon, // best-effort survival past unload
      })
    } catch {
      // silently drop — monitoring must never break the app
    }
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
  _onGlobalError(message: string, stack?: string): void {
    this._push('unhandled', false, undefined, message, this._withError(undefined, stack), 'global_error')
  }
}
