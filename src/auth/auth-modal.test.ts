// @vitest-environment jsdom
/**
 * The modal's own ✕ — the fail-safe that stops a user being trapped.
 *
 * This file was EMPTY, so the button's behaviour was never asserted anywhere.
 * It does close the modal — but "closes" was the whole of it, and on a surface
 * the user only reached because they have no plan, closing into a locked, empty
 * app reads as nothing happening at all (reported 2026-08-19). What that close
 * must MEAN is pinned in auth.magic-link-handover.test.ts; this file pins that
 * the button works and cleans up after itself.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { AuthModal } from './auth-modal'

const URL_SIGN_IN = 'https://st.onelo.tools/auth/hosted?token=art_x'

beforeEach(() => {
  document.documentElement.replaceChild(document.createElement('body'), document.body)
})

afterEach(() => { vi.unstubAllGlobals() })

function closeButton(): HTMLElement | null {
  return document.querySelector('[data-onelo-cancel]')
}

describe('the fail-safe ✕', () => {
  it('closes the modal when clicked', async () => {
    const modal = new AuthModal()
    const result = modal.open(URL_SIGN_IN, 'embedded')

    const btn = closeButton()
    expect(btn, 'the button must exist to be a fail-safe').toBeTruthy()
    btn!.click()

    expect(await result).toEqual({ type: 'cancelled' })
  })

  it('tears the overlay down, so the app is usable again', async () => {
    const modal = new AuthModal()
    const result = modal.open(URL_SIGN_IN, 'embedded')

    closeButton()!.click()
    await result

    // A modal that resolves but leaves its overlay up is still a trap.
    expect(document.querySelector('iframe')).toBeNull()
    expect(closeButton()).toBeNull()
  })

  it('is hidden on a healthy load and revealed only if the page never signals', async () => {
    // The canonical ✕ belongs to the hosted page; the SDK's own must not sit on
    // top of it. It appears only when the page never says it mounted.
    vi.useFakeTimers()
    const modal = new AuthModal()
    const result = modal.open(URL_SIGN_IN, 'embedded')

    expect(closeButton()!.style.display, 'hidden on mount').toBe('none')
    vi.advanceTimersByTime(4000)
    expect(closeButton()!.style.display, 'revealed after the grace period').not.toBe('none')

    closeButton()!.click()
    vi.useRealTimers()
    await result
  })

  it('a second click cannot resolve twice', async () => {
    const modal = new AuthModal()
    const result = modal.open(URL_SIGN_IN, 'embedded')
    const btn = closeButton()!

    btn.click()
    btn.click()   // the element is detached by now; must not throw either

    expect(await result).toEqual({ type: 'cancelled' })
  })
})
