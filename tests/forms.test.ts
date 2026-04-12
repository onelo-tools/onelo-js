import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { _OneloClient } from '../src/client'
import { OneloForms } from '../src/forms'

describe('OneloForms', () => {
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
      json: async () => ({ success: true, message: 'Submitted!' }),
    })
    const client = new _OneloClient('pk_test')
    const forms = new OneloForms(client)
    await forms.submit('feedback', { message: 'Hello' })
    expect(mockFetch.mock.calls[0][0]).toContain('/api/sdk/forms/submit')
  })

  it('sends publishableKey, formSlug, and data in body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, message: 'ok' }),
    })
    const client = new _OneloClient('pk_test')
    const forms = new OneloForms(client)
    await forms.submit('contact', { name: 'Ada', email: 'ada@example.com' })
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.publishableKey).toBe('pk_test')
    expect(body.formSlug).toBe('contact')
    expect(body.data).toEqual({ name: 'Ada', email: 'ada@example.com' })
  })

  it('includes submitterEmail when provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, message: 'ok' }),
    })
    const client = new _OneloClient('pk_test')
    const forms = new OneloForms(client)
    await forms.submit('feedback', { msg: 'hi' }, { submitterEmail: 'user@example.com' })
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.submitterEmail).toBe('user@example.com')
  })

  it('omits submitterEmail when not provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, message: 'ok' }),
    })
    const client = new _OneloClient('pk_test')
    const forms = new OneloForms(client)
    await forms.submit('feedback', { msg: 'hi' })
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.submitterEmail).toBeUndefined()
  })

  it('returns FormResult from API response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, message: 'Thank you!' }),
    })
    const client = new _OneloClient('pk_test')
    const forms = new OneloForms(client)
    const result = await forms.submit('feedback', { msg: 'great product' })
    expect(result.success).toBe(true)
    expect(result.message).toBe('Thank you!')
  })

  it('propagates API error', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 422 })
    const client = new _OneloClient('pk_test')
    const forms = new OneloForms(client)
    await expect(forms.submit('feedback', {})).rejects.toThrow('422')
  })
})
