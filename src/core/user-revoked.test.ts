// @vitest-environment jsdom
// #831 — every SDK endpoint refuses a banned or deleted App User with
// 403 {"detail":{"error":"user_revoked","message":"You don't have access"}}.
// The JS SDK turns it into its typed `user_revoked` error, once, with no retry.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../core/storage', () => ({
  TokenStorage: vi.fn().mockImplementation(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
  })),
  TOKEN_KEYS: {
    ACCESS_TOKEN: 'onelo_access_token',
    REFRESH_TOKEN: 'onelo_refresh_token',
    EXPIRES_AT: 'onelo_expires_at',
    USER_JSON: 'onelo_user',
  },
}))

vi.mock('@onelo/core', async () => {
  const actual = await vi.importActual<typeof import('@onelo/core')>('@onelo/core')
  return { ...actual, httpGet: vi.fn(), httpPost: vi.fn() }
})

import { BrandSource, httpGet, httpPost, OneloError } from '@onelo/core'
import { isUserRevokedRefusal } from './user-revoked'
import { OneloConsent } from '../consent/consent'
import { OneloPaywall } from '../paywall/paywall'
import { OneloCustomerPortal } from '../customer-portal/customer-portal'
import { OneloAuth } from '../auth/auth'

const REFUSAL = { status: 403, json: { detail: { error: 'user_revoked', message: "You don't have access" } } }

beforeEach(() => {
  ;(httpGet as any).mockReset()
  ;(httpPost as any).mockReset()
})

async function expectUserRevoked(p: Promise<unknown>) {
  const err = await p.then(() => null, (e) => e)
  expect(err).toBeInstanceOf(OneloError)
  expect((err as OneloError).code).toBe('user_revoked')
}

describe('the unified refusal (#831)', () => {
  it('is recognised in FastAPI and flat shapes, and only for user_revoked', () => {
    expect(isUserRevokedRefusal(REFUSAL.json)).toBe(true)
    expect(isUserRevokedRefusal({ error: 'user_revoked' })).toBe(true)
    expect(isUserRevokedRefusal({ detail: { error: 'invalid_user_token' } })).toBe(false)
    expect(isUserRevokedRefusal(null)).toBe(false)
  })

  it('consent accept reports user_revoked, one request', async () => {
    ;(httpPost as any).mockResolvedValue(REFUSAL)
    const auth = { getSession: vi.fn(async () => ({ accessToken: 'tok' })), brand: new BrandSource() }
    await expectUserRevoked(new OneloConsent('https://api', 'pk', auth as any).acceptConsent('v-1'))
    expect(httpPost).toHaveBeenCalledTimes(1)
  })

  it('paywall manage reports user_revoked, one request', async () => {
    ;(httpGet as any).mockResolvedValue(REFUSAL)
    const paywall = new OneloPaywall('https://api', 'pk', async () => 'tok', async () => {})
    await expectUserRevoked(paywall.openManage())
    expect(httpGet).toHaveBeenCalledTimes(1)
  })

  it('paywall store reports user_revoked', async () => {
    ;(httpGet as any).mockResolvedValue(REFUSAL)
    const paywall = new OneloPaywall('https://api', 'pk', async () => 'tok', async () => {})
    await expectUserRevoked((paywall as any).initiateStore())
    expect(httpGet).toHaveBeenCalledTimes(1)
  })

  it('customer portal reports user_revoked', async () => {
    ;(httpGet as any).mockResolvedValue(REFUSAL)
    const portal = new OneloCustomerPortal('https://api', 'pk', async () => 'tok')
    await expectUserRevoked((portal as any).initiate())
    expect(httpGet).toHaveBeenCalledTimes(1)
  })

  it('the flow reports user_revoked and marks the user revoked', async () => {
    ;(httpGet as any).mockResolvedValue({ status: 200, json: { tenant_id: 't', allow_custom_branding: false } })
    const auth = new OneloAuth({ apiUrl: 'https://api', publishableKey: 'pk' })
    await (auth as any).initPromise
    ;(httpGet as any).mockReset()
    ;(httpGet as any).mockResolvedValue(REFUSAL)
    await expectUserRevoked((auth as any).resolveFlow('tok'))
    expect(httpGet).toHaveBeenCalledTimes(1)
    expect(auth.isUserRevoked).toBe(true)
  })
})
