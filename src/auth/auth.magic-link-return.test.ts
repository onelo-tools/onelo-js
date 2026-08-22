import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { OneloAuth } from './auth'
import { TOKEN_KEYS } from '../core/storage'

/**
 * The web return path for magic link.
 *
 * Until 2026-08-18 this flow dead-ended: the link was consumed, a one-time code
 * was minted, and there was nothing on the web able to receive it — the email
 * opens a fresh tab with no opener and no parent frame. The pieces under test
 * are what closes that gap: a verifier that survives the trip, and an exchange
 * that runs off the returned URL.
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

describe('sendMagicLink — durable verifier', () => {
  it('persists the verifier and binds the link to it with a challenge', async () => {
    mockFetch()
    const auth = new OneloAuth({ apiUrl: API, publishableKey: KEY })
    await auth.sendMagicLink('a@b.test', 'https://app.test/welcome')

    const stored = store.get(TOKEN_KEYS.MAGIC_LINK_VERIFIER)
    expect(stored, 'verifier must outlive this tab — the email opens another one').toBeTruthy()

    const req = calls.find((c) => c.url.includes('/api/sdk/auth/magic-link'))!
    expect(req.body.code_challenge, 'a durable verifier must be bound').toBeTruthy()
    // The challenge is a HASH. Shipping the verifier itself would put the
    // secret in the email and make PKCE decorative.
    expect(req.body.code_challenge).not.toBe(stored)
  })

  it('sends NO challenge when storage cannot persist', async () => {
    mockFetch()
    // Safari private mode: TokenStorage degrades to an in-memory map, which the
    // tab the email opens cannot read. A challenge here would 401 at callback on
    // a link ALREADY marked used — a lockout with no recovery. The weaker link
    // is the correct trade.
    failWrites = true

    const auth = new OneloAuth({ apiUrl: API, publishableKey: KEY })
    await auth.sendMagicLink('a@b.test', 'https://app.test/welcome')

    const req = calls.find((c) => c.url.includes('/api/sdk/auth/magic-link'))!
    expect(req.body.code_challenge).toBeUndefined()
  })
})

describe('completeFromUrl', () => {
  it('exchanges onelo_code with the stored verifier and signs the user in', async () => {
    mockFetch()
    store.set(TOKEN_KEYS.MAGIC_LINK_VERIFIER, 'verifier-123')
    setUrl('https://app.test/welcome?onelo_code=oac_abc')

    const auth = new OneloAuth({ apiUrl: API, publishableKey: KEY })
    const session = await auth.completeFromUrl()

    expect(session?.accessToken).toBe('at')
    const req = calls.find((c) => c.url.includes('/hosted-callback'))!
    expect(req.body.code).toBe('oac_abc')
    expect(req.body.code_verifier).toBe('verifier-123')
  })

  it('strips the code from the address bar', async () => {
    mockFetch()
    const replaceState = setUrl('https://app.test/welcome?onelo_code=oac_abc&keep=1')

    const auth = new OneloAuth({ apiUrl: API, publishableKey: KEY })
    await auth.completeFromUrl()

    // A one-time code is a credential: left in the URL it leaks through history,
    // the Referer header and analytics — and a reload would replay a spent one.
    const written = String(replaceState.mock.calls.at(-1)?.[2])
    expect(written).not.toContain('onelo_code')
    expect(written, 'unrelated params are the developer’s, not ours to drop').toContain('keep=1')
  })

  it('consumes the verifier even when the exchange fails', async () => {
    mockFetch((url) => url.includes('/hosted-callback') ? { status: 401 } : undefined)
    store.set(TOKEN_KEYS.MAGIC_LINK_VERIFIER, 'verifier-123')
    setUrl('https://app.test/welcome?onelo_code=oac_dead')

    const auth = new OneloAuth({ apiUrl: API, publishableKey: KEY })
    await expect(auth.completeFromUrl()).rejects.toThrow()

    // A failed code is not going to start working, and a stale verifier would
    // be bound to the NEXT link and break that one too.
    expect(store.get(TOKEN_KEYS.MAGIC_LINK_VERIFIER)).toBeUndefined()
  })

  it('announces the sign-in so a waiting tab can stop waiting', async () => {
    // The SENDING half. Without it the modal in the other tab listens to a
    // channel nobody ever posts on — and the whole hand-off is silently dead.
    const received: unknown[] = []
    class Ch {
      static live: Ch[] = []
      handlers: Array<(e: { data: unknown }) => void> = []
      closed = false
      constructor(public name: string) { Ch.live.push(this) }
      postMessage(data: unknown) {
        for (const c of Ch.live) if (c !== this && !c.closed) c.handlers.forEach((h) => h({ data }))
      }
      addEventListener(_t: string, h: (e: { data: unknown }) => void) { this.handlers.push(h) }
      removeEventListener() {}
      close() { this.closed = true }
    }
    vi.stubGlobal('BroadcastChannel', Ch as unknown as typeof BroadcastChannel)
    const listener = new Ch('onelo_auth')
    listener.addEventListener('message', (e) => { received.push(e.data) })

    mockFetch()
    store.set(TOKEN_KEYS.MAGIC_LINK_VERIFIER, 'verifier-123')
    setUrl('https://app.test/welcome?onelo_code=oac_abc')

    const auth = new OneloAuth({ apiUrl: API, publishableKey: KEY })
    await auth.completeFromUrl()

    expect(received).toContainEqual({ type: 'onelo:session-created' })
  })

  it('is a no-op on an ordinary page load', async () => {
    mockFetch()
    const auth = new OneloAuth({ apiUrl: API, publishableKey: KEY })
    await expect(auth.completeFromUrl()).resolves.toBeNull()
    expect(calls.some((c) => c.url.includes('/hosted-callback'))).toBe(false)
  })
})

describe('automatic completion', () => {
  it('runs during init, so whenReady() is all a developer needs', async () => {
    mockFetch()
    store.set(TOKEN_KEYS.MAGIC_LINK_VERIFIER, 'verifier-123')
    setUrl('https://app.test/welcome?onelo_code=oac_abc')

    const auth = new OneloAuth({ apiUrl: API, publishableKey: KEY })
    await auth.whenReady()

    expect(await auth.getSession(), 'signed in without an explicit call').toBeTruthy()
  })

  it('a dead code leaves the SDK usable, signed out', async () => {
    mockFetch((url) => url.includes('/hosted-callback') ? { status: 410 } : undefined)
    setUrl('https://app.test/welcome?onelo_code=oac_spent')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const auth = new OneloAuth({ apiUrl: API, publishableKey: KEY })
    await auth.whenReady()

    // Landing on a spent code is NORMAL — a reload, or a mail scanner that
    // prefetched the link. Taking the whole SDK down for it would strand the
    // user on a page that cannot even offer them a password form.
    expect(await auth.getSession()).toBeNull()
    expect(warn).toHaveBeenCalled()
  })
})

describe('the tab that was waiting', () => {
  // `storage` was the first attempt and was measured NOT to arrive in Safari
  // (2026-08-18, listener attached by hand in the waiting tab). BroadcastChannel
  // is the API built for this, so these tests drive it directly.
  class FakeChannel {
    static live: FakeChannel[] = []
    handlers: Array<(e: { data: unknown }) => void> = []
    closed = false
    constructor(public name: string) { FakeChannel.live.push(this) }
    postMessage(data: unknown) {
      for (const c of FakeChannel.live) {
        if (c !== this && !c.closed) c.handlers.forEach((h) => h({ data }))
      }
    }
    addEventListener(_t: string, h: (e: { data: unknown }) => void) { this.handlers.push(h) }
    removeEventListener(_t: string, h: (e: { data: unknown }) => void) {
      this.handlers = this.handlers.filter((x) => x !== h)
    }
    close() { this.closed = true }
  }

  function browser() {
    FakeChannel.live = []
    vi.stubGlobal('BroadcastChannel', FakeChannel as unknown as typeof BroadcastChannel)
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        location: { href: 'https://app.test/' },
        history: { replaceState: vi.fn() },
        localStorage: globalThis.localStorage,
        addEventListener: () => {},
        removeEventListener: () => {},
        open: () => ({ closed: false, close: () => {} }),
      },
    })
  }

  it('settles when another tab announces a sign-in', async () => {
    browser()
    const { AuthModal } = await import('./auth-modal')
    const { publishSessionCreated } = await import('../core/session-channel')

    const pending = new AuthModal().open('https://st.onelo.tools/auth/hosted', 'popup', {
      watchCrossTabSession: true,
    })
    publishSessionCreated()

    expect(await pending).toEqual({ type: 'session' })
  })

  it('ignores unrelated traffic on the channel', async () => {
    browser()
    const { AuthModal } = await import('./auth-modal')

    let settled = false
    void new AuthModal().open('https://st.onelo.tools/auth/hosted', 'popup', {
      watchCrossTabSession: true,
    }).then(() => { settled = true })

    new (globalThis.BroadcastChannel as unknown as typeof FakeChannel)('onelo_auth')
      .postMessage({ type: 'something-else' })
    await Promise.resolve()

    expect(settled).toBe(false)
  })

  it('does not listen unless asked — the STORE must not close on a sign-in elsewhere', async () => {
    browser()
    const { AuthModal } = await import('./auth-modal')
    const { publishSessionCreated } = await import('../core/session-channel')

    let settled = false
    void new AuthModal().open('https://st.onelo.tools/store/hosted', 'popup')
      .then(() => { settled = true })
    publishSessionCreated()
    await Promise.resolve()

    // A buyer part-way through checkout must not have it closed under them
    // because they signed in somewhere else.
    expect(settled).toBe(false)
  })
})
