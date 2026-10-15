// @vitest-environment jsdom
// #621 — the hosted manage page's token lives 15 minutes. A page left open past
// that asks the web SDK for a fresh manage URL (kind `manage`). The SDK re-runs
// manage-initiate with the user's access token and answers only the manage
// iframe, at the hosted origin.
import { describe, it, expect, vi, afterEach } from 'vitest'

const httpGet = vi.fn()
vi.mock('@onelo/core', async (orig) => ({
  ...(await orig<typeof import('@onelo/core')>()),
  httpGet: (...a: unknown[]) => httpGet(...a),
}))

import { OneloPaywall } from '../../src/paywall/paywall'

const HOSTED = 'https://onelo.test/manage/hosted?token=a.b.c&lang=pl'
const FRESH = 'https://onelo.test/manage/hosted?token=d.e.f&lang=pl'

afterEach(() => {
  httpGet.mockReset()
  document.body.innerHTML = ''
})

function paywall(token: string | null = 'user-jwt') {
  return new OneloPaywall('https://api.test', 'pk_test', async () => token, async () => {})
}

describe('manageRenewReply', () => {
  it('mints a fresh manage URL with the current access token and the same lang', async () => {
    httpGet.mockResolvedValue({ status: 200, json: { manage_url: FRESH } })
    const reply = await paywall().manageRenewReply('r1', 'pl')
    expect(reply).toEqual({ type: 'onelo:renewed', request_id: 'r1', hosted_url: FRESH })
    const [url, headers] = httpGet.mock.calls[0]
    expect(url).toBe('https://api.test/api/sdk/paywall/manage-initiate?key=pk_test&lang=pl')
    expect(headers.Authorization).toBe('Bearer user-jwt')
  })

  it('signed out → renew_failed not_authenticated, no request', async () => {
    const reply = await paywall(null).manageRenewReply('r2')
    expect(reply).toEqual({ type: 'onelo:renew_failed', request_id: 'r2', reason: 'not_authenticated' })
    expect(httpGet).not.toHaveBeenCalled()
  })

  it('a server failure → renew_failed', async () => {
    httpGet.mockResolvedValue({ status: 500, json: {} })
    expect((await paywall().manageRenewReply('r3')).reason).toBe('renew_failed')
  })
})

describe('the open manage modal answers its iframe', () => {
  async function openModal() {
    httpGet.mockResolvedValueOnce({ status: 200, json: { manage_url: HOSTED } })
    const p = paywall()
    const result = p.openManage('pl')
    await vi.waitFor(() => expect(document.querySelector('iframe[src]')).not.toBeNull())
    const iframe = document.querySelector('iframe[src]') as HTMLIFrameElement
    const post = vi.fn()
    Object.defineProperty(iframe, 'contentWindow', { configurable: true, value: { postMessage: post } })
    return { iframe, post, result }
  }

  it('replies to a renew request from the manage iframe, targeted at its origin', async () => {
    const { iframe, post } = await openModal()
    httpGet.mockResolvedValueOnce({ status: 200, json: { manage_url: FRESH } })
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'onelo:renew_request', kind: 'manage', request_id: 'abc' },
      origin: 'https://onelo.test', source: iframe.contentWindow as Window,
    }))
    await vi.waitFor(() => expect(post).toHaveBeenCalled())
    expect(post).toHaveBeenCalledWith(
      { type: 'onelo:renewed', request_id: 'abc', hosted_url: FRESH }, 'https://onelo.test',
    )
    // The modal stays open: a renewal is not a close signal.
    expect(document.querySelector('iframe[src]')).not.toBeNull()
  })

  it('ignores a request from another origin or another window', async () => {
    const { post } = await openModal()
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'onelo:renew_request', kind: 'manage', request_id: 'abc' },
      origin: 'https://evil.test',
    }))
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'onelo:renew_request', kind: 'manage', request_id: 'abc' },
      origin: 'https://onelo.test', source: window,
    }))
    await new Promise((r) => setTimeout(r, 20))
    expect(post).not.toHaveBeenCalled()
    expect(httpGet).toHaveBeenCalledTimes(1) // only the open()
  })

  it('the expiry screen\'s "Back to app" (onelo:cancel) still closes the modal with null', async () => {
    const { result } = await openModal()
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'onelo:cancel' }, origin: 'https://onelo.test' }))
    await expect(result).resolves.toBeNull()
    expect(document.querySelector('iframe[src]')).toBeNull()
  })
})
