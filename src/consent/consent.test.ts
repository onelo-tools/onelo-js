// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@onelo/core', async () => {
  const actual = await vi.importActual<typeof import('@onelo/core')>('@onelo/core')
  return { ...actual, httpGet: vi.fn(), httpPost: vi.fn() }
})

import { OneloConsent } from './consent'
import { BrandSource } from '@onelo/core'
import { httpGet, httpPost } from '@onelo/core'

const SESSION = { accessToken: 'tok', user: { id: 'u1', email: 'a@b.com' } }

function makeAuth(session: unknown = SESSION) {
  return { getSession: vi.fn(async () => session), signOut: vi.fn(async () => {}), brand: new BrandSource() }
}
function reqRow(o: Record<string, unknown> = {}) {
  return {
    doc_type: 'terms', version_id: 'v-1', version: '2026-06-01',
    enforcement: 'block', blocking: true,
    url: 'https://app/legal/terms', consent_url: 'https://app/legal/terms?gate=1',
    ...o,
  }
}
const flush = () => new Promise((r) => setTimeout(r, 0))
const buttons = () => Array.from(document.querySelectorAll('[data-onelo-consent-gate] button')) as HTMLButtonElement[]

beforeEach(() => {
  ;(httpGet as any).mockReset()
  ;(httpPost as any).mockReset()
  document.body.innerHTML = ''
  document.body.style.overflow = ''
})

describe('OneloConsent — data API', () => {
  it('maps required rows', async () => {
    ;(httpGet as any).mockResolvedValue({ status: 200, json: { required: [reqRow()] } })
    const items = await new OneloConsent('https://api', 'pk', makeAuth() as any).requiredConsents()
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ docType: 'terms', versionId: 'v-1', blocking: true, enforcement: 'block' })
  })

  it('fail-open [] on network error', async () => {
    ;(httpGet as any).mockRejectedValue(new Error('net'))
    expect(await new OneloConsent('https://api', 'pk', makeAuth() as any).requiredConsents()).toEqual([])
  })

  it('[] when signed out (no request)', async () => {
    const c = new OneloConsent('https://api', 'pk', makeAuth(null) as any)
    expect(await c.requiredConsents()).toEqual([])
    expect(httpGet).not.toHaveBeenCalled()
  })

  it('acceptConsent posts snake_case body', async () => {
    ;(httpPost as any).mockResolvedValue({ status: 200, json: {} })
    await new OneloConsent('https://api', 'pk', makeAuth() as any).acceptConsent('v-1')
    expect((httpPost as any).mock.calls[0][1]).toEqual({ document_version_id: 'v-1' })
  })

  it('acceptConsent throws on non-2xx', async () => {
    ;(httpPost as any).mockResolvedValue({ status: 500, json: {} })
    await expect(new OneloConsent('https://api', 'pk', makeAuth() as any).acceptConsent('v-1')).rejects.toBeTruthy()
  })
})

