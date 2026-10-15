import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// In-memory storage so refreshSession finds a refresh token to rotate.
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

// Shape mapSession expects for a refresh response ({ session:{...}, user }).
const REFRESH_OK = {
  status: 200,
  json: { session: { access_token: 'AT', refresh_token: 'RT_NEW', expires_in: 900 }, user: { id: 'u1', email: 'a@b.c' } },
}
const newAuth = () => new OneloAuth({ apiUrl: 'https://api.x', publishableKey: 'pk_test_abc' })

describe('OneloAuth refresh coordination — single-flight + cross-tab Web Lock', () => {
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k]
    store['onelo_refresh_token'] = 'RT0'
    httpPost.mockReset()
    httpPost.mockResolvedValue(REFRESH_OK)
    vi.unstubAllGlobals()
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

  it('single-flight: N concurrent refreshSession() collapse onto ONE network refresh', async () => {
    vi.stubGlobal('navigator', undefined) // isolate Layer 1
    const auth = newAuth()
    const [a, b, c] = await Promise.all([auth.refreshSession(), auth.refreshSession(), auth.refreshSession()])
    expect(httpPost).toHaveBeenCalledTimes(1)      // the whole point: one token used once
    expect(a?.accessToken).toBe('AT')
    expect(b).toBe(a)                              // same in-flight promise → same result ref
    expect(c).toBe(a)
  })

  it('single-flight clears after settle: a later refresh fires a fresh request', async () => {
    vi.stubGlobal('navigator', undefined)
    const auth = newAuth()
    await auth.refreshSession()
    store['onelo_refresh_token'] = 'RT_NEW' // rotated
    await auth.refreshSession()
    expect(httpPost).toHaveBeenCalledTimes(2)
  })

  it('acquires a per-app Web Lock when navigator.locks is available', async () => {
    const request = vi.fn(async (_name: string, _opts: unknown, cb: () => Promise<unknown>) => cb())
    vi.stubGlobal('navigator', { locks: { request } })
    const auth = newAuth()
    const s = await auth.refreshSession()
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0][0]).toBe('onelo_auth_refresh:pk_test_abc') // scoped per publishable key
    expect(s?.accessToken).toBe('AT')
    expect(httpPost).toHaveBeenCalledTimes(1)
  })

  it('falls back to a direct refresh when Web Locks are unavailable', async () => {
    vi.stubGlobal('navigator', {}) // navigator present but no .locks
    const auth = newAuth()
    const s = await auth.refreshSession()
    expect(s?.accessToken).toBe('AT')
    expect(httpPost).toHaveBeenCalledTimes(1) // refresh still happens
  })

  it('epoch guard holds on the async Web-Lock path: a signOut between call and lock-grant → null (no resurrect)', async () => {
    // Grant the lock only after we release the gate — mimics the real API granting
    // on a later task, so _doRefresh runs AFTER the synchronous epoch bump below.
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const request = vi.fn(async (_n: string, _o: unknown, cb: () => Promise<unknown>) => { await gate; return cb() })
    vi.stubGlobal('navigator', { locks: { request } })
    const auth = newAuth()
    const p = auth.refreshSession()            // captures signOutEpoch SYNCHRONOUSLY (E0)
    // Simulate signOut bumping the epoch after capture but before the lock grants
    // _doRefresh. Bump the counter directly so the refresh token stays readable —
    // isolates the EPOCH guard from the no-token early-return.
    ;(auth as unknown as { signOutEpoch: number }).signOutEpoch++
    release()                                  // lock grants → _doRefresh runs with the stale epoch
    const result = await p
    expect(result).toBeNull()                  // guard fired: token was present, so null == epoch guard
    // saveSession must NOT have run → the (already-signed-out) session isn't written back
  })

  it('lock wait times out while the holder is still in flight → no replay: throws a transient timeout, session kept', async () => {
    vi.useFakeTimers()
    // A holder that never releases: the request stays pending until the wait is aborted.
    const request = vi.fn((_name: string, opts: { signal: AbortSignal }) => new Promise((_res, rej) => {
      opts.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))
    }))
    vi.stubGlobal('navigator', { locks: { request } })
    const auth = newAuth()
    const p = auth.refreshSession()
    const settled = p.catch((e) => e)
    await vi.advanceTimersByTimeAsync(5001) // past REFRESH_LOCK_TIMEOUT_MS
    const err = await settled
    expect(err).toMatchObject({ code: 'timeout' }) // never hangs …
    expect(httpPost).not.toHaveBeenCalled()        // … and never replays the in-flight token
    expect(store['onelo_refresh_token']).toBe('RT0') // session kept for the next attempt
  })

  it('the retry after a lock-wait timeout does not re-rotate what the other tab just refreshed', async () => {
    vi.useFakeTimers()
    const request = vi.fn((_name: string, opts: { signal: AbortSignal }) => new Promise((_res, rej) => {
      opts.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))
    }))
    vi.stubGlobal('navigator', { locks: { request } })
    const auth = newAuth()
    const settled = auth.refreshSession().catch((e) => e)
    await vi.advanceTimersByTimeAsync(5001)
    expect(await settled).toMatchObject({ code: 'timeout' })
    // The holder tab finishes AFTER our timeout and writes a fresh session.
    Object.assign(store, {
      onelo_access_token: 'AT_OTHER', onelo_refresh_token: 'RT_OTHER',
      onelo_expires_at: String(Math.floor(Date.now() / 1000) + 900),
      onelo_user: JSON.stringify({ id: 'u1', email: 'a@b.c' }),
    })
    await vi.advanceTimersByTimeAsync(5_000) // the scheduled retry fires
    expect(httpPost).not.toHaveBeenCalled()  // fresh session adopted, no second rotation
    ;(auth as unknown as { clearRefreshTimer(): void }).clearRefreshTimer()
  })

  it('lock wait times out after the other tab already rotated → adopts its session, no second refresh', async () => {
    vi.useFakeTimers()
    const request = vi.fn((_name: string, opts: { signal: AbortSignal }) => new Promise((_res, rej) => {
      opts.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))
    }))
    vi.stubGlobal('navigator', { locks: { request } })
    const auth = newAuth()
    const p = auth.refreshSession()
    await Promise.resolve(); await Promise.resolve()
    // The other tab finished its refresh and wrote the rotated session.
    Object.assign(store, {
      onelo_access_token: 'AT_OTHER', onelo_refresh_token: 'RT_OTHER',
      onelo_expires_at: String(Math.floor(Date.now() / 1000) + 900),
      onelo_user: JSON.stringify({ id: 'u1', email: 'a@b.c' }),
    })
    await vi.advanceTimersByTimeAsync(5001)
    const s = await p
    expect(s?.accessToken).toBe('AT_OTHER')
    expect(httpPost).not.toHaveBeenCalled()
  })

  describe('two tabs refreshing at once (shared storage, real mutual exclusion)', () => {
    // A minimal LockManager with real exclusivity per name, shared by both
    // "tabs" — the way the browser shares navigator.locks across one origin.
    function sharedLocks() {
      const tails = new Map<string, Promise<unknown>>()
      return {
        request: (name: string, opts: { signal?: AbortSignal }, cb: () => Promise<unknown>) => {
          const prev = tails.get(name) ?? Promise.resolve()
          let granted = false
          const run = new Promise((resolve, reject) => {
            opts.signal?.addEventListener('abort', () => {
              if (!granted) reject(new DOMException('aborted', 'AbortError'))
            })
            prev.then(() => {
              if (opts.signal?.aborted) return
              granted = true
              cb().then(resolve, reject)
            })
          })
          tails.set(name, run.catch(() => {}))
          return run
        },
      }
    }

    it('only ONE refresh request is sent with the shared token; both tabs end on the rotated session', async () => {
      vi.stubGlobal('navigator', { locks: sharedLocks() })
      let release!: () => void
      httpPost.mockReset()
      httpPost.mockImplementation(() => new Promise((r) => { release = () => r(REFRESH_OK) }))
      const tabA = newAuth()
      const tabB = newAuth()
      const a = tabA.refreshSession()
      const b = tabB.refreshSession()
      await new Promise((r) => setTimeout(r, 0))
      release()
      const [sa, sb] = await Promise.all([a, b])
      expect(httpPost).toHaveBeenCalledTimes(1)
      expect(httpPost.mock.calls[0][1]).toMatchObject({ refresh_token: 'RT0' })
      expect(sa?.refreshToken).toBe('RT_NEW')
      expect(sb?.refreshToken).toBe('RT_NEW') // B adopted A's result instead of refreshing
    })

    it('the waiting tab times out while the holder is slow → it does NOT replay the token', async () => {
      vi.useFakeTimers()
      vi.stubGlobal('navigator', { locks: sharedLocks() })
      let release!: () => void
      httpPost.mockReset()
      httpPost.mockImplementation(() => new Promise((r) => { release = () => r(REFRESH_OK) }))
      const tabA = newAuth()
      const tabB = newAuth()
      const a = tabA.refreshSession()
      const b = tabB.refreshSession().catch((e) => e)
      await vi.advanceTimersByTimeAsync(5001) // B's lock wait expires; A's POST still in flight
      expect(await b).toMatchObject({ code: 'timeout' })
      expect(httpPost).toHaveBeenCalledTimes(1) // only A's request — no replay from B
      release()
      expect((await a)?.refreshToken).toBe('RT_NEW')
    })
  })

  it('does NOT resend the token if the POST throws AFTER the lock-wait timeout fired (no double-refresh reuse)', async () => {
    // Lock granted immediately → _doRefresh starts. Its POST rejects (network drop)
    // only AFTER the 5s timeout aborted the (now no-op) wait. The abort branch must
    // NOT re-run _doRefresh — that would replay the same, possibly already-rotated,
    // token → backend reuse hard-revoke. The error must propagate; token sent once.
    vi.useFakeTimers()
    const request = vi.fn(async (_n: string, _o: unknown, cb: () => Promise<unknown>) => cb())
    vi.stubGlobal('navigator', { locks: { request } })
    let rejectPost!: (e: unknown) => void
    httpPost.mockReset()
    httpPost.mockImplementation(() => new Promise((_res, rej) => { rejectPost = rej }))
    const auth = newAuth()
    const p = auth.refreshSession()
    await Promise.resolve()                 // let _doRefresh reach the awaited POST
    await vi.advanceTimersByTimeAsync(5001)  // timer fires controller.abort() (lock already held)
    rejectPost(new Error('network lost'))    // POST fails at the network layer, post-abort
    await expect(p).rejects.toBeTruthy()     // error propagates — NOT swallowed + retried
    expect(httpPost).toHaveBeenCalledTimes(1) // the invariant: token sent exactly once
  })
})
