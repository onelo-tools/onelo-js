import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../core/storage', () => ({
  TokenStorage: vi.fn().mockImplementation(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
  })),
  TOKEN_KEYS: {
    ACCESS_TOKEN: 'onelo_access_token',
    REFRESH_TOKEN: 'onelo_refresh_token',
    EXPIRES_AT: 'onelo_expires_at',
    USER_JSON: 'onelo_user',
  },
}))

vi.mock('@onelo/core', async () => {
  const actual = await vi.importActual<typeof import('@onelo/core')>('@onelo/core')
  return {
    ...actual,
    httpGet: vi.fn().mockResolvedValue({ status: 200, json: {
      supabase_url: 'https://x.supabase.co',
      supabase_anon_key: 'anon',
      tenant_id: 'tenant-1',
      allow_custom_branding: false,
    }}),
    httpPost: vi.fn().mockResolvedValue({ status: 204, json: {} }),
  }
})

import { OneloAuth } from './auth'

describe('OneloAuth heartbeat', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('starts heartbeat timer after saveSession and stops on signOut', async () => {
    const auth = new OneloAuth({ apiUrl: 'https://api.example.com', publishableKey: 'pk_test' })
    // @ts-ignore accessing private for test
    const startSpy = vi.spyOn(auth as any, 'startHeartbeat')
    // @ts-ignore
    const stopSpy = vi.spyOn(auth as any, 'stopHeartbeat')

    await auth.importSession({
      accessToken: 'tok',
      refreshToken: 'rtok',
      expiresAt: Math.floor(Date.now() / 1000) + 900,
      user: { id: 'u1', email: 'a@b.com', role: 'member', tenantId: null },
    })

    expect(startSpy).toHaveBeenCalledWith('tok')

    await auth.signOut()
    expect(stopSpy).toHaveBeenCalled()
  })
})
