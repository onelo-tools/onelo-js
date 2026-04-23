export interface MonitorEventOptions {
  ok: boolean
  durationMs?: number
  error?: string
  meta?: Record<string, unknown>
}

interface BufferedEvent {
  featureName: string
  ok: boolean
  durationMs?: number
  error?: string
  meta?: Record<string, unknown>
}

export class OneloMonitor {
  private readonly publishableKey: string
  private readonly apiUrl: string
  private buffer: BufferedEvent[] = []
  private flushTimer: ReturnType<typeof setInterval> | null = null

  constructor(publishableKey: string, apiUrl: string) {
    this.publishableKey = publishableKey
    this.apiUrl = apiUrl
    this.flushTimer = setInterval(() => { this.flush() }, 5000)
  }

  event(featureName: string, opts: MonitorEventOptions): void {
    this.buffer.push({
      featureName,
      ok: opts.ok,
      durationMs: opts.durationMs,
      error: opts.error,
      meta: opts.meta,
    })
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
}
