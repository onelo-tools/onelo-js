import { describe, it, expect, vi, afterEach } from 'vitest'
import { Onelo } from './onelo'

// Onelo.openUpgrade() must route to a WORKING web surface by billing state:
//   active subscriber → customerPortal.open()  (Portal "Change plan")
//   otherwise         → paywall.openStore()     (buy a plan)
// It must NOT drive /upgrade-initiate's store_switch (that hangs the iframe modal
// on the plan-switch terminals — the whole reason this router exists).
describe('Onelo.openUpgrade — web routing', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  function makeOnelo() {
    // Stub fetch so the constructor's background features.load(null) is inert.
    // No EventSource in Node → features takes the resolve fallback (also stubbed).
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, json: () => Promise.resolve({ features: {} }) }))
    return new Onelo({ publishableKey: 'onelo_pk_test_x', apiUrl: 'https://api.onelo.tools' })
  }

  it('routes an active subscriber to the Customer Portal (not the store)', async () => {
    const onelo = makeOnelo()
    vi.spyOn(onelo.auth, 'hasActiveAccess').mockResolvedValue(true)
    const portal = vi.spyOn(onelo.customerPortal, 'open').mockResolvedValue(undefined)
    const store = vi.spyOn(onelo.paywall, 'openStore').mockResolvedValue(null)

    await onelo.openUpgrade('pro') // plan arg is advisory on web — ignored

    expect(portal).toHaveBeenCalledTimes(1)
    // Subscriber lands straight in the plan picker, not the portal home.
    expect(portal).toHaveBeenCalledWith({ intent: 'change_plan' })
    expect(store).not.toHaveBeenCalled()
    onelo.destroy()
  })

  it('routes a non-subscriber to the Store (not the portal)', async () => {
    const onelo = makeOnelo()
    vi.spyOn(onelo.auth, 'hasActiveAccess').mockResolvedValue(false)
    const portal = vi.spyOn(onelo.customerPortal, 'open').mockResolvedValue(undefined)
    const store = vi.spyOn(onelo.paywall, 'openStore').mockResolvedValue(null)

    await onelo.openUpgrade()

    expect(store).toHaveBeenCalledTimes(1)
    expect(portal).not.toHaveBeenCalled()
    onelo.destroy()
  })

  it('never has a paywall.openUpgrade (store_switch) method on web', () => {
    const onelo = makeOnelo()
    expect((onelo.paywall as unknown as { openUpgrade?: unknown }).openUpgrade).toBeUndefined()
    onelo.destroy()
  })
})
