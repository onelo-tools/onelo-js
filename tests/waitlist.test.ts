import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { _OneloClient } from '../src/client'
import { OneloWaitlist } from '../src/waitlist'

describe('OneloWaitlist', () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn()
    globalThis.fetch = mockFetch
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls the correct endpoint', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, alreadyJoined: false }),
    })
    const client = new _OneloClient('pk_test')
    const waitlist = new OneloWaitlist(client)
    await waitlist.join('beta', 'user@example.com')
    expect(mockFetch.mock.calls[0][0]).toContain('/api/sdk/waitlist/join')
  })

  it('sends publishableKey, slug, and email in body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, alreadyJoined: false }),
    })
    const client = new _OneloClient('pk_test')
    const waitlist = new OneloWaitlist(client)
    await waitlist.join('early-access', 'ada@example.com')
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.publishableKey).toBe('pk_test')
    expect(body.slug).toBe('early-access')
    expect(body.email).toBe('ada@example.com')
  })

  it('returns WaitlistResult with position when provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, position: 42, alreadyJoined: false }),
    })
    const client = new _OneloClient('pk_test')
    const waitlist = new OneloWaitlist(client)
    const result = await waitlist.join('beta', 'user@example.com')
    expect(result.success).toBe(true)
    expect(result.position).toBe(42)
    expect(result.alreadyJoined).toBe(false)
  })

  it('returns alreadyJoined: true for repeat signups', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: false, alreadyJoined: true }),
    })
    const client = new _OneloClient('pk_test')
    const waitlist = new OneloWaitlist(client)
    const result = await waitlist.join('beta', 'user@example.com')
    expect(result.alreadyJoined).toBe(true)
  })

  it('propagates API error', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 400 })
    const client = new _OneloClient('pk_test')
    const waitlist = new OneloWaitlist(client)
    await expect(waitlist.join('beta', 'bad-email')).rejects.toThrow('400')
  })
})
