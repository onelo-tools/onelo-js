import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OneloError } from '@onelo/core'
import { OneloAuth } from '../../src/auth/auth'
import { OneloEventStream } from '../../src/core/event-stream'

// Verifies the P0 revocation/signout alignment to Swift:
//   B  — signOut revokes server-side (POST /auth/signout) then clears; fail-open.
//   A2 — heartbeat acts on a 401 from /presence/heartbeat → signs the user out.
//   A1 — getSession arms the heartbeat on restore (page reload), not just sign-in.

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)
vi.stubGlobal('crypto', {
  getRandomValues: (a: Uint8Array) => { a.fill(1); return a },
  subtle: { digest: vi.fn().mockResolvedValue(new Uint8Array(32).fill(2)) },
})

function res(status: number, body: unknown = {}) {
  return Promise.resolve({ status, json: () => Promise.resolve(body) } as Response)
}
const CONFIG = { supabase_url: 'x', supabase_anon_key: 'y', tenant_id: 't', allow_custom_branding: true, app_name: 'A', app_logo_url: null }
// Far-future expiry so getSession never triggers a refresh mid-test.
const SESSION = {
  accessToken: 'tok_abc',
  refreshToken: 'ref_xyz',
  expiresAt: Math.floor(Date.now() / 1000) + 100000,
  user: { id: 'user-1', email: 't@e.com', role: 'member' },
} as never

function newAuth() {
  return new OneloAuth({ publishableKey: 'onelo_pk_test', apiUrl: 'https://api.onelo.tools' })
}