describe('OneloConsent — hard-block gate', () => {
  it('presents a fixed full-viewport overlay + locks scroll for a blocking doc', async () => {
    ;(httpGet as any).mockResolvedValue({ status: 200, json: { required: [reqRow()] } })
    const shown = await new OneloConsent('https://api', 'pk', makeAuth() as any).presentGateIfNeeded()
    expect(shown).toBe(true)
    const overlay = document.querySelector('[data-onelo-consent-gate]') as HTMLElement
    expect(overlay.style.position).toBe('fixed')
    expect(overlay.style.zIndex).toBe('2147483647')
    expect(document.body.style.overflow).toBe('hidden')
    // No dismiss affordance — only Sign out + Accept.
    expect(buttons().map((b) => b.textContent)).toEqual(['Sign out', 'Accept & Continue'])
  })

  it('no overlay when nothing is blocking', async () => {
    ;(httpGet as any).mockResolvedValue({ status: 200, json: { required: [reqRow({ blocking: false })] } })
    expect(await new OneloConsent('https://api', 'pk', makeAuth() as any).presentGateIfNeeded()).toBe(false)
    expect(document.querySelector('[data-onelo-consent-gate]')).toBeNull()
  })

  it('does not stack a second overlay', async () => {
    ;(httpGet as any).mockResolvedValue({ status: 200, json: { required: [reqRow()] } })
    const c = new OneloConsent('https://api', 'pk', makeAuth() as any)
    await c.presentGateIfNeeded()
    await c.presentGateIfNeeded()
    expect(document.querySelectorAll('[data-onelo-consent-gate]').length).toBe(1)
  })

  it('Accept → records, removes overlay, restores scroll, re-checks next', async () => {
    ;(httpGet as any)
      .mockResolvedValueOnce({ status: 200, json: { required: [reqRow()] } })
      .mockResolvedValueOnce({ status: 200, json: { required: [] } })
    ;(httpPost as any).mockResolvedValue({ status: 200, json: {} })
    const c = new OneloConsent('https://api', 'pk', makeAuth() as any)
    await c.presentGateIfNeeded()
    buttons()[1].click() // Accept
    await flush(); await flush()
    expect((httpPost as any).mock.calls[0][1]).toEqual({ document_version_id: 'v-1' })
    expect(document.querySelector('[data-onelo-consent-gate]')).toBeNull()
    expect(document.body.style.overflow).toBe('')
  })

  it('Sign out → signs out + removes overlay', async () => {
    ;(httpGet as any).mockResolvedValue({ status: 200, json: { required: [reqRow()] } })
    const auth = makeAuth()
    const c = new OneloConsent('https://api', 'pk', auth as any)
    await c.presentGateIfNeeded()
    buttons()[0].click() // Sign out
    await flush(); await flush()
    expect(auth.signOut).toHaveBeenCalled()
    expect(document.querySelector('[data-onelo-consent-gate]')).toBeNull()
  })

  it('Accept failure keeps the gate up for retry', async () => {
    ;(httpGet as any).mockResolvedValue({ status: 200, json: { required: [reqRow()] } })
    ;(httpPost as any).mockResolvedValue({ status: 500, json: {} })
    const c = new OneloConsent('https://api', 'pk', makeAuth() as any)
    await c.presentGateIfNeeded()
    buttons()[1].click() // Accept → fails
    await flush(); await flush()
    expect(document.querySelector('[data-onelo-consent-gate]')).toBeTruthy() // still up
    expect(buttons()[1].disabled).toBe(false) // re-enabled for retry
  })

  it('SSE legal.consent_required auto-presents', async () => {
    ;(httpGet as any).mockResolvedValue({ status: 200, json: { required: [reqRow()] } })
    const handlers: Record<string, () => void> = {}
    const stream = { on: (e: string, h: () => void) => { handlers[e] = h } }
    const c = new OneloConsent('https://api', 'pk', makeAuth() as any, true)
    c.attachEventStream(stream as any)
    handlers['legal.consent_required']()
    await flush(); await flush()
    expect(document.querySelector('[data-onelo-consent-gate]')).toBeTruthy()
  })

  it('moves focus into the gate (Accept button) — keyboard entry point', async () => {
    ;(httpGet as any).mockResolvedValue({ status: 200, json: { required: [reqRow()] } })
    await new OneloConsent('https://api', 'pk', makeAuth() as any).presentGateIfNeeded()
    expect(document.activeElement).toBe(buttons()[1]) // Accept
  })

  it('inerts sibling app nodes while blocking, restores on close (keyboard hard-block)', async () => {
    const app = document.createElement('main')
    document.body.appendChild(app)
    ;(httpGet as any).mockResolvedValue({ status: 200, json: { required: [reqRow()] } })
    const c = new OneloConsent('https://api', 'pk', makeAuth() as any)
    await c.presentGateIfNeeded()
    expect(app.hasAttribute('inert')).toBe(true) // background unreachable by Tab/AT
    buttons()[0].click() // Sign out → close
    await flush(); await flush()
    expect(app.hasAttribute('inert')).toBe(false) // restored
  })

  it('does not clear an inert the host app set itself', async () => {
    const app = document.createElement('main')
    app.setAttribute('inert', '')
    document.body.appendChild(app)
    ;(httpGet as any).mockResolvedValue({ status: 200, json: { required: [reqRow()] } })
    const c = new OneloConsent('https://api', 'pk', makeAuth() as any)
    await c.presentGateIfNeeded()
    buttons()[0].click()
    await flush(); await flush()
    expect(app.hasAttribute('inert')).toBe(true) // left as the app had it
  })

  it('dispose() blocks re-present + never re-locks scroll (zombie guard)', async () => {
    ;(httpGet as any).mockResolvedValue({ status: 200, json: { required: [reqRow()] } })
    const c = new OneloConsent('https://api', 'pk', makeAuth() as any)
    c.dispose()
    expect(await c.presentGateIfNeeded()).toBe(false)
    expect(document.querySelector('[data-onelo-consent-gate]')).toBeNull()
    expect(document.body.style.overflow).toBe('')
  })
})
