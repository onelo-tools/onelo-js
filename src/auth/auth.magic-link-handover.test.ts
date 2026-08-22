// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { OneloAuth } from './auth'
import { TOKEN_KEYS } from '../core/storage'
import { subscribeSessionCreated } from '../core/session-channel'

/**
 * Only ONE tab may end up being the app.
 *
 * A magic link opens its own tab and the browser gives us no way to reuse the
 * one the user started in. That tab must still finish the exchange — no other
 * origin can write this origin's storage — but it must not become a second
 * running copy of the app. Adrian, 2026-08-18, on seeing both tabs signed in:
 * "innej opcji nie przyjmuje".
 *
 * The rule is ABSOLUTE and has no exceptions (Adrian, 2026-08-19): this tab ends
 * with a farewell message, always. Earlier versions made it conditional on
 * another tab acknowledging, so the email tab showed an app, a store or a login
 * form depending on timing — unpredictability the condition itself created.
 */

const API = 'https://backend.test'
const KEY = 'onelo_pk_live_x'

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

beforeEach(() => {
  FakeChannel.live = []
  // A FRESH body, not an emptied one: the notice keeps a MutationObserver alive
  // for a few seconds to survive the host app re-rendering, and emptying the old
  // body would let the previous test's observer put its overlay into this one.
  document.documentElement.replaceChild(document.createElement('body'), document.body)
  // Own the storage rather than trusting the environment's: something in the
  // shared setup replaces `localStorage` with a partial stand-in that has no
  // `clear`, and a half-real storage would make these assertions meaningless.
  const store = new Map<string, string>()
  const ls = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => store.clear(),
  }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: ls })
  Object.defineProperty(window, 'localStorage', { configurable: true, value: ls })
  vi.stubGlobal('BroadcastChannel', FakeChannel as unknown as typeof BroadcastChannel)
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/api/sdk/config')) {
      return {
        status: 200, ok: true,
        json: async () => ({
          supabase_url: 'https://x.supabase.co', supabase_anon_key: 'anon',
          tenant_id: 't1', app_name: 'Turingo',
        }),
      }
    }
    return {
      status: 200, ok: true,
      json: async () => ({
        access_token: 'at', refresh_token: 'rt', expires_in: 86400,
        user: { id: 'u1', email: 'a@b.test' },
      }),
    }
  }) as unknown as typeof fetch)
  window.history.replaceState({}, '', '/welcome?onelo_code=oac_abc')
})

afterEach(() => { vi.unstubAllGlobals() })

const notice = () => document.getElementById('onelo-handed-over')

