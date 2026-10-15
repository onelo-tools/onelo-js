// @vitest-environment jsdom
// #670 — an upsell tap by an entitled user goes STRAIGHT to where the backend
// resolves it (/upgrade-initiate → the plan picker), in the same modal the
// portal uses. It used to open the Customer Portal page first and let that page
// ask /portal-upgrade where to go: one whole hosted page (SSR + hydrate) in
// front of the store — about 13 s of "Opening plans…" on staging.
import { describe, it, expect, vi, afterEach } from 'vitest'

const httpGet = vi.fn()
vi.mock('@onelo/core', async (orig) => ({
  ...(await orig<typeof import('@onelo/core')>()),
  httpGet: (...a: unknown[]) => httpGet(...a),
}))

import { OneloCustomerPortal } from '../../src/customer-portal/customer-portal'
import { OneloError } from '@onelo/core'

const STORE = 'https://onelo.test/store/hosted?token=srt_first&callback=web%3A%2F%2Fcallback'
const STORE_FRESH = 'https://onelo.test/store/hosted?token=srt_fresh&callback=web%3A%2F%2Fcallback'
const PORTAL_FRESH = 'https://onelo.test/customer/portal?token=prt_fresh'

afterEach(() => {
  httpGet.mockReset()
  document.body.innerHTML = ''
})

function portal(token: string | null = 'user-jwt') {
  return new OneloCustomerPortal('https://api.test', 'pk_test', async () => token)
}

function upgradeResponse(url = STORE, extra: Record<string, unknown> = {}) {
  return { status: 200, json: { upgrade_url: url, target: 'store_switch', primary_color: '#123456', checkout_bg_color: '#0a0b0c', ...extra } }
}

async function openUpgrade(p = portal()) {
  httpGet.mockResolvedValueOnce(upgradeResponse())
  const done = p.openUpgrade()
  await vi.waitFor(() => expect(document.querySelector('iframe[src]')).not.toBeNull())
  const iframe = document.querySelector('iframe[src]') as HTMLIFrameElement
  const post = vi.fn()
  Object.defineProperty(iframe, 'contentWindow', { configurable: true, value: { postMessage: post } })
  return { p, done, iframe, post }
}

function fromIframe(iframe: HTMLIFrameElement, data: unknown) {
  window.dispatchEvent(new MessageEvent('message', {
    data, origin: 'https://onelo.test', source: iframe.contentWindow as Window,
  }))
}

describe('openUpgrade — no portal page in front of the store', () => {
  it('asks /upgrade-initiate once and loads its answer — never the portal', async () => {
    const { iframe } = await openUpgrade()

    expect(httpGet).toHaveBeenCalledTimes(1)
    const [url, headers] = httpGet.mock.calls[0]
    expect(url).toBe('https://api.test/api/sdk/paywall/upgrade-initiate?key=pk_test&callback_scheme=web')
    // `plan` is advisory on web: the buyer picks in the store (browse mode).
    expect(url).not.toContain('plan=')
    expect(headers.Authorization).toBe('Bearer user-jwt')
    expect(url).not.toContain('portal-initiate')
    expect(iframe.src).toBe(STORE)
  })

  it('paints the app-branded "Opening plans…" screen while the store loads (#601)', async () => {
    await openUpgrade()
    const skeleton = document.querySelector('iframe[srcdoc]') as HTMLIFrameElement
    expect(skeleton.srcdoc).toContain('Opening plans…')
    expect(skeleton.srcdoc).toContain('#123456')
    expect(skeleton.srcdoc).toContain('#0a0b0c')
  })

  it('a plan switch handed back by the store closes the modal and reconciles the plan (#615, #659)', async () => {
    const p = portal()
    const onPlanChange = vi.fn()
    p.setPlanChangeHandler(onPlanChange)
    const { done, iframe } = await openUpgrade(p)

    fromIframe(iframe, { type: 'onelo:done', reason: 'plan_switched' })

    await done
    expect(document.querySelector('iframe[src]')).toBeNull()
    expect(onPlanChange).toHaveBeenCalledWith({ kind: 'switched', reason: 'plan_switched' })
  })

  it("answers the store's portal renewal request, so an in-app checkout keeps renewing (#642)", async () => {
    const { iframe, post } = await openUpgrade()
    httpGet.mockResolvedValueOnce({ status: 200, json: { hosted_url: PORTAL_FRESH } })

    fromIframe(iframe, { type: 'onelo:renew_request', kind: 'portal', request_id: 'r1' })

    await vi.waitFor(() => expect(post).toHaveBeenCalled())
    expect(post).toHaveBeenCalledWith(
      { type: 'onelo:renewed', request_id: 'r1', hosted_url: PORTAL_FRESH }, 'https://onelo.test',
    )
  })

  it('a dead store link reloads a fresh one in the same modal (#619)', async () => {
    const { iframe } = await openUpgrade()
    httpGet.mockResolvedValueOnce(upgradeResponse(STORE_FRESH))

    fromIframe(iframe, { type: 'onelo:cancel', reason: 'expired' })

    await vi.waitFor(() => expect(iframe.src).toBe(STORE_FRESH))
    expect(httpGet).toHaveBeenCalledTimes(2)
    expect(httpGet.mock.calls[1][0]).toContain('/api/sdk/paywall/upgrade-initiate?')
    // Still open: the buyer stays on the plans.
    expect(document.body.contains(iframe)).toBe(true)
  })

  it('closes when the fresh link cannot be had (signed out meanwhile)', async () => {
    const { done, iframe } = await openUpgrade()
    httpGet.mockResolvedValueOnce({ status: 401, json: {} })

    fromIframe(iframe, { type: 'onelo:cancel', reason: 'expired' })

    await done
    expect(document.querySelector('iframe[src]')).toBeNull()
  })

  it('a plain cancel still just closes', async () => {
    const { done, iframe } = await openUpgrade()
    fromIframe(iframe, { type: 'onelo:cancel' })
    await done
    expect(httpGet).toHaveBeenCalledTimes(1)
  })

  it('signed out → not_authenticated, nothing opens', async () => {
    await expect(portal(null).openUpgrade()).rejects.toMatchObject({ code: 'not_authenticated' })
    expect(httpGet).not.toHaveBeenCalled()
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('a refused access token (401) → not_authenticated, nothing opens', async () => {
    httpGet.mockResolvedValueOnce({ status: 401, json: {} })
    await expect(portal().openUpgrade()).rejects.toMatchObject({ code: 'not_authenticated' })
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('a refusal (e.g. 409 in_app_store_not_allowed) throws with its code, nothing opens', async () => {
    httpGet.mockResolvedValueOnce({ status: 409, json: { detail: { error: 'in_app_store_not_allowed', message: 'x' } } })
    const err = await portal().openUpgrade().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(OneloError)
    expect(String((err as Error).message)).toContain('in_app_store_not_allowed')
    expect(document.querySelector('iframe')).toBeNull()
  })
})
