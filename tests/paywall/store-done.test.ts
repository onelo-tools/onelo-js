// @vitest-environment jsdom
// #599 — the hosted store's code-less hand-back (`onelo:done`) after a month↔year
// switch or a scheduled downgrade closes every web container as a SUCCESS:
// the store modal resolves the current session (not null = cancel) and the
// Customer Portal modal closes.
import { describe, it, expect, vi, afterEach } from 'vitest'

const httpGet = vi.fn()
vi.mock('@onelo/core', async (orig) => ({
  ...(await orig<typeof import('@onelo/core')>()),
  httpGet: (...a: unknown[]) => httpGet(...a),
}))

import { AuthModal } from '../../src/auth/auth-modal'
import { OneloPaywall } from '../../src/paywall/paywall'
import { OneloCustomerPortal } from '../../src/customer-portal/customer-portal'

const HOSTED = 'https://st.onelo.tools'

afterEach(() => {
  httpGet.mockReset()
  document.body.innerHTML = ''
})

function post(data: unknown, source?: MessageEventSource | null) {
  window.dispatchEvent(new MessageEvent('message', { origin: HOSTED, data, source: source ?? null }))
}

describe('onelo:done (#599)', () => {
  it('AuthModal settles with a done result, not cancelled', async () => {
    const result = new AuthModal().open(`${HOSTED}/store/hosted?token=srt_x`, 'embedded')
    post({ type: 'onelo:done', reason: 'plan_switched' })
    expect(await result).toEqual({ type: 'done', reason: 'plan_switched' })
    expect(document.querySelector('[data-onelo-cancel]')).toBeNull()
  })

  it('openStore resolves the current session on done', async () => {
    httpGet.mockResolvedValue({ status: 200, json: { store_url: `${HOSTED}/store/hosted?token=srt_x` } })
    const session = { accessToken: 'at', refreshToken: 'rt' } as never
    const paywall = new OneloPaywall('https://api.test', 'pk_test', async () => 'at', async () => {}, async () => session)
    const opened = paywall.openStore()
    await vi.waitFor(() => expect(document.querySelector('iframe')).not.toBeNull())
    post({ type: 'onelo:done', reason: 'switch_scheduled' })
    expect(await opened).toBe(session)
  })

  it('#615 a paid switch still catching up (plan_switch_pending) resolves openStore as success', async () => {
    httpGet.mockResolvedValue({ status: 200, json: { store_url: `${HOSTED}/store/hosted?token=srt_x` } })
    const session = { accessToken: 'at', refreshToken: 'rt' } as never
    const paywall = new OneloPaywall('https://api.test', 'pk_test', async () => 'at', async () => {}, async () => session)
    const opened = paywall.openStore()
    await vi.waitFor(() => expect(document.querySelector('iframe')).not.toBeNull())
    post({ type: 'onelo:done', reason: 'plan_switch_pending' })
    expect(await opened).toBe(session)
  })

  it('the Customer Portal modal closes on done', async () => {
    httpGet.mockResolvedValue({ status: 200, json: { hosted_url: `${HOSTED}/customer/portal?token=prt_x` } })
    const opened = new OneloCustomerPortal('https://api.test', 'pk_test', async () => 'tok').open()
    await vi.waitFor(() => expect(document.querySelector('iframe:not([aria-hidden="true"])')).not.toBeNull())
    const frame = document.querySelector('iframe:not([aria-hidden="true"])') as HTMLIFrameElement
    post({ type: 'onelo:done', reason: 'plan_switched' }, frame.contentWindow)
    await expect(opened).resolves.toBeUndefined()
    expect(document.querySelector('iframe')).toBeNull()
  })
})
