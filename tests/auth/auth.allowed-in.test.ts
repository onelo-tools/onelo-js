import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * `isAllowedIn()` — the single "should this user see your app?" signal.
 *
 * Gating on a session alone gives a paid product away: the session says WHO
 * someone is and nothing about whether they may be here. Before this existed the
 * gate had to be hand-assembled from three reads, and our OWN web snippet
 * assembled it wrongly — it never checked for a session, and it called
 * `isPaywallEnabled()`, which existed on Electron and React Native but NOT here.
 * A developer following our documentation called a function that did not exist.
 */
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function mockResponse(status: number, body: unknown) {
  return Promise.resolve({ status, ok: status < 400, json: () => Promise.resolve(body) } as Response)
}

const CONFIG = (paywall: boolean) => ({
  supabase_url: 'https://x.supabase.co',
  supabase_anon_key: 'anon',
  tenant_id: 't1',
  app_name: 'App',
  paywall_enabled: paywall,
})

// The DOMAIN shape importSession takes (camelCase + absolute expiry), not the
// wire shape the backend sends. Matches tests/auth/auth.revocation.test.ts.
const session = (entitlement: string) => ({
  accessToken: 'tok_abc',
  refreshToken: 'ref_xyz',
  expiresAt: Math.floor(Date.now() / 1000) + 100000,
  user: { id: 'u1', email: 'a@b.c', role: 'member', entitlement },
}) as never

async function build(paywall: boolean) {
  mockFetch.mockImplementation((url: string) => {
    if (String(url).includes('/api/sdk/config')) return mockResponse(200, CONFIG(paywall))
    return mockResponse(404, {})
  })
  const { OneloAuth } = await import('../../src/auth/auth')
  const auth = new OneloAuth({ publishableKey: 'onelo_pk_test', apiUrl: 'https://api.onelo.tools' })
  await auth.whenReady()
  return auth
}

// No localStorage reset: this environment has no full DOM storage shim, and
// each test builds its OWN OneloAuth, so sessions never leak between them.
beforeEach(() => { mockFetch.mockReset() })

describe('isAllowedIn', () => {
  it('is false when signed out, even with no paywall', async () => {
    // The composed form this replaces read `!paywalled || hasActiveAccess()`,
    // which is TRUE for a signed-out user of a non-paywalled app.
    const auth = await build(false)
    expect(await auth.isAllowedIn()).toBe(false)
  })

  it('is false for a signed-in user with NO plan when a plan is required', async () => {
    const auth = await build(true)
    await auth.importSession(session('none'))
    expect(await auth.isAllowedIn()).toBe(false)
  })

  it('is true for a signed-in user WITH an active plan', async () => {
    const auth = await build(true)
    await auth.importSession(session('active'))
    expect(await auth.isAllowedIn()).toBe(true)
  })

  it('is true for any signed-in user when the app has no paywall', async () => {
    const auth = await build(false)
    await auth.importSession(session('none'))
    expect(await auth.isAllowedIn()).toBe(true)
  })
})

describe('isPaywallEnabled', () => {
  it('exists — the web snippet has been calling it', async () => {
    // Parity with Electron and React Native. Its absence here is what made the
    // shipped snippet throw.
    const auth = await build(true)
    expect(typeof auth.isPaywallEnabled).toBe('function')
    expect(auth.isPaywallEnabled()).toBe(true)
  })

  it('reports false for an app without a paywall', async () => {
    const auth = await build(false)
    expect(auth.isPaywallEnabled()).toBe(false)
  })
})

describe('isAllowedIn fails CLOSED', () => {
  it('does not need whenReady() to be awaited first', async () => {
    // The bug this pins: called on load, before config resolved,
    // `paywallEnabled` was still false so `!paywallEnabled` was TRUE and a
    // plan-less user was let into a paid app. Apps consult the gate exactly
    // then. `isAllowedIn` now awaits readiness itself.
    // The config response is DELAYED on purpose. With an instant mock the race
    // cannot happen — init finishes before the assertion — and the test passes
    // whether or not the guard exists. It has to be slow to prove anything.
    let releaseConfig: () => void = () => {}
    const configGate = new Promise<void>((r) => { releaseConfig = r })
    mockFetch.mockImplementation(async (url: string) => {
      if (String(url).includes('/api/sdk/config')) {
        await configGate
        return mockResponse(200, CONFIG(true))
      }
      return mockResponse(404, {})
    })
    const { OneloAuth } = await import('../../src/auth/auth')
    const auth = new OneloAuth({ publishableKey: 'onelo_pk_test', apiUrl: 'https://api.onelo.tools' })
    await auth.importSession(session('none'))

    // Ask WHILE config is still in flight — exactly what an app does on load.
    const answer = auth.isAllowedIn()
    releaseConfig()
    expect(await answer).toBe(false)
  })

  it('denies when config never resolved at all', async () => {
    // Offline / 403 / 5xx. `paywallEnabled` is false only because nothing set
    // it — indistinguishable from "no paywall". Unknown must deny: withholding
    // access is recoverable, giving a paid product away is not.
    mockFetch.mockImplementation(() => mockResponse(500, {}))
    const { OneloAuth } = await import('../../src/auth/auth')
    const auth = new OneloAuth({ publishableKey: 'onelo_pk_test', apiUrl: 'https://api.onelo.tools' })
    await auth.whenReady().catch(() => {})
    await auth.importSession(session('active'))
    expect(await auth.isAllowedIn()).toBe(false)
  })
})