describe('OneloAuth — revocation & signout (P0 security)', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    mockFetch.mockImplementation((url: string) => (url.includes('/api/sdk/config') ? res(200, CONFIG) : res(204)))
  })
  afterEach(() => { vi.useRealTimers() })

  it('B: signOut revokes server-side (Bearer + pk header) then clears locally', async () => {
    const auth = newAuth(); await auth.whenReady()
    await auth.importSession(SESSION)
    mockFetch.mockImplementation((url: string) => (url.includes('/api/sdk/auth/signout') ? res(200, {}) : res(204)))

    await auth.signOut()

    const call = mockFetch.mock.calls.find((c) => String(c[0]).includes('/api/sdk/auth/signout'))
    expect(call, 'POST /api/sdk/auth/signout must be called on sign-out').toBeTruthy()
    const headers = (call![1] as RequestInit).headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer tok_abc')
    expect(headers['X-Publishable-Key']).toBe('onelo_pk_test')
    expect(await auth.getSession()).toBeNull()
  })

  it('B: signOut fails open — still clears locally when the revoke call throws', async () => {
    const auth = newAuth(); await auth.whenReady()
    await auth.importSession(SESSION)
    mockFetch.mockImplementation((url: string) =>
      url.includes('/api/sdk/auth/signout') ? Promise.reject(new Error('network down')) : res(204),
    )

    await expect(auth.signOut()).resolves.toBeUndefined()
    expect(await auth.getSession()).toBeNull()
  })

  it('A2: a 401 from the heartbeat signs the user out and notifies listeners', async () => {
    const auth = newAuth(); await auth.whenReady()
    const seen: Array<unknown> = []
    auth.onAuthStateChange((s) => seen.push(s))

    vi.useFakeTimers()
    await auth.importSession(SESSION) // arms the heartbeat
    mockFetch.mockImplementation((url: string) => (url.includes('/presence/heartbeat') ? res(401, {}) : res(204)))

    await vi.advanceTimersByTimeAsync(13 * 60 * 1000 + 100)

    expect(auth.isUserRevoked).toBe(true)
    expect(await auth.getSession()).toBeNull()
    expect(seen.at(-1)).toBeNull()
  })

  it('A2: a 204 from the heartbeat keeps the session (only 401 logs out)', async () => {
    const auth = newAuth(); await auth.whenReady()
    vi.useFakeTimers()
    await auth.importSession(SESSION)
    mockFetch.mockImplementation((url: string) => (url.includes('/presence/heartbeat') ? res(204) : res(204)))

    await vi.advanceTimersByTimeAsync(13 * 60 * 1000 + 100)

    expect(auth.isUserRevoked).toBe(false)
    expect(await auth.getSession()).not.toBeNull()
    ;(auth as unknown as { stopHeartbeat(): void }).stopHeartbeat()
  })

  it('refresh: sends snake_case refresh_token (backend RefreshRequest contract), never camelCase', async () => {
    const auth = newAuth(); await auth.whenReady()
    await auth.importSession(SESSION) // stores refreshToken 'ref_xyz'
    // Real backend refresh shape: nested `session` + `expires_in` (seconds).
    mockFetch.mockImplementation((url: string) =>
      url.includes('/api/sdk/auth/refresh')
        ? res(200, {
            session: { access_token: 'tok_new', refresh_token: 'ref_new', token_type: 'bearer', expires_in: 900 },
            user: { id: 'user-1', email: 't@e.com', entitlement: null },
          })
        : res(204),
    )

    const session = await auth.refreshSession()

    const call = mockFetch.mock.calls.find((c) => String(c[0]).includes('/api/sdk/auth/refresh'))
    expect(call, 'POST /api/sdk/auth/refresh must be called').toBeTruthy()
    const body = JSON.parse((call![1] as RequestInit).body as string) as Record<string, unknown>
    // Backend RefreshRequest requires snake_case; camelCase → hard 422.
    expect(body.refresh_token).toBe('ref_xyz')
    expect(body.publishableKey).toBe('onelo_pk_test')
    expect(body.refreshToken, 'must NOT send camelCase refreshToken').toBeUndefined()
    // And the nested response is parsed correctly (tokens from `session`,
    // expiresAt computed from expires_in as a future epoch-seconds value).
    expect(session?.accessToken).toBe('tok_new')
    expect(session?.refreshToken).toBe('ref_new')
    expect(session?.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000))
  })

  it('refresh: a 401 session_compromised (detail.error) revokes + throws userRevoked', async () => {
    const auth = newAuth(); await auth.whenReady()
    await auth.importSession(SESSION)
    mockFetch.mockImplementation((url: string) =>
      url.includes('/api/sdk/auth/refresh')
        ? res(401, { detail: { error: 'session_compromised' } })
        : res(204),
    )

    await expect(auth.refreshSession()).rejects.toMatchObject({ code: 'user_revoked' })
    expect(auth.isUserRevoked).toBe(true)
    expect(await auth.getSession()).toBeNull()
  })

  it('refresh: a benign 401 session_expired clears the session and returns null (no throw)', async () => {
    const auth = newAuth(); await auth.whenReady()
    await auth.importSession(SESSION)
    mockFetch.mockImplementation((url: string) =>
      url.includes('/api/sdk/auth/refresh')
        ? res(401, { detail: { error: 'session_expired' } })
        : res(204),
    )

    await expect(auth.refreshSession()).resolves.toBeNull()
    expect(auth.isUserRevoked).toBe(false)
    expect(await auth.getSession()).toBeNull()
  })

  it('A1: getSession arms the heartbeat on restore when none is running', async () => {
    const auth = newAuth(); await auth.whenReady()
    await auth.importSession(SESSION)
    // Simulate a page reload: session sits in storage, but no heartbeat runs yet.
    const priv = auth as unknown as { stopHeartbeat(): void; heartbeatTimer: unknown }
    priv.stopHeartbeat()
    expect(priv.heartbeatTimer).toBeNull()

    const s = await auth.getSession()

    expect(s).not.toBeNull()
    expect(priv.heartbeatTimer, 'heartbeat must be armed on restore').not.toBeNull()
    priv.stopHeartbeat()
  })

  it('A1: getSession on restore re-publishes the session to listeners exactly once', async () => {
    const auth = newAuth(); await auth.whenReady()
    await auth.importSession(SESSION)
    // Simulate a page reload: session in storage, no heartbeat running, and a
    // listener subscribed AFTER restore (as the Onelo bridge is at construction).
    const priv = auth as unknown as { stopHeartbeat(): void }
    priv.stopHeartbeat()
    const seen: Array<{ user: { id: string } } | null> = []
    auth.onAuthStateChange((s) => seen.push(s as never))

    await auth.getSession() // restore
    await auth.getSession() // second read must NOT re-notify (heartbeat now armed)

    expect(seen).toHaveLength(1)
    expect(seen[0]?.user.id).toBe('user-1')
    priv.stopHeartbeat()
  })

  // ── Entitlement / hasActiveAccess (parity with Swift) ──────────────────────
  const stop = (auth: OneloAuth) => (auth as unknown as { stopHeartbeat(): void }).stopHeartbeat()
  const withEntitlement = (e: 'active' | 'none') =>
    ({ ...(SESSION as unknown as Record<string, unknown>), user: { id: 'user-1', email: 't@e.com', role: 'member', entitlement: e } } as never)

  it('entitlement: hasActiveAccess reflects the persisted session (false with no session)', async () => {
    const auth = newAuth(); await auth.whenReady()
    expect(await auth.hasActiveAccess()).toBe(false) // no session

    await auth.importSession(withEntitlement('active'))
    expect(await auth.hasActiveAccess()).toBe(true)

    await auth.importSession(withEntitlement('none'))
    expect(await auth.hasActiveAccess()).toBe(false)
    stop(auth)
  })

  it('revalidateEntitlement: on change → GET /auth/user (Bearer+pk), rebuilds session + notifies', async () => {
    const auth = newAuth(); await auth.whenReady()
    await auth.importSession(withEntitlement('none'))
    const seen: Array<{ user: { entitlement: string } } | null> = []
    auth.onAuthStateChange((s) => seen.push(s as never))
    mockFetch.mockImplementation((url: string) =>
      url.includes('/api/sdk/auth/user')
        ? res(200, { id: 'user-1', email: 't@e.com', entitlement: 'active' })
        : res(204),
    )

    const result = await auth.revalidateEntitlement()

    expect(result).toBe('active')
    expect(await auth.hasActiveAccess()).toBe(true)
    expect(seen.at(-1)?.user.entitlement).toBe('active')
    const call = mockFetch.mock.calls.find((c) => String(c[0]).includes('/api/sdk/auth/user'))
    const headers = (call![1] as RequestInit).headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer tok_abc')
    expect(headers['X-Publishable-Key']).toBe('onelo_pk_test')
    stop(auth)
  })

  it('revalidateEntitlement: best-effort — returns cached value on non-200, never throws', async () => {
    const auth = newAuth(); await auth.whenReady()
    await auth.importSession(withEntitlement('active'))
    mockFetch.mockImplementation((url: string) =>
      url.includes('/api/sdk/auth/user') ? res(500, {}) : res(204),
    )

    await expect(auth.revalidateEntitlement()).resolves.toBe('active')
    expect(await auth.hasActiveAccess()).toBe(true) // unchanged
    stop(auth)
  })

  it('revalidateEntitlement: no session → returns none without a network call', async () => {
    const auth = newAuth(); await auth.whenReady()
    mockFetch.mockReset()
    mockFetch.mockImplementation((url: string) => (url.includes('/api/sdk/config') ? res(200, CONFIG) : res(204)))

    expect(await auth.revalidateEntitlement()).toBe('none')
    expect(mockFetch.mock.calls.some((c) => String(c[0]).includes('/api/sdk/auth/user'))).toBe(false)
  })

  // ── SSE session.revoked — real-time revocation (parity with Swift) ─────────
  class MockES {
    static instances: MockES[] = []
    listeners = new Map<string, Array<(e: MessageEvent) => void>>()
    onerror: (() => void) | null = null
    closed = false
    constructor(public url: string) { MockES.instances.push(this) }
    addEventListener(n: string, fn: (e: MessageEvent) => void) {
      const a = this.listeners.get(n) ?? []; a.push(fn); this.listeners.set(n, a)
    }
    close() { this.closed = true }
    emit(n: string, d: unknown) {
      for (const fn of this.listeners.get(n) ?? []) fn({ data: JSON.stringify(d) } as MessageEvent)
    }
  }
  const flush = () => new Promise((r) => setTimeout(r, 0))
  const setES = () => { (globalThis as unknown as { EventSource: unknown }).EventSource = MockES; MockES.instances = [] }
  const clearES = () => { delete (globalThis as unknown as { EventSource?: unknown }).EventSource }

  it('SSE session.revoked (current user) → clears session, sets isUserRevoked, notifies', async () => {
    setES()
    const auth = newAuth(); await auth.whenReady()
    const stream = new OneloEventStream('https://api.onelo.tools', 'onelo_pk_test')
    auth.attachEventStream(stream)
    await auth.importSession(withEntitlement('active')) // user-1
    const seen: Array<unknown> = []; auth.onAuthStateChange((s) => seen.push(s))
    stream.start('user-1')

    MockES.instances.at(-1)!.emit('session.revoked', { app_user_id: 'user-1', reason: 'refund_lapsed_no_free_tier' })
    await flush()

    expect(auth.isUserRevoked).toBe(true)
    expect(await auth.getSession()).toBeNull()
    expect(seen.at(-1)).toBeNull()
    stream.stop(); clearES()
  })

  it('SSE session.revoked (different buyer) → ignored', async () => {
    setES()
    const auth = newAuth(); await auth.whenReady()
    const stream = new OneloEventStream('https://api.onelo.tools', 'onelo_pk_test')
    auth.attachEventStream(stream)
    await auth.importSession(withEntitlement('active')) // user-1
    stream.start('user-1')

    MockES.instances.at(-1)!.emit('session.revoked', { app_user_id: 'someone-else' })
    await flush()

    expect(auth.isUserRevoked).toBe(false)
    expect(await auth.getSession()).not.toBeNull()
    stop(auth); stream.stop(); clearES()
  })

  it('epoch guard: a signOut during an in-flight refresh does NOT write the session back', async () => {
    const auth = newAuth(); await auth.whenReady()
    await auth.importSession(SESSION)
    // Gate /auth/refresh so we can sign out while it is mid-flight.
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/sdk/auth/refresh')) {
        await gate
        return { status: 200, json: () => Promise.resolve({
          session: { access_token: 'tok_new', refresh_token: 'ref_new', expires_in: 900 },
          user: { id: 'user-1', email: 't@e.com', entitlement: 'none' },
        }) } as Response
      }
      return res(204) // config + /auth/signout
    })

    const refreshP = auth.refreshSession()
    await auth.signOut() // bumps signOutEpoch + clears storage
    release()            // now the refresh resolves 200
    const result = await refreshP

    expect(result).toBeNull()                       // epoch moved → no saveSession
    expect(await auth.getSession()).toBeNull()      // still signed out
  })

  it('refresh no_plan_available → throws noActivePlan (not "suspended"/custom-UI), clears, no isUserRevoked', async () => {
    const auth = newAuth(); await auth.whenReady()
    await auth.importSession(SESSION)
    mockFetch.mockImplementation((url: string) =>
      url.includes('/api/sdk/auth/refresh') ? res(403, { detail: { error_code: 'no_plan_available' } }) : res(204),
    )

    const err = await auth.refreshSession().catch((e) => e)
    expect(err).toBeInstanceOf(OneloError)
    // A lapsed subscription is `no_active_plan` (route to store/upgrade) — NOT
    // `plan_required` (which means "custom UI needs a paid plan / use loadAuthView").
    expect((err as OneloError).code).toBe('no_active_plan')
    expect(auth.isUserRevoked).toBe(false) // no-plan is NOT an account revocation
    expect(await auth.getSession()).toBeNull()
  })

  it('SSE session.revoked with no active session → no-op (no spurious logout)', async () => {
    setES()
    const auth = newAuth(); await auth.whenReady()
    const stream = new OneloEventStream('https://api.onelo.tools', 'onelo_pk_test')
    auth.attachEventStream(stream)
    const seen: Array<unknown> = []; auth.onAuthStateChange((s) => seen.push(s))
    stream.start(null)

    MockES.instances.at(-1)!.emit('session.revoked', { app_user_id: 'user-1' })
    await flush()

    expect(seen).toEqual([])
    expect(auth.isUserRevoked).toBe(false)
    stream.stop(); clearES()
  })
})
