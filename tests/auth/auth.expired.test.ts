import { describe, it, expect } from 'vitest'
import { isExpiredAuthError } from '../../src/auth/auth'

/**
 * `?error=invalid_token` must be classified as EXPIRED, never as an error.
 *
 * It is what "Use a different account" on the no-plan page sends after signing
 * the user out, and what an idle expiry sends. Treated as an error it reached
 * the developer's users as a raw string for a routine sign-out; the correct
 * response is to re-resolve the flow and reopen on a clean sign-in page. Parity
 * with Swift's `onSessionExpired`.
 */
describe('isExpiredAuthError', () => {
  it.each(['invalid_token', 'expired_token', 'token_expired'])(
    'treats %s as expired',
    (code) => expect(isExpiredAuthError(code)).toBe(true),
  )

  it('leaves a genuine failure as an error', () => {
    // Not a catch-all — reloading on every error would loop on a real failure.
    expect(isExpiredAuthError('attest_invalid')).toBe(false)
    expect(isExpiredAuthError('store_not_configured')).toBe(false)
  })

  it('handles absent values without claiming expiry', () => {
    expect(isExpiredAuthError(null)).toBe(false)
    expect(isExpiredAuthError(undefined)).toBe(false)
    expect(isExpiredAuthError('')).toBe(false)
  })
})
