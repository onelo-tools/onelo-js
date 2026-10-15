/**
 * #518: every Features call proves the signed-in Onelo user with their access
 * token (`Authorization: Bearer`), refreshes and retries once on the server's
 * `401 invalid_user_token`, and falls back to anonymous (no token, no userId)
 * when refused again. `userIdHash` is never sent.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { OneloFeatures } from './features'

const API = 'https://api.onelo.tools'
const PK = 'onelo_pk_test_abc'
const REFUSED = { status: 401, body: { detail: { error: 'invalid_user_token' } } }

type Reply = { status: number; body: unknown }
type Call = { url: string; headers: Record<string, string>; body: Record<string, unknown> }

/** Route fetch by path. `replies[path]` is consumed in order; the last one repeats. */
function stubFetch(replies: Record<string, Reply[]> = {}) {
  const calls: Call[] = []
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(init.body as string) : {},
    })
    const key = Object.keys(replies).find((k) => String(url).includes(k))
    const queue = key ? replies[key] : undefined
    const r = queue && queue.length > 1 ? queue.shift()! : queue?.[0] ?? { status: 200, body: { features: {}, config_version: 1, token: 'module-jwt' } }
    return { status: r.status, json: async () => r.body }
  })
  vi.stubGlobal('fetch', fetchMock)
  const to = (path: string) => calls.filter((c) => c.url.includes(path))
  return { calls, to }
}

function tokenSource(current: string | null, refreshed: string | null = 'fresh-token') {
  let token = current
  const source = {
    current: vi.fn(async () => token),
    refresh: vi.fn(async () => { token = refreshed; return refreshed }),
  }
  return source
}

const auth = (c: Call) => c.headers['Authorization']

describe('OneloFeatures — signed-in user proven with the access token (#518)', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('sends Authorization: Bearer on resolve, batch-ping and module-token when signed in', async () => {
    const { to } = stubFetch()
    const f = new OneloFeatures(API, PK, undefined, { featureEnvironment: 'test', userToken: tokenSource('access-1') })
    f.declare(['hero'])
    await f.load('u1') // no stream attached → batch-ping + resolve
    await f.moduleToken('export')

    expect(auth(to('/features/resolve')[0])).toBe('Bearer access-1')
    expect(auth(to('/batch-ping')[0])).toBe('Bearer access-1')
    expect(auth(to('/module-token')[0])).toBe('Bearer access-1')
    // userId still rides along (ignored by a server that verified the token).
    expect(to('/features/resolve')[0].body['userId']).toBe('u1')
  })

  it('reads the token fresh for every call (a refreshed session is used at once)', async () => {
    const { to } = stubFetch()
    let current = 'access-1'
    const f = new OneloFeatures(API, PK, undefined, {
      userToken: { current: async () => current, refresh: async () => null },
    })
    await f.load('u1')
    current = 'access-2'
    await f.refresh(true)
    expect(to('/features/resolve').map(auth)).toEqual(['Bearer access-1', 'Bearer access-2'])
  })

  it('signed out: no Authorization header and no userId', async () => {
    const { to } = stubFetch()
    const f = new OneloFeatures(API, PK, undefined, { featureEnvironment: 'test', userToken: tokenSource(null) })
    f.declare(['hero'])
    await f.load(null)
    for (const c of [...to('/features/resolve'), ...to('/batch-ping')]) {
      expect(auth(c)).toBeUndefined()
      expect('userId' in c.body).toBe(false)
    }
  })

  it('never sends userIdHash, even when identify() passes one', async () => {
    const { calls } = stubFetch()
    const f = new OneloFeatures(API, PK, undefined, { featureEnvironment: 'test', userToken: tokenSource('access-1') })
    f.declare(['hero'])
    await f.load('u1', 'legacy-hash')
    await f.moduleToken('export')
    expect(calls.length).toBeGreaterThan(0)
    for (const c of calls) expect('userIdHash' in c.body).toBe(false)
  })

  it('401 invalid_user_token → refreshes once and retries once with the new token', async () => {
    const { to } = stubFetch({ '/features/resolve': [REFUSED, { status: 200, body: { features: { hero: { status: 'enabled' } }, config_version: 2 } }] })
    const source = tokenSource('stale')
    const f = new OneloFeatures(API, PK, undefined, { userToken: source })
    await f.load('u1')
    expect(source.refresh).toHaveBeenCalledTimes(1)
    expect(to('/features/resolve').map(auth)).toEqual(['Bearer stale', 'Bearer fresh-token'])
    expect(f.feature('hero').isEnabled).toBe(true)
  })

  it('refused again → does not apply an anonymous resolve over a signed-in user', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { to } = stubFetch({ '/features/resolve': [REFUSED, REFUSED] })
    const source = tokenSource('stale')
    const f = new OneloFeatures(API, PK, undefined, { userToken: source })
    await f.load('u1')
    const resolves = to('/features/resolve')
    expect(resolves).toHaveLength(2)
    expect(resolves.map(auth)).toEqual(['Bearer stale', 'Bearer fresh-token'])
    expect(source.refresh).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls.some((c) => String(c[0]).includes('invalid_user_token'))).toBe(true)
    expect(f.feature('hero').status).toBe('hidden')
  })

  it('a refresh that yields no token keeps the signed-in resolve from falling back anonymously', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { to } = stubFetch({ '/features/resolve': [REFUSED] })
    const f = new OneloFeatures(API, PK, undefined, { userToken: tokenSource('stale', null) })
    await f.load('u1')
    expect(to('/features/resolve').map(auth)).toEqual(['Bearer stale'])
  })

  it('batch-ping: refused twice → retried once, then sent without a token', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { to } = stubFetch({ '/batch-ping': [REFUSED, REFUSED, { status: 200, body: {} }] })
    const f = new OneloFeatures(API, PK, undefined, { featureEnvironment: 'test', userToken: tokenSource('stale') })
    f.declare(['hero'])
    await f.load('u1')
    expect(to('/batch-ping').map(auth)).toEqual(['Bearer stale', 'Bearer fresh-token', undefined])
  })

  it('module-token: refused, refreshed, retried; refused again → not_authenticated (no anonymous mint)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { to } = stubFetch({ '/module-token': [REFUSED] })
    const f = new OneloFeatures(API, PK, undefined, { userToken: tokenSource('stale') })
    await f.load('u1')
    await expect(f.moduleToken('export')).rejects.toMatchObject({ code: 'not_authenticated' })
    expect(to('/module-token').map(auth)).toEqual(['Bearer stale', 'Bearer fresh-token'])
  })

  it('module-token: a refresh fixes a refused token', async () => {
    const { to } = stubFetch({ '/module-token': [REFUSED, { status: 200, body: { token: 'module-jwt' } }] })
    const f = new OneloFeatures(API, PK, undefined, { userToken: tokenSource('stale') })
    await f.load('u1')
    await expect(f.moduleToken('export')).resolves.toBe('module-jwt')
    expect(to('/module-token').map(auth)).toEqual(['Bearer stale', 'Bearer fresh-token'])
  })

  it('a 401 that is not invalid_user_token is not retried', async () => {
    const { to } = stubFetch({ '/features/resolve': [{ status: 401, body: { detail: { error: 'invalid_key' } } }] })
    const source = tokenSource('access-1')
    const f = new OneloFeatures(API, PK, undefined, { userToken: source })
    await f.load('u1')
    expect(to('/features/resolve')).toHaveLength(1)
    expect(source.refresh).not.toHaveBeenCalled()
  })
})
