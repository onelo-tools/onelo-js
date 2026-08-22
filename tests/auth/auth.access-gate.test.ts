import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The Access Gate as the JS SDK sees it.
 *
 * From the tester's report, 2026-08-18: the backend has always returned
 * `in_app_store_allowed` on /api/sdk/config and this SDK dropped it, so neither
 * the SDK nor the host app could tell "Sign in only" from "Show the store".
 * `openUpgrade()` therefore opened the store for every plan-less user — and
 * that is the exact call our own snippet wires to `feature.upgradeCta`.
 */
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function mockResponse(status: number, body: unknown) {
  return Promise.resolve({ status, ok: status < 400, json: () => Promise.resolve(body) } as Response)
}

const CONFIG = (extra: Record<string, unknown>) => ({
  supabase_url: 'https://x.supabase.co',
  supabase_anon_key: 'anon',
  tenant_id: 't1',
  app_name: 'App',
  paywall_enabled: true,
  ...extra,
})

async function build(extra: Record<string, unknown>) {
  mockFetch.mockImplementation((url: string) => {
    if (String(url).includes('/api/sdk/config')) return mockResponse(200, CONFIG(extra))
    return mockResponse(404, {})
  })
  const { OneloAuth } = await import('../../src/auth/auth')
  const auth = new OneloAuth({ publishableKey: 'onelo_pk_test', apiUrl: 'https://api.onelo.tools' })
  await auth.whenReady()
  return auth
}

beforeEach(() => mockFetch.mockReset())

describe('isStoreAvailable', () => {
  it('is false under "Sign in only"', async () => {
    const auth = await build({ in_app_store_allowed: false })
    expect(auth.isStoreAvailable()).toBe(false)
  })

  it('is true under "Show the store"', async () => {
    const auth = await build({ in_app_store_allowed: true })
    expect(auth.isStoreAvailable()).toBe(true)
  })

  it('defaults to TRUE when the backend omits the field', async () => {
    // An older backend must not have its store hidden by a newer SDK.
    const auth = await build({})
    expect(auth.isStoreAvailable()).toBe(true)
  })
})

describe('lastPresentedSurface', () => {
  it('starts null — nothing has been presented yet', async () => {
    const auth = await build({})
    expect(auth.lastPresentedSurface).toBeNull()
  })
})

describe('sendMagicLink reads the response BODY', () => {
  it('throws when a 200 carries success:false', async () => {
    // Until 2026-08-18 only the status was read, so a refusal the backend
    // spelled out reached the developer as silence — their UI said "check your
    // inbox" for a mail that was never sent.
    mockFetch.mockImplementation((url: string) => {
      if (String(url).includes('/api/sdk/config')) {
        return mockResponse(200, CONFIG({ allow_custom_branding: true }))
      }
      if (String(url).includes('/auth/magic-link')) {
        return mockResponse(200, { success: false, error: 'magic_link_disabled' })
      }
      return mockResponse(404, {})
    })
    const { OneloAuth } = await import('../../src/auth/auth')
    const auth = new OneloAuth({ publishableKey: 'onelo_pk_test', apiUrl: 'https://api.onelo.tools' })
    await auth.whenReady()
    await expect(auth.sendMagicLink('ada@example.com')).rejects.toThrow(/magic_link_disabled/)
  })

  it('an empty 200 body is still success — older backends must keep working', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (String(url).includes('/api/sdk/config')) {
        return mockResponse(200, CONFIG({ allow_custom_branding: true }))
      }
      if (String(url).includes('/auth/magic-link')) return mockResponse(200, {})
      return mockResponse(404, {})
    })
    const { OneloAuth } = await import('../../src/auth/auth')
    const auth = new OneloAuth({ publishableKey: 'onelo_pk_test', apiUrl: 'https://api.onelo.tools' })
    await auth.whenReady()
    await expect(auth.sendMagicLink('ada@example.com')).resolves.toBeUndefined()
  })
})
