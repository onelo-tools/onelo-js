import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { _OneloClient } from '../src/client'
import { OneloFeatures } from '../src/features'

const makeClient = () => new _OneloClient('pk_test')

const mockResolveResponse = (features: Record<string, { status: string }>, ttl = 300) => ({
  ok: true,
  json: async () => ({ features, ttl }),
})

describe('OneloFeatures', () => {
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

  describe('_resolve()', () => {
    it('populates cache from API response', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResolveResponse({ 'export-button': { status: 'enabled' } })
      )
      const client = makeClient()
      const features = new OneloFeatures(client)
      await features._resolve()
      expect(features.status('export-button')).toBe('enabled')
    })

    it('sends publishableKey and userPlan in request body', async () => {
      mockFetch.mockResolvedValueOnce(mockResolveResponse({}))
      const client = makeClient()
      const features = new OneloFeatures(client)
      await features._resolve('pro')
      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.publishableKey).toBe('pk_test')
      expect(body.userPlan).toBe('pro')
    })

    it('does not throw on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))
      const client = makeClient()
      const features = new OneloFeatures(client)
      await expect(features._resolve()).resolves.toBeUndefined()
    })

    it('clears previous cache before re-resolving', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResolveResponse({ 'old-feat': { status: 'enabled' } }))
        .mockResolvedValueOnce(mockResolveResponse({ 'new-feat': { status: 'enabled' } }))
      const client = makeClient()
      const features = new OneloFeatures(client)
      await features._resolve()
      await features._resolve()
      expect(features.status('old-feat')).toBe('hidden')
      expect(features.status('new-feat')).toBe('enabled')
    })
  })

  describe('status()', () => {
    it('returns feature status from cache', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResolveResponse({
          'export-button': { status: 'upsell' },
          'dark-mode': { status: 'greyed' },
          'beta-feature': { status: 'hidden' },
        })
      )
      const client = makeClient()
      const features = new OneloFeatures(client)
      await features._resolve()
      expect(features.status('export-button')).toBe('upsell')
      expect(features.status('dark-mode')).toBe('greyed')
      expect(features.status('beta-feature')).toBe('hidden')
    })

    it('returns "hidden" for unknown features', async () => {
      mockFetch.mockResolvedValueOnce(mockResolveResponse({}))
      const client = makeClient()
      const features = new OneloFeatures(client)
      await features._resolve()
      expect(features.status('unknown-feature')).toBe('hidden')
    })

    it('schedules batch-ping for unknown features', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResolveResponse({}))
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      const client = makeClient()
      const features = new OneloFeatures(client)
      await features._resolve()
      features.status('missing-a')
      features.status('missing-b')
      vi.runAllTimers()
      await Promise.resolve()
      const pingCall = mockFetch.mock.calls[1]
      const pingBody = JSON.parse(pingCall[1].body)
      expect(pingCall[0]).toContain('/api/sdk/features/batch-ping')
      expect(pingBody.features).toContain('missing-a')
      expect(pingBody.features).toContain('missing-b')
    })

    it('only sends one batch-ping for multiple unknown features', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResolveResponse({}))
        .mockResolvedValue({ ok: true, json: async () => ({}) })
      const client = makeClient()
      const features = new OneloFeatures(client)
      await features._resolve()
      features.status('feat-1')
      features.status('feat-2')
      features.status('feat-3')
      vi.runAllTimers()
      await Promise.resolve()
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })

  describe('isEnabled()', () => {
    it('returns true when feature status is "enabled"', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResolveResponse({ 'my-feature': { status: 'enabled' } })
      )
      const client = makeClient()
      const features = new OneloFeatures(client)
      await features._resolve()
      expect(features.isEnabled('my-feature')).toBe(true)
    })

    it('returns false for all non-enabled statuses', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResolveResponse({
          'greyed-feat': { status: 'greyed' },
          'hidden-feat': { status: 'hidden' },
          'upsell-feat': { status: 'upsell' },
        })
      )
      const client = makeClient()
      const features = new OneloFeatures(client)
      await features._resolve()
      expect(features.isEnabled('greyed-feat')).toBe(false)
      expect(features.isEnabled('hidden-feat')).toBe(false)
      expect(features.isEnabled('upsell-feat')).toBe(false)
    })

    it('returns false for unknown features', async () => {
      mockFetch.mockResolvedValueOnce(mockResolveResponse({}))
      const client = makeClient()
      const features = new OneloFeatures(client)
      await features._resolve()
      expect(features.isEnabled('never-seen')).toBe(false)
    })
  })
})
