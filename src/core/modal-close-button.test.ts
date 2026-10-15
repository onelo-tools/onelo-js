// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { createModalCloseButton } from './modal-close-button'

describe('createModalCloseButton', () => {
  it('carries data-onelo-cancel so existing modal wiring finds it', () => {
    const btn = createModalCloseButton()
    // auth-modal / customer-portal / paywall all locate the button via this attr.
    expect(btn.getAttribute('data-onelo-cancel')).toBe('')
    expect(btn.tagName).toBe('BUTTON')
    expect(btn.textContent).toBe('✕')
  })

  it('is accessible (labelled) and rendered as a visible chip, not a bare glyph', () => {
    const btn = createModalCloseButton()
    expect(btn.getAttribute('aria-label')).toBe('Close')
    expect(btn.getAttribute('title')).toBe('Close')
    // The old faint version had transparent bg + no border; the chip must have both.
    // #681: the chip is the brand's card surface (neutral set before config).
    expect(btn.style.background).toBe('rgb(26, 26, 26)')
    expect(btn.style.border).toContain('1px solid')
    expect(btn.style.borderRadius).toBe('9999px')
    expect(btn.style.width).toBe('36px')
  })

  it('brightens on hover and restores on leave (JS-driven, no :hover stylesheet)', () => {
    const btn = createModalCloseButton()
    const rest = btn.style.background
    btn.dispatchEvent(new MouseEvent('mouseenter'))
    expect(btn.style.background).not.toBe(rest)
    btn.dispatchEvent(new MouseEvent('mouseleave'))
    expect(btn.style.background).toBe(rest)
  })
})