describe('the tab the email opened', () => {
  it('shows a message instead of the app once another tab takes over', async () => {
    const stop = subscribeSessionCreated(() => {})   // the waiting tab

    const auth = new OneloAuth({ apiUrl: API, publishableKey: KEY })
    await auth.completeFromUrl()

    expect(notice(), 'this tab must not become a second copy of the app').toBeTruthy()
    // It still had to finish the exchange — that write is the whole reason this
    // tab exists.
    expect(localStorage.getItem(TOKEN_KEYS.ACCESS_TOKEN)).toBe('at')
    stop()
  })

  it('covers the page BEFORE the exchange, so the app never flashes', async () => {
    // The app boots underneath while the code is being exchanged, sees a session
    // and paints itself. Covering only after the outcome was known let it flash
    // up and be replaced (Adrian, 2026-08-18: "na chwilę pojawia się zalogowana
    // apka"). The cover has to be up from the first moment.
    const stop = subscribeSessionCreated(() => {})
    const auth = new OneloAuth({ apiUrl: API, publishableKey: KEY })

    // Synchronously after construction — before the config request resolves,
    // let alone the exchange.
    expect(notice(), 'the cover must be up on the first tick').toBeTruthy()
    expect(notice()!.textContent).toMatch(/signing you in/i)

    await auth.completeFromUrl()
    expect(notice()!.textContent).toMatch(/close this one/i)
    stop()
  })

  it('presents NOTHING after handing over, even when the app asks', async () => {
    // Most apps call loadAuthView() on startup. In the tab we just told the user
    // to leave, that opened a sign-in form ON TOP of the notice — so the tab
    // pointing them elsewhere asked them to log in again (reported 2026-08-19).
    const stop = subscribeSessionCreated(() => {})
    const auth = new OneloAuth({ apiUrl: API, publishableKey: KEY })
    await auth.completeFromUrl()
    expect(notice()).toBeTruthy()

    const presented = await auth.loadAuthView()

    expect(presented, 'nothing to present — this tab is done').toBeNull()
    expect(notice(), 'and the message must still be the only thing showing').toBeTruthy()
    stop()
  })

  it('a gate hand-over silences this tab too', async () => {
    // Same rule for the refused path: it also ends with the notice up.
    window.history.replaceState({}, '', '/welcome?onelo_gate=' + encodeURIComponent(
      'https://st.onelo.tools/no-plan/hosted?token=npt_x',
    ))
    const stop = subscribeSessionCreated(() => {})
    const auth = new OneloAuth({ apiUrl: API, publishableKey: KEY })
    await auth.completeFromUrl()

    expect(await auth.loadAuthView()).toBeNull()
    expect(notice()).toBeTruthy()
    stop()
  })

  it('ends with the message even when NOBODY was listening', async () => {
    // No subscriber at all. This used to make the tab carry on into the app,
    // which is precisely the behaviour that had to go: whether this tab becomes
    // an app must not depend on what another tab happened to be doing.
    const auth = new OneloAuth({ apiUrl: API, publishableKey: KEY })
    await auth.completeFromUrl()

    expect(notice(), 'the message is unconditional').toBeTruthy()
    // The exchange still happened — only a page on this origin can write this
    // origin's storage, which is the whole reason this tab exists.
    expect(localStorage.getItem(TOKEN_KEYS.ACCESS_TOKEN)).toBe('at')
  })

  it('presents nothing afterwards, listener or not', async () => {
    const auth = new OneloAuth({ apiUrl: API, publishableKey: KEY })
    await auth.completeFromUrl()

    expect(await auth.loadAuthView(), 'this tab is done').toBeNull()
    expect(notice()).toBeTruthy()
  })

  it('an ordinary page load shows nothing', async () => {
    window.history.replaceState({}, '', '/welcome')
    const stop = subscribeSessionCreated(() => {})

    const auth = new OneloAuth({ apiUrl: API, publishableKey: KEY })
    await auth.completeFromUrl()

    expect(notice()).toBeNull()
    stop()
  })
})

describe('closing a surface reached with no plan', () => {
  it('recognises the marker that means "back to sign-in"', async () => {
    const { closingMeansSignOut } = await import('./auth')

    // Stamped by the backend on a surface the user only reached by
    // authenticating with NO plan: there is no app behind it to dismiss into.
    expect(closingMeansSignOut(
      'https://st.onelo.tools/store/hosted?token=srt_x&exit=signout',
    )).toBe(true)
    expect(closingMeansSignOut(
      'https://st.onelo.tools/no-plan/hosted?token=npt_x&exit=signout',
    )).toBe(true)

    // A store opened by openUpgrade() on an ENTITLED user carries no marker, and
    // signing that person out for declining to buy would be hostile.
    expect(closingMeansSignOut('https://st.onelo.tools/store/hosted?token=srt_x')).toBe(false)
    // Not a catch-all on any `exit` value.
    expect(closingMeansSignOut('https://st.onelo.tools/store/hosted?exit=back')).toBe(false)
    // An unparsable URL is not a licence to sign anyone out.
    expect(closingMeansSignOut('not a url')).toBe(false)
  })

  it('drops the session and re-opens sign-in when that surface is closed', async () => {
    // The ✕ did close the modal — and that was ALL it did, so the user was left
    // looking at a locked, empty app, which reads as nothing happening at all
    // (reported 2026-08-19).
    const surface = 'https://st.onelo.tools/store/hosted?token=srt_x&exit=signout'
    // A PLAIN url: this is the tab the user started in, not the one the email
    // opened. With a magic-link code in the address this tab would mark itself
    // finished during init and present nothing at all.
    window.history.replaceState({}, '', '/welcome')
    const { AuthModal } = await import('./auth-modal')

    const opened: string[] = []
    vi.spyOn(AuthModal.prototype, 'open').mockImplementation(async (url: string) => {
      opened.push(url)
      // 1st: the waiting tab is told another tab finished, and handed the surface.
      // 2nd: that surface, closed with the ✕.
      // 3rd: whatever the SDK decides comes next.
      if (opened.length === 1) return { type: 'session' as const, surfaceUrl: surface }
      return { type: 'cancelled' as const }
    })

    // /flow/init must answer with a surface to present, or loadAuthView never
    // opens a modal and the test measures nothing.
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/api/sdk/flow/init')) {
        return {
          status: 200, ok: true,
          json: async () => ({
            action: 'present', surface: 'sign_in',
            url: 'https://st.onelo.tools/auth/hosted?token=art_x',
          }),
        }
      }
      return (realFetch as unknown as (u: string, i?: RequestInit) => Promise<Response>)(url, init)
    }) as unknown as typeof fetch)

    const auth = new OneloAuth({ apiUrl: API, publishableKey: KEY })
    const signOut = vi.spyOn(auth, 'signOut').mockResolvedValue(undefined)

    await auth.loadAuthView()

    expect(signOut, 'closing that surface must drop the session').toHaveBeenCalled()
    expect(opened[1], 'the surface itself was presented').toBe(surface)
    expect(opened.length, 'and the flow was re-resolved afterwards').toBeGreaterThan(2)
  })
})

