import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { generateCodeChallenge } from '@onelo/core'

// The hosted modal needs a DOM; here only what the SDK asks the backend for and
// what it keeps matters, so the modal simply reports "cancelled".
vi.mock('./auth-modal', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./auth-modal')>()),
  AuthModal: class {
    static discardParkedPopup = vi.fn()
    open = vi.fn(async () => ({ type: 'cancelled' }))
  },
}))

import { OneloAuth } from './auth'
import { TOKEN_KEYS } from '../core/storage'

/**
 * Magic link opened in another browser or on another device (#535).
 *
 * Owner decision 2026-09-25: the same browser keeps one click; anywhere else the
 * person types the code the requesting tab shows, and the session goes to that
 * tab. The SDK's part:
 *  - the waiting tab binds the hosted flow to its verifier (code_challenge on
 *    /flow/init) and keeps the verifier where THIS browser's link tab finds it;
 *  - the link tab proves "same browser" with that verifier, or leaves for the
 *    code screen without signing anyone in.
 */

const API = 'https://backend.test'
const KEY = 'onelo_pk_live_x'

const CONFIG = {
  supabase_url: 'https://x.supabase.co',
  supabase_anon_key: 'anon',
  tenant_id: 't1',
  allow_custom_branding: true,
}

const SESSION = {
  access_token: 'at', refresh_token: 'rt',
  // The contract is a TTL, not an absolute time: mapSession reads `expires_in`
  // (seconds). An `expires_at` decodes to 0, so getSession treats a fresh
  // session as expired and refreshes instead.
  expires_in: 86400,
  user: { id: 'u1', email: 'a@b.test' },
}

/** Requests seen this test, in order. */
let calls: Array<{ url: string; body: Record<string, unknown> }>

function mockFetch(handler?: (url: string) => { status?: number; json?: unknown } | undefined) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : {} })
    const custom = handler?.(url)
    if (custom) {
      return { status: custom.status ?? 200, ok: (custom.status ?? 200) < 400, json: async () => custom.json ?? {} }
    }
    if (url.includes('/api/sdk/config')) return { status: 200, ok: true, json: async () => CONFIG }
    if (url.includes('/hosted-callback')) return { status: 200, ok: true, json: async () => SESSION }
    return { status: 200, ok: true, json: async () => ({}) }
  }) as unknown as typeof fetch)
}

function setUrl(href: string) {
  const replaceState = vi.fn()
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    // `localStorage` hangs off `window` too — TokenStorage decides whether to
    // persist by probing `window.localStorage`, so a window without it silently
    // demotes every write to memory and the durability under test disappears.
    value: { location: { href }, history: { replaceState }, localStorage: globalThis.localStorage },
  })
  return replaceState
}

/** Map-backed localStorage. This suite runs in Node, and the point of the
 *  feature is DURABILITY across tabs, so the store has to be real enough to
 *  read back — and breakable on demand. */
let store: Map<string, string>
let failWrites = false

function installStorage() {
  store = new Map()
  failWrites = false
  const ls = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (failWrites) throw new Error('QuotaExceeded')
      store.set(k, v)
    },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => store.clear(),
  }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: ls })
}

beforeEach(() => {
  calls = []
  installStorage()   // must precede setUrl — the window stub borrows it
  setUrl('https://app.test/welcome')
})

afterEach(() => { vi.unstubAllGlobals() })


async function s256(v: string) { return generateCodeChallenge(v) }

describe('waiting tab', () => {
  it('sends its PKCE challenge to /flow/init and keeps the verifier for this browser', async () => {
    mockFetch((url) => url.includes('/api/sdk/flow/init')
      ? { json: { action: 'present', surface: 'sign_in', url: 'https://st.onelo.tools/auth/hosted?token=art_x' } }
      : undefined)
    const auth = new OneloAuth({ apiUrl: API, publishableKey: KEY })
    await auth.loadAuthView()

    const init = calls.find((c) => c.url.includes('/api/sdk/flow/init'))!
    const challenge = new URL(init.url).searchParams.get('code_challenge')
    const verifier = store.get(TOKEN_KEYS.MAGIC_LINK_VERIFIER)
    expect(verifier, 'the link tab in this browser needs it').toBeTruthy()
    expect(challenge).toBe(await s256(verifier!))
  })
})

describe('link tab — paired link (?onelo_link=)', () => {
  it('same browser: proves it with the stored verifier and signs in in one click', async () => {
    store.set(TOKEN_KEYS.MAGIC_LINK_VERIFIER, 'stored-verifier')
    const replaceState = setUrl('https://app.test/welcome?onelo_link=mlt-1')
    mockFetch((url) => url.includes('/magic-link/consume') ? { json: { code: 'oac_same' } } : undefined)

    const auth = new OneloAuth({ apiUrl: API, publishableKey: KEY })
    await auth.whenReady()

    const consume = calls.find((c) => c.url.includes('/magic-link/consume'))!
    expect(consume.body).toEqual({ publishableKey: KEY, token: 'mlt-1', code_verifier: 'stored-verifier' })
    const cb = calls.find((c) => c.url.includes('/hosted-callback'))!
    expect(cb.body).toMatchObject({ code: 'oac_same', code_verifier: 'stored-verifier' })
    expect(store.get(TOKEN_KEYS.ACCESS_TOKEN)).toBe('at')
    expect(store.has(TOKEN_KEYS.MAGIC_LINK_VERIFIER), 'single-use').toBe(false)
    expect(String(replaceState.mock.calls[0][2])).not.toContain('onelo_link')
    // Still a messenger: it never presents a sign-in form of its own.
    expect(await auth.loadAuthView()).toBeNull()
  })

  it('another browser: goes to the code screen and signs nobody in', async () => {
    const replace = vi.fn()
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        location: { href: 'https://app.test/welcome?onelo_link=mlt-1', replace },
        history: { replaceState: vi.fn() },
        localStorage: globalThis.localStorage,
      },
    })
    const confirmUrl = 'https://st.onelo.tools/auth/sdk-magic-link?token=mlt-1&confirm=1'
    mockFetch((url) => url.includes('/magic-link/consume')
      ? { status: 409, json: { detail: { error: 'confirm_required', confirm_url: confirmUrl } } }
      : undefined)

    const auth = new OneloAuth({ apiUrl: API, publishableKey: KEY })
    await auth.whenReady()

    expect(calls.find((c) => c.url.includes('/magic-link/consume'))!.body.code_verifier).toBeNull()
    expect(replace).toHaveBeenCalledWith(confirmUrl)
    expect(calls.some((c) => c.url.includes('/hosted-callback'))).toBe(false)
    expect(store.has(TOKEN_KEYS.ACCESS_TOKEN)).toBe(false)
  })

  it('never follows a non-web confirm URL', async () => {
    const replace = vi.fn()
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        location: { href: 'https://app.test/?onelo_link=mlt-1', replace },
        history: { replaceState: vi.fn() },
        localStorage: globalThis.localStorage,
      },
    })
    mockFetch((url) => url.includes('/magic-link/consume')
      ? { status: 409, json: { detail: { error: 'confirm_required', confirm_url: 'javascript:alert(1)' } } }
      : undefined)
    const auth = new OneloAuth({ apiUrl: API, publishableKey: KEY })
    await auth.whenReady()
    expect(replace).not.toHaveBeenCalled()
    expect(store.has(TOKEN_KEYS.ACCESS_TOKEN)).toBe(false)
  })
})
