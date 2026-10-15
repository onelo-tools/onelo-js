// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../auth/auth-modal', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth/auth-modal')>()),
  AuthModal: class {
    static discardParkedPopup = vi.fn()
    open = vi.fn(async () => ({ type: 'cancelled' }))
  },
}))

import { OneloPaywall } from './paywall'
import { recallStoreReturnLook } from '../core/store-return-look'

const KEY = 'onelo_pk_live_x'

beforeEach(() => {
  window.sessionStorage.clear()
  window.history.replaceState({}, '', '/app')
  vi.stubGlobal('fetch', vi.fn(async () => ({
    status: 200, ok: true,
    json: async () => ({ store_url: 'https://st.onelo.tools/store/hosted?token=srt_1', primary_color: '#0055ff', checkout_bg_color: '#f5f5f4' }),
  })) as unknown as typeof fetch)
})

afterEach(() => { vi.unstubAllGlobals() })

describe('openStore remembers the look of the return (#728)', () => {
  it('keeps the Branding of the store-initiate answer and the store language for this tab', async () => {
    const paywall = new OneloPaywall('https://backend.test', KEY, async () => null, async () => {})
    await paywall.openStore('pl')
    const look = recallStoreReturnLook(KEY)
    expect(look?.lang).toBe('pl')
    expect(look?.tokens.brand).toBe('#0055ff')
    expect(look?.tokens.page_bg).toBe('#f5f5f4')
  })
})
