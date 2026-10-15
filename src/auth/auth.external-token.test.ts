import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// #798: an App that signs users in with Supabase, Clerk or Firebase hands the
// SDK a function returning the provider's token; the SDK exchanges it for an
// Onelo session (POST /api/sdk/auth/exchange) and renews it before it lapses.

const store: Record<string, string> = {}
vi.mock('../core/storage', () => ({
  TokenStorage: vi.fn().mockImplementation(() => ({
    get: vi.fn(async (k: string) => store[k] ?? null),
    set: vi.fn(async (k: string, v: string) => { store[k] = v }),
    delete: vi.fn(async (k: string) => { delete store[k] }),
    clear: vi.fn(async () => { for (const k of Object.keys(store)) delete store[k] }),
  })),
  TOKEN_KEYS: {
    ACCESS_TOKEN: 'onelo_access_token',
    REFRESH_TOKEN: 'onelo_refresh_token',
    EXPIRES_AT: 'onelo_expires_at',
    USER_JSON: 'onelo_user',
  },
}))

const httpPost = vi.fn()
vi.mock('@onelo/core', async () => {
  const actual = await vi.importActual<typeof import('@onelo/core')>('@onelo/core')
  return {
    ...actual,
    httpGet: vi.fn().mockResolvedValue({ status: 200, json: { tenant_id: 't1', allow_custom_branding: false } }),
    httpPost: (...args: unknown[]) => httpPost(...args),
  }
})

import { OneloAuth } from './auth'
import { OneloError } from '@onelo/core'
import { renewalLeadSeconds } from './external-token'

const EXCHANGE_URL = 'https://api.x/api/sdk/auth/exchange'
let minted = 0
/** The door's answer as built in #796: no refresh token, 30 minutes. */
const exchanged = () => ({
  status: 200,
  json: {
    session: { access_token: `AT${++minted}`, token_type: 'bearer', expires_in: 1800 },
    user: { id: 'u1', email: 'a@b.c', entitlement: 'none', allowed_in: true, email_verified: true },
  },
})
const refused = (status: number, detail: unknown) => ({ status, json: { detail } })
const exchangeCalls = () => httpPost.mock.calls.filter((c) => c[0] === EXCHANGE_URL)
const newAuth = () => new OneloAuth({ apiUrl: 'https://api.x', publishableKey: 'pk_test_abc' })
const fetchMock = vi.fn()
let random: { mockRestore: () => void }

