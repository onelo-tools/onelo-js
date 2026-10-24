import { describe, expect, it } from 'vitest'
import { brandTokensFromLegacy } from '@onelo/core'
import { authSkeletonHtml } from './auth-modal'

// #948: the skeleton has the hosted form's structure for the app's config
// (OAuthButtons.tsx pills + "or" divider; HostedAuthForm magic-link button).
const t = brandTokensFromLegacy(null, '#111111')
const body = (html: string) => html.slice(html.indexOf('<body>'))
const count = (s: string, needle: string) => s.split(needle).length - 1

describe('authSkeletonHtml shape (#948)', () => {
  it.each([0, 1, 3])('%i social providers → that many pills, divider only when > 0', (n) => {
    const b = body(authSkeletonHtml(t, { socialCount: n, magicLink: false }))
    expect(count(b, 'class="strong pill"')).toBe(n)
    expect(count(b, 'class="divider"')).toBe(n > 0 ? 1 : 0)
  })

  it.each([true, false])('magic link %s → row between password and CTA', (on) => {
    const b = body(authSkeletonHtml(t, { socialCount: 0, magicLink: on }))
    expect(count(b, 'class="sk magic"')).toBe(on ? 1 : 0)
    if (on) expect(b).toMatch(/strong input"><\/div>\n<div class="sk magic"><\/div><div class="strong cta"/)
  })

  it('pills sit above the email column, as on the hosted page', () => {
    const b = body(authSkeletonHtml(t, { socialCount: 1, magicLink: true }))
    expect(b.indexOf('pill')).toBeLessThan(b.indexOf('class="col"'))
  })

  it('no shape (config unknown) → minimal: no pills, no magic link', () => {
    const b = body(authSkeletonHtml(t))
    expect(b).not.toContain('pill')
    expect(b).not.toContain('magic')
  })

  it('is fully inline — nothing fetched', () => {
    const html = authSkeletonHtml(t, { socialCount: 3, magicLink: true })
    expect(html).not.toMatch(/<link|<script|src=|url\(/)
  })

  it('light page: logo/heading blocks visible (not page colour)', () => {
    const l = brandTokensFromLegacy(null, '#ffffff')
    expect(authSkeletonHtml(l)).toContain(`.sk{background-color:${l.border};`)
  })
})
