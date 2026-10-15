import { afterEach, describe, expect, it, vi } from 'vitest'
import { OneloEventStream } from '../core/event-stream'
import { OneloFeatures } from './features'

const API = 'https://api.onelo.tools'
const PK = 'onelo_pk_test_identity'

type Reply = { status: number; body: Record<string, unknown> }

function response(reply: Reply): Response {
  return { status: reply.status, json: async () => reply.body } as unknown as Response
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

async function settle(): Promise<void> {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}

class MockEventSource {
  static instances: MockEventSource[] = []
  readonly url: string
  readonly listeners = new Map<string, Array<(event: MessageEvent) => void>>()
  readyState = 1
  onerror: (() => void) | null = null
  closed = false

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  addEventListener(name: string, listener: (event: MessageEvent) => void): void {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener])
  }

  close(): void {
    this.closed = true
    this.readyState = 2
  }

  emit(name: string, data: Record<string, unknown>): void {
    for (const listener of this.listeners.get(name) ?? []) {
      listener({ data: JSON.stringify(data) } as MessageEvent)
    }
  }
}

describe('OneloFeatures identity-bound snapshots', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    MockEventSource.instances = []
  })

  it('drops a late anonymous resolve after a signed-in identity starts', async () => {
    const anonymous = deferred<Response>()
    const user = deferred<Response>()
    let resolveCalls = 0
    const fetchMock = vi.fn((url: string): Promise<Response> => {
      if (!url.includes('/features/resolve')) return Promise.resolve(response({ status: 200, body: { features: {} } }))
      resolveCalls++
      if (resolveCalls === 1) return Promise.resolve(response({ status: 200, body: { config_version: 1, features: {} } }))
      return resolveCalls === 2 ? anonymous.promise : user.promise
    })
    vi.stubGlobal('fetch', fetchMock)
    const f = new OneloFeatures(API, PK)

    await f.load(null)
    const first = f.refresh(true)
    await settle()
    const second = f.load('user-1')
    await settle()
    user.resolve(response({ status: 200, body: { config_version: 2, features: { private: { status: 'enabled' } } } }))
    await second
    anonymous.resolve(response({ status: 200, body: { config_version: 1, features: { private: { status: 'hidden' } } } }))
    await first

    expect(f.feature('private').status).toBe('enabled')
  })

  it('drops a resolve started for the previous signed-in user after a switch', async () => {
    const firstUser = deferred<Response>()
    const secondUser = deferred<Response>()
    let resolveCalls = 0
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (!url.includes('/features/resolve')) return Promise.resolve(response({ status: 200, body: { features: {} } }))
      const body = JSON.parse(String(init?.body)) as { userId?: string }
      resolveCalls++
      if (resolveCalls === 1) return Promise.resolve(response({ status: 200, body: { config_version: 1, features: {} } }))
      return body.userId === 'user-1' ? firstUser.promise : secondUser.promise
    })
    vi.stubGlobal('fetch', fetchMock)
    const f = new OneloFeatures(API, PK)

    await f.load('user-1')
    const first = f.refresh(true)
    await settle()
    const second = f.load('user-2')
    await settle()
    secondUser.resolve(response({ status: 200, body: { config_version: 4, features: { private: { status: 'enabled' } } } }))
    await second
    firstUser.resolve(response({ status: 200, body: { config_version: 3, features: { private: { status: 'hidden' } } } }))
    await first

    expect(f.feature('private').status).toBe('enabled')
  })

  it('does not apply an anonymous answer after a signed-in token is refused', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (!url.includes('/features/resolve')) return response({ status: 200, body: { features: {} } })
      const headers = (init?.headers ?? {}) as Record<string, string>
      if (headers.Authorization) return response({ status: 401, body: { detail: { error: 'invalid_user_token' } } })
      return response({ status: 200, body: { anonymous: true, targeting_misses: 1, config_version: 5, features: { private: { status: 'enabled' } } } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const token = {
      current: vi.fn(async () => 'refused'),
      refresh: vi.fn(async () => 'refreshed'),
    }
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const f = new OneloFeatures(API, PK, undefined, { userToken: token })
    await f.load('user-1')

    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/features/resolve'))).toHaveLength(2)
    expect(f.feature('private').status).toBe('hidden')
  })

  it('resets readiness when the identity changes and waits for its snapshot', async () => {
    let resolveSecond!: (value: Response) => void
    const second = new Promise<Response>((resolve) => { resolveSecond = resolve })
    let resolveCount = 0
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (!url.includes('/features/resolve')) return Promise.resolve(response({ status: 200, body: { features: {} } }))
      resolveCount++
      return resolveCount === 1
        ? Promise.resolve(response({ status: 200, body: { config_version: 1, features: { private: { status: 'enabled' } } } }))
        : second
    }))
    const f = new OneloFeatures(API, PK)
    await f.load('user-1')
    const loading = f.load('user-2')
    let ready = false
    const waiting = f.ready(100).then(() => { ready = true })
    await settle()
    expect(ready).toBe(false)
    resolveSecond(response({ status: 200, body: { config_version: 2, features: { private: { status: 'enabled' } } } }))
    await loading
    await waiting
    expect(ready).toBe(true)
  })

  it('clears the previous identity snapshot when the new identity has no cache', async () => {
    const store: Record<string, string> = {}
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value },
    })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (!url.includes('/features/resolve')) return response({ status: 200, body: { features: {} } })
      return response({ status: 200, body: { config_version: 1, features: { private: { status: 'enabled' } } } })
    }))
    const f = new OneloFeatures(API, PK)
    await f.load('user-1')
    expect(f.feature('private').isEnabled).toBe(true)
    const pending = deferred<Response>()
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (!url.includes('/features/resolve')) return Promise.resolve(response({ status: 200, body: { features: {} } }))
      return pending.promise
    })
    const loading = f.load('user-2')
    await settle()
    expect(f.feature('private').status).toBe('hidden')
    pending.resolve(response({ status: 200, body: { config_version: 2, features: {} } }))
    await loading
  })

  it('starts a new identity stream with since_version zero until it confirms a snapshot', async () => {
    const store: Record<string, string> = {}
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value },
    })
    vi.stubGlobal('EventSource', MockEventSource)
    vi.stubGlobal('fetch', vi.fn(async () => response({ status: 200, body: { token: 'stream-token', features: {} } })))
    const f = new OneloFeatures(API, PK)
    const cacheKey = (f as unknown as { _cacheKey(id: string): string })._cacheKey('user-1')
    store[cacheKey] = JSON.stringify({ configVersion: 17, features: { private: { status: 'enabled' } } })
    const stream = new OneloEventStream(API, PK)
    f.attachStream(stream)
    await f.load('user-1')
    await settle()

    expect(new URL(MockEventSource.instances[0].url).searchParams.get('since_version')).toBe('0')
  })

  it('ignores a snapshot from an anonymous-fallback stream for a signed-in identity', async () => {
    vi.stubGlobal('EventSource', MockEventSource)
    let mint = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (!url.includes('/stream-token')) return response({ status: 200, body: { features: {} } })
      mint++
      const headers = (init?.headers ?? {}) as Record<string, string>
      if (headers.Authorization && mint < 3) return response({ status: 401, body: { detail: { error: 'invalid_user_token' } } })
      return response({ status: 200, body: { token: 'anonymous-stream-token' } })
    }))
    const f = new OneloFeatures(API, PK, undefined, {
      userToken: { current: async () => 'refused', refresh: async () => null },
    })
    const stream = new OneloEventStream(API, PK, undefined, {
      current: async () => 'refused',
      refresh: async () => null,
    })
    f.attachStream(stream)
    await f.load('user-1')
    for (let attempt = 0; attempt < 20 && MockEventSource.instances.length === 0; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    expect(MockEventSource.instances).toHaveLength(1)
    MockEventSource.instances[0].emit('connected', { config_version: 3, features: { private: { status: 'enabled' } } })

    expect(f.feature('private').status).toBe('hidden')
  })

  it('does not resolve anonymously before an identity has loaded', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const f = new OneloFeatures(API, PK)
    await f.refresh(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
