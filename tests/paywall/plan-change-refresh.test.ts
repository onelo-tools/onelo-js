// @vitest-environment jsdom
// #659 — after a store purchase / plan switch the app showed the old plan for
// ~1 min: the modal closed on the hand-back and nothing re-read the features.
// Now every successful hand-back reconciles at once, and a pending switch is
// re-checked on a bounded backoff until the plan moves.
// #635 — the stream's `paywall.access_changed` re-reads the entitlement.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { Onelo } from '../../src/onelo'
import { OneloAuth } from '../../src/auth/auth'
import { PlanChangeRefresher, PENDING_RECHECK_DELAYS_MS } from '../../src/core/plan-change'
import type { OneloEventStream } from '../../src/core/event-stream'

const HOSTED = 'https://st.onelo.tools'
const API = 'https://api.onelo.tools'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

/** The server's answer for `team-report`: upsell until `applied` flips. */
function stubServer(state: { applied: boolean; resolves: number }) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url)
    if (u.includes('/features/resolve')) {
      state.resolves++
      const status = state.applied ? 'enabled' : 'upsell'
      return { status: 200, json: async () => ({ config_version: 3, features: { 'team-report': { status } } }) }
    }
    if (u.includes('/portal-initiate')) {
      return { status: 200, json: async () => ({ hosted_url: `${HOSTED}/customer/portal?token=prt_x` }) }
    }
    if (u.includes('/auth/user')) {
      return { status: 200, json: async () => ({ entitlement: 'active', allowed_in: true }) }
    }
    return { status: 200, json: async () => ({ features: {} }) }
  }))
}

async function signedInOnelo(): Promise<Onelo> {
  const onelo = new Onelo({ publishableKey: 'onelo_pk_live_x', apiUrl: API })
  const session = { accessToken: 'at', refreshToken: 'r', expiresAt: 0, user: { id: 'u1', entitlement: 'active' } }
  vi.spyOn(onelo.auth, 'getSession').mockResolvedValue(session as never)
  await onelo.features.load('u1')
  return onelo
}

async function handBackFromPortal(data: unknown): Promise<void> {
  await vi.waitFor(() => expect(document.querySelector('iframe:not([aria-hidden="true"])')).not.toBeNull())
  const frame = document.querySelector('iframe:not([aria-hidden="true"])') as HTMLIFrameElement
  window.dispatchEvent(new MessageEvent('message', { origin: HOSTED, data, source: frame.contentWindow }))
}

describe('store hand-back reconciles the plan at once (#659)', () => {
  it('a finished plan switch shows the new plan without waiting for the stream', async () => {
    const server = { applied: false, resolves: 0 }
    stubServer(server)
    const onelo = await signedInOnelo()
    expect(onelo.features.feature('team-report').status).toBe('upsell')

    const opened = onelo.customerPortal.open({ intent: 'change_plan' })
    server.applied = true // the switch landed server-side before the store handed back
    await handBackFromPortal({ type: 'onelo:done', reason: 'plan_switched' })
    await opened

    await vi.waitFor(() => expect(onelo.features.feature('team-report').status).toBe('enabled'))
    onelo.destroy()
  })

  it('a purchase handed back through the portal re-reads features and entitlement', async () => {
    const server = { applied: false, resolves: 0 }
    stubServer(server)
    const onelo = await signedInOnelo()
    const revalidate = vi.spyOn(onelo.auth, 'revalidateEntitlement')

    const opened = onelo.customerPortal.open()
    server.applied = true
    await handBackFromPortal({ type: 'onelo:code', code: 'c1' })
    await opened

    await vi.waitFor(() => expect(onelo.features.feature('team-report').status).toBe('enabled'))
    expect(revalidate).toHaveBeenCalled()
    onelo.destroy()
  })

  it('a cancel changes nothing', async () => {
    const server = { applied: false, resolves: 0 }
    stubServer(server)
    const onelo = await signedInOnelo()
    const before = server.resolves

    const opened = onelo.customerPortal.open()
    await handBackFromPortal({ type: 'onelo:cancel' })
    await opened
    await new Promise((r) => setTimeout(r, 0))

    expect(server.resolves).toBe(before)
    onelo.destroy()
  })
})

