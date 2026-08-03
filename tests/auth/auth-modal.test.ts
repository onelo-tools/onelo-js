// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { AuthModal } from '../../src/auth/auth-modal'

// Hosted page lives on the FRONTEND origin (st.onelo.tools) — deliberately
// different from any backend apiUrl (st.backend.onelo.tools) to prove the fix:
// origin validation must key off the hosted URL, not apiUrl.
const HOSTED = 'https://st.onelo.tools/auth/hosted?token=art_x&origin=https%3A%2F%2Fapp.dev'
const HOSTED_ORIGIN = 'https://st.onelo.tools'

function fakePopup() {
  return { closed: false, close: vi.fn() } as unknown as Window
}

afterEach(() => { vi.restoreAllMocks() })

describe('AuthModal — origin validation (hosted-page origin, not apiUrl)', () => {
  it('resolves onelo:code from the hosted-page origin', async () => {
    vi.spyOn(window, 'open').mockReturnValue(fakePopup())
    const modal = new AuthModal()
    const p = modal.open(HOSTED, 'popup')
    window.dispatchEvent(new MessageEvent('message', {
      origin: HOSTED_ORIGIN,
      data: { type: 'onelo:code', code: 'CODE123' },
    }))
    await expect(p).resolves.toEqual({ type: 'code', code: 'CODE123' })
  })

  it('IGNORES a message from a different (attacker) origin', async () => {
    vi.spyOn(window, 'open').mockReturnValue(fakePopup())
    const modal = new AuthModal()
    const p = modal.open(HOSTED, 'popup')
    let settled = false
    void p.then(() => { settled = true })
    window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://evil.example',
      data: { type: 'onelo:code', code: 'STOLEN' },
    }))
    await new Promise((r) => setTimeout(r, 20))
    expect(settled).toBe(false)
    modal.close()
  })
})

describe('AuthModal — modes', () => {
  it('popup mode opens a top-level window (no iframe)', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(fakePopup())
    const modal = new AuthModal()
    void modal.open(HOSTED, 'popup')
    expect(openSpy).toHaveBeenCalledWith(HOSTED, 'onelo-auth', expect.stringContaining('width='))
    expect(document.querySelector('iframe')).toBeNull()
    modal.close()
  })

  it('embedded mode injects an iframe (no window.open)', () => {
    const openSpy = vi.spyOn(window, 'open')
    const modal = new AuthModal()
    void modal.open(HOSTED, 'embedded')
    // `iframe[src]` targets the HOSTED frame specifically — the overlay also
    // contains a srcdoc skeleton iframe painted behind it.
    expect(document.querySelector('iframe[src]')?.getAttribute('src')).toBe(HOSTED)
    expect(openSpy).not.toHaveBeenCalled()
    modal.close()
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('embedded mode paints a skeleton behind the hosted frame, dropped on onelo:ready', () => {
    const modal = new AuthModal()
    void modal.open(HOSTED, 'embedded')
    const skeleton = () => document.querySelector('iframe[aria-hidden="true"]')
    expect(skeleton()).not.toBeNull()
    expect(skeleton()?.getAttribute('srcdoc')).toContain('onelo-shimmer')

    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'onelo:ready' }, origin: new URL(HOSTED).origin }),
    )
    expect(skeleton()).toBeNull()
    modal.close()
  })

  it('embedded ✕ stays hidden on a healthy load (sign-in is the first screen, not a modal)', () => {
    const modal = new AuthModal()
    void modal.open(HOSTED, 'embedded')
    const x = () => document.querySelector<HTMLElement>('[data-onelo-cancel]')
    // Hidden from the very first frame — no flash before the page paints.
    expect(x()?.style.display).toBe('none')

    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'onelo:ready' }, origin: new URL(HOSTED).origin }),
    )
    // Still hidden after the hosted page reports ready.
    expect(x()?.style.display).toBe('none')
    modal.close()
  })

  it('defaults to popup', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(fakePopup())
    const modal = new AuthModal()
    void modal.open(HOSTED)
    expect(openSpy).toHaveBeenCalled()
    modal.close()
  })

  it('reports a blocked popup as an error (with the embedded hint)', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    const modal = new AuthModal()
    const res = await modal.open(HOSTED, 'popup')
    expect(res.type).toBe('error')
    expect((res as { message: string }).message).toMatch(/embedded/)
  })
})
