// #1038 — a waitlist join sends the App's language, else the device language;
// the backend stores the join's Page Language (one of the App Languages) on
// the entry for the waitlist emails. Same scenarios in every SDK.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OneloWaitlist } from './waitlist/waitlist'

const mockFetch = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch)
  vi.stubGlobal('navigator', { ...globalThis.navigator, language: 'de-DE' })
  mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, position: 1 }), clone() { return this } })
})

afterEach(() => {
  vi.unstubAllGlobals()
  mockFetch.mockReset()
})

function sentBody(): Record<string, unknown> {
  const [url, init] = mockFetch.mock.calls[0]
  expect(String(url)).toContain('/api/sdk/waitlist/join')
  return JSON.parse(init.body as string)
}

describe('waitlist join language (#1038)', () => {
  const waitlist = () => new OneloWaitlist('https://api.test', 'pk_test')

  it('sends the device language when the App passes none', async () => {
    await waitlist().join('beta', 'ada@example.com')
    expect(sentBody().language).toBe('de-DE')
  })

  it('sends a language the App passes unchanged', async () => {
    await waitlist().join('beta', 'ada@example.com', { language: 'pt-PT' })
    expect(sentBody().language).toBe('pt-PT')
  })

  it('keeps the consent flags next to the language', async () => {
    await waitlist().join(undefined, 'ada@example.com', { consent: { marketing: true }, language: 'pl' })
    expect(sentBody()).toMatchObject({ email: 'ada@example.com', consent: { marketing: true }, language: 'pl' })
  })
})