describe('PlanChangeRefresher — pending switch (#659)', () => {
  function targets(applyAfterRefreshes: number) {
    let refreshes = 0
    let plan = 'pro'
    const t = {
      refreshFeatures: vi.fn(async () => { refreshes++; if (refreshes >= applyAfterRefreshes) plan = 'business' }),
      revalidateEntitlement: vi.fn(async () => {}),
      snapshot: () => plan,
    }
    return t
  }

  it('re-checks on the backoff until the plan moves, then stops', async () => {
    vi.useFakeTimers()
    const t = targets(3) // immediate refresh + 2 re-checks
    await new PlanChangeRefresher(t).handBack({ kind: 'switched', reason: 'plan_switch_pending' })
    expect(t.refreshFeatures).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(PENDING_RECHECK_DELAYS_MS[0])
    expect(t.refreshFeatures).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(PENDING_RECHECK_DELAYS_MS[1])
    expect(t.refreshFeatures).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(t.refreshFeatures).toHaveBeenCalledTimes(3)
    // Entitlement re-read once at the hand-back, once when the plan moved.
    expect(t.revalidateEntitlement).toHaveBeenCalledTimes(2)
  })

  it('gives up after the bounded delays when the plan never moves', async () => {
    vi.useFakeTimers()
    const t = targets(Number.POSITIVE_INFINITY)
    await new PlanChangeRefresher(t).handBack({ kind: 'switched', reason: 'plan_switch_pending' })
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(t.refreshFeatures).toHaveBeenCalledTimes(1 + PENDING_RECHECK_DELAYS_MS.length)
  })

  it('a completed switch refreshes once and does not poll', async () => {
    vi.useFakeTimers()
    const t = targets(Number.POSITIVE_INFINITY)
    await new PlanChangeRefresher(t).handBack({ kind: 'switched', reason: 'plan_switched' })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(t.refreshFeatures).toHaveBeenCalledTimes(1)
    expect(t.revalidateEntitlement).toHaveBeenCalledTimes(1)
  })

  it('cancel stops the re-checks', async () => {
    vi.useFakeTimers()
    const t = targets(Number.POSITIVE_INFINITY)
    const r = new PlanChangeRefresher(t)
    await r.handBack({ kind: 'switched', reason: 'plan_switch_pending' })
    r.cancel()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(t.refreshFeatures).toHaveBeenCalledTimes(1)
  })

  it('ignores hand-backs that cannot move the plan', async () => {
    const t = targets(1)
    const r = new PlanChangeRefresher(t)
    await r.handBack({ kind: 'cancelled' })
    await r.handBack({ kind: 'portal_closed' })
    expect(t.refreshFeatures).not.toHaveBeenCalled()
  })
})

describe('paywall.access_changed on the stream (#635)', () => {
  it('re-reads the entitlement', async () => {
    const handlers = new Map<string, (d: Record<string, unknown>) => void>()
    const stream = { on: (name: string, fn: (d: Record<string, unknown>) => void) => { handlers.set(name, fn) } }
    const auth = new OneloAuth({ publishableKey: 'onelo_pk_live_x', apiUrl: API })
    const revalidate = vi.spyOn(auth, 'revalidateEntitlement').mockResolvedValue('active')
    auth.attachEventStream(stream as unknown as OneloEventStream)
    handlers.get('paywall.access_changed')?.({ app_user_id: 'u1' })
    expect(revalidate).toHaveBeenCalledTimes(1)
  })
})

describe('the store modal reports the plan change (#659)', () => {
  it('openStore: a pending switch reaches the plan-change handler with its reason', async () => {
    const { OneloPaywall } = await import('../../src/paywall/paywall')
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, json: async () => ({ store_url: `${HOSTED}/store/hosted?token=srt_x` }) })))
    const session = { accessToken: 'at', refreshToken: 'rt' } as never
    const paywall = new OneloPaywall(API, 'pk', async () => 'at', async () => {}, async () => session)
    const changes: unknown[] = []
    paywall.setPlanChangeHandler((c) => changes.push(c))

    const opened = paywall.openStore()
    await vi.waitFor(() => expect(document.querySelector('iframe')).not.toBeNull())
    window.dispatchEvent(new MessageEvent('message', { origin: HOSTED, data: { type: 'onelo:done', reason: 'plan_switch_pending' } }))
    await opened
    expect(changes).toEqual([{ kind: 'switched', reason: 'plan_switch_pending' }])
  })
})
