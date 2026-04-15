import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OneloAuth } from '../../src/auth/auth'
import { OneloError } from '../../src/core/types'

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Mock crypto for PKCE
vi.stubGlobal('crypto', {
  getRandomValues: (arr: Uint8Array) => { arr.fill(1); return arr },
  subtle: {
    digest: vi.fn().mockResolvedValue(new Uint8Array(32).fill(2)),
  },
})

function mockResponse(status: number, body: unknown) {
  return Promise.resolve({
    status,
    json: () => Promise.resolve(body),
  } as Response)
}

const CONFIG_RESPONSE = {
  supabase_url: 'https://test.supabase.co',
  supabase_anon_key: 'anon-key',
  tenant_id: 'tenant-1',
  allow_custom_branding: false,
  app_name: 'TestApp',
  app_logo_url: null,
}

const SESSION_RESPONSE = {
  access_token: 'tok_abc',
  refresh_token: 'ref_xyz',
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: 'user-1', email: 'test@example.com', role: 'member', tenant_id: 'tenant-1', app_metadata: { user_role: 'member', tenant_id: 'tenant-1' } },
}

describe('OneloAuth', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    // Default: config call succeeds
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/sdk/config')) return mockResponse(200, CONFIG_RESPONSE)
      return mockResponse(404, {})
    })
  })

  it('throws if publishableKey missing', () => {
    expect(() => new OneloAuth({ publishableKey: '', apiUrl: 'https://api.onelo.tools' }))
      .toThrow()
  })

  it('resolves whenReady after config fetch', async () => {
    const auth = new OneloAuth({ publishableKey: 'onelo_pk_test', apiUrl: 'https://api.onelo.tools' })
    await auth.whenReady()
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/api/sdk/config'), expect.any(Object))
  })

  it('signIn returns session on success', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/sdk/config')) return mockResponse(200, { ...CONFIG_RESPONSE, allow_custom_branding: true })
      if (url.includes('/api/sdk/auth/signin')) return mockResponse(200, SESSION_RESPONSE)
      return mockResponse(404, {})
    })
    const auth = new OneloAuth({ publishableKey: 'onelo_pk_test', apiUrl: 'https://api.onelo.tools' })
    await auth.whenReady()
    const session = await auth.signIn('test@example.com', 'password')
    expect(session.accessToken).toBe('tok_abc')
    expect(session.user.email).toBe('test@example.com')
  })

  it('signIn throws planRequired when allowCustomBranding is false', async () => {
    const auth = new OneloAuth({ publishableKey: 'onelo_pk_test', apiUrl: 'https://api.onelo.tools' })
    await auth.whenReady()
    // allowCustomBranding is false from CONFIG_RESPONSE
    const err = await auth.signIn('test@example.com', 'password').catch(e => e)
    expect(err).toBeInstanceOf(OneloError)
    expect(err.code).toBe('plan_required')
  })

  it('signOut clears session', async () => {
    const auth = new OneloAuth({ publishableKey: 'onelo_pk_test', apiUrl: 'https://api.onelo.tools' })
    await auth.whenReady()
    await auth.signOut()
    const session = await auth.getSession()
    expect(session).toBeNull()
  })
})
