import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { _OneloClient } from '../src/client'

describe('_OneloClient', () => {
  const mockFetch = vi.fn()

  beforeEach(() => {
    globalThis.fetch = mockFetch
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sets publishableKey and default baseUrl', () => {
    const client = new _OneloClient('pk_test_123')
    expect(client.publishableKey).toBe('pk_test_123')
    expect(client.baseUrl).toBe('https://api.onelo.tools')
  })

  it('strips trailing slash from custom baseUrl', () => {
    const client = new _OneloClient('pk_test_123', 'http://localhost:3000/')
    expect(client.baseUrl).toBe('http://localhost:3000')
  })

  it('stores identity after setIdentity()', () => {
    const client = new _OneloClient('pk_test_123')
    client.setIdentity('user_abc', 'pro')
    expect(client.userId).toBe('user_abc')
    expect(client.plan).toBe('pro')
  })

  it('userId and plan are null/undefined before identify', () => {
    const client = new _OneloClient('pk_test_123')
    expect(client.userId).toBeNull()
    expect(client.plan).toBeUndefined()
  })

  it('post() calls fetch with correct URL, method, and body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    })
    const client = new _OneloClient('pk_test_123')
    await client.post('/api/test', { foo: 'bar' })
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.onelo.tools/api/test',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ foo: 'bar' }),
      })
    )
  })

  it('post() throws when response is not ok', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 })
    const client = new _OneloClient('pk_test_123')
    await expect(client.post('/api/test', {})).rejects.toThrow('401')
  })
})
