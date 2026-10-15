// @vitest-environment jsdom
// #613 / #614 — the hosted portal asks the web SDK for a fresh portal token when
// an action meets a dead one. The SDK re-mints with the user's access token and
// answers only the portal iframe, at the portal's origin.
import { describe, it, expect, vi, afterEach } from 'vitest'

const httpGet = vi.fn()
vi.mock('@onelo/core', async (orig) => ({
  ...(await orig<typeof import('@onelo/core')>()),
  httpGet: (...a: unknown[]) => httpGet(...a),
}))

import { OneloCustomerPortal } from '../../src/customer-portal/customer-portal'

const HOSTED = 'https://onelo.test/customer/portal?token=prt_first'
const FRESH = 'https://onelo.test/customer/portal?token=prt_fresh'

afterEach(() => {
  httpGet.mockReset()
  document.body.innerHTML = ''
})

function portal(token: string | null = 'user-jwt') {
  return new OneloCustomerPortal('https://api.test', 'pk_test', async () => token)
}

describe('renewReply', () => {
  it('mints a fresh portal with the current access token', async () => {
    httpGet.mockResolvedValue({ status: 200, json: { hosted_url: FRESH } })
    const reply = await portal().renewReply('r1')
    expect(reply).toEqual({ type: 'onelo:renewed', request_id: 'r1', hosted_url: FRESH })
    const [url, headers] = httpGet.mock.calls[0]
    expect(url).toContain('/api/sdk/paywall/portal-initiate?key=pk_test&callback_scheme=web')
    expect(headers.Authorization).toBe('Bearer user-jwt')
  })

  it('signed out → renew_failed not_authenticated, no request', async () => {
    const reply = await portal(null).renewReply('r2')
    expect(reply).toEqual({ type: 'onelo:renew_failed', request_id: 'r2', reason: 'not_authenticated' })
    expect(httpGet).not.toHaveBeenCalled()
  })

  it('an access token the server refuses (401) → not_authenticated', async () => {
    httpGet.mockResolvedValue({ status: 401, json: {} })
    expect((await portal().renewReply('r3')).reason).toBe('not_authenticated')
  })

  it('a server failure → renew_failed', async () => {
    httpGet.mockResolvedValue({ status: 500, json: {} })
    expect((await portal().renewReply('r4')).reason).toBe('renew_failed')
  })
})

describe('the open modal answers the portal iframe', () => {
  async function openModal() {
    httpGet.mockResolvedValueOnce({ status: 200, json: { hosted_url: HOSTED } })
    const p = portal()
    void p.open()
    await vi.waitFor(() => expect(document.querySelector('iframe[src]')).not.toBeNull())
    const iframe = document.querySelector('iframe[src]') as HTMLIFrameElement
    const post = vi.fn()
    Object.defineProperty(iframe, 'contentWindow', { configurable: true, value: { postMessage: post } })
    return { iframe, post }
  }

  it('replies to a renew request from the portal, targeted at its origin', async () => {
    const { iframe, post } = await openModal()
    httpGet.mockResolvedValueOnce({ status: 200, json: { hosted_url: FRESH } })
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'onelo:renew_request', kind: 'portal', request_id: 'abc' },
      origin: 'https://onelo.test', source: iframe.contentWindow as Window,
    }))
    await vi.waitFor(() => expect(post).toHaveBeenCalled())
    expect(post).toHaveBeenCalledWith(
      { type: 'onelo:renewed', request_id: 'abc', hosted_url: FRESH }, 'https://onelo.test',
    )
  })

  it('ignores a request from another origin', async () => {
    const { iframe, post } = await openModal()
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'onelo:renew_request', kind: 'portal', request_id: 'abc' },
      origin: 'https://evil.test', source: iframe.contentWindow as Window,
    }))
    await new Promise((r) => setTimeout(r, 20))
    expect(post).not.toHaveBeenCalled()
    expect(httpGet).toHaveBeenCalledTimes(1) // only the open()
  })
})
