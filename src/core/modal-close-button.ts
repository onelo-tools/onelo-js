/**
 * A visible, accessible close (✕) button for the SDK's fullscreen hosted modals
 * (auth / store / customer portal). Rendered as a circular chip in the top-right
 * corner so it reads as an OBVIOUS affordance — the bare, 50%-opacity ✕ it
 * replaced was routinely missed on the edge-to-edge portal (users pressed browser
 * Back, which doesn't dismiss a DOM overlay, and got stuck).
 *
 * Carries `data-onelo-cancel` so callers wire the click the same way they already
 * did. Hover state is applied via JS listeners because inline styles can't hold a
 * `:hover` pseudo-class and these SDK modals inject no stylesheet.
 */
import { NEUTRAL_BRAND_TOKENS, type BrandTokens } from '@onelo/core'

export function createModalCloseButton(t: BrandTokens = NEUTRAL_BRAND_TOKENS): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.setAttribute('data-onelo-cancel', '')
  btn.setAttribute('aria-label', 'Close')
  btn.setAttribute('title', 'Close')
  btn.textContent = '✕'

  // Chip painted from the app's brand tokens (#681): card surface, border
  // ring, text glyph — readable on a light page as on a dark one.
  const bg = t.card_bg
  const border = t.border
  btn.style.cssText = [
    'position:absolute', 'top:16px', 'right:16px',
    'width:36px', 'height:36px',
    'display:flex', 'align-items:center', 'justify-content:center',
    `background:${bg}`, `border:1px solid ${border}`, 'border-radius:9999px',
    `color:${t.text}`, 'font-size:15px', 'line-height:1',
    'cursor:pointer', 'padding:0', 'z-index:2',
    'transition:background 120ms ease,border-color 120ms ease,transform 120ms ease',
  ].join(';')

  btn.addEventListener('mouseenter', () => {
    btn.style.background = border
    btn.style.borderColor = t.text_muted
    btn.style.transform = 'scale(1.06)'
  })
  btn.addEventListener('mouseleave', () => {
    btn.style.background = bg
    btn.style.borderColor = border
    btn.style.transform = 'scale(1)'
  })

  return btn
}
