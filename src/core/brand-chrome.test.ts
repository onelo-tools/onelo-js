// @vitest-environment jsdom
// #681 — every piece of the web SDK's own chrome is painted from the backend's
// `brand_tokens`: the auth/store modal container, its skeleton, the ✕ chip, the
// portal loaders, the feedback modal and the consent card.
import { describe, it, expect, afterEach } from 'vitest'
import { BrandSource, parseBrandTokens, NEUTRAL_BRAND_TOKENS, type BrandTokens } from '@onelo/core'
import { AuthModal } from '../auth/auth-modal'
import { createModalCloseButton } from './modal-close-button'
import { openingPlansHtml, portalSkeletonHtml } from '../customer-portal/customer-portal'
import { consentCardStyles } from '../consent/consent'

const T: BrandTokens = parseBrandTokens({
  version: 1,
  page_bg: '#0e0b1a',
  brand: '#e4007c',
  card_bg: '#221133',
  text: '#fafafa',
  text_muted: 'rgba(250,250,250,0.6)',
  border: '#443355',
  button_bg: '#00aa55',
  button_text: '#010101',
  button_radius: 3,
  field_radius: 7,
  card_radius: 21,
  body_font: "'Poppins', sans-serif",
  heading_font: "'Lato', sans-serif",
  spinner_track: 'rgba(255,255,255,0.18)',
  light_bg: false,
})!

function source(t: BrandTokens = T): BrandSource {
  const s = new BrandSource()
  s.set(t)
  return s
}

afterEach(() => { document.body.innerHTML = '' })

describe('web SDK chrome from brand_tokens (#681)', () => {
  it('auth/store modal container + skeleton use page_bg, card_bg and radii', () => {
    void new AuthModal(source()).open('https://st.onelo.tools/auth/hosted', 'embedded')
    const overlay = document.body.lastElementChild as HTMLElement
    expect(overlay.style.background).toBe('rgb(14, 11, 26)')
    const container = overlay.firstElementChild as HTMLElement
    expect(container.style.background).toBe('rgb(14, 11, 26)')
    const skeleton = container.querySelector('iframe[aria-hidden="true"]') as HTMLIFrameElement
    expect(skeleton.srcdoc).toContain('body{background:#0e0b1a')
    expect(skeleton.srcdoc).toContain('background-color:#221133')
    expect(skeleton.srcdoc).toContain('border-radius:3px') // the CTA placeholder = button radius
    expect(skeleton.srcdoc).not.toMatch(/#111111|rgba\(255,255,255,0\.04\)/)
  })

  it('the ✕ chip is card_bg / border / text', () => {
    const btn = createModalCloseButton(T)
    expect(btn.style.background).toBe('rgb(34, 17, 51)')
    expect(btn.style.color).toBe('rgb(250, 250, 250)')
  })

  it('portal loaders: brand arc on the token track, page_bg ground', () => {
    const op = openingPlansHtml(T)
    expect(op).toContain('border-top-color:#e4007c')
    expect(op).toContain('background:#0e0b1a')
    expect(op).toContain('3px solid rgba(255,255,255,0.18)')
    expect(portalSkeletonHtml(T)).toContain('border-radius:21px')
  })

  it('consent card: card_bg, text, button_bg/button_text/button_radius', () => {
    const s = consentCardStyles(T)
    expect(s.card).toContain('background:#221133')
    expect(s.card).toContain('border-radius:21px')
    expect(s.card).toContain('color:#fafafa')
    expect(s.accept).toContain('background:#00aa55')
    expect(s.accept).toContain('color:#010101')
    expect(s.accept).toContain('border-radius:3px')
  })

  it('before config arrives the chrome is neutral, never Onelo orange', () => {
    void new AuthModal(new BrandSource()).open('https://st.onelo.tools/auth/hosted', 'embedded')
    const overlay = document.body.lastElementChild as HTMLElement
    expect(overlay.innerHTML + (overlay.querySelector('iframe') as HTMLIFrameElement).srcdoc).not.toMatch(/f97316|ffa100/i)
    expect(openingPlansHtml(NEUTRAL_BRAND_TOKENS)).toContain(`border-top-color:${NEUTRAL_BRAND_TOKENS.brand}`)
  })
})
