// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OneloFeedback } from './feedback'

/**
 * Guards the #40 fix for the JS SDK feedback modal:
 *  - the SDK's own ✕ is a fail-safe (hidden on a normal load, so no double-✕),
 *  - `onelo:ready` hides the fail-safe but does NOT close the modal,
 *  - `onelo:feedback_close` (the canonical hosted ✕) DOES close it — the exact
 *    bug reported: clicking the circular hosted ✕ did nothing,
 *  - `onelo:feedback_submitted` still closes (regression).
 */
describe('OneloFeedback modal — close affordance (#40)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    document.body.innerHTML = ''
    ;(globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ hosted_url: 'https://hosted.example/feedback' }),
    }))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  async function openModal() {
    const fb = new OneloFeedback('https://api.example', 'pk_x', () => [])
    await fb.open()
    const btn = document.querySelector('[data-onelo-cancel]') as HTMLButtonElement | null
    return btn!
  }

  const isOpen = () => document.querySelector('iframe') !== null
  const send = (type: string) =>
    window.dispatchEvent(new MessageEvent('message', { data: { type } }))

  it('renders the fail-safe ✕ HIDDEN on open (no double-✕ against the hosted ✕)', async () => {
    const btn = await openModal()
    expect(btn).toBeTruthy()
    expect(btn.style.display).toBe('none')
    expect(isOpen()).toBe(true)
  })

  it('onelo:ready hides the fail-safe and leaves the modal OPEN', async () => {
    const btn = await openModal()
    send('onelo:ready')
    expect(btn.style.display).toBe('none')
    expect(isOpen()).toBe(true)
  })

  it('onelo:feedback_close CLOSES the modal (the reported bug)', async () => {
    await openModal()
    expect(isOpen()).toBe(true)
    send('onelo:feedback_close')
    expect(isOpen()).toBe(false)
  })

  it('onelo:feedback_submitted still closes the modal', async () => {
    await openModal()
    send('onelo:feedback_submitted')
    expect(isOpen()).toBe(false)
  })

  it('after the grace period with no ready, the fail-safe ✕ appears and still closes on click', async () => {
    const btn = await openModal()
    vi.advanceTimersByTime(3500)
    expect(btn.style.display).toBe('flex') // #681: the shared brand ✕ chip (display:flex); was: plain ✕ had no inline display
    btn.click()
    expect(isOpen()).toBe(false)
  })
})

/**
 * #622 — the hosted form's reporter token `ft` lives 30 minutes. A form left
 * open longer asks the SDK for a fresh one on submit; the SDK initiates the
 * same options again and answers only its own iframe, at the hosted origin.
 */
describe('OneloFeedback — renews an expired ft (#622)', () => {
  const HOSTED = 'https://hosted.example/feedback/hosted?key=pk_x&ft=old'
  const FRESH = 'https://hosted.example/feedback/hosted?key=pk_x&ft=fresh'
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    document.body.innerHTML = ''
    fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ hosted_url: HOSTED }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ hosted_url: FRESH }) })
    ;(globalThis as unknown as { fetch: unknown }).fetch = fetchMock
  })
  afterEach(() => { vi.restoreAllMocks() })

  async function openWithFrame() {
    const fb = new OneloFeedback('https://api.example', 'pk_x', () => [])
    await fb.open({ type: 'bug', area: 'checkout', userId: 'u-1' })
    const iframe = document.querySelector('iframe') as HTMLIFrameElement
    const post = vi.spyOn(iframe.contentWindow as Window, 'postMessage')
    return { iframe, post }
  }

  const renewRequest = (source: Window | null, origin = 'https://hosted.example') =>
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'onelo:renew_request', kind: 'feedback', request_id: 'r-1' }, origin, source,
    }))

  it('re-initiates with the same options and answers its iframe with the fresh URL', async () => {
    const { iframe, post } = await openWithFrame()
    renewRequest(iframe.contentWindow)
    await vi.waitFor(() => expect(post).toHaveBeenCalled())
    expect(post).toHaveBeenCalledWith(
      { type: 'onelo:renewed', request_id: 'r-1', hosted_url: FRESH }, 'https://hosted.example')
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(url).toContain('/api/sdk/feedback/initiate?')
    expect(url).toContain('type=bug')
    expect(url).toContain('area=checkout')
    expect((init.headers as Record<string, string>)['X-Onelo-User-Id']).toBe('u-1')
    expect(document.querySelector('iframe')).not.toBeNull() // the modal stays open
  })

  it('a failed initiate answers renew_failed', async () => {
    fetchMock.mockReset()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ hosted_url: HOSTED }) })
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
    const { iframe, post } = await openWithFrame()
    renewRequest(iframe.contentWindow)
    await vi.waitFor(() => expect(post).toHaveBeenCalled())
    expect(post.mock.calls[0][0]).toMatchObject({ type: 'onelo:renew_failed', request_id: 'r-1' })
  })

  it.each([
    ['another origin', 'https://evil.example', true],
    ['another window', 'https://hosted.example', false],
  ])('ignores a request from %s', async (_label, origin, fromFrame) => {
    const { iframe, post } = await openWithFrame()
    renewRequest(fromFrame ? iframe.contentWindow : window, origin)
    await new Promise((r) => setTimeout(r, 10))
    expect(post).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
