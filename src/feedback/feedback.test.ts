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
    expect(btn.style.display).toBe('') // plain feedback ✕ has no inline display
    btn.click()
    expect(isOpen()).toBe(false)
  })
})
