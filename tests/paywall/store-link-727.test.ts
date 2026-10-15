// @vitest-environment jsdom
// #727 — openStore() pairs store magic links to a verifier kept on THIS page:
// store-initiate gets its challenge, only alongside the page to return to.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

const httpGet = vi.fn()
vi.mock('@onelo/core', async (orig) => ({
  ...(await orig<typeof import('@onelo/core')>()),
  httpGet: (...a: unknown[]) => httpGet(...a),
}))

import { OneloPaywall } from '../../src/paywall/paywall'

const HOSTED = 'https://st.onelo.tools'
const CHALLENGE = 'c'.repeat(43)

beforeEach(() => {
  window.history.replaceState({}, '', '/pricing?plan=pro')
  httpGet.mockResolvedValue({ status: 200, json: { store_url: `${HOSTED}/store/hosted?token=srt_1` } })
})

afterEach(() => {
  httpGet.mockReset()
  document.body.innerHTML = ''
})

function paywall(challenge: () => Promise<string | null>) {
  return new OneloPaywall('https://api.test', 'pk_test', async () => 'at', async () => {}, async () => null as never, challenge)
}

async function initiateUrl(p: OneloPaywall): Promise<URL> {
  void p.openStore()
  await vi.waitFor(() => expect(httpGet).toHaveBeenCalled())
  return new URL(httpGet.mock.calls[0][0] as string)
}

describe('store-initiate code_challenge (#727)', () => {
  it('sends the challenge with the return page', async () => {
    const url = await initiateUrl(paywall(async () => CHALLENGE))
    expect(url.searchParams.get('return_url')).toBe(`${window.location.origin}/pricing?plan=pro`)
    expect(url.searchParams.get('code_challenge')).toBe(CHALLENGE)
  })

  it('sends none when no verifier could be kept', async () => {
    const url = await initiateUrl(paywall(async () => null))
    expect(url.searchParams.has('code_challenge')).toBe(false)
  })

  it('a failing challenge never blocks the store', async () => {
    const url = await initiateUrl(paywall(async () => { throw new Error('crypto unavailable') }))
    expect(url.searchParams.has('code_challenge')).toBe(false)
    expect(url.pathname).toBe('/api/sdk/paywall/store-initiate')
  })
})
