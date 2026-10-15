// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NEUTRAL_BRAND_TOKENS, brandTokensFromLegacy } from '@onelo/core'
import { OneloAuth } from './auth'
import { TOKEN_KEYS } from '../core/storage'
import { rememberStoreReturnLook, recallStoreReturnLook } from '../core/store-return-look'

/**
 * #728: back from the app-window checkout, the page loads with
 * `onelo_store_code` and the SDK covers it with "Signing you in…" on its FIRST
 * tick — before config answers. That cover must look like the branded,
 * localized checkout steps before it (the store's Branding and language, a
 * spinner, a status text), not the neutral near-black English screen, and it
 * goes away once the session is in.
 */

const API = 'https://backend.test'
const KEY = 'onelo_pk_live_x'
const BRAND = brandTokensFromLegacy('#0055ff', '#f5f5f4')

beforeEach(() => {
  document.documentElement.replaceChild(document.createElement('body'), document.body)
  window.sessionStorage.clear()
  const store = new Map<string, string>()
  const ls = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => store.clear(),
  }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: ls })
  Object.defineProperty(window, 'localStorage', { configurable: true, value: ls })
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/api/sdk/config')) {
      return { status: 200, ok: true, json: async () => ({ supabase_url: 'https://x.supabase.co', supabase_anon_key: 'anon', tenant_id: 't1', app_name: 'Acme' }) }
    }
    return {
      status: 200, ok: true,
      json: async () => ({ access_token: 'at', refresh_token: 'rt', expires_in: 86400, user: { id: 'u1', email: 'a@b.test' } }),
    }
  }) as unknown as typeof fetch)
  window.history.replaceState({}, '', '/app?onelo_store_code=oac_1')
})

afterEach(() => { vi.unstubAllGlobals() })

const cover = () => document.getElementById('onelo-handed-over')

describe('store return cover (#728)', () => {
  it('first tick: the store\'s Branding and language, a spinner, a status', () => {
    rememberStoreReturnLook(KEY, BRAND, 'pl')
    new OneloAuth({ apiUrl: API, publishableKey: KEY })
    const el = cover()!
    expect(el).toBeTruthy()
    expect(el.getAttribute('role')).toBe('status')
    expect(el.querySelector('h1')!.textContent).toBe('Logujemy Cię…')
    expect(el.style.background).toBe('rgb(245, 245, 244)')
    expect(el.querySelector('[data-onelo-spinner]')).toBeTruthy()
    expect(el.querySelector('style')!.textContent).toContain('#0055ff')
  })

  it('without a remembered look (storage blocked, another tab): neutral, browser language', () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('de-DE')
    new OneloAuth({ apiUrl: API, publishableKey: KEY })
    const el = cover()!
    expect(el.querySelector('h1')!.textContent).toBe('Sie werden angemeldet…')
    expect(el.style.background).toBe('rgb(17, 17, 17)')
    expect(NEUTRAL_BRAND_TOKENS.page_bg).toBe('#111111')
  })

  it('a store opened without a language spoke English, so does the cover', () => {
    rememberStoreReturnLook(KEY, BRAND, null)
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('de-DE')
    new OneloAuth({ apiUrl: API, publishableKey: KEY })
    expect(cover()!.querySelector('h1')!.textContent).toBe('Signing you in…')
  })

  it('a look remembered for another app is not used', () => {
    rememberStoreReturnLook('onelo_pk_live_other', BRAND, 'pl')
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-GB')
    new OneloAuth({ apiUrl: API, publishableKey: KEY })
    expect(cover()!.querySelector('h1')!.textContent).toBe('Signing you in…')
  })

  it('goes away once signed in, and the remembered look is spent', async () => {
    rememberStoreReturnLook(KEY, BRAND, 'pl')
    const auth = new OneloAuth({ apiUrl: API, publishableKey: KEY })
    await auth.completeFromUrl()
    await vi.waitFor(() => expect(localStorage.getItem(TOKEN_KEYS.ACCESS_TOKEN)).toBe('at'))
    expect(cover()).toBeNull()
    expect(recallStoreReturnLook(KEY)).toBeNull()
    expect(new URL(window.location.href).searchParams.get('onelo_store_code')).toBeNull()
  })
})

describe('remembered look', () => {
  it('expires', () => {
    rememberStoreReturnLook(KEY, BRAND, 'pl')
    expect(recallStoreReturnLook(KEY)).not.toBeNull()
    expect(recallStoreReturnLook(KEY, Date.now() + 3 * 60 * 60 * 1000)).toBeNull()
  })
})