describe('the hosted ✕ on a no-plan surface', () => {
  it('clears the local session, so the flow does not reopen the same screen', async () => {
    // The ✕ revokes server-side and reports `invalid_token`. The tokens were
    // still in THIS tab's storage, so re-resolving sent them as a Bearer, the
    // backend answered "signed in, no plan", and the SDK reopened the same store.
    // Close-then-instantly-reopen is indistinguishable from a dead button
    // (reported 2026-08-19).
    window.history.replaceState({}, '', '/welcome')
    const surface = 'https://st.onelo.tools/store/hosted?token=srt_x&exit=signout'
    const { AuthModal } = await import('./auth-modal')

    const opened: string[] = []
    vi.spyOn(AuthModal.prototype, 'open').mockImplementation(async (url: string) => {
      opened.push(url)
      if (opened.length === 1) return { type: 'session' as const, surfaceUrl: surface }
      // The hosted ✕ speaks through this exact shape.
      if (opened.length === 2) return { type: 'error' as const, message: 'invalid_token' }
      return { type: 'cancelled' as const }
    })

    // /flow/init must answer with a surface, or loadAuthView presents nothing and
    // the test measures nothing.
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn(async (u: string, i?: RequestInit) => {
      if (String(u).includes('/api/sdk/flow/init')) {
        return {
          status: 200, ok: true,
          json: async () => ({
            action: 'present', surface: 'sign_in',
            url: 'https://st.onelo.tools/auth/hosted?token=art_x',
          }),
        }
      }
      return (realFetch as unknown as (a: string, b?: RequestInit) => Promise<Response>)(u, i)
    }) as unknown as typeof fetch)

    const auth = new OneloAuth({ apiUrl: API, publishableKey: KEY })
    const signOut = vi.spyOn(auth, 'signOut').mockResolvedValue(undefined)

    await auth.loadAuthView()

    expect(signOut, 'the local session must go before we ask again').toHaveBeenCalled()
  })

  it('does NOT sign out an entitled user whose addressing token merely went stale', async () => {
    // `invalid_token` also arrives when a token idles out under someone who IS
    // entitled. Signing them out there would be a regression dressed as a fix, so
    // the rule is scoped to surfaces stamped `exit=signout`.
    window.history.replaceState({}, '', '/welcome')
    const { AuthModal } = await import('./auth-modal')
    const plain = 'https://st.onelo.tools/store/hosted?token=srt_x'

    const opened: string[] = []
    vi.spyOn(AuthModal.prototype, 'open').mockImplementation(async (url: string) => {
      opened.push(url)
      if (opened.length === 1) return { type: 'session' as const, surfaceUrl: plain }
      if (opened.length === 2) return { type: 'error' as const, message: 'invalid_token' }
      return { type: 'cancelled' as const }
    })

    // /flow/init must answer with a surface, or loadAuthView presents nothing and
    // the test measures nothing.
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn(async (u: string, i?: RequestInit) => {
      if (String(u).includes('/api/sdk/flow/init')) {
        return {
          status: 200, ok: true,
          json: async () => ({
            action: 'present', surface: 'sign_in',
            url: 'https://st.onelo.tools/auth/hosted?token=art_x',
          }),
        }
      }
      return (realFetch as unknown as (a: string, b?: RequestInit) => Promise<Response>)(u, i)
    }) as unknown as typeof fetch)

    const auth = new OneloAuth({ apiUrl: API, publishableKey: KEY })
    const signOut = vi.spyOn(auth, 'signOut').mockResolvedValue(undefined)

    await auth.loadAuthView()

    expect(signOut).not.toHaveBeenCalled()
  })
})