describe('the server owns the answer', () => {
  // The rule — no paywall, or a live grant — used to be re-derived here, in
  // Swift and in Flutter: three languages, three copies. Onelo now ships the
  // conclusion as `allowed_in`, and this SDK's job is to read it. That is what
  // makes the next SDK a matter of reading a boolean instead of re-implementing
  // the Access Gate (Adrian, 2026-08-19).

  it('trusts allowed_in over anything it could work out itself', async () => {
    // Deliberately contradictory inputs: a paywalled app and an unentitled user,
    // which the old derivation would refuse. The server said yes — perhaps a
    // grant this client has not seen yet — and the server is the one that knows.
    const auth = await build(true)
    await auth.importSession({
      ...(session('none') as unknown as Record<string, unknown>),
      user: { id: 'u1', email: 'a@b.c', role: 'member', entitlement: 'none', allowedIn: true },
    } as never)

    expect(await auth.isAllowedIn()).toBe(true)
  })

  it('refuses when the server says no, whatever the local flags suggest', async () => {
    const auth = await build(false)   // no paywall locally → old rule said TRUE
    await auth.importSession({
      ...(session('active') as unknown as Record<string, unknown>),
      user: { id: 'u1', email: 'a@b.c', role: 'member', entitlement: 'active', allowedIn: false },
    } as never)

    expect(await auth.isAllowedIn()).toBe(false)
  })

  it('still works against a backend that has not shipped the field yet', async () => {
    // Compatibility, not a second source of truth: without this an app would be
    // locked out the moment the SDK updated ahead of the backend.
    const auth = await build(true)
    await auth.importSession(session('active'))
    expect(await auth.isAllowedIn()).toBe(true)
  })
})

describe('after a purchase', () => {
  it('refreshes the ANSWER, not just the entitlement', async () => {
    // The scenario this exists for: a user with no plan buys one. The SDK calls
    // /auth/user to pick the change up. Refreshing only `entitlement` would
    // leave the stored answer saying "not allowed" for someone who had just
    // paid — locked out of the thing they bought, by the very call meant to let
    // them in (found while wiring this up, 2026-08-19).
    const auth = await build(true)
    await auth.importSession({
      ...(session('none') as unknown as Record<string, unknown>),
      user: { id: 'u1', email: 'a@b.c', role: 'member', entitlement: 'none', allowedIn: false },
    } as never)
    expect(await auth.isAllowedIn(), 'before the purchase').toBe(false)

    mockFetch.mockImplementation((url: string) => {
      if (String(url).includes('/api/sdk/auth/user')) {
        return mockResponse(200, { entitlement: 'active', allowed_in: true })
      }
      return mockResponse(200, CONFIG(true))
    })
    await auth.revalidateEntitlement()

    expect(await auth.isAllowedIn(), 'the paid user must be let in').toBe(true)
  })

  it('keeps the previous answer when the backend omits it', async () => {
    // An older backend sends `entitlement` and nothing else. Overwriting the
    // stored answer with `undefined` would silently drop back to the legacy
    // derivation for the rest of the session.
    const auth = await build(true)
    await auth.importSession({
      ...(session('active') as unknown as Record<string, unknown>),
      user: { id: 'u1', email: 'a@b.c', role: 'member', entitlement: 'active', allowedIn: true },
    } as never)

    mockFetch.mockImplementation((url: string) => {
      if (String(url).includes('/api/sdk/auth/user')) return mockResponse(200, { entitlement: 'active' })
      return mockResponse(200, CONFIG(true))
    })
    await auth.revalidateEntitlement()

    expect(await auth.isAllowedIn()).toBe(true)
  })
})
