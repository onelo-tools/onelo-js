import { describe, it, expect } from 'vitest'
import { generateCodeVerifier, generateCodeChallenge } from '@onelo/core'

describe('PKCE helpers', () => {
  it('generates a verifier of correct length', () => {
    const verifier = generateCodeVerifier()
    expect(verifier.length).toBeGreaterThanOrEqual(43)
    expect(verifier.length).toBeLessThanOrEqual(128)
  })

  it('verifier contains only base64url characters', () => {
    const verifier = generateCodeVerifier()
    expect(verifier).toMatch(/^[A-Za-z0-9\-_]+$/)
  })

  it('generates different verifiers each call', () => {
    const a = generateCodeVerifier()
    const b = generateCodeVerifier()
    expect(a).not.toBe(b)
  })

  it('generates a 43-char base64url challenge from verifier', async () => {
    const verifier = generateCodeVerifier()
    const challenge = await generateCodeChallenge(verifier)
    expect(challenge).toMatch(/^[A-Za-z0-9\-_]+$/)
    expect(challenge.length).toBe(43)
  })
})
