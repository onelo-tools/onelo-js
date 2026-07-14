import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OneloEventStream } from './event-stream'

// Node has no EventSource — stub a controllable one that records instances,
// lets tests dispatch named events, and reports close().
class MockEventSource {
  static instances: MockEventSource[] = []
  url: string
  listeners = new Map<string, Array<(e: MessageEvent) => void>>()
  onerror: (() => void) | null = null
  closed = false
  readyState = 1 // OPEN
  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }
  addEventListener(name: string, fn: (e: MessageEvent) => void) {
    const arr = this.listeners.get(name) ?? []
    arr.push(fn)
    this.listeners.set(name, arr)
  }
  close() { this.closed = true; this.readyState = 2 /* CLOSED */ }
  emit(name: string, data: unknown) {
    for (const fn of this.listeners.get(name) ?? []) fn({ data: JSON.stringify(data) } as MessageEvent)
  }
  emitRaw(name: string, data: string) {
    for (const fn of this.listeners.get(name) ?? []) fn({ data } as MessageEvent)
  }
  error() { this.onerror?.() }
}

const last = () => MockEventSource.instances.at(-1)!

describe('OneloEventStream', () => {
  beforeEach(() => {
    MockEventSource.instances = []
    vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource)
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks() })

  function make() { return new OneloEventStream('https://api.onelo.tools', 'onelo_pk_test') }

  it('start() opens the features stream with key + userId query params', () => {
    const s = make()
    s.start('user-1')
    expect(MockEventSource.instances).toHaveLength(1)
    const url = new URL(last().url)
    expect(url.pathname).toBe('/api/sdk/features/stream')
    expect(url.searchParams.get('key')).toBe('onelo_pk_test')
    expect(url.searchParams.get('userId')).toBe('user-1')
    expect(url.searchParams.get('sdk_platform')).toBe('js')
    s.stop()
  })

  it('sends sdk_version when provided (observability / presence bucketing)', () => {
    const s = new OneloEventStream('https://api.onelo.tools', 'onelo_pk_test', '0.20.0-staging')
    s.start(null)
    expect(new URL(last().url).searchParams.get('sdk_version')).toBe('0.20.0-staging')
    s.stop()
  })

  it('an empty-data frame dispatches {} (forward-compat), does not throw', () => {
    const s = make()
    const seen: Array<Record<string, unknown>> = []
    s.on('session.revoked', (d) => seen.push(d))
    s.start('user-1')
    last().emitRaw('session.revoked', '') // e.g. account.banned-style empty payload
    expect(seen).toEqual([{}])
    s.stop()
  })

  it('reconnect() forces a fresh connection (re-reads params) even with an unchanged userId', () => {
    const s = make()
    let version = 5
    s.addParamProvider(() => ({ since_version: String(version) }))
    s.start('user-1')
    const first = last()
    version = 0 // simulate invalidateCache resetting since_version
    s.reconnect()
    expect(first.closed).toBe(true)
    expect(MockEventSource.instances).toHaveLength(2)
    expect(new URL(last().url).searchParams.get('since_version')).toBe('0')
    s.stop()
  })

  it('on(): dispatches the parsed data object to registered handlers', () => {
    const s = make()
    const seen: Array<Record<string, unknown>> = []
    s.on('session.revoked', (d) => seen.push(d))
    s.start('user-1')
    last().emit('session.revoked', { app_user_id: 'user-1', reason: 'remote_revoke' })
    expect(seen).toEqual([{ app_user_id: 'user-1', reason: 'remote_revoke' }])
    s.stop()
  })

  it('a changed userId reconnects (old closed, new opened); same userId is a no-op', () => {
    const s = make()
    s.start('user-1')
    const first = last()
    s.start('user-1') // same → no reconnect
    expect(MockEventSource.instances).toHaveLength(1)
    s.start('user-2') // changed → reconnect
    expect(MockEventSource.instances).toHaveLength(2)
    expect(first.closed).toBe(true)
    s.stop()
  })

  it('addParamProvider params are read fresh on every (re)connect', () => {
    const s = make()
    let version = 3
    s.addParamProvider(() => ({ since_version: String(version) }))
    s.start('user-1')
    expect(new URL(last().url).searchParams.get('since_version')).toBe('3')
    version = 9
    s.start('user-2') // reconnect re-reads the provider
    expect(new URL(last().url).searchParams.get('since_version')).toBe('9')
    s.stop()
  })

  it('a throwing handler never breaks sibling handlers or the stream', () => {
    const s = make()
    const seen: string[] = []
    s.on('features_updated', () => { throw new Error('boom') })
    s.on('features_updated', () => { seen.push('ok') })
    s.start(null)
    last().emit('features_updated', { config_version: 2 })
    expect(seen).toEqual(['ok'])
    s.stop()
  })

  it('onerror closes and reconnects with jittered backoff; stop() cancels a pending reconnect', () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0.5) // deterministic jitter: 0.5 * base
    const s = make()
    s.start('user-1')
    const first = last()
    first.error()
    expect(first.closed).toBe(true)
    // base[0] = 1000ms, jittered → floor(0.5 * 1000) = 500ms. Not yet at 499:
    vi.advanceTimersByTime(499)
    expect(MockEventSource.instances).toHaveLength(1)
    vi.advanceTimersByTime(1) // now at 500 → reconnect fires
    expect(MockEventSource.instances).toHaveLength(2)
    // A second error then stop() must cancel the scheduled reconnect.
    last().error()
    s.stop()
    vi.advanceTimersByTime(60_000)
    expect(MockEventSource.instances).toHaveLength(2) // no further reconnect
    ;(Math.random as unknown as { mockRestore: () => void }).mockRestore()
  })

  it('no EventSource in the environment → start() is a safe no-op', () => {
    vi.stubGlobal('EventSource', undefined)
    const s = make()
    expect(() => s.start('user-1')).not.toThrow()
    s.stop()
  })

  it('destroy() closes and refuses further connects', () => {
    const s = make()
    s.start('user-1')
    s.destroy()
    expect(last().closed).toBe(true)
    s.start('user-2')
    expect(MockEventSource.instances).toHaveLength(1) // destroyed → no reconnect
  })

  it('reconnectIfStale: OPEN → no reconnect; dropped (readyState≠OPEN) → reconnect', () => {
    const s = make()
    s.start('user-1')
    s.reconnectIfStale() // source OPEN (readyState 1) → no-op
    expect(MockEventSource.instances).toHaveLength(1)
    last().readyState = 2 // browser dropped the socket while backgrounded
    s.reconnectIfStale()
    expect(MockEventSource.instances).toHaveLength(2)
    s.stop()
  })

  it('a lifecycle reconnect during a pending backoff cancels the stale timer (no double-reconnect)', () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0.9)
    const s = make()
    s.start('user-1')          // source A
    last().error()             // onerror → close A (source=null), arm backoff timer
    expect(MockEventSource.instances).toHaveLength(1)

    // Network recovers before the backoff fires:
    s.reconnectIfStale()       // source===null → connect B, MUST cancel the armed timer
    expect(MockEventSource.instances).toHaveLength(2)

    vi.advanceTimersByTime(60_000) // the stale backoff timer must NOT fire
    expect(MockEventSource.instances, 'no second reconnect from the stale timer').toHaveLength(2)
    s.stop()
  })

  it('lifecycle: visibilitychange→visible reconnects a dropped connection; destroy unbinds', () => {
    const docHandlers: Record<string, Array<() => void>> = {}
    const removed: string[] = []
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      addEventListener: (t: string, fn: () => void) => { (docHandlers[t] ??= []).push(fn) },
      removeEventListener: (t: string) => { removed.push(t) },
    })
    vi.stubGlobal('window', {
      addEventListener: () => {},
      removeEventListener: () => {},
    })

    const s = make()
    s.start('user-1') // binds lifecycle
    expect(docHandlers['visibilitychange'], 'visibilitychange must be bound').toBeTruthy()

    last().readyState = 2 // socket dropped while the tab was hidden
    docHandlers['visibilitychange'].forEach((fn) => fn()) // tab back to visible
    expect(MockEventSource.instances, 'a dropped connection reconnects on visible').toHaveLength(2)

    s.destroy()
    expect(removed).toContain('visibilitychange') // listener removed on destroy
  })
})
