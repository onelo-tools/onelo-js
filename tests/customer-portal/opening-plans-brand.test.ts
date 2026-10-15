// @vitest-environment jsdom
// #601 — the SDK's pre-page loading screens ("Opening plans…" and the portal
// skeleton) paint the app's brand from the portal-initiate response, and fall
// back to a neutral arc — never Onelo orange — when the brand is unknown.
// #681: the screens take the SDK's brand tokens; an older backend's two colour
// fields seed them (brandTokensFromResponse).
import { describe, it, expect, vi, afterEach } from 'vitest'

const httpGet = vi.fn()
vi.mock('@onelo/core', async (orig) => ({
  ...(await orig<typeof import('@onelo/core')>()),
  httpGet: (...a: unknown[]) => httpGet(...a),
}))

import { OneloCustomerPortal, openingPlansHtml, portalSkeletonHtml } from '../../src/customer-portal/customer-portal'
import { brandTokensFromResponse, brandTokensFromLegacy, NEUTRAL_BRAND_TOKENS } from '@onelo/core'

afterEach(() => {
  httpGet.mockReset()
  document.body.innerHTML = ''
})

describe('opening-plans loading screen colours', () => {
  it('uses the brand accent and page background', () => {
    const html = openingPlansHtml(brandTokensFromLegacy('#E4007C', '#0E0B1A'))
    expect(html).toContain('border-top-color:#E4007C')
    expect(html).toContain('background:#0E0B1A')
    expect(html).not.toMatch(/f97316/i)
  })

  it('falls back to a neutral arc on #111111 when the brand is unknown', () => {
    const html = openingPlansHtml()
    expect(html).toContain(`border-top-color:${NEUTRAL_BRAND_TOKENS.brand}`)
    expect(html).toContain('background:#111111')
    expect(html).not.toMatch(/f97316/i)
  })

  it('skeleton paints the brand page background', () => {
    expect(portalSkeletonHtml(brandTokensFromLegacy(null, '#0E0B1A'))).toContain('body{background:#0E0B1A')
    expect(portalSkeletonHtml()).toContain('body{background:#111111')
  })

  it('accepts only plain hex colours (values go into srcdoc CSS)', () => {
    const t = brandTokensFromResponse({ primary_color: 'url(x)', checkout_bg_color: ' #0E0B1A ' })!
    expect(t.brand).toBe(NEUTRAL_BRAND_TOKENS.brand)
    expect(t.page_bg).toBe('#0E0B1A')
    const inj = brandTokensFromResponse({ primary_color: 'red;}</style><script>x</script>' })
    expect(inj).toBeNull()
  })
})

describe('OneloCustomerPortal.open', () => {
  function portal() {
    return new OneloCustomerPortal('https://api.test', 'pk_test', async () => 'tok')
  }

  it("change_plan shows the brand-coloured 'Opening plans…' screen", async () => {
    httpGet.mockResolvedValue({
      status: 200,
      json: { hosted_url: 'https://st.onelo.tools/customer/portal?token=prt_x', primary_color: '#E4007C', checkout_bg_color: '#0E0B1A' },
    })
    void portal().open({ intent: 'change_plan' })
    await vi.waitFor(() => expect(document.querySelector('iframe[aria-hidden="true"]')).not.toBeNull())
    const skeleton = document.querySelector('iframe[aria-hidden="true"]') as HTMLIFrameElement
    expect(skeleton.srcdoc).toContain('Opening plans')
    expect(skeleton.srcdoc).toContain('border-top-color:#E4007C')
    expect(skeleton.srcdoc).toContain('background:#0E0B1A')
    const overlay = document.body.lastElementChild as HTMLElement
    expect(overlay.style.background).toMatch(/#0e0b1a|rgb\(14, 11, 26\)/i)
  })

  it('an older backend without brand fields gets the neutral screen, not orange', async () => {
    httpGet.mockResolvedValue({ status: 200, json: { hosted_url: 'https://st.onelo.tools/customer/portal?token=prt_x' } })
    void portal().open({ intent: 'change_plan' })
    await vi.waitFor(() => expect(document.querySelector('iframe[aria-hidden="true"]')).not.toBeNull())
    const skeleton = document.querySelector('iframe[aria-hidden="true"]') as HTMLIFrameElement
    expect(skeleton.srcdoc).toContain(`border-top-color:${NEUTRAL_BRAND_TOKENS.brand}`)
    expect(skeleton.srcdoc).not.toMatch(/f97316/i)
  })
})
