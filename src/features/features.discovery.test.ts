import { describe, it, expect, vi, afterEach } from 'vitest'
import { OneloFeatures } from './features'

const API = 'https://api.onelo.tools'
const PK = 'onelo_pk_test_abc'

describe('OneloFeatures — discovery instance-id + sampling; userIdHash never sent (#518)', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  function stubFetch() {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, json: () => Promise.resolve({ features: {} }) })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }
  const pingCall = (m: ReturnType<typeof vi.fn>) => m.mock.calls.find((c) => String(c[0]).includes('/batch-ping'))
  const resolveCall = (m: ReturnType<typeof vi.fn>) => m.mock.calls.find((c) => String(c[0]).includes('/features/resolve'))

  it('batch-ping sends X-Onelo-Instance-Id header and no userIdHash; test-env always pings', async () => {
    const fetchMock = stubFetch()
    const f = new OneloFeatures(API, PK, undefined, { featureEnvironment: 'test' })
    f.declare(['hero'])
    await f.load('u1', 'hash-abc') // (no stream attached → also does _resolve)

    const ping = pingCall(fetchMock)
    expect(ping, 'batch-ping must fire in test env').toBeTruthy()
    const headers = (ping![1] as RequestInit).headers as Record<string, string>
    expect(headers['X-Onelo-Instance-Id']).toBeTruthy()
    const body = JSON.parse((ping![1] as RequestInit).body as string)
    expect('userIdHash' in body, 'Secure Mode is retired: the hash is never sent').toBe(false)
    expect(body.environment).toBe('test')

    // resolve carries the userId but not the hash
    const rb = JSON.parse((resolveCall(fetchMock)![1] as RequestInit).body as string)
    expect(rb.userId).toBe('u1')
    expect('userIdHash' in rb).toBe(false)
  })

  it('instance id is stable across instances (localStorage-backed)', async () => {
    const store: Record<string, string> = {}
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v },
    })
    const fetchMock = stubFetch()
    const f1 = new OneloFeatures(API, PK, undefined, { featureEnvironment: 'test' })
    f1.declare(['a']); await f1.load('u1')
    const id1 = ((pingCall(fetchMock)![1] as RequestInit).headers as Record<string, string>)['X-Onelo-Instance-Id']

    fetchMock.mockClear()
    const f2 = new OneloFeatures(API, PK, undefined, { featureEnvironment: 'test' })
    f2.declare(['b']); await f2.load('u2')
    const id2 = ((pingCall(fetchMock)![1] as RequestInit).headers as Record<string, string>)['X-Onelo-Instance-Id']
    expect(id2).toBe(id1) // same install → same id
  })

  it('batch-ping sends X-Onelo-Sdk-Platform: js (browsers cannot set User-Agent)', async () => {
    const fetchMock = stubFetch()
    const f = new OneloFeatures(API, PK, undefined, { featureEnvironment: 'test' })
    f.declare(['hero'])
    await f.load('u1')
    const headers = (pingCall(fetchMock)![1] as RequestInit).headers as Record<string, string>
    expect(headers['X-Onelo-Sdk-Platform']).toBe('js')
  })

  it('instance id is STABLE across constructions even when localStorage.setItem throws (private mode)', async () => {
    // The 2-rows-per-browser bug: when persistence fails, the OLD code minted a
    // fresh volatile id per construction → the backend TOFU table accumulated
    // throwaway instances. The module-level cache must collapse both to one id.
    vi.resetModules() // fresh module → cachedInstanceId starts null
    const { OneloFeatures: FreshFeatures } = await import('./features')
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError / private mode') },
    })
    const fetchMock = stubFetch()
    const f1 = new FreshFeatures(API, PK, undefined, { featureEnvironment: 'test' })
    f1.declare(['a']); await f1.load('u1')
    const id1 = ((pingCall(fetchMock)![1] as RequestInit).headers as Record<string, string>)['X-Onelo-Instance-Id']

    fetchMock.mockClear()
    const f2 = new FreshFeatures(API, PK, undefined, { featureEnvironment: 'test' })
    f2.declare(['b']); await f2.load('u2')
    const id2 = ((pingCall(fetchMock)![1] as RequestInit).headers as Record<string, string>)['X-Onelo-Instance-Id']
    expect(id1).toBeTruthy()
    expect(id2).toBe(id1) // volatile fallback still deduped to ONE id per realm
  })

  it('live-env batch-ping is ~1% sampled — skipped when the roll misses', async () => {
    const fetchMock = stubFetch()
    vi.spyOn(Math, 'random').mockReturnValue(0.5) // > 0.01 → skip
    // Live KEY too (a `_test_` prefix would force isTestEnv=true → always ping).
    const f = new OneloFeatures(API, 'onelo_pk_live_abc', undefined, { featureEnvironment: 'live' })
    f.declare(['hero'])
    await f.load('u1')
    expect(pingCall(fetchMock), 'live ping skipped on a missed sample').toBeFalsy()
    expect(resolveCall(fetchMock), 'resolve still runs').toBeTruthy() // load still resolves state
  })
})
