import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { OneloMonitor } from './monitor'

const API = 'https://api.onelo.tools'
const PK = 'onelo_pk_test_abc'
const tick = () => new Promise((r) => setTimeout(r, 0))

// Minimal window stub: captures addEventListener handlers, lets a test dispatch.
class WindowStub {
  handlers: Record<string, Array<(e: unknown) => void>> = {}
  addEventListener(type: string, fn: (e: unknown) => void) { (this.handlers[type] ??= []).push(fn) }
  dispatch(type: string, e: unknown) { for (const fn of this.handlers[type] ?? []) fn(e) }
}
const win = new WindowStub()
let fetchMock: ReturnType<typeof vi.fn>

/** Constructs a monitor and strips the auto-emitted `session_opened` event
 *  (fired unconditionally at construction) so these tests' index-0 assertions
 *  see only what the test itself pushes. */
function freshMonitor(...args: ConstructorParameters<typeof OneloMonitor>): OneloMonitor {
  const m = new OneloMonitor(...args)
  ;(m as unknown as { buffer: unknown[] }).buffer.length = 0
  return m
}

describe('OneloMonitor — PII scrubbing + dual-instance global handlers (Phase 1)', () => {
  // Install window ONCE so the module-level handlers bind to this stub.
  beforeAll(() => { vi.stubGlobal('window', win) })
  afterAll(() => { vi.unstubAllGlobals() })
  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ status: 204 })
    ;(globalThis as unknown as { fetch: unknown }).fetch = fetchMock
  })

  it('scrubs secrets from meta before they leave the browser', async () => {
    const m = freshMonitor(PK, API)
    m.event('checkout', { ok: true, meta: { password: 'p', note: 'fine', log: 'used sk_live_ABCDEFGHIJKLMNOP' } })
    await m.flush()
    const body = JSON.parse((fetchMock.mock.calls.at(-1)![1] as RequestInit).body as string)
    const meta = body.events[0].meta as Record<string, unknown>
    expect(meta.password).toBe('[REDACTED]')
    expect(meta.note).toBe('fine')
    expect(meta.log).toBe('used [REDACTED]')
    expect(meta._onelo_redacted).toContain('password')
    m.destroy()
  })

  it('scrubs secrets from the error string', async () => {
    const m = freshMonitor(PK, API)
    m.event('pay', { ok: false, error: 'failed with Bearer abc123.def' }) // ok:false auto-flushes
    await tick()
    const body = JSON.parse((fetchMock.mock.calls.at(-1)![1] as RequestInit).body as string)
    expect(body.events[0].error).toBe('failed with [REDACTED]')
    m.destroy()
  })

  it('flag↔error: snapshots active flags into meta.flags on ERROR events only', async () => {
    const m = freshMonitor(PK, API)
    m.recordFlag('checkout-v2', 'enabled')
    m.recordFlag('dark-mode', 'hidden')

    // ok event → NO flags attached
    m.event('ok-op', { ok: true })
    await m.flush()
    let body = JSON.parse((fetchMock.mock.calls.at(-1)![1] as RequestInit).body as string)
    expect(body.events[0].meta.flags).toBeUndefined()

    // error event → flag snapshot attached
    fetchMock.mockClear()
    m.event('bad-op', { ok: false, error: 'boom' }) // ok:false auto-flushes
    await tick()
    body = JSON.parse((fetchMock.mock.calls.at(-1)![1] as RequestInit).body as string)
    expect(body.events[0].meta.flags).toEqual({ 'checkout-v2': 'enabled', 'dark-mode': 'hidden' })
    m.destroy()
  })

  it('recordFlag is LRU-capped at 100 (re-record survives eviction)', async () => {
    const m = freshMonitor(PK, API)
    for (let i = 0; i < 100; i++) m.recordFlag(`f${i}`, 'enabled') // f0..f99
    m.recordFlag('f0', 'disabled') // re-record oldest → moves to newest + updates value
    m.recordFlag('f100', 'enabled') // new key → evicts the now-oldest (f1)

    m.event('err', { ok: false, error: 'x' })
    await tick()
    const body = JSON.parse((fetchMock.mock.calls.at(-1)![1] as RequestInit).body as string)
    const flags = body.events[0].meta.flags as Record<string, string>
    expect(Object.keys(flags)).toHaveLength(100)
    expect(flags.f0).toBe('disabled')   // re-recorded → survived + value updated
    expect(flags.f1).toBeUndefined()    // evicted (became oldest after f0 moved)
    expect(flags.f100).toBe('enabled')
    m.destroy()
  })

  it('capture(): breadcrumbs + stack + errorType + flags + device attach on the error', async () => {
    const m = freshMonitor(PK, API)
    m.breadcrumb('user clicked checkout', { category: 'navigation' })
    m.breadcrumb('token was Bearer abc123.def') // free text → scrubbed
    m.recordFlag('checkout-v2', 'enabled')
    const err = new Error('kaboom')
    err.name = 'PaymentError'
    m.capture(err)
    await tick()

    const ev = JSON.parse((fetchMock.mock.calls.at(-1)![1] as RequestInit).body as string).events[0]
    expect(ev.error).toBe('kaboom')
    expect(ev.meta.stack).toContain('kaboom')
    expect(ev.meta.errorType).toBe('PaymentError')
    expect(ev.meta.flags).toEqual({ 'checkout-v2': 'enabled' })
    expect(ev.meta.breadcrumbs).toHaveLength(2)
    expect(ev.meta.breadcrumbs[0].message).toBe('user clicked checkout')
    expect(ev.meta.breadcrumbs[1].message).toContain('[REDACTED]') // secret scrubbed in crumb
    expect(ev.meta.device).toBeTruthy() // Intl timezone at minimum
    m.destroy()
  })

  it('ok events carry NO breadcrumbs/device/flags (error-only enrichment)', async () => {
    const m = freshMonitor(PK, API)
    m.breadcrumb('crumb')
    m.recordFlag('f', 'enabled')
    m.event('ok-op', { ok: true })
    await m.flush()
    const ev = JSON.parse((fetchMock.mock.calls.at(-1)![1] as RequestInit).body as string).events[0]
    expect(ev.meta.breadcrumbs).toBeUndefined()
    expect(ev.meta.device).toBeUndefined()
    expect(ev.meta.flags).toBeUndefined()
    m.destroy()
  })

  it('global-error path delivers via a CORS-safe text/plain sendBeacon', async () => {
    const beacon = vi.fn().mockReturnValue(true)
    vi.stubGlobal('navigator', { sendBeacon: beacon })
    const m = freshMonitor(PK, API) // becomes active
    m.event('pre', { ok: true }) // buffer without flushing

    win.dispatch('error', { message: 'boom' }) // → global_error → flush(useBeacon=true)
    await tick()

    expect(beacon).toHaveBeenCalled()
    const blob = beacon.mock.calls[0][1] as Blob
    expect(blob.type).toBe('text/plain') // safelisted → no preflight dropped on unload
    m.destroy()
    vi.stubGlobal('navigator', undefined)
  })

  it('destroy() flushes the final batch via text/plain sendBeacon (teardown-safe, no preflight)', async () => {
    const beacon = vi.fn().mockReturnValue(true)
    vi.stubGlobal('navigator', { sendBeacon: beacon })
    const m = freshMonitor(PK, API)
    m.event('pre', { ok: true }) // ok:true → buffered, not auto-flushed
    m.destroy()                  // teardown → must use beacon, not a preflighted fetch
    await tick()
    expect(beacon, 'destroy() must flush via beacon so the batch survives teardown').toHaveBeenCalled()
    const blob = beacon.mock.calls[0][1] as Blob
    expect(blob.type).toBe('text/plain') // CORS-safelisted → no OPTIONS preflight to drop
    expect(fetchMock, 'destroy() must NOT use the preflighted application/json fetch').not.toHaveBeenCalled()
    vi.stubGlobal('navigator', undefined)
  })

  it('breadcrumbs ring-buffer caps at 100', async () => {
    const m = freshMonitor(PK, API)
    for (let i = 0; i < 130; i++) m.breadcrumb(`c${i}`)
    m.event('err', { ok: false, error: 'x' })
    await tick()
    const ev = JSON.parse((fetchMock.mock.calls.at(-1)![1] as RequestInit).body as string).events[0]
    expect(ev.meta.breadcrumbs).toHaveLength(100)
    expect(ev.meta.breadcrumbs[0].message).toBe('c30') // oldest 30 evicted
    m.destroy()
  })

  it('dual-instance: latest-wins routing, no dead-instance routing after destroy, re-arm', async () => {
    const m1 = freshMonitor(PK, API) // installs handlers, active = m1
    const m2 = freshMonitor(PK, API) // active = m2 (latest-wins)

    fetchMock.mockClear()
    win.dispatch('error', { message: 'boom' })
    await tick()
    expect(fetchMock, 'a live monitor must receive the window error').toHaveBeenCalled()

    m2.destroy() // active = null (m2 was active)
    fetchMock.mockClear()
    win.dispatch('error', { message: 'after-destroy' })
    await tick()
    expect(fetchMock, 'no routing into a destroyed instance').not.toHaveBeenCalled()

    const m3 = freshMonitor(PK, API) // re-arms → active = m3
    fetchMock.mockClear()
    win.dispatch('error', { message: 'rearmed' })
    await tick()
    expect(fetchMock, 'a replacement monitor must re-arm global capture').toHaveBeenCalled()

    m1.destroy(); m3.destroy()
  })
})
