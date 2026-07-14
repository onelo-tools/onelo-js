import { describe, it, expect, vi, afterEach } from 'vitest'
import { OneloFeatures } from './features'

const API = 'https://api.onelo.tools'
const PK = 'onelo_pk_test_abc'

// Stub fetch: /resolve returns the given features snapshot, everything else 200-empty.
function stubResolve(features: Record<string, unknown>) {
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    const body = String(url).includes('/features/resolve')
      ? { features, config_version: 1 }
      : { features: {} }
    return Promise.resolve({ status: 200, json: () => Promise.resolve(body) })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('OneloFeatures — Swift/RN/Electron parity (featureDefaultStatus + subscribe)', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  // ── featureDefaultStatus ──────────────────────────────────────────────────
  it('defaults an unseen slug to hidden (fail-closed)', () => {
    stubResolve({})
    const f = new OneloFeatures(API, PK)
    const s = f.feature('never-seen')
    expect(s.status).toBe('hidden')
    expect(s.isVisible).toBe(false)
    expect(s.isEnabled).toBe(false)
  })

  it('featureDefaultStatus: "enabled" makes unseen slugs usable (dev preview)', () => {
    stubResolve({})
    const f = new OneloFeatures(API, PK, undefined, { featureDefaultStatus: 'enabled' })
    const s = f.feature('never-seen')
    expect(s.status).toBe('enabled')
    expect(s.isEnabled).toBe(true)
  })

  // ── subscribe() reactivity ────────────────────────────────────────────────
  it('fires subscribers when a resolved snapshot lands, and stops after unsubscribe', async () => {
    stubResolve({ 'adv-export': { status: 'enabled' } })
    const f = new OneloFeatures(API, PK)
    const calls: number[] = []
    const unsub = f.subscribe(() => calls.push(1))
    // load(null) with no stream → _resolve → _applySnapshot → _emitChange (plus
    // the identity-swap emit in load()). At least one change must reach the listener.
    await f.load(null)
    expect(calls.length).toBeGreaterThan(0)
    expect(f.feature('adv-export').isEnabled).toBe(true)

    const afterFirst = calls.length
    unsub()
    f.invalidateCache() // emits a change — but we're unsubscribed now
    expect(calls.length).toBe(afterFirst)
  })

  it('a throwing subscriber does not break the others', async () => {
    stubResolve({ x: { status: 'enabled' } })
    const f = new OneloFeatures(API, PK)
    let goodRan = false
    f.subscribe(() => { throw new Error('bad listener') })
    f.subscribe(() => { goodRan = true })
    await f.load(null)
    expect(goodRan).toBe(true)
  })
})
