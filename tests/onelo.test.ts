import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Onelo } from '../src/onelo'

describe('Onelo (integration)', () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn()
    globalThis.fetch = mockFetch
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('throws if publishableKey is missing', () => {
    expect(() => new Onelo({ publishableKey: '' })).toThrow('[Onelo] publishableKey is required')
  })

  it('exposes all four module namespaces', () => {
    const onelo = new Onelo({ publishableKey: 'pk_test' })
    expect(onelo.features).toBeDefined()
    expect(onelo.paywall).toBeDefined()
    expect(onelo.forms).toBeDefined()
    expect(onelo.waitlist).toBeDefined()
  })

  it('identify() calls features resolve with the correct plan', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ features: { 'export-button': { status: 'enabled' } }, ttl: 300 }),
    })
    const onelo = new Onelo({ publishableKey: 'pk_live_123' })
    await onelo.identify('user_abc', { plan: 'pro' })
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.publishableKey).toBe('pk_live_123')
    expect(body.userPlan).toBe('pro')
  })

  it('full workflow: identify → features.isEnabled → paywall.check → forms.submit → waitlist.join', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          features: { 'export-button': { status: 'enabled' }, 'analytics': { status: 'upsell' } },
          ttl: 300,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, message: 'Received!' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, position: 7, alreadyJoined: false }),
      })

    const onelo = new Onelo({ publishableKey: 'pk_test' })
    await onelo.identify('user_abc', { plan: 'pro' })

    expect(onelo.features.isEnabled('export-button')).toBe(true)
    expect(onelo.features.status('analytics')).toBe('upsell')
    expect(onelo.features.isEnabled('analytics')).toBe(false)

    expect(onelo.paywall.check('pro')).toBe(true)
    expect(onelo.paywall.check('enterprise')).toBe(false)

    const formResult = await onelo.forms.submit(
      'feedback',
      { message: 'Great product!' },
      { submitterEmail: 'user@example.com' }
    )
    expect(formResult.success).toBe(true)
    expect(formResult.message).toBe('Received!')

    const waitlistResult = await onelo.waitlist.join('beta', 'user@example.com')
    expect(waitlistResult.success).toBe(true)
    expect(waitlistResult.position).toBe(7)
    expect(waitlistResult.alreadyJoined).toBe(false)
  })

  it('identify() without plan works', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ features: {}, ttl: 300 }),
    })
    const onelo = new Onelo({ publishableKey: 'pk_test' })
    await onelo.identify('user_abc')
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.userPlan).toBeUndefined()
  })

  it('paywall.check returns false for paid tiers before identify()', () => {
    const onelo = new Onelo({ publishableKey: 'pk_test' })
    expect(onelo.paywall.check('pro')).toBe(false)
  })

  it('custom baseUrl is respected', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ features: {}, ttl: 300 }),
    })
    const onelo = new Onelo({ publishableKey: 'pk_test', baseUrl: 'http://localhost:4000' })
    await onelo.identify('user_1')
    expect(mockFetch.mock.calls[0][0]).toContain('http://localhost:4000')
  })
})
