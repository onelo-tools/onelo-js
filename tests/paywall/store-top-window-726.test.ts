// @vitest-environment jsdom
// #726 — the embedded store signs in and pays in the APP'S window. The SDK
// (1) lets its store iframe navigate the top window on a click, (2) tells
// store-initiate which page to return to, and (3) on return exchanges
// `onelo_store_code` as the app itself (not a magic-link messenger tab).
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

const httpGet = vi.fn()
const httpPost = vi.fn()
vi.mock('@onelo/core', async (orig) => ({
  ...(await orig<typeof import('@onelo/core')>()),
  httpGet: (...a: unknown[]) => httpGet(...a),
  httpPost: (...a: unknown[]) => httpPost(...a),
}))

import { OneloPaywall, storeReturnUrl } from '../../src/paywall/paywall'
import { OneloAuth } from '../../src/auth/auth'

const HOSTED = 'https://st.onelo.tools'

beforeEach(() => {
  window.history.replaceState({}, '', '/pricing?plan=pro&onelo_code=x#top')
})

afterEach(() => {
  httpGet.mockReset()
  httpPost.mockReset()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

function paywall() {
  return new OneloPaywall('https://api.test', 'pk_test', async () => 'at', async () => {}, async () => null as never)
}

describe('store iframe (#726)', () => {
  it('may navigate the top window only on a click inside it', async () => {
    httpGet.mockResolvedValue({ status: 200, json: { store_url: `${HOSTED}/store/hosted?token=srt_1` } })
    void paywall().openStore()
    await vi.waitFor(() => expect(document.querySelector('iframe[src*="/store/hosted"]')).not.toBeNull())
    const sandbox = document.querySelector('iframe[src*="/store/hosted"]')!.getAttribute('sandbox')!.split(' ')
    expect(sandbox).toContain('allow-top-navigation-by-user-activation')
    // Never the unconditional flag: the frame must not move the page on its own.
    expect(sandbox).not.toContain('allow-top-navigation')
  })

  it('sends this page, without Onelo one-time params or fragment, as return_url', async () => {
    httpGet.mockResolvedValue({ status: 200, json: { store_url: `${HOSTED}/store/hosted?token=srt_1` } })
    void paywall().openStore()
    await vi.waitFor(() => expect(httpGet).toHaveBeenCalled())
    const url = new URL(httpGet.mock.calls[0][0] as string)
    expect(url.pathname).toBe('/api/sdk/paywall/store-initiate')
    expect(url.searchParams.get('return_url')).toBe(`${window.location.origin}/pricing?plan=pro`)
  })

  it('storeReturnUrl ignores non-web pages', () => {
    expect(storeReturnUrl()).toBe(`${window.location.origin}/pricing?plan=pro`)
  })
})

describe('return from a top-level store (#726)', () => {
  it('exchanges onelo_store_code, signs in, reports the purchase and strips the code', async () => {
    window.history.replaceState({}, '', '/pricing?plan=pro&onelo_store_code=oac_9')
    vi.stubGlobal('fetch', vi.fn(async () => ({
      status: 200, ok: true,
      json: async () => ({ supabase_url: 'https://x.supabase.co', supabase_anon_key: 'anon', tenant_id: 't1' }),
    })) as unknown as typeof fetch)
    httpGet.mockResolvedValue({ status: 200, json: { supabase_url: 'https://x.supabase.co', supabase_anon_key: 'anon', tenant_id: 't1' } })
    httpPost.mockResolvedValue({
      status: 200,
      json: { access_token: 'at', refresh_token: 'rt', expires_in: 86400, user: { id: 'u1', email: 'a@b.test' } },
    })
    const auth = new OneloAuth({ apiUrl: 'https://api.test', publishableKey: 'pk_test' })
    const onPlanChange = vi.fn()
    auth.setPlanChangeHandler(onPlanChange)

    // init() runs the exchange itself, like the magic-link return.
    await auth.whenReady()
    await vi.waitFor(() => expect(onPlanChange).toHaveBeenCalled())

    const exchange = httpPost.mock.calls.find((c) => String(c[0]).endsWith('/api/sdk/auth/hosted-callback'))!
    expect(exchange[1]).toMatchObject({ publishableKey: 'pk_test', code: 'oac_9' })
    expect(window.location.search).toBe('?plan=pro')
    expect(onPlanChange).toHaveBeenCalledWith({ kind: 'purchase' })
    // The app keeps running: no magic-link farewell over it.
    expect(document.body.textContent ?? '').not.toMatch(/close this tab/i)
  })
})
