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

// The Stream Token mint (`POST /api/sdk/features/stream-token`) is a plain
// fetch, so it is stubbed on the global. Default: one token per call, numbered
// so a test can prove a reconnect re-minted rather than reused.
function mintOk() {
  let n = 0
  const f = vi.fn(async () => {
    n++
    return { status: 200, json: async () => ({ token: `tok-${n}`, ttl: 300 }) }
  })
  vi.stubGlobal('fetch', f)
  return f
}

function mintStatus(status: number) {
  const f = vi.fn(async () => ({ status, json: async () => ({ detail: 'nope' }) }))
  vi.stubGlobal('fetch', f)
  return f
}

/**
 * The same statuses, but rendered the way an edge, proxy or WAF actually
 * renders them: an HTML page. `res.json()` rejects, exactly as it does on the
 * wire, so the body carries NO information and only the status can decide.
 *
 * This is the shape that used to walk past the brake — `httpPost` parsed the
 * body first, so the refusal arrived as a network error and was retried
 * forever (#97).
 */
function mintHtml(status: number) {
  const f = vi.fn(async () => ({
    status,
    json: async () => {
      throw new SyntaxError('Unexpected token < in JSON at position 0')
    },
  }))
  vi.stubGlobal('fetch', f)
  return f
}

/** Let the in-flight mint promise settle — connecting is async now (mint, then
 *  open). Microtask-only so it works under fake timers too. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

const headersOf = (init: unknown) => (init as RequestInit).headers as Record<string, string>

describe('OneloEventStream', () => {
  beforeEach(() => {
    MockEventSource.instances = []
    vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource)
    mintOk()
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks() })

  function make() { return new OneloEventStream('https://api.onelo.tools', 'onelo_pk_test') }

  it('start() mints a Stream Token and opens the stream with it — no key in the URL', async () => {
    const fetchMock = mintOk()
    const s = make()
    s.start('user-1')
    await settle()
    expect(MockEventSource.instances).toHaveLength(1)
    const url = new URL(last().url)
    expect(url.pathname).toBe('/api/sdk/features/stream')
    expect(url.searchParams.get('token')).toBe('tok-1')
    expect(url.searchParams.get('key'), 'the Publishable Key must never reach a stream URL').toBeNull()
    expect(url.searchParams.get('userId')).toBe('user-1')
    expect(url.searchParams.get('sdk_platform')).toBe('js')
    // The key travels once, in a header on the mint POST.
    const [mintUrl, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(mintUrl).toBe('https://api.onelo.tools/api/sdk/features/stream-token')
    expect(init.method).toBe('POST')
    expect(headersOf(init)['X-Publishable-Key']).toBe('onelo_pk_test')
    s.stop()
  })

  it('sends sdk_version when provided (observability / presence bucketing)', async () => {
    const s = new OneloEventStream('https://api.onelo.tools', 'onelo_pk_test', '0.20.0-staging')
    s.start(null)
    await settle()
    expect(new URL(last().url).searchParams.get('sdk_version')).toBe('0.20.0-staging')
    s.stop()
  })

  it('an empty-data frame dispatches {} (forward-compat), does not throw', async () => {
    const s = make()
    const seen: Array<Record<string, unknown>> = []
    s.on('session.revoked', (d) => seen.push(d))
    s.start('user-1')
    await settle()
    last().emitRaw('session.revoked', '') // e.g. account.banned-style empty payload
    expect(seen).toEqual([{}])
    s.stop()
  })

  it('reconnect() forces a fresh connection (re-reads params) even with an unchanged userId', async () => {
    const s = make()
    let version = 5
    s.addParamProvider(() => ({ since_version: String(version) }))
    s.start('user-1')
    await settle()
    const first = last()
    version = 0 // simulate invalidateCache resetting since_version
    s.reconnect()
    await settle()
    expect(first.closed).toBe(true)
    expect(MockEventSource.instances).toHaveLength(2)
    expect(new URL(last().url).searchParams.get('since_version')).toBe('0')
    s.stop()
  })

  it('every connect mints a FRESH token, so an expired one can never be reused', async () => {
    const fetchMock = mintOk()
    const s = make()
    s.start('user-1')
    await settle()
    expect(new URL(last().url).searchParams.get('token')).toBe('tok-1')
    // A reconnect happens minutes later — well past the token's 5-minute TTL.
    s.reconnect()
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(new URL(last().url).searchParams.get('token')).toBe('tok-2')
    s.stop()
  })

  it('on(): dispatches the parsed data object to registered handlers', async () => {
    const s = make()
    const seen: Array<Record<string, unknown>> = []
    s.on('session.revoked', (d) => seen.push(d))
    s.start('user-1')
    await settle()
    last().emit('session.revoked', { app_user_id: 'user-1', reason: 'remote_revoke' })
    expect(seen).toEqual([{ app_user_id: 'user-1', reason: 'remote_revoke' }])
    s.stop()
  })

  it('a changed userId reconnects (old closed, new opened); same userId is a no-op', async () => {
    const s = make()
    s.start('user-1')
    await settle()
    const first = last()
    s.start('user-1') // same → no reconnect
    await settle()
    expect(MockEventSource.instances).toHaveLength(1)
    s.start('user-2') // changed → reconnect
    await settle()
    expect(MockEventSource.instances).toHaveLength(2)
    expect(first.closed).toBe(true)
    s.stop()
  })

  it('addParamProvider params are read fresh on every (re)connect', async () => {
    const s = make()
    let version = 3
    s.addParamProvider(() => ({ since_version: String(version) }))
    s.start('user-1')
    await settle()
    expect(new URL(last().url).searchParams.get('since_version')).toBe('3')
    version = 9
    s.start('user-2') // reconnect re-reads the provider
    await settle()
    expect(new URL(last().url).searchParams.get('since_version')).toBe('9')
    s.stop()
  })

  it('a throwing handler never breaks sibling handlers or the stream', async () => {
    const s = make()
    const seen: string[] = []
    s.on('features_updated', () => { throw new Error('boom') })
    s.on('features_updated', () => { seen.push('ok') })
    s.start(null)
    await settle()
    last().emit('features_updated', { config_version: 2 })
    expect(seen).toEqual(['ok'])
    s.stop()
  })

  it('onerror closes and reconnects with jittered backoff; stop() cancels a pending reconnect', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0.5) // deterministic jitter: 0.5 * base
    const s = make()
    s.start('user-1')
    await settle()
    const first = last()
    first.error()
    expect(first.closed).toBe(true)
    // base[0] = 1000ms, jittered → floor(0.5 * 1000) = 500ms. Not yet at 499:
    await vi.advanceTimersByTimeAsync(499)
    expect(MockEventSource.instances).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1) // now at 500 → reconnect fires
    await settle()
    expect(MockEventSource.instances).toHaveLength(2)
    // A second error then stop() must cancel the scheduled reconnect.
    last().error()
    s.stop()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(MockEventSource.instances).toHaveLength(2) // no further reconnect
    ;(Math.random as unknown as { mockRestore: () => void }).mockRestore()
  })

  it('a transient mint failure (5xx) backs off and reconnects — it does not kill the stream', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const failing = mintStatus(503)
    const s = make()
    s.start('user-1')
    await settle()
    expect(MockEventSource.instances, 'no socket while the mint is failing').toHaveLength(0)
    // The backend recovers before the backoff fires.
    const ok = mintOk()
    await vi.advanceTimersByTimeAsync(500)
    await settle()
    expect(failing).toHaveBeenCalledTimes(1)
    expect(ok).toHaveBeenCalledTimes(1)
    expect(MockEventSource.instances).toHaveLength(1)
    expect(new URL(last().url).searchParams.get('token')).toBe('tok-1')
    s.stop()
    ;(Math.random as unknown as { mockRestore: () => void }).mockRestore()
  })

  it('a mint that answers without a token is transient, not fatal', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, json: async () => ({ ttl: 300 }) })))
    const s = make()
    s.start('user-1')
    await settle()
    expect(MockEventSource.instances).toHaveLength(0)
    mintOk()
    await vi.advanceTimersByTimeAsync(500)
    await settle()
    expect(MockEventSource.instances, 'a token-less body retries like any other bad answer').toHaveLength(1)
    s.stop()
    ;(Math.random as unknown as { mockRestore: () => void }).mockRestore()
  })

  for (const status of [401, 403]) {
    it(`a genuine ${status} from the mint stops the stream permanently (no retry storm)`, async () => {
      vi.useFakeTimers()
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const refusing = mintStatus(status)
      const s = make()
      s.start('user-1')
      await settle()
      expect(MockEventSource.instances).toHaveLength(0)
      // No backoff timer was armed, and no lifecycle signal can revive it.
      await vi.advanceTimersByTimeAsync(120_000)
      await settle()
      s.reconnectIfStale()
      s.reconnect()
      s.start('user-2')
      await settle()
      expect(refusing, 'a refused credential is never re-presented').toHaveBeenCalledTimes(1)
      expect(MockEventSource.instances).toHaveLength(0)
      expect(warn).toHaveBeenCalled() // never silent — the developer is told why
      s.stop()
    })
  }

  it('an HTML 403 from the mint stops the stream permanently — a WAF page is still a refusal', async () => {
    // The regression #97 names. `mintStatus(403)` above proves nothing about it:
    // its body PARSES, so the brake was reached even before the fix. Here the
    // body is unreadable, which is the only thing that was ever wrong.
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const refusing = mintHtml(403)
    const s = make()
    s.start('user-1')
    await settle()
    expect(MockEventSource.instances).toHaveLength(0)
    // Before the fix this was a "network error" → transient → a backoff timer
    // was armed and the dead key re-presented on every tick, forever.
    await vi.advanceTimersByTimeAsync(120_000)
    await settle()
    s.reconnectIfStale()
    s.reconnect()
    s.start('user-2')
    await settle()
    expect(refusing, 'an HTML refusal is never re-presented either').toHaveBeenCalledTimes(1)
    expect(MockEventSource.instances).toHaveLength(0)
    expect(warn).toHaveBeenCalled()
    s.stop()
  })

  it('an HTML 502 from the mint stays transient — an unreachable intermediary is not a verdict', async () => {
    // The inverse mistake the ticket warns about: braking on "unreadable body"
    // rather than on the status would kill the stream on a proxy outage.
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const failing = mintHtml(502)
    const s = make()
    s.start('user-1')
    await settle()
    expect(MockEventSource.instances).toHaveLength(0)
    const ok = mintOk()
    await vi.advanceTimersByTimeAsync(500)
    await settle()
    expect(failing).toHaveBeenCalledTimes(1)
    expect(ok, 'the backoff timer was armed — the stream is still alive').toHaveBeenCalledTimes(1)
    expect(MockEventSource.instances).toHaveLength(1)
    s.stop()
    ;(Math.random as unknown as { mockRestore: () => void }).mockRestore()
  })

  it('a mint that resolves after stop() does not open a socket', async () => {
    let release: (v: unknown) => void = () => {}
    const gate = new Promise((r) => { release = r })
    vi.stubGlobal('fetch', vi.fn(async () => {
      await gate
      return { status: 200, json: async () => ({ token: 'late', ttl: 300 }) }
    }))
    const s = make()
    s.start('user-1')
    s.stop() // the developer signed out while the mint was still in flight
    release(null)
    await settle()
    expect(MockEventSource.instances, 'a superseded mint must not install a socket').toHaveLength(0)
  })

  it('a mint that NEVER settles is aborted, backs off, and the stream recovers', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    // A black-holing proxy, or a tab frozen mid-request: the promise never
    // settles on its own. A real `fetch` rejects when its signal aborts, and so
    // does this stub — that abort is the only thing that can end the hang.
    const hanging = vi.fn((_url: string, init: RequestInit) => new Promise((_res, rej) => {
      init.signal?.addEventListener('abort', () => rej(new Error('The operation was aborted.')))
    }))
    vi.stubGlobal('fetch', hanging)
    const s = make()
    s.start('user-1')
    await settle()
    expect(MockEventSource.instances, 'no socket while the mint hangs').toHaveLength(0)

    // Nothing revives it before the ceiling: `minting` is still true, so
    // reconnectIfStale() is a no-op and no backoff timer has been armed.
    await vi.advanceTimersByTimeAsync(14_000)
    s.reconnectIfStale()
    await settle()
    expect(hanging, 'the hung mint is not duplicated while in flight').toHaveBeenCalledTimes(1)

    // The ceiling fires → abort → an ordinary transient failure → backoff.
    const ok = mintOk()
    await vi.advanceTimersByTimeAsync(1_000)
    await settle()
    await vi.advanceTimersByTimeAsync(500) // jittered backoff: floor(0.5 * 1000)
    await settle()
    expect(ok, 'the stream re-mints instead of staying stranded').toHaveBeenCalledTimes(1)
    expect(MockEventSource.instances).toHaveLength(1)
    s.stop()
    ;(Math.random as unknown as { mockRestore: () => void }).mockRestore()
  })

  it('two overlapping connects: the newer wins, and the older mint installs nothing', async () => {
    // Both mints are held open, then settled in REVERSE order — the newer one
    // first — which is exactly the interleaving `connectGeneration` guards.
    const releases: Array<() => void> = []
    let n = 0
    const fetchMock = vi.fn(() => {
      const k = ++n
      return new Promise((res) => {
        releases.push(() => res({ status: 200, json: async () => ({ token: `tok-${k}`, ttl: 300 }) }))
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const s = make()
    s.start('user-1')  // connect A
    s.reconnect()      // connect B supersedes A while A's mint is still in flight
    await settle()
    expect(fetchMock, 'each connect mints its own token').toHaveBeenCalledTimes(2)

    releases[1]()      // B settles first and installs the socket
    await settle()
    releases[0]()      // A settles late — superseded, must install nothing
    await settle()

    expect(MockEventSource.instances, 'the superseded connect must not open a second socket').toHaveLength(1)
    expect(new URL(last().url).searchParams.get('token')).toBe('tok-2')

    // And the stream is still healable: the late mint must not have left
    // `minting` stuck (its finally belongs to a generation that no longer owns
    // the flag), or nothing could ever reconnect again.
    mintOk()
    last().readyState = 2
    s.reconnectIfStale()
    await settle()
    expect(MockEventSource.instances).toHaveLength(2)
    s.stop()
  })

  it('no fetch in the environment → start() is a safe no-op (nothing can mint)', () => {
    vi.stubGlobal('fetch', undefined)
    const s = make()
    expect(() => s.start('user-1')).not.toThrow()
    expect(MockEventSource.instances).toHaveLength(0)
    s.stop()
  })

  it('no EventSource in the environment → start() is a safe no-op', () => {
    vi.stubGlobal('EventSource', undefined)
    const s = make()
    expect(() => s.start('user-1')).not.toThrow()
    s.stop()
  })

  it('destroy() closes and refuses further connects', async () => {
    const s = make()
    s.start('user-1')
    await settle()
    s.destroy()
    expect(last().closed).toBe(true)
    s.start('user-2')
    await settle()
    expect(MockEventSource.instances).toHaveLength(1) // destroyed → no reconnect
  })

  it('reconnectIfStale: OPEN → no reconnect; dropped (readyState≠OPEN) → reconnect', async () => {
    const s = make()
    s.start('user-1')
    await settle()
    s.reconnectIfStale() // source OPEN (readyState 1) → no-op
    await settle()
    expect(MockEventSource.instances).toHaveLength(1)
    last().readyState = 2 // browser dropped the socket while backgrounded
    s.reconnectIfStale()
    await settle()
    expect(MockEventSource.instances).toHaveLength(2)
    s.stop()
  })

  it('reconnectIfStale during an in-flight mint does not start a second one', async () => {
    let release: (v: unknown) => void = () => {}
    const gate = new Promise((r) => { release = r })
    const fetchMock = vi.fn(async () => {
      await gate
      return { status: 200, json: async () => ({ token: 'tok-1', ttl: 300 }) }
    })
    vi.stubGlobal('fetch', fetchMock)
    const s = make()
    s.start('user-1')
    // Two lifecycle signals land back-to-back while the mint is in flight
    // (online + visibilitychange on network recovery).
    s.reconnectIfStale()
    s.reconnectIfStale()
    release(null)
    await settle()
    expect(fetchMock, 'one connect, one mint').toHaveBeenCalledTimes(1)
    expect(MockEventSource.instances).toHaveLength(1)
    s.stop()
  })

  it('a lifecycle reconnect during a pending backoff cancels the stale timer (no double-reconnect)', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0.9)
    const s = make()
    s.start('user-1')          // source A
    await settle()
    last().error()             // onerror → close A (source=null), arm backoff timer
    expect(MockEventSource.instances).toHaveLength(1)

    // Network recovers before the backoff fires:
    s.reconnectIfStale()       // source===null → connect B, MUST cancel the armed timer
    await settle()
    expect(MockEventSource.instances).toHaveLength(2)

    await vi.advanceTimersByTimeAsync(60_000) // the stale backoff timer must NOT fire
    await settle()
    expect(MockEventSource.instances, 'no second reconnect from the stale timer').toHaveLength(2)
    s.stop()
  })

  it('lifecycle: visibilitychange→visible reconnects a dropped connection; destroy unbinds', async () => {
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
    await settle()
    expect(docHandlers['visibilitychange'], 'visibilitychange must be bound').toBeTruthy()

    last().readyState = 2 // socket dropped while the tab was hidden
    docHandlers['visibilitychange'].forEach((fn) => fn()) // tab back to visible
    await settle()
    expect(MockEventSource.instances, 'a dropped connection reconnects on visible').toHaveLength(2)

    s.destroy()
    expect(removed).toContain('visibilitychange') // listener removed on destroy
  })
})
