// @vitest-environment jsdom
/**
 * Popup mode, flow token died while the popup sat in the background (#625).
 *
 * The hosted page posts `{type:'onelo:error', message:'token_expired'}` and the
 * SDK starts a new flow. That restart runs from a `message` event, long after
 * the click that opened the popup, so a second `window.open` has no user
 * activation and the browser blocks it (returns null). The fake `window.open`
 * here behaves exactly like that: only the first call, made while the test
 * "clicks", gets a window. The restart must reuse the popup it already has.
 */
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'
import { generateCodeChallenge } from '@onelo/core'
import { OneloAuth } from './auth'

const HOSTED = 'https://st.onelo.tools'
const OLD = `${HOSTED}/auth/hosted?token=art_old`
const NEW = `${HOSTED}/auth/hosted?token=art_new`

type FakePopup = { closed: boolean; close: () => void; focus: () => void; location: { replace: ReturnType<typeof vi.fn> } }

let calls: Array<{ url: string; body: Record<string, unknown> }>
let flowReplies: Array<Record<string, unknown>>
let popup: FakePopup
let openSpy: Mock<unknown[], FakePopup | null>

beforeEach(() => {
  calls = []
  flowReplies = [
    { action: 'present', surface: 'sign_in', url: OLD },
    { action: 'present', surface: 'sign_in', url: NEW },
  ]
  popup = {
    closed: false,
    close() { this.closed = true },
    focus() {},
    location: { replace: vi.fn() },
  }
  let userActivation = true
  openSpy = vi.fn<unknown[], FakePopup | null>(() => {
    // Transient activation is consumed by the first open; later calls come
    // from message handlers and are blocked.
    const granted = userActivation
    userActivation = false
    return granted ? popup : null
  })
  vi.spyOn(window, 'open').mockImplementation(openSpy as unknown as typeof window.open)
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : {} })
    const ok = (json: unknown) => ({ status: 200, ok: true, json: async () => json })
    if (url.includes('/api/sdk/config')) {
      return ok({ supabase_url: 'https://x.supabase.co', supabase_anon_key: 'anon', tenant_id: 't1', allow_custom_branding: true })
    }
    if (url.includes('/api/sdk/flow/init')) return ok(flowReplies.shift())
    if (url.includes('/hosted-callback')) {
      return ok({ access_token: 'at', refresh_token: 'rt', expires_in: 86400, user: { id: 'u1', email: 'a@b.test' } })
    }
    return ok({})
  }) as unknown as typeof fetch)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function until(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 1))
  expect(cond()).toBe(true)
}

function fromHostedPage(data: Record<string, unknown>) {
  window.dispatchEvent(new MessageEvent('message', { origin: HOSTED, data }))
}

const flowInits = () => calls.filter((c) => c.url.includes('/api/sdk/flow/init'))

describe('popup mode: hosted sign-in handed back as token_expired', () => {
  it('continues in the SAME popup on the new hosted URL, then signs in', async () => {
    const auth = new OneloAuth({ apiUrl: 'https://backend.test', publishableKey: 'onelo_pk_live_x' })
    const result = auth.loadAuthView({ mode: 'popup' })
    await until(() => openSpy.mock.calls.length === 1)
    expect(new URL(openSpy.mock.calls[0][0] as string).searchParams.get('token')).toBe('art_old')

    fromHostedPage({ type: 'onelo:error', message: 'token_expired' })

    await until(() => popup.location.replace.mock.calls.length === 1)
    const reloaded = popup.location.replace.mock.calls[0][0] as string
    expect(new URL(reloaded).searchParams.get('token')).toBe('art_new')
    expect(openSpy, 'no second, un-gestured window.open').toHaveBeenCalledTimes(1)
    expect(popup.closed).toBe(false)

    fromHostedPage({ type: 'onelo:code', code: 'oac_new' })
    const session = await result
    expect(session?.user.id).toBe('u1')
    expect(popup.closed, 'the popup closes once the flow is done').toBe(true)

    const exchange = calls.find((c) => c.url.includes('/hosted-callback'))!
    const challenge = new URL(flowInits()[1].url).searchParams.get('code_challenge')
    expect(challenge).toBe(await generateCodeChallenge(exchange.body.code_verifier as string))
  })

  it('closes the kept popup when the new flow needs no page (authorized)', async () => {
    flowReplies[1] = { action: 'authorized' }
    const auth = new OneloAuth({ apiUrl: 'https://backend.test', publishableKey: 'onelo_pk_live_x' })
    const result = auth.loadAuthView({ mode: 'popup' })
    await until(() => openSpy.mock.calls.length === 1)

    fromHostedPage({ type: 'onelo:error', message: 'token_expired' })
    await result

    expect(popup.closed, 'nothing adopted it, so it must not linger').toBe(true)
    expect(popup.location.replace).not.toHaveBeenCalled()
  })

  it('a genuine error still closes the popup and surfaces', async () => {
    const auth = new OneloAuth({ apiUrl: 'https://backend.test', publishableKey: 'onelo_pk_live_x' })
    const result = auth.loadAuthView({ mode: 'popup' })
    await until(() => openSpy.mock.calls.length === 1)

    fromHostedPage({ type: 'onelo:error', message: 'attest_invalid' })

    await expect(result).rejects.toThrow(/attest_invalid/)
    expect(popup.closed).toBe(true)
    expect(flowInits()).toHaveLength(1)
  })
})
