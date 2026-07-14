import { describe, it, expect } from 'vitest'
import { scrubText, scrubMeta } from './scrubber'

describe('monitor scrubber (PII redaction, mirrors backend)', () => {
  it('redacts secret-looking values in free text', () => {
    expect(scrubText('auth Bearer abc123.def')).toBe('auth [REDACTED]')
    expect(scrubText('key sk_live_ABCDEFGHIJKLMNOP done')).toBe('key [REDACTED] done')
    expect(scrubText('onelo_pk_live_ABCDEFGH tail')).toBe('[REDACTED] tail')
    expect(scrubText('jwt eyJhbGciOi.eyJzdWIi.SflKxwRJ end')).toBe('jwt [REDACTED] end')
    expect(scrubText('card 4111 1111 1111 1111 x')).toBe('card [REDACTED] x')
    expect(scrubText('amex 371449635398431 x')).toBe('amex [REDACTED] x')
  })

  it('preserves the leading boundary char (no lookbehind) and leaves clean text alone', () => {
    expect(scrubText('nothing secret here')).toBe('nothing secret here')
    // boundary char before the token is kept, only the secret is dropped
    expect(scrubText('(sk_test_ABCDEFGHIJKLMNOP)')).toBe('([REDACTED])')
  })

  it('redacts by PII key name; keeps non-PII; adds _onelo_redacted', () => {
    const out = scrubMeta({ password: 'p', api_key: 'k', 'x-groq-key': 'g', note: 'ok', count: 3 })!
    expect(out.password).toBe('[REDACTED]')
    expect(out.api_key).toBe('[REDACTED]')
    expect(out['x-groq-key']).toBe('[REDACTED]') // "key" segment
    expect(out.note).toBe('ok')
    expect(out.count).toBe(3)
    expect(out._onelo_redacted).toEqual(['api_key', 'password', 'x-groq-key'])
  })

  it('does NOT false-positive on "monkey" (key must be a segment)', () => {
    const out = scrubMeta({ monkey: 'banana' })!
    expect(out.monkey).toBe('banana')
    expect(out._onelo_redacted).toBeUndefined()
  })

  it('recurses nested objects/arrays and scrubs string values inside', () => {
    const out = scrubMeta({ nested: { token: 't', msg: 'Bearer xyz' }, arr: ['sk_live_ABCDEFGHIJKLMNOP'] })!
    const nested = out.nested as Record<string, unknown>
    expect(nested.token).toBe('[REDACTED]')  // key match
    expect(nested.msg).toBe('[REDACTED]')     // value match
    expect((out.arr as string[])[0]).toBe('[REDACTED]')
  })

  it('never mutates the input + passes undefined through', () => {
    const input = { password: 'p' }
    scrubMeta(input)
    expect(input.password).toBe('p')
    expect(scrubMeta(undefined)).toBeUndefined()
  })
})
