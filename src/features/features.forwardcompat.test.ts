import { describe, it, expect, vi, afterEach } from 'vitest'
import { OneloFeatures } from './features'

const API = 'https://api.onelo.tools'
const PK = 'onelo_pk_test_abc'

// Reach the private snapshot-apply (the SSE/resolve ingest point) without a live
// stream — mirrors what `connected`/`features_updated` deliver.
function applySnapshot(f: OneloFeatures, features: Record<string, { status: string }>) {
  ;(f as unknown as { _applySnapshot(v: number, features: Record<string, { status: string }>): void })._applySnapshot(1, features)
}

describe('OneloFeatures — unknown-status forward-compat (fail-closed, parity with Swift)', () => {
  it('an unrecognized status from a newer backend normalizes to hidden (not visible)', () => {
    const f = new OneloFeatures(API, PK)
    applySnapshot(f, {
      known: { status: 'enabled' },
      future: { status: 'quantum_superposition' }, // status this SDK version doesn't know
    })

    expect(f.feature('known').status).toBe('enabled')
    expect(f.feature('known').isVisible).toBe(true)

    // Fail-CLOSED: unknown → 'hidden' → NOT visible (pre-fix it stayed the raw
    // string and isVisible was `true`, leaking a broken affordance).
    expect(f.feature('future').status).toBe('hidden')
    expect(f.feature('future').isVisible).toBe(false)
    expect(f.feature('future').isEnabled).toBe(false)
  })

  it('all known statuses pass through unchanged', () => {
    const f = new OneloFeatures(API, PK)
    const all = ['enabled', 'disabled', 'greyed', 'hidden', 'upsell', 'new', 'beta', 'coming_soon']
    applySnapshot(f, Object.fromEntries(all.map((s) => [s, { status: s }])))
    for (const s of all) expect(f.feature(s).status).toBe(s)
  })

  it('feature() records the flag into the monitor on EVERY evaluation (flag↔error bridge)', () => {
    const flags: Array<[string, string]> = []
    const monitor = { _trackFeatureCall: () => {}, recordFlag: (k: string, v: string) => flags.push([k, v]) }
    const f = new OneloFeatures(API, PK, monitor)
    applySnapshot(f, { hero: { status: 'enabled' } })

    f.feature('hero')
    f.feature('hero')            // second eval must also record
    f.feature('future-status')   // unknown in cache → 'hidden'

    expect(flags).toEqual([
      ['hero', 'enabled'],
      ['hero', 'enabled'],
      ['future-status', 'hidden'],
    ])
  })

  it('rich FeatureState: reason/requiredPlan/upgradeCTA + derived badgeLabel/upgradeHint (parity w/ Swift)', () => {
    const f = new OneloFeatures(API, PK)
    applySnapshot(f, {
      locked: { status: 'upsell', reason: 'plan', required_plan: 'pro', required_plan_label: 'Pro', upgrade_cta: true } as never,
      grey: { status: 'greyed', reason: 'plan', required_plan: 'pro' } as never,
      open: { status: 'enabled' },
      weird: { status: 'enabled', reason: 'brand_new_reason' } as never, // unknown reason
    })

    const locked = f.feature('locked')
    expect(locked.status).toBe('upsell')
    expect(locked.reason).toBe('plan')
    expect(locked.requiredPlan).toBe('pro')
    expect(locked.requiredPlanLabel).toBe('Pro')
    expect(locked.upgradeCta).toBe(true)
    expect(locked.badgeLabel).toBe('Available in Pro')
    expect(locked.upgradeHint).toEqual({ requiredPlan: 'pro', currentStatus: 'upsell' })

    const grey = f.feature('grey')
    expect(grey.badgeLabel).toBe('🔒') // locked = padlock, never hidden
    expect(grey.upgradeHint).toEqual({ requiredPlan: 'pro', currentStatus: 'greyed' })

    const open = f.feature('open')
    expect(open.badgeLabel).toBeNull()
    expect(open.upgradeHint).toBeNull()

    expect(f.feature('weird').reason).toBe('unknown') // forward-compat
  })
})

describe('OneloFeatures — persisted cache v2 (+ v1 back-compat)', () => {
  const store: Record<string, string> = {}
  afterEach(() => { for (const k of Object.keys(store)) delete store[k]; vi.unstubAllGlobals() })

  function stubLs() {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v },
    })
  }

  it('v2 round-trips reason/plan through localStorage so a cold start renders upgrade badges', () => {
    stubLs()
    const f1 = new OneloFeatures(API, PK)
    applySnapshot(f1, { locked: { status: 'upsell', reason: 'plan', required_plan: 'pro', required_plan_label: 'Pro' } as never })

    const f2 = new OneloFeatures(API, PK)
    ;(f2 as unknown as { _loadCache(u: string | null): void })._loadCache(null)
    const locked = f2.feature('locked')
    expect(locked.status).toBe('upsell')
    expect(locked.requiredPlanLabel).toBe('Pro')
    expect(locked.badgeLabel).toBe('Available in Pro')
  })

  it('a null/malformed cached entry is skipped, not aborting the whole load', () => {
    stubLs()
    const f = new OneloFeatures(API, PK)
    const key = (f as unknown as { _cacheKey(u: string | null): string })._cacheKey(null)
    store[key] = JSON.stringify({ configVersion: 3, features: { good: { status: 'enabled' }, bad: null } })
    ;(f as unknown as { _loadCache(u: string | null): void })._loadCache(null)
    expect(f.feature('good').status).toBe('enabled') // survived despite the null neighbour
  })

  it('reads a v1 (status-only) cache without crashing', () => {
    stubLs()
    const f = new OneloFeatures(API, PK)
    const key = (f as unknown as { _cacheKey(u: string | null): string })._cacheKey(null)
    store[key] = JSON.stringify({ configVersion: 5, features: { legacy: 'greyed' } }) // old format
    ;(f as unknown as { _loadCache(u: string | null): void })._loadCache(null)
    const legacy = f.feature('legacy')
    expect(legacy.status).toBe('greyed')
    expect(legacy.upgradeCta).toBe(false)
    expect(legacy.badgeLabel).toBe('🔒')
  })
})
