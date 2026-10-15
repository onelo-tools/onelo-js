// @vitest-environment jsdom
// #619 — a store whose link died hands it back as `onelo:cancel reason:expired`.
// openStore() opens a FRESH store (a second store-initiate) in the same place
// instead of resolving null, and the buyer continues. A plain cancel still
// resolves null.
import { describe, it, expect, vi, afterEach } from 'vitest'

const httpGet = vi.fn()
vi.mock('@onelo/core', async (orig) => ({
  ...(await orig<typeof import('@onelo/core')>()),
  httpGet: (...a: unknown[]) => httpGet(...a),
}))

import { classifyHandBack } from '../../src/core/hand-back'
import { OneloPaywall } from '../../src/paywall/paywall'
import { signOutBeforeRestart } from '../../src/auth/auth'

const HOSTED = 'https://st.onelo.tools'

afterEach(() => {
  httpGet.mockReset()
  document.body.innerHTML = ''
})

function post(data: unknown) {
  window.dispatchEvent(new MessageEvent('message', { origin: HOSTED, data }))
}

const iframeToken = () => {
  const src = Array.from(document.querySelectorAll('iframe')).map((f) => f.src).find((u) => u.includes('/store/hosted'))
  return src ? new URL(src).searchParams.get('token') : null
}

describe('classifyHandBack (#619)', () => {
  it('an expired cancel is its own kind; a plain cancel stays a cancel', () => {
    expect(classifyHandBack({ type: 'onelo:cancel', reason: 'expired' })).toEqual({ kind: 'expired' })
    expect(classifyHandBack({ type: 'onelo:cancel' })).toEqual({ kind: 'cancelled' })
  })
})

describe('signOutBeforeRestart (#619)', () => {
  const GATE = `${HOSTED}/store/hosted?token=srt_x&exit=signout`
  it.each([
    ['invalid_token', GATE, true],
    ['token_expired', GATE, false],
    ['expired_token', GATE, false],
    ['invalid_token', `${HOSTED}/store/hosted?token=srt_x`, false],
  ])('%s on %s → %s', (msg, url, expected) => {
    expect(signOutBeforeRestart(msg, url)).toBe(expected)
  })
})

describe('openStore after the link died (#619)', () => {
  function paywall(session: unknown = { accessToken: 'at' }) {
    return new OneloPaywall('https://api.test', 'pk_test', async () => 'at', async () => {}, async () => session as never)
  }

  it('opens a fresh store in place and continues', async () => {
    httpGet
      .mockResolvedValueOnce({ status: 200, json: { store_url: `${HOSTED}/store/hosted?token=srt_1` } })
      .mockResolvedValueOnce({ status: 200, json: { store_url: `${HOSTED}/store/hosted?token=srt_2` } })
    const session = { accessToken: 'at' }
    const opened = paywall(session).openStore()
    await vi.waitFor(() => expect(iframeToken()).toBe('srt_1'))
    post({ type: 'onelo:cancel', reason: 'expired' })
    await vi.waitFor(() => expect(iframeToken()).toBe('srt_2'))
    expect(httpGet).toHaveBeenCalledTimes(2)
    post({ type: 'onelo:done', reason: 'plan_switched' })
    expect(await opened).toBe(session)
  })

  it('a plain cancel still resolves null with one initiate', async () => {
    httpGet.mockResolvedValue({ status: 200, json: { store_url: `${HOSTED}/store/hosted?token=srt_1` } })
    const opened = paywall().openStore()
    await vi.waitFor(() => expect(iframeToken()).toBe('srt_1'))
    post({ type: 'onelo:cancel' })
    expect(await opened).toBeNull()
    expect(httpGet).toHaveBeenCalledTimes(1)
  })
})
