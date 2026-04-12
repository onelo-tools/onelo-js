import { describe, it, expect } from 'vitest'
import { _OneloClient } from '../src/client'
import { OneloPaywall } from '../src/paywall'

const makePaywall = (plan?: string) => {
  const client = new _OneloClient('pk_test')
  if (plan !== undefined) client.setIdentity('user_1', plan)
  return new OneloPaywall(client)
}

describe('OneloPaywall', () => {
  describe('check()', () => {
    it('returns true when user plan equals required tier', () => {
      expect(makePaywall('pro').check('pro')).toBe(true)
    })

    it('returns true when user plan exceeds required tier', () => {
      expect(makePaywall('enterprise').check('pro')).toBe(true)
      expect(makePaywall('pro').check('starter')).toBe(true)
      expect(makePaywall('pro').check('free')).toBe(true)
    })

    it('returns false when user plan is below required tier', () => {
      expect(makePaywall('free').check('pro')).toBe(false)
      expect(makePaywall('starter').check('pro')).toBe(false)
      expect(makePaywall('pro').check('enterprise')).toBe(false)
    })

    it('returns false when identify() has not been called (no plan)', () => {
      expect(makePaywall(undefined).check('pro')).toBe(false)
    })

    it('treats unknown plan names as free tier', () => {
      expect(makePaywall('vip').check('pro')).toBe(false)
      expect(makePaywall('vip').check('free')).toBe(true)
    })

    it('treats unknown required tier as free tier', () => {
      expect(makePaywall('pro').check('unknown')).toBe(true)
    })

    it('free plan passes free check', () => {
      expect(makePaywall('free').check('free')).toBe(true)
    })

    it('enterprise plan passes all checks', () => {
      for (const tier of ['free', 'starter', 'pro', 'enterprise']) {
        expect(makePaywall('enterprise').check(tier)).toBe(true)
      }
    })
  })
})
