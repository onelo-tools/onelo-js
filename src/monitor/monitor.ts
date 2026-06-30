import { version as SDK_VERSION } from '../../package.json'

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

const PLATFORM = 'js'
let _globalHandlersRegistered = false

export class OneloMonitor {
  private readonly publishableKey: string
  private readonly apiUrl: string
  private readonly sessionId: string = crypto.randomUUID()
  private buffer: BufferedEvent[] = []
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
    this._registerGlobalHandlers()
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

  async track<T>(featureName: string, fn: () => Promise<T> | T, options?: { meta?: Record<string, unknown> }): Promise<T> {
    const start = Date.now()
    try {
      const result = await fn()
      this._push(featureName, true, Date.now() - start, undefined, options?.meta, 'track')
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this._push(featureName, false, Date.now() - start, message, options?.meta, 'track')
      throw err
    }
  }

  event(featureName: string, opts: MonitorEventOptions): void {
    this._push(featureName, opts.ok, opts.durationMs, opts.error, opts.meta, 'event')
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return
    const events = this.buffer.splice(0)
    try {
      await fetch(`${this.apiUrl}/api/sdk/monitor/events/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publishableKey: this.publishableKey, events }),
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
    void this.flush()
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
    this.buffer.push({
      featureName,
      ok,
      durationMs,
      error,
      meta: this._enrich(meta),
      source,
      userId: this.currentUserId ?? undefined,
      sessionId: this.sessionId,
      platform: PLATFORM,
    })
    if (!ok || source === 'global_error') {
      void this.flush()
    }
  }

  private _registerGlobalHandlers(): void {
    if (_globalHandlersRegistered) return
    _globalHandlersRegistered = true

    const handler = (error: string) => {
      this._push('unhandled', false, undefined, error, undefined, 'global_error')
      void this.flush()
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('unhandledrejection', (e) => {
        const msg = e.reason instanceof Error ? e.reason.message : String(e.reason)
        handler(msg)
      })
      window.addEventListener('error', (e) => {
        handler(e.message ?? 'Unknown error')
      })
    }
  }
}
