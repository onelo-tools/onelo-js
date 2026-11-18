// @vitest-environment jsdom
// #1039 — every SDK sends the device (here: browser) language when it opens a
// hosted page and the App passes none; a language the App passes is sent
// unchanged. The backend picks the Page Language within the App Languages
// (#1036); the SDK never chooses. Same scenarios in every SDK.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

const httpGet = vi.fn()
vi.mock('@onelo/core', async (orig) => ({
  ...(await orig<typeof import('@onelo/core')>()),
  httpGet: (...a: unknown[]) => httpGet(...a),
}))
vi.mock('./auth/auth-modal', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./auth/auth-modal')>()),
  AuthModal: class {
    static discardParkedPopup = vi.fn()
    open = vi.fn(async () => ({ type: 'cancelled' }))
  },
}))

import { OneloPaywall } from './paywall/paywall'
import { OneloCustomerPortal } from './customer-portal/customer-portal'
import { OneloAuth } from './auth/auth'

const API = 'https://api.test'
const KEY = 'pk_test'

function langOf(call: unknown[]): string | null {
  return new URL(call[0] as string).searchParams.get('lang')
}

function callTo(path: string): unknown[] {
  const call = httpGet.mock.calls.find((c) => new URL(c[0] as string).pathname === path)
  if (!call) throw new Error(`no request to ${path}`)
  return call
}

beforeEach(() => {
  vi.stubGlobal('navigator', { ...globalThis.navigator, language: 'de-DE' })
})

afterEach(() => {
  vi.unstubAllGlobals()
  httpGet.mockReset()
  document.body.innerHTML = ''
  window.sessionStorage.clear()
})

function paywall() {
  return new OneloPaywall(API, KEY, async () => 'user-jwt', async () => {})
}

describe('Store (store-initiate)', () => {
  beforeEach(() => {
    httpGet.mockResolvedValue({ status: 200, json: { store_url: 'https://st.test/store/hosted?token=srt_1' } })
  })

  it('sends the browser language when the App passes none', async () => {
    await paywall().openStore()
    expect(langOf(callTo('/api/sdk/paywall/store-initiate'))).toBe('de-DE')
  })

  it('sends the language the App passes unchanged', async () => {
    await paywall().openStore('pt-BR')
    expect(langOf(callTo('/api/sdk/paywall/store-initiate'))).toBe('pt-BR')
  })
})

describe('Manage (manage-initiate)', () => {
  beforeEach(() => {
    httpGet.mockResolvedValue({ status: 200, json: { manage_url: 'https://st.test/manage/hosted?token=m' } })
  })

  it('sends the browser language when the App passes none', async () => {
    await paywall().manageRenewReply('r1')
    expect(langOf(callTo('/api/sdk/paywall/manage-initiate'))).toBe('de-DE')
  })

  it('sends the language the App passes unchanged', async () => {
    await paywall().manageRenewReply('r1', 'pl')
    expect(langOf(callTo('/api/sdk/paywall/manage-initiate'))).toBe('pl')
  })
})

describe('Upgrade (upgrade-initiate)', () => {
  it('sends the browser language', async () => {
    // A refusal ends the call right after the request — nothing is opened.
    httpGet.mockResolvedValue({ status: 404, json: { detail: 'plan_not_purchasable' } })
    const portal = new OneloCustomerPortal(API, KEY, async () => 'user-jwt')
    await portal.openUpgrade().catch(() => {})
    expect(langOf(callTo('/api/sdk/paywall/upgrade-initiate'))).toBe('de-DE')
  })
})

describe('Sign-in (flow/init)', () => {
  it('sends the browser language', async () => {
    httpGet.mockResolvedValue({ status: 200, json: { action: 'authorized' } })
    const auth = new OneloAuth({ apiUrl: API, publishableKey: KEY })
    await (auth as unknown as { resolveFlow(t: string | null): Promise<unknown> }).resolveFlow(null)
    expect(langOf(callTo('/api/sdk/flow/init'))).toBe('de-DE')
  })
})
