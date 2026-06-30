/**
 * Tests for OneloMonitor's always-on meta enrichment (parity with Swift's
 * enrichMeta): every event carries `meta.sdk = { name, version }`, optional
 * `meta.app = { version, build, bundleId }` from config, and `meta.environment`
 * from config (a per-event value wins). Also locks in the wire shape sent to
 * POST /api/sdk/monitor/events/batch so it can't silently drift from the
 * backend contract (sdk_monitor.py).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { version as SDK_VERSION } from '../../package.json'
import { OneloMonitor, type MonitorContext } from './monitor'

const API = 'https://api.onelo.tools'
const PK = 'onelo_pk_test_abc'

let fetchMock: ReturnType<typeof vi.fn>

/** Builds a monitor, runs `act`, flushes, and returns the parsed batch body. */
async function captureBatch(
  context: MonitorContext | undefined,
  act: (m: OneloMonitor) => void | Promise<void>,
): Promise<{ publishableKey: string; events: Array<Record<string, unknown>> }> {
  const monitor = new OneloMonitor(PK, API, context)
  try {
    await act(monitor)
    await monitor.flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${API}/api/sdk/monitor/events/batch`)
    return JSON.parse((init as RequestInit).body as string)
  } finally {
    monitor.destroy()
  }
}

describe('OneloMonitor meta enrichment', () => {
  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('attaches meta.sdk to every event with no config', async () => {
    const body = await captureBatch(undefined, (m) => {
      m.event('tab_viewed', { ok: true, meta: { tab: 'export' } })
    })
    const e = body.events[0]
    expect(e.featureName).toBe('tab_viewed')
    expect(e.platform).toBe('js')
    expect(e.source).toBe('event')
    expect(typeof e.sessionId).toBe('string')
    const meta = e.meta as Record<string, unknown>
    expect(meta.tab).toBe('export')
    expect(meta.sdk).toEqual({ name: '@onelo/js', version: SDK_VERSION })
    // No appVersion/appBuild/bundleId in config → no `app` key at all.
    expect(meta.app).toBeUndefined()
    expect(meta.environment).toBeUndefined()
  })

  it('attaches meta.app and meta.environment from config', async () => {
    const ctx: MonitorContext = {
      appVersion: '1.2.0',
      appBuild: '420',
      bundleId: 'com.example.app',
      environment: 'production',
    }
    const body = await captureBatch(ctx, (m) => {
      m.event('checkout', { ok: true })
    })
    const meta = body.events[0].meta as Record<string, unknown>
    expect(meta.app).toEqual({ version: '1.2.0', build: '420', bundleId: 'com.example.app' })
    expect(meta.environment).toBe('production')
  })

  it('omits absent app fields (only the provided keys appear)', async () => {
    const body = await captureBatch({ appVersion: '2.0.0' }, (m) => {
      m.event('sync', { ok: true })
    })
    const meta = body.events[0].meta as Record<string, unknown>
    expect(meta.app).toEqual({ version: '2.0.0' })
  })

  it('lets a per-event meta.environment override the config default', async () => {
    const body = await captureBatch({ environment: 'production' }, (m) => {
      m.event('debug_ping', { ok: true, meta: { environment: 'staging' } })
    })
    const meta = body.events[0].meta as Record<string, unknown>
    expect(meta.environment).toBe('staging')
  })

  it('makes SDK-owned sdk/app authoritative over caller-supplied values', async () => {
    const body = await captureBatch({ appVersion: '9.9.9' }, (m) => {
      // A caller trying to spoof sdk/app must not win.
      m.event('evil', { ok: true, meta: { sdk: { name: 'fake', version: '0.0.0' }, app: { version: '0.0.0' } } })
    })
    const meta = body.events[0].meta as Record<string, unknown>
    expect(meta.sdk).toEqual({ name: '@onelo/js', version: SDK_VERSION })
    expect(meta.app).toEqual({ version: '9.9.9' })
  })

  it('does not mutate the caller-supplied meta object', async () => {
    const original = { tab: 'export' }
    await captureBatch({ environment: 'production' }, (m) => {
      m.event('tab_viewed', { ok: true, meta: original })
    })
    expect(original).toEqual({ tab: 'export' })
  })

  it('attaches userId from setUserId() and enriches track() events', async () => {
    const body = await captureBatch(undefined, async (m) => {
      m.setUserId('user-123')
      await m.track('pdf_export', () => 'done', { meta: { pages: 3 } })
    })
    const e = body.events[0]
    expect(e.userId).toBe('user-123')
    expect(e.source).toBe('track')
    expect(e.ok).toBe(true)
    expect(typeof e.durationMs).toBe('number')
    const meta = e.meta as Record<string, unknown>
    expect(meta.pages).toBe(3)
    expect(meta.sdk).toEqual({ name: '@onelo/js', version: SDK_VERSION })
  })
})