describe('OneloAuth.useExternalToken — a provider token becomes an Onelo session (#798)', () => {
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k]
    minted = 0
    httpPost.mockReset()
    // Only the door mints a session; sign-out and the rest answer an empty 200.
    httpPost.mockImplementation(async (url: string) => (url === EXCHANGE_URL ? exchanged() : { status: 200, json: {} }))
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({ status: 204 })
    vi.unstubAllGlobals()
    vi.stubGlobal('navigator', undefined)
    vi.stubGlobal('fetch', fetchMock)
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-04T10:00:00Z'))
    random = vi.spyOn(Math, 'random').mockReturnValue(0)
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); random.mockRestore() })

  it('exchanges the provider token on start and keeps the session in the session store', async () => {
    const auth = newAuth()
    const seen: Array<string | null> = []
    auth.onAuthStateChange((s) => seen.push(s?.accessToken ?? null))

    const session = await auth.useExternalToken(async () => 'provider-token-1')

    expect(exchangeCalls()).toHaveLength(1)
    expect(exchangeCalls()[0][1]).toEqual({ publishableKey: 'pk_test_abc', token: 'provider-token-1' })
    expect(session?.accessToken).toBe('AT1')
    expect(session?.user.id).toBe('u1')
    expect(session?.refreshToken).toBe('')
    expect(seen).toEqual(['AT1'])
    // The same store every Module reads through getSession().
    expect(store['onelo_access_token']).toBe('AT1')
    expect((await auth.getSession())?.accessToken).toBe('AT1')
    expect(exchangeCalls()).toHaveLength(1)
  })

  it('accepts a provider function that answers synchronously', async () => {
    const session = await newAuth().useExternalToken(() => 'sync-token')
    expect(session?.accessToken).toBe('AT1')
    expect(exchangeCalls()[0][1]).toMatchObject({ token: 'sync-token' })
  })

  it('re-exchanges a fresh provider token at 80% of the lifetime, before the session lapses', async () => {
    const auth = newAuth()
    let n = 0
    const getToken = vi.fn(async () => `provider-token-${++n}`)
    await auth.useExternalToken(getToken)

    // Math.random() = 0 → no jitter → renewal at exactly 80% of 1800 s = 1440 s.
    await vi.advanceTimersByTimeAsync(1439_000)
    expect(exchangeCalls()).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(exchangeCalls()).toHaveLength(2)
    expect(exchangeCalls()[1][1]).toEqual({ publishableKey: 'pk_test_abc', token: 'provider-token-2' })
    expect(store['onelo_access_token']).toBe('AT2')

    // …and again, 80% into the second session.
    await vi.advanceTimersByTimeAsync(1441_000)
    expect(exchangeCalls()).toHaveLength(3)
    expect(store['onelo_access_token']).toBe('AT3')
  })

  it('jitter only ever moves the renewal earlier: between 72% and 80% of the lifetime', () => {
    expect(renewalLeadSeconds(1800, () => 0)).toBeCloseTo(360)       // renew at 1440 s (80%)
    expect(renewalLeadSeconds(1800, () => 1)).toBeCloseTo(504)       // renew at 1296 s (72%)
    const lead = renewalLeadSeconds(1800, () => 0.5)
    expect(lead).toBeGreaterThan(360)
    expect(lead).toBeLessThan(504)
  })

  it('a read past the renewal point renews instead of handing out the old session', async () => {
    const auth = newAuth()
    await auth.useExternalToken(async () => 'provider-token')
    // A sleeping tab: the clock jumps, no timer fired.
    vi.setSystemTime(new Date(Date.now() + 1500_000))
    const session = await auth.getSession()
    expect(session?.accessToken).toBe('AT2')
    expect(exchangeCalls()).toHaveLength(2)
  })

  it('concurrent callers share one in-flight exchange', async () => {
    const auth = newAuth()
    const getToken = vi.fn(async () => 'provider-token')
    await auth.useExternalToken(getToken)
    vi.setSystemTime(new Date(Date.now() + 1500_000))

    const [a, b, c, d] = await Promise.all([
      auth.getSession(), auth.refreshSession(), auth.getSession(), auth.refreshSession(),
    ])

    expect(getToken).toHaveBeenCalledTimes(2)      // start + ONE renewal
    expect(exchangeCalls()).toHaveLength(2)
    for (const s of [a, b, c, d]) expect(s?.accessToken).toBe('AT2')
  })

  it('a tab that waited for the lock adopts the session another tab renewed', async () => {
    const auth = newAuth()
    const getToken = vi.fn(async () => 'provider-token')
    await auth.useExternalToken(getToken)
    const request = vi.fn(async (_name: string, _opts: unknown, cb: () => Promise<unknown>) => {
      // While this tab waited, another tab exchanged and wrote the shared store.
      store['onelo_access_token'] = 'AT_OTHER_TAB'
      store['onelo_expires_at'] = String(Math.floor(Date.now() / 1000) + 1800)
      return cb()
    })
    vi.stubGlobal('navigator', { locks: { request } })

    const session = await auth.refreshSession()

    expect(request.mock.calls[0][0]).toBe('onelo_auth_refresh:pk_test_abc')
    expect(session?.accessToken).toBe('AT_OTHER_TAB')
    expect(getToken).toHaveBeenCalledTimes(1)      // only the start
    expect(exchangeCalls()).toHaveLength(1)
  })

  it('a tab that adopts another tab\'s exchange on start still tells its listeners who signed in', async () => {
    // Several tabs restored at once: this one waits for the lock, and by the
    // time it gets it the other tab has exchanged (here: for another user).
    store['onelo_access_token'] = 'AT_STALE'
    store['onelo_refresh_token'] = ''
    store['onelo_expires_at'] = String(Math.floor(Date.now() / 1000) + 600)
    store['onelo_user'] = JSON.stringify({ id: 'userA' })
    const request = vi.fn(async (_name: string, _opts: unknown, cb: () => Promise<unknown>) => {
      store['onelo_access_token'] = 'AT_OTHER_TAB'
      store['onelo_expires_at'] = String(Math.floor(Date.now() / 1000) + 1800)
      store['onelo_user'] = JSON.stringify({ id: 'userB' })
      return cb()
    })
    vi.stubGlobal('navigator', { locks: { request } })
    const auth = newAuth()
    const seen: Array<string | null> = []
    auth.onAuthStateChange((s) => seen.push(s?.user.id ?? null))

    const session = await auth.useExternalToken(async () => 'provider-token')

    expect(session?.user.id).toBe('userB')
    expect(seen).toEqual(['userB'])               // Features, Monitor and Consent bind to it
    expect(exchangeCalls()).toHaveLength(0)       // adopted, not exchanged a second time
  })

  it('a transient failure on start, with nothing stored, rejects and is retried in the background', async () => {
    httpPost.mockResolvedValue(refused(503, { error: 'issuer_unavailable', message: 'unreachable' }))
    const auth = newAuth()
    const seen: Array<string | null> = []
    auth.onAuthStateChange((s) => seen.push(s?.accessToken ?? null))

    const err = await auth.useExternalToken(async () => 'provider-token').catch((e: unknown) => e)

    expect((err as OneloError).code).toBe('server_error')
    expect(seen).toEqual([])                      // nothing to end, nothing announced
    expect(await auth.getSession()).toBeNull()

    httpPost.mockImplementation(async () => exchanged())
    await vi.advanceTimersByTimeAsync(5_000)
    expect(seen).toEqual(['AT1'])
    expect((await auth.getSession())?.accessToken).toBe('AT1')
  })

  it.each(['token_expired', 'token_not_yet_valid'])(
    'a %s refusal keeps the session and asks the provider again', async (code) => {
      const auth = newAuth()
      let n = 0
      const getToken = vi.fn(async () => `provider-token-${++n}`)
      await auth.useExternalToken(getToken)
      const seen: Array<string | null> = []
      auth.onAuthStateChange((s) => seen.push(s?.accessToken ?? null))
      // A stale cached provider token, or a clock a few seconds off.
      httpPost.mockResolvedValueOnce(refused(401, { error: code, message: 'not valid now' }))

      await vi.advanceTimersByTimeAsync(1441_000)
      expect(store['onelo_access_token']).toBe('AT1')
      expect(seen).toEqual([])

      await vi.advanceTimersByTimeAsync(5_000)
      expect(exchangeCalls()[2][1]).toMatchObject({ token: 'provider-token-3' })
      expect(store['onelo_access_token']).toBe('AT2')
    })

  it('a new provider function handed over during a renewal gets its own exchange', async () => {
    const auth = newAuth()
    await auth.useExternalToken(async () => 'token-of-user-a')
    let release!: (v: unknown) => void
    httpPost.mockImplementationOnce(() => new Promise((r) => { release = r }))

    const renewing = auth.refreshSession()        // still for user A, in flight
    await vi.advanceTimersByTimeAsync(0)
    const switched = auth.useExternalToken(async () => 'token-of-user-b')
    await vi.advanceTimersByTimeAsync(0)
    release(exchanged())
    await renewing
    const session = await switched

    expect(exchangeCalls().map((c) => (c[1] as { token: string }).token))
      .toEqual(['token-of-user-a', 'token-of-user-a', 'token-of-user-b'])
    expect(session?.accessToken).toBe('AT3')
    expect(store['onelo_access_token']).toBe('AT3')
  })

  it('reports signed out when the provider returns no token on start', async () => {
    const auth = newAuth()
    const seen: Array<string | null> = []
    auth.onAuthStateChange((s) => seen.push(s?.accessToken ?? null))

    expect(await auth.useExternalToken(async () => null)).toBeNull()

    expect(exchangeCalls()).toHaveLength(0)
    expect(await auth.getSession()).toBeNull()
    expect(seen).toEqual([null])
  })

  it('ends the session when the provider returns no token at renewal', async () => {
    const auth = newAuth()
    let signedInAtProvider = true
    await auth.useExternalToken(async () => (signedInAtProvider ? 'provider-token' : undefined))
    const seen: Array<string | null> = []
    auth.onAuthStateChange((s) => seen.push(s?.accessToken ?? null))

    signedInAtProvider = false
    await vi.advanceTimersByTimeAsync(1441_000)

    expect(exchangeCalls()).toHaveLength(1)
    expect(seen).toEqual([null])
    expect(store['onelo_access_token']).toBeUndefined()
    expect(await auth.getSession()).toBeNull()
  })

  it('a refused token ends the session and says why', async () => {
    const auth = newAuth()
    await auth.useExternalToken(async () => 'provider-token')
    const seen: Array<string | null> = []
    auth.onAuthStateChange((s) => seen.push(s?.accessToken ?? null))
    httpPost.mockResolvedValue(refused(401, { error: 'token_issuer_mismatch', message: 'The token issuer differs.' }))

    const err = await auth.refreshSession().catch((e: unknown) => e)

    expect(err).toBeInstanceOf(OneloError)
    expect((err as OneloError).code).toBe('session_ended')
    expect((err as OneloError).message).toContain('token_issuer_mismatch')
    expect(seen).toEqual([null])
    expect(await auth.getSession()).toBeNull()
  })

  it('a banned App User is reported as suspended', async () => {
    httpPost.mockResolvedValue(refused(403, { error: 'banned' }))
    const err = await newAuth().useExternalToken(async () => 'provider-token').catch((e: unknown) => e)
    expect((err as OneloError).code).toBe('user_revoked')
  })

  it('an App on Onelo Auth is told which setting refuses the token', async () => {
    httpPost.mockResolvedValue(refused(403, { error: 'sign_in_mode_onelo', message: 'This App uses Onelo Auth.' }))
    const err = await newAuth().useExternalToken(async () => 'provider-token').catch((e: unknown) => e)
    expect((err as OneloError).code).toBe('session_ended')
    expect((err as OneloError).message).toContain('sign_in_mode_onelo')
    expect((err as OneloError).message).toContain('Sign-in Mode')
  })

  it.each([
    ['429 rate_limited', refused(429, { error: 'rate_limited', message: 'Too many exchanges.' })],
    ['503 issuer_unavailable', refused(503, { error: 'issuer_unavailable', message: 'unreachable' })],
  ])('a transient refusal (%s) keeps the session and retries with backoff', async (_name, answer) => {
    const auth = newAuth()
    await auth.useExternalToken(async () => 'provider-token')
    const seen: Array<string | null> = []
    auth.onAuthStateChange((s) => seen.push(s?.accessToken ?? null))
    httpPost.mockResolvedValue(answer)

    await vi.advanceTimersByTimeAsync(1441_000)       // renewal fails
    expect(exchangeCalls()).toHaveLength(2)
    expect(store['onelo_access_token']).toBe('AT1')   // session kept
    expect((await auth.getSession())?.accessToken).toBe('AT1')
    expect(exchangeCalls()).toHaveLength(2)           // a read does not hammer the door

    httpPost.mockImplementation(async () => exchanged())
    await vi.advanceTimersByTimeAsync(5_000)          // first retry
    expect(exchangeCalls()).toHaveLength(3)
    expect(store['onelo_access_token']).toBe('AT2')
    expect(seen).toEqual(['AT2'])
  })

  it('repeated transient failures back off instead of retrying every 5 seconds', async () => {
    const auth = newAuth()
    await auth.useExternalToken(async () => 'provider-token')
    httpPost.mockRejectedValue(OneloError.network('offline'))

    await vi.advanceTimersByTimeAsync(1440_000)       // renewal fails → retry in 5 s
    expect(exchangeCalls()).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(5_000)          // retry 1 fails → next in 10 s
    expect(exchangeCalls()).toHaveLength(3)
    await vi.advanceTimersByTimeAsync(9_000)
    expect(exchangeCalls()).toHaveLength(3)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(exchangeCalls()).toHaveLength(4)
  })

  it('a provider function that throws is transient, not a sign-out', async () => {
    const auth = newAuth()
    let broken = false
    await auth.useExternalToken(async () => {
      if (broken) throw new Error('provider network blip')
      return 'provider-token'
    })
    broken = true
    await vi.advanceTimersByTimeAsync(1441_000)
    expect(store['onelo_access_token']).toBe('AT1')

    broken = false
    await vi.advanceTimersByTimeAsync(5_000)
    expect(store['onelo_access_token']).toBe('AT2')
  })

  it('never opens an Onelo sign-in screen: loadAuthView answers with the session', async () => {
    const auth = newAuth()
    await auth.useExternalToken(async () => 'provider-token')
    const open = vi.fn()
    vi.stubGlobal('window', { open, location: { href: 'https://app.example/' } })

    const session = await auth.loadAuthView()

    expect(session?.accessToken).toBe('AT1')
    expect(open).not.toHaveBeenCalled()
    // No /api/sdk/flow/init either: nothing was asked to choose a surface.
    expect(httpPost.mock.calls.every((c) => c[0] === EXCHANGE_URL)).toBe(true)
  })

  it('sends no presence heartbeat for an external session', async () => {
    const auth = newAuth()
    await auth.useExternalToken(async () => 'provider-token')
    await auth.getSession()
    // Past the 13-minute heartbeat of an Onelo Auth session.
    await vi.advanceTimersByTimeAsync(14 * 60 * 1000)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(store['onelo_access_token']).toBe('AT1')
  })

  it('a sign-out during an exchange is not undone when the exchange lands', async () => {
    const auth = newAuth()
    await auth.useExternalToken(async () => 'provider-token')
    let release!: (v: unknown) => void
    httpPost.mockImplementation((url: string) =>
      url === EXCHANGE_URL ? new Promise((r) => { release = r }) : Promise.resolve({ status: 200, json: {} }))

    const renewing = auth.refreshSession()
    await vi.advanceTimersByTimeAsync(0)
    await auth.signOut()
    release(exchanged())

    expect(await renewing).toBeNull()
    expect(store['onelo_access_token']).toBeUndefined()
    expect(await auth.getSession()).toBeNull()
  })

  it('signOut stops renewal until the provider function is handed over again', async () => {
    const auth = newAuth()
    const getToken = vi.fn(async () => 'provider-token')
    await auth.useExternalToken(getToken)
    await auth.signOut()

    await vi.advanceTimersByTimeAsync(1800_000)
    expect(await auth.refreshSession()).toBeNull()
    expect(getToken).toHaveBeenCalledTimes(1)
    expect(await auth.getSession()).toBeNull()

    const again = await auth.useExternalToken(getToken)
    expect(again?.accessToken).toBe('AT2')
  })

  it('a stored external session is not handed out before the provider function is registered', async () => {
    const first = newAuth()
    await first.useExternalToken(async () => 'provider-token')
    // A page reload: same store, a new SDK instance, no function yet.
    const reloaded = newAuth()
    expect(await reloaded.getSession()).toBeNull()
    // …and registering it exchanges again: the provider is the source of truth.
    const session = await reloaded.useExternalToken(async () => 'provider-token-after-reload')
    expect(session?.accessToken).toBe('AT2')
    expect(exchangeCalls()[1][1]).toMatchObject({ token: 'provider-token-after-reload' })
  })

  it('drops a stored Onelo Auth session instead of rotating its refresh token', async () => {
    store['onelo_access_token'] = 'OLD_AT'
    store['onelo_refresh_token'] = 'OLD_RT'
    store['onelo_expires_at'] = String(Math.floor(Date.now() / 1000) + 600)
    store['onelo_user'] = JSON.stringify({ id: 'old' })
    const auth = newAuth()

    const session = await auth.useExternalToken(async () => 'provider-token')

    expect(session?.user.id).toBe('u1')
    expect(store['onelo_refresh_token']).toBe('')
    expect(httpPost.mock.calls.some((c) => String(c[0]).endsWith('/api/sdk/auth/refresh'))).toBe(false)
  })

  it('an Onelo Auth session (no provider function) still refreshes with its refresh token', async () => {
    store['onelo_refresh_token'] = 'RT0'
    httpPost.mockResolvedValue({
      status: 200,
      json: { session: { access_token: 'AT', refresh_token: 'RT_NEW', expires_in: 900 }, user: { id: 'u1' } },
    })
    const session = await newAuth().refreshSession()
    expect(session?.refreshToken).toBe('RT_NEW')
    expect(httpPost.mock.calls[0][0]).toBe('https://api.x/api/sdk/auth/refresh')
  })
  // ── #836: sign-out reaches every tab; an expired-only provider ends the session ──

  /** A window whose `storage` events the test delivers by hand, as the browser
   *  does to every OTHER tab when one tab writes localStorage. */
  const stubWindow = () => {
    const win = new EventTarget()
    vi.stubGlobal('window', win)
    return (key: string, newValue: string | null) =>
      win.dispatchEvent(Object.assign(new Event('storage'), { key, newValue }))
  }

  it('signOut() in one tab leaves another tab signed out and not renewing (#836)', async () => {
    const tabA = newAuth()
    const tabB = newAuth()
    const getTokenA = vi.fn(async () => 'provider-token')
    const getTokenB = vi.fn(async () => 'provider-token')
    await tabA.useExternalToken(getTokenA)
    await tabB.useExternalToken(getTokenB)
    const seenB: Array<string | null> = []
    tabB.onAuthStateChange((s) => seenB.push(s?.accessToken ?? null))

    await tabA.signOut()

    expect(await tabB.getSession()).toBeNull()
    // Tab B's own renewal timer fires later: it must not sign the user back in.
    await vi.advanceTimersByTimeAsync(3600_000)
    expect(getTokenB).toHaveBeenCalledTimes(1)
    expect(getTokenA).toHaveBeenCalledTimes(1)
    expect(exchangeCalls()).toHaveLength(2)
    expect(store['onelo_access_token']).toBeUndefined()
    expect(await tabB.getSession()).toBeNull()
    expect(await tabB.refreshSession()).toBeNull()
    expect(seenB).toEqual([null])
  })

  it('the other tab hears the sign-out at once through the shared storage (#836)', async () => {
    const deliver = stubWindow()
    const tabA = newAuth()
    const tabB = newAuth()
    await tabA.useExternalToken(async () => 'provider-token')
    await tabB.useExternalToken(async () => 'provider-token')
    const seenB: Array<string | null> = []
    tabB.onAuthStateChange((s) => seenB.push(s?.accessToken ?? null))

    await tabA.signOut()
    deliver('onelo_external_signed_out', store['onelo_external_signed_out'] ?? null)

    expect(seenB).toEqual([null])
  })

  it('a new sign-in at the provider signs the user in again in both tabs (#836)', async () => {
    const deliver = stubWindow()
    const tabA = newAuth()
    const tabB = newAuth()
    const getTokenB = vi.fn(async () => 'provider-token')
    await tabA.useExternalToken(async () => 'provider-token')
    await tabB.useExternalToken(getTokenB)
    await tabB.signOut()                       // this time tab B signs out
    deliver('onelo_external_signed_out', store['onelo_external_signed_out'] ?? null)
    const seenB: Array<string | null> = []
    tabB.onAuthStateChange((s) => seenB.push(s?.accessToken ?? null))

    // The provider reports a new sign-in in tab A; the App hands its function over again.
    const again = await tabA.useExternalToken(async () => 'provider-token-new')
    expect(again?.accessToken).toBe('AT3')
    deliver('onelo_external_signed_out', null)
    deliver('onelo_access_token', 'AT3')
    await vi.advanceTimersByTimeAsync(0)

    expect(seenB).toEqual(['AT3'])
    expect((await tabB.getSession())?.accessToken).toBe('AT3')
    // …and tab B renews again on its own.
    await vi.advanceTimersByTimeAsync(1441_000)
    expect(getTokenB).toHaveBeenCalledTimes(2)
  })

  it('a new sign-in is picked up by a tab that missed the storage event (#836)', async () => {
    const tabA = newAuth()
    const tabB = newAuth()
    await tabA.useExternalToken(async () => 'provider-token')
    await tabB.useExternalToken(async () => 'provider-token')
    await tabA.signOut()
    expect(await tabB.getSession()).toBeNull()

    await tabA.useExternalToken(async () => 'provider-token-new')

    expect((await tabB.getSession())?.accessToken).toBe('AT3')
  })

  it('a provider that only returns expired tokens leads to signed out once the Onelo token expired (#836)', async () => {
    const auth = newAuth()
    const getToken = vi.fn(async () => 'stale-provider-token')
    await auth.useExternalToken(getToken)
    const seen: Array<string | null> = []
    auth.onAuthStateChange((s) => seen.push(s?.accessToken ?? null))
    httpPost.mockResolvedValue(refused(401, { error: 'token_expired', message: 'expired' }))

    // Before the Onelo access token expires (1800 s) the session is kept.
    await vi.advanceTimersByTimeAsync(1700_000)
    expect((await auth.getSession())?.accessToken).toBe('AT1')
    expect(seen).toEqual([])

    // Past expiry: signed out, not a lapsed session, and no endless retry.
    vi.setSystemTime(new Date(Date.now() + 101_000))
    expect(await auth.getSession()).toBeNull()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(seen).toEqual([null])
    const calls = getToken.mock.calls.length
    await vi.advanceTimersByTimeAsync(3600_000)
    expect(getToken.mock.calls.length).toBe(calls)
    expect(await auth.getSession()).toBeNull()
  })

  it('an outage past expiry still keeps retrying: only a stale provider token ends the session (#836)', async () => {
    const auth = newAuth()
    await auth.useExternalToken(async () => 'provider-token')
    httpPost.mockResolvedValue(refused(503, { error: 'issuer_unavailable', message: 'down' }))
    await vi.advanceTimersByTimeAsync(1900_000)
    httpPost.mockImplementation(async (url: string) => (url === EXCHANGE_URL ? exchanged() : { status: 200, json: {} }))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(store['onelo_access_token']).toMatch(/^AT\d+$/)
    expect(store['onelo_access_token']).not.toBe('AT1')
  })

  it('an Onelo Auth sign-out writes no external sign-out mark (#836)', async () => {
    store['onelo_access_token'] = 'AT'
    store['onelo_refresh_token'] = 'RT'
    store['onelo_expires_at'] = String(Math.floor(Date.now() / 1000) + 900)
    store['onelo_user'] = JSON.stringify({ id: 'u1' })
    await newAuth().signOut()
    expect(store['onelo_external_signed_out']).toBeUndefined()
  })
})
