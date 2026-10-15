import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #818 — an App's own sign-up screen asks for Marketing Consent with the text
 * /api/sdk/config hands over, and signUp sends the choice only when ticked.
 */
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function mockResponse(status: number, body: unknown) {
  return Promise.resolve({ status, ok: status < 400, json: () => Promise.resolve(body) } as Response)
}

const QUESTION = { asked: true, text: 'Updates from Turingo.', language: 'pl' }
let config: Record<string, unknown> = {}
const configUrls: string[] = []
const posts: Array<{ url: string; body: Record<string, unknown> }> = []

const SESSION = {
  access_token: 'acc', refresh_token: 'ref', expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: 'u1', email: 'a@b.c' },
}

async function build() {
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    const u = String(url)
    if (u.includes('/api/sdk/config')) {
      configUrls.push(u)
      return mockResponse(200, config)
    }
    if (init?.method === 'POST') {
      posts.push({ url: u, body: JSON.parse(String(init.body)) })
      return mockResponse(200, SESSION)
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
  configUrls.length = 0
  posts.length = 0
  config = {
    supabase_url: 'https://x.supabase.co', supabase_anon_key: 'anon', tenant_id: 't1', app_name: 'App',
    paywall_enabled: false, allow_custom_branding: true, signup_marketing_consent: QUESTION,
  }
})

describe('Marketing Consent at sign-up (#818)', () => {
  it('asks /config in the browser language and exposes the question', async () => {
    const auth = await build()
    expect(configUrls[0]).toMatch(/[?&]lang=/)
    expect(auth.getSignupMarketingConsent()).toEqual(QUESTION)
  })

  it('reads an older backend without the field as not asked', async () => {
    delete config.signup_marketing_consent
    const auth = await build()
    expect(auth.getSignupMarketingConsent()).toEqual({ asked: false, text: null, language: null })
  })

  it('sends the ticked consent in the language of the text shown', async () => {
    const auth = await build()
    await auth.signUp('a@b.c', 'Passw0rd!x', { marketingConsent: true })
    const signup = posts.find((p) => p.url.endsWith('/api/sdk/auth/signup'))!
    expect(signup.body).toMatchObject({ marketing_consent: true, lang: 'pl' })
  })

  it('sends nothing about marketing when it was not ticked', async () => {
    const auth = await build()
    await auth.signUp('a@b.c', 'Passw0rd!x')
    const signup = posts.find((p) => p.url.endsWith('/api/sdk/auth/signup'))!
    expect(signup.body).not.toHaveProperty('marketing_consent')
    expect(signup.body).not.toHaveProperty('lang')
  })
})
