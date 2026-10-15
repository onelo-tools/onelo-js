import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { generateCodeChallenge } from '@onelo/core'

/**
 * #619 — the access-gate store (`exit=signout`, reached through /flow/init)
 * whose `srt_` link died. The page hands it back as expired, which AuthModal
 * settles as `token_expired`. The user did not choose to leave, so the SDK
 * restarts the flow WITHOUT signing out and the gate store comes back on a
 * fresh link. The ✕ (`invalid_token`) still signs out first.
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
const OLD_URL = 'https://st.onelo.tools/store/hosted?token=srt_old&exit=signout'
const NEW_URL = 'https://st.onelo.tools/store/hosted?token=srt_new&exit=signout'

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
      return ok({ action: 'present', surface: 'store', url: flowUrls.shift() })
    }
    if (url.includes('/hosted-callback')) return ok(SESSION)
    return ok({})
  }) as unknown as typeof fetch)
})

afterEach(() => { vi.unstubAllGlobals() })

const openedTokens = () => opened.map((u) => new URL(u).searchParams.get('token'))
const flowInits = () => calls.filter((c) => c.url.includes('/api/sdk/flow/init'))

describe('access-gate store handed back as expired (#619)', () => {
  it('restarts on a fresh store link and keeps the user signed in', async () => {
    results.push({ type: 'error', message: 'token_expired' }, { type: 'code', code: 'oac_new' })
    const auth = new OneloAuth({ apiUrl: API, publishableKey: KEY })
    const signOut = vi.spyOn(auth, 'signOut')

    await expect(auth.loadAuthView()).resolves.toBeTruthy()

    expect(openedTokens()).toEqual(['srt_old', 'srt_new'])
    expect(flowInits()).toHaveLength(2)
    expect(signOut).not.toHaveBeenCalled()
  })

  it('the ✕ (invalid_token) on the same surface still signs out first', async () => {
    results.push({ type: 'error', message: 'invalid_token' }, { type: 'code', code: 'oac_new' })
    const auth = new OneloAuth({ apiUrl: API, publishableKey: KEY })
    const signOut = vi.spyOn(auth, 'signOut')

    await auth.loadAuthView()

    expect(signOut).toHaveBeenCalledTimes(1)
  })
})
