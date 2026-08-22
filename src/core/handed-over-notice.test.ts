// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { showHandedOverNotice } from './handed-over-notice'

/**
 * What the EMAIL TAB shows once the tab the user started in has taken over.
 *
 * The requirement is blunt: only one tab may be the app. This tab still had to
 * complete the exchange — no other origin can write this origin's storage — so
 * the app underneath has already booted. The notice has to cover it completely,
 * not tint it.
 */

beforeEach(() => {
  // See the note in the other suite: a fresh body, so a live observer from the
  // previous test cannot re-attach its overlay into this one.
  document.documentElement.replaceChild(document.createElement('body'), document.body)
})

describe('handed-over notice', () => {
  it('covers the app completely, not as a translucent scrim', () => {
    document.body.innerHTML = '<main id="app">the running app</main>'
    showHandedOverNotice('Turingo')

    const el = document.getElementById('onelo-handed-over')!
    expect(el).toBeTruthy()
    expect(el.style.position).toBe('fixed')
    expect(el.style.inset).toBe('0')
    // Opaque. A see-through overlay leaves the app readable and, worse, looks
    // like something the user can dismiss.
    expect(el.style.background).toBe('rgb(17, 17, 17)')
  })

  it('names the tab to go back to', () => {
    showHandedOverNotice('Turingo')
    const text = document.getElementById('onelo-handed-over')!.textContent ?? ''
    // The user is looking at two tabs that appear identical and has to pick one.
    expect(text).toContain('Turingo')
    expect(text).toMatch(/close this one/i)
  })

  it('still reads sensibly without an app name', () => {
    showHandedOverNotice(null)
    const text = document.getElementById('onelo-handed-over')!.textContent ?? ''
    expect(text).toMatch(/tab you started from/i)
    expect(text).not.toContain('null')
  })

  it('never stacks two overlays', () => {
    // A re-render or a double init must not double the backdrop.
    showHandedOverNotice('Turingo')
    showHandedOverNotice('Turingo')
    expect(document.querySelectorAll('#onelo-handed-over').length).toBe(1)
  })
})

describe('surviving the host app', () => {
  it('comes back when the app replaces the page contents', async () => {
    // Many apps paint by replacing <body> once they learn they are signed in.
    // That wiped this overlay out and left the user with a second running copy
    // of the app — the exact outcome it exists to prevent (observed live
    // 2026-08-18, after the notice itself was already correct).
    showHandedOverNotice('Turingo')
    expect(document.getElementById('onelo-handed-over')).toBeTruthy()

    document.body.innerHTML = '<main>the app just rendered itself</main>'
    expect(document.getElementById('onelo-handed-over')).toBeNull()

    // MutationObserver callbacks are queued as microtasks.
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))

    expect(
      document.getElementById('onelo-handed-over'),
      'the notice must outlast the host app painting over it',
    ).toBeTruthy()
  })
})
