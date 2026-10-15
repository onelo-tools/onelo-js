import { describe, it, expect, vi, afterEach } from 'vitest'
import { OneloFeatures, OneloFeaturesError } from './features'

const API = 'https://api.onelo.tools'
const PK = 'onelo_pk_test_abc'

type MtResp = { status: number; body: unknown } | 'throw'

describe('OneloFeatures Phase 2 — moduleToken / ready / refresh (Swift parity)', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  // Route fetch by URL. /module-token uses the supplied override; everything
  // else (resolve, batch-ping) returns an empty-features 200.
  function stubFetch(moduleTokenResp?: MtResp) {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/module-token')) {
        if (moduleTokenResp === 'throw') return Promise.reject(new Error('boom'))
        const r = moduleTokenResp ?? { status: 200, body: { token: 'jwt-xyz', expires_in: 60 } }
        return Promise.resolve({ status: r.status, json: () => Promise.resolve(r.body) })
      }
      return Promise.resolve({ status: 200, json: () => Promise.resolve({ features: {} }) })
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }
  const mtCall = (m: ReturnType<typeof vi.fn>) => m.mock.calls.find((c) => String(c[0]).includes('/module-token'))
  const resolveCount = (m: ReturnType<typeof vi.fn>) => m.mock.calls.filter((c) => String(c[0]).includes('/features/resolve')).length

  // ── moduleToken ────────────────────────────────────────────────────────────
  it('throws not_authenticated before identify — makes NO network call', async () => {
    const fetchMock = stubFetch()
    const f = new OneloFeatures(API, PK)
    await expect(f.moduleToken('slug')).rejects.toMatchObject({ code: 'not_authenticated' })
    expect(mtCall(fetchMock), 'no request without a user').toBeFalsy()
  })

  it('200 returns the token and sends publishableKey/userId/slug, never userIdHash', async () => {
    const fetchMock = stubFetch()
    const f = new OneloFeatures(API, PK)
    await f.load('u1', 'hash-abc')
    const token = await f.moduleToken('advanced-export')
    expect(token).toBe('jwt-xyz')
    const body = JSON.parse((mtCall(fetchMock)![1] as RequestInit).body as string)
    expect(body).toMatchObject({ publishableKey: PK, userId: 'u1', slug: 'advanced-export' })
    expect('userIdHash' in body, 'Secure Mode is retired: the hash is never sent').toBe(false)
  })

  it('omits userIdHash when none is set', async () => {
    const fetchMock = stubFetch()
    const f = new OneloFeatures(API, PK)
    await f.load('u1')
    await f.moduleToken('x')
    const body = JSON.parse((mtCall(fetchMock)![1] as RequestInit).body as string)
    expect('userIdHash' in body).toBe(false)
  })

  it('maps 403 → not_entitled', async () => {
    stubFetch({ status: 403, body: { detail: { error: 'not_entitled', status: 'greyed' } } })
    const f = new OneloFeatures(API, PK)
    await f.load('u1')
    await expect(f.moduleToken('x')).rejects.toMatchObject({ code: 'not_entitled' })
  })

  it('maps 401 secure_mode_required / invalid_user_hash / default→not_authenticated', async () => {
    const f1 = new OneloFeatures(API, PK)
    stubFetch({ status: 401, body: { detail: { error: 'secure_mode_required' } } })
    await f1.load('u1')
    await expect(f1.moduleToken('x')).rejects.toMatchObject({ code: 'secure_mode_required' })

    vi.unstubAllGlobals()
    const f2 = new OneloFeatures(API, PK)
    stubFetch({ status: 401, body: { detail: { error: 'invalid_user_hash' } } })
    await f2.load('u1')
    await expect(f2.moduleToken('x')).rejects.toMatchObject({ code: 'invalid_user_hash' })

    vi.unstubAllGlobals()
    const f3 = new OneloFeatures(API, PK)
    stubFetch({ status: 401, body: { detail: { error: 'user_required' } } })
    await f3.load('u1')
    await expect(f3.moduleToken('x')).rejects.toMatchObject({ code: 'not_authenticated' })
  })

  it('maps transport failure and a malformed 200 (no token) → network_error', async () => {
    stubFetch('throw')
    const f = new OneloFeatures(API, PK)
    await f.load('u1')
    await expect(f.moduleToken('x')).rejects.toMatchObject({ code: 'network_error' })

    vi.unstubAllGlobals()
    stubFetch({ status: 200, body: { expires_in: 60 } })
    const f2 = new OneloFeatures(API, PK)
    await f2.load('u1')
    await expect(f2.moduleToken('x')).rejects.toMatchObject({ code: 'network_error' })
  })

  it('throws an OneloFeaturesError instance', async () => {
    stubFetch()
    const f = new OneloFeatures(API, PK)
    const err = await f.moduleToken('x').catch((e) => e)
    expect(err).toBeInstanceOf(OneloFeaturesError)
  })

  // ── ready ─────────────────────────────────────────────────────────────────
  it('ready() resolves after load applies a snapshot (no-stream fallback signals)', async () => {
    stubFetch()
    const f = new OneloFeatures(API, PK)
    await f.load('u1')
    await expect(f.ready()).resolves.toBeUndefined()
  })

  it('ready(timeout) resolves via timeout when no snapshot ever arrives', async () => {
    const f = new OneloFeatures(API, PK) // no load, no stream → never signals
    const start = Date.now()
    await f.ready(30)
    expect(Date.now() - start).toBeGreaterThanOrEqual(25)
  })

  // ── refresh ──────────────────────────────────────────────────────────────
  it('refresh() is debounced to one call/sec; force bypasses', async () => {
    const fetchMock = stubFetch()
    const f = new OneloFeatures(API, PK)
    await f.load('u1') // load resolves once; does NOT set the refresh cursor
    const base = resolveCount(fetchMock)
    await f.refresh()            // lastRefreshAt was 0 → fires
    expect(resolveCount(fetchMock)).toBe(base + 1)
    await f.refresh()            // within 1s → debounced, no new resolve
    expect(resolveCount(fetchMock)).toBe(base + 1)
    await f.refresh(true)        // force → fires despite debounce
    expect(resolveCount(fetchMock)).toBe(base + 2)
  })
})
