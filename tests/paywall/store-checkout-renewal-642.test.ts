// @vitest-environment jsdom
// #642 review F2 — a store opened by openStore() (not the Customer Portal)
// relays its checkout's `onelo:renew_request` kind `portal`. The store modal
// must answer it with a fresh portal token for the signed-in user, only to its
// own iframe at the hosted origin; otherwise the in-app checkout meets its
// ceiling.
import { describe, it, expect, vi, afterEach } from 'vitest'

const httpGet = vi.fn()
vi.mock('@onelo/core', async (orig) => ({
  ...(await orig<typeof import('@onelo/core')>()),
  httpGet: (...a: unknown[]) => httpGet(...a),
}))

import { OneloPaywall } from '../../src/paywall/paywall'
import { OneloCustomerPortal } from '../../src/customer-portal/customer-portal'

const HOSTED = 'https://st.onelo.test'
const FRESH_PORTAL = `${HOSTED}/customer/portal?token=prt_${'c'.repeat(64)}`

afterEach(() => {
  httpGet.mockReset()
  document.body.innerHTML = ''
})

async function openStoreWithRenewer(token: string | null) {
  const portal = new OneloCustomerPortal('https://api.test', 'pk_test', async () => token)
  const paywall = new OneloPaywall('https://api.test', 'pk_test', async () => token, async () => {})
  paywall.setPortalRenewer((id) => portal.renewReply(id))
  httpGet.mockResolvedValueOnce({ status: 200, json: { store_url: `${HOSTED}/store/hosted?token=srt_1` } })
  void paywall.openStore()
  await vi.waitFor(() => expect(document.querySelector('iframe[src*="/store/hosted"]')).not.toBeNull())
  const iframe = document.querySelector('iframe[src*="/store/hosted"]') as HTMLIFrameElement
  const post = vi.fn()
  Object.defineProperty(iframe, 'contentWindow', { configurable: true, value: { postMessage: post } })
  return { iframe, post }
}

describe('store modal answers a checkout portal renewal (#642)', () => {
  it('signed in: a fresh portal token, to its own iframe at the hosted origin', async () => {
    const { iframe, post } = await openStoreWithRenewer('user-jwt')
    httpGet.mockResolvedValueOnce({ status: 200, json: { hosted_url: FRESH_PORTAL } })
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'onelo:renew_request', kind: 'portal', request_id: 'r1' },
      origin: HOSTED, source: iframe.contentWindow as Window,
    }))
    await vi.waitFor(() => expect(post).toHaveBeenCalled())
    expect(post).toHaveBeenCalledWith({ type: 'onelo:renewed', request_id: 'r1', hosted_url: FRESH_PORTAL }, HOSTED)
    const [url, headers] = httpGet.mock.calls[1]
    expect(url).toContain('/api/sdk/paywall/portal-initiate')
    expect(headers.Authorization).toBe('Bearer user-jwt')
    // A renewal is not a close signal.
    expect(document.querySelector('iframe[src*="/store/hosted"]')).not.toBeNull()
  })

  it('signed out: renew_failed not_authenticated', async () => {
    const { iframe, post } = await openStoreWithRenewer(null)
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'onelo:renew_request', kind: 'portal', request_id: 'r2' },
      origin: HOSTED, source: iframe.contentWindow as Window,
    }))
    await vi.waitFor(() => expect(post).toHaveBeenCalled())
    expect(post.mock.calls[0][0]).toEqual({ type: 'onelo:renew_failed', request_id: 'r2', reason: 'not_authenticated' })
  })

  it('ignores another window or origin', async () => {
    const { iframe, post } = await openStoreWithRenewer('user-jwt')
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'onelo:renew_request', kind: 'portal', request_id: 'x' }, origin: 'https://evil.test', source: iframe.contentWindow as Window,
    }))
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'onelo:renew_request', kind: 'portal', request_id: 'y' }, origin: HOSTED, source: window,
    }))
    await new Promise((r) => setTimeout(r, 20))
    expect(post).not.toHaveBeenCalled()
    expect(httpGet).toHaveBeenCalledTimes(1) // only store-initiate
  })
})

describe('Onelo wires the portal renewer into the store and auth modals', () => {
  it('both answer through the customer portal', async () => {
    const { Onelo } = await import('../../src/onelo')
    const onelo = new Onelo({ publishableKey: 'onelo_pk_test_x', apiUrl: 'https://api.onelo.tools' })
    const spy = vi.spyOn(onelo.customerPortal, 'renewReply').mockResolvedValue({ type: 'onelo:renewed', request_id: 'z', hosted_url: 'u' })
    const viaPaywall = (onelo.paywall as unknown as { renewPortal: (id: string) => Promise<unknown> }).renewPortal
    const viaAuth = (onelo.auth as unknown as { renewPortal: (id: string) => Promise<unknown> }).renewPortal
    await viaPaywall('z')
    await viaAuth('z')
    expect(spy).toHaveBeenCalledTimes(2)
  })
})
