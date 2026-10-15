import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { generateCodeChallenge } from '@onelo/core'

/**
 * A hosted sign-in whose `art_` flow token died while the modal sat in the
 * background (#625, #620).
 *
 * The hosted page never swaps a dead token. It hands the flow back with
 * `{type:'onelo:error', message:'token_expired'}` to the bound origin
 * (frontend/lib/auth-expiry-handback.ts), which AuthModal settles as
 * `{type:'error', message:'token_expired'}`. The SDK must then start a NEW flow
 * (a second /flow/init, a new hosted URL) and exchange the code that flow hands
 * out with the verifier whose challenge the NEW token carries.
 */

const { opened, results } = vi.hoisted(() => ({
  opened: [] as string[],
  results: [] as Array<Record<string, unknown>>,
}))

vi.mock('./auth-modal', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./auth-modal')>()),
  AuthModal: class {
    static discardParkedPopup = vi.fn()
    open = vi.fn(async (url: string) => {
      opened.push(url)
      return results.shift() ?? { type: 'cancelled' }
    })
  },
}))

import { OneloAuth } from './auth'

const API = 'https://backend.test'
const KEY = 'onelo_pk_live_x'
const OLD_URL = 'https://st.onelo.tools/auth/hosted?token=art_old'
const NEW_URL = 'https://st.onelo.tools/auth/hosted?token=art_new'

const SESSION = {
  access_token: 'at', refresh_token: 'rt', expires_in: 86400,
  user: { id: 'u1', email: 'a@b.test' },
}

let calls: Array<{ url: string; body: Record<string, unknown> }>
let flowUrls: string[]

beforeEach(() => {
  calls = []
  opened.length = 0
  results.length = 0
  flowUrls = [OLD_URL, NEW_URL]
  const store = new Map<string, string>()
  const ls = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => store.clear(),
  }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: ls })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: { href: 'https://app.test/' }, history: { replaceState: vi.fn() }, localStorage: ls },
  })
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : {} })
    const ok = (json: unknown) => ({ status: 200, ok: true, json: async () => json })
    if (url.includes('/api/sdk/config')) {
      return ok({ supabase_url: 'https://x.supabase.co', supabase_anon_key: 'anon', tenant_id: 't1', allow_custom_branding: true })
    }
    if (url.includes('/api/sdk/flow/init')) {
      return ok({ action: 'present', surface: 'sign_in', url: flowUrls.shift() })
    }
    if (url.includes('/hosted-callback')) return ok(SESSION)
    return ok({})
  }) as unknown as typeof fetch)
})

afterEach(() => { vi.unstubAllGlobals() })

const openedTokens = () => opened.map((u) => new URL(u).searchParams.get('token'))
const flowInits = () => calls.filter((c) => c.url.includes('/api/sdk/flow/init'))

describe('hosted sign-in handed back as token_expired', () => {
  it('starts a NEW flow and exchanges with the verifier the NEW token is bound to', async () => {
    results.push({ type: 'error', message: 'token_expired' }, { type: 'code', code: 'oac_new' })
    const auth = new OneloAuth({ apiUrl: API, publishableKey: KEY })

    const session = await auth.loadAuthView()

    expect(session?.user.id).toBe('u1')
    // The dead page, then the fresh one — not the dead one twice.
    expect(openedTokens()).toEqual(['art_old', 'art_new'])
    expect(flowInits()).toHaveLength(2)

    const exchange = calls.find((c) => c.url.includes('/hosted-callback'))!
    expect(exchange.body.code).toBe('oac_new')
    const verifier = exchange.body.code_verifier as string
    expect(verifier).toBeTruthy()
    const newChallenge = new URL(flowInits()[1].url).searchParams.get('code_challenge')
    expect(newChallenge).toBe(await generateCodeChallenge(verifier))
  })

  it.each(['invalid_token', 'expired_token'])('treats %s the same way', async (code) => {
    results.push({ type: 'error', message: code }, { type: 'code', code: 'oac_new' })
    const auth = new OneloAuth({ apiUrl: API, publishableKey: KEY })
    await expect(auth.loadAuthView()).resolves.toBeTruthy()
    expect(openedTokens()).toEqual(['art_old', 'art_new'])
  })

  it('a genuine failure is surfaced, not restarted', async () => {
    results.push({ type: 'error', message: 'attest_invalid' })
    const auth = new OneloAuth({ apiUrl: API, publishableKey: KEY })
    await expect(auth.loadAuthView()).rejects.toThrow(/attest_invalid/)
    expect(flowInits()).toHaveLength(1)
  })
})
