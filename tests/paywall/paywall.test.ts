import { describe, it, expect } from 'vitest'
import { OneloPaywall } from '../../src/paywall/paywall'

describe('OneloPaywall', () => {
  const paywall = new OneloPaywall(
    'https://app.onelo.tools',
    'pk_test',
    async () => null,
    async () => {},
  )

  it('allows access when user plan meets requirement', () => {
    expect(paywall.check('free', 'free')).toBe(true)
    expect(paywall.check('pro', 'pro')).toBe(true)
    expect(paywall.check('pro', 'business')).toBe(true)
    expect(paywall.check('free', 'pro')).toBe(true)
  })

  it('blocks access when user plan is below requirement', () => {
    expect(paywall.check('pro', 'free')).toBe(false)
    expect(paywall.check('business', 'pro')).toBe(false)
    expect(paywall.check('enterprise', 'business')).toBe(false)
  })

  it('defaults userPlan to free', () => {
    expect(paywall.check('pro')).toBe(false)
    expect(paywall.check('free')).toBe(true)
  })

  it('returns false for unknown plans', () => {
    expect(paywall.check('unknown_plan', 'free')).toBe(false)
  })
})
