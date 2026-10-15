import { describe, it, expect, vi, afterEach } from 'vitest'
import { Onelo } from './onelo'

// Onelo.openUpgrade() routes by billing state:
//   entitled user     → customerPortal.openUpgrade()  (/upgrade-initiate's answer,
//                       opened directly — no Customer Portal page in front, #670)
//   entitled, "Sign in only" → customerPortal.open()  (manage only; no store)
//   otherwise         → paywall.openStore()           (buy a plan)
describe('Onelo.openUpgrade — web routing', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  function makeOnelo() {
    // Stub fetch so the constructor's background features.load(null) is inert.
    // No EventSource in Node → features takes the resolve fallback (also stubbed).
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, json: () => Promise.resolve({ features: {} }) }))
    return new Onelo({ publishableKey: 'onelo_pk_test_x', apiUrl: 'https://api.onelo.tools' })
  }

  it('sends an entitled user straight to the resolved upgrade — not through the portal page (#670)', async () => {
    const onelo = makeOnelo()
    vi.spyOn(onelo.auth, 'hasActiveAccess').mockResolvedValue(true)
    const upgrade = vi.spyOn(onelo.customerPortal, 'openUpgrade').mockResolvedValue(undefined)
    const portal = vi.spyOn(onelo.customerPortal, 'open').mockResolvedValue(undefined)
    const store = vi.spyOn(onelo.paywall, 'openStore').mockResolvedValue(null)

    await onelo.openUpgrade('pro') // plan arg is advisory on web — ignored

    expect(upgrade).toHaveBeenCalledTimes(1)
    expect(portal).not.toHaveBeenCalled()
    expect(store).not.toHaveBeenCalled()
    onelo.destroy()
  })

  it('keeps an entitled user of a "Sign in only" app on the portal (manage, never sell)', async () => {
    const onelo = makeOnelo()
    vi.spyOn(onelo.auth, 'hasActiveAccess').mockResolvedValue(true)
    vi.spyOn(onelo.auth, 'isStoreAvailable').mockReturnValue(false)
    const upgrade = vi.spyOn(onelo.customerPortal, 'openUpgrade').mockResolvedValue(undefined)
    const portal = vi.spyOn(onelo.customerPortal, 'open').mockResolvedValue(undefined)

    await onelo.openUpgrade()

    expect(portal).toHaveBeenCalledWith({ intent: 'change_plan' })
    expect(upgrade).not.toHaveBeenCalled()
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

  it('keeps the upgrade on the portal modal, not a second paywall.openUpgrade', () => {
    const onelo = makeOnelo()
    expect((onelo.paywall as unknown as { openUpgrade?: unknown }).openUpgrade).toBeUndefined()
    onelo.destroy()
  })
})
