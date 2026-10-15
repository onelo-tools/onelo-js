import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #819 — Email Verification in the web SDK: the server's answer gates a free
 * app, a refresh after verifying lets the user in, and the two calls an App
 * with its own screen uses.
 */
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function mockResponse(status: number, body: unknown) {
  return Promise.resolve({ status, ok: status < 400, json: () => Promise.resolve(body) } as Response)
}

const CONFIG = {
  supabase_url: 'https://x.supabase.co', supabase_anon_key: 'anon', tenant_id: 't1', app_name: 'App',
  paywall_enabled: false,
}

const unverified = () => ({
  accessToken: 'tok_abc',
  refreshToken: 'ref_xyz',
  expiresAt: Math.floor(Date.now() / 1000) + 100000,
  user: {
    id: 'u1', email: 'a@b.c', role: 'member', entitlement: 'none',
    allowedIn: false, emailVerified: false, accessReason: 'email_unverified',
  },
}) as never

let userBody: Record<string, unknown> = {}
const posts: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, string> }> = []
let postReply: { status: number; body: unknown } = { status: 200, body: {} }

async function build() {
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    const u = String(url)
    if (u.includes('/api/sdk/config')) return mockResponse(200, CONFIG)
    if (u.includes('/api/sdk/auth/user')) return mockResponse(200, userBody)
    if (init?.method === 'POST') {
      posts.push({ url: u, body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> })
      return mockResponse(postReply.status, postReply.body)
    }
    return mockResponse(404, {})
  })
  const { OneloAuth } = await import('../../src/auth/auth')
  const auth = new OneloAuth({ publishableKey: 'onelo_pk_test', apiUrl: 'https://api.onelo.tools' })
  await auth.whenReady()
  return auth
}

beforeEach(() => {
  mockFetch.mockReset()
  posts.length = 0
  userBody = {}
  postReply = { status: 200, body: {} }
})

describe('Email Verification (#819)', () => {
  it('keeps an unverified user out of a FREE app — the server said no', async () => {
    const auth = await build()
    await auth.importSession(unverified())
    expect(await auth.isAllowedIn()).toBe(false)
    expect((await auth.getSession())?.user.accessReason).toBe('email_unverified')
  })

  it('lets them in once a refresh reports the address verified', async () => {
    const auth = await build()
    await auth.importSession(unverified())
    userBody = { entitlement: 'none', allowed_in: true, email_verified: true }
    await auth.revalidateEntitlement()
    expect(await auth.isAllowedIn()).toBe(true)
    const user = (await auth.getSession())?.user
    expect(user?.emailVerified).toBe(true)
    expect(user?.accessReason).toBeUndefined()
  })

  it('resends as the signed-in user, with an own landing when given', async () => {
    const auth = await build()
    await auth.importSession(unverified())
    postReply = { status: 200, body: { sent: true, email_verified: false } }
    await expect(auth.resendVerificationEmail({ redirectTo: 'https://app.test/verified' }))
      .resolves.toEqual({ sent: true, emailVerified: false })
    const call = posts.at(-1)!
    expect(call.url).toBe('https://api.onelo.tools/api/sdk/auth/verify-email/resend')
    expect(call.body).toEqual({ publishableKey: 'onelo_pk_test', verify_redirect_to: 'https://app.test/verified' })
    expect(call.headers.Authorization).toBe('Bearer tok_abc')
  })

  it('maps the hourly limit', async () => {
    const auth = await build()
    await auth.importSession(unverified())
    postReply = { status: 429, body: { detail: { error: 'verification_rate_limited' } } }
    await expect(auth.resendVerificationEmail()).rejects.toMatchObject({ code: 'verification_rate_limited' })
  })

  it('confirms the token and refreshes the session — never the 30 s-cached /user', async () => {
    const auth = await build()
    await auth.importSession(unverified())
    // /user keeps answering "no" (its per-token cache); /refresh answers fresh.
    userBody = { entitlement: 'none', allowed_in: false, email_verified: false, access_reason: 'email_unverified' }
    const replies: Record<string, { status: number; body: unknown }> = {
      'verify-email/confirm': { status: 200, body: { email_verified: true } },
      'auth/refresh': { status: 200, body: {
        session: { access_token: 'tok_new', refresh_token: 'ref_new', expires_in: 900 },
        user: { id: 'u1', email: 'a@b.c', entitlement: 'none', allowed_in: true, email_verified: true },
      } },
    }
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url)
      if (u.includes('/api/sdk/config')) return mockResponse(200, CONFIG)
      if (u.includes('/api/sdk/auth/user')) return mockResponse(200, userBody)
      if (init?.method === 'POST') {
        posts.push({ url: u, body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> })
        const key = Object.keys(replies).find((k) => u.endsWith(k))
        return key ? mockResponse(replies[key].status, replies[key].body) : mockResponse(404, {})
      }
      return mockResponse(404, {})
    })
    await auth.confirmEmail('tok_123')
    expect(posts.map((p) => p.url)).toEqual([
      'https://api.onelo.tools/api/sdk/auth/verify-email/confirm',
      'https://api.onelo.tools/api/sdk/auth/refresh',
    ])
    expect(posts[0].body).toEqual({ publishableKey: 'onelo_pk_test', token: 'tok_123' })
    expect(await auth.isAllowedIn()).toBe(true)
    expect((await auth.getSession())?.user.emailVerified).toBe(true)
  })

  it('names a used or expired link', async () => {
    const auth = await build()
    postReply = { status: 400, body: { detail: { error: 'invalid_token' } } }
    await expect(auth.confirmEmail('old')).rejects.toMatchObject({ code: 'invalid_verification_token' })
  })

  it('resend needs a signed-in user', async () => {
    const auth = await build()
    await expect(auth.resendVerificationEmail()).rejects.toMatchObject({ code: 'not_authenticated' })
  })
})
