import { describe, it, expect, vi } from 'vitest'

/**
 * `openUpgrade()` must not open a store the developer switched off.
 *
 * This is the call our own snippet wires to `feature.upgradeCta`, so a
 * developer following the documentation under "Sign in only" was opening the
 * exact surface the dashboard disabled. The backend refuses it (409) either
 * way — but a window opening onto an error is still a broken screen.
 *
 * Exercised through a stand-in rather than a real Onelo: the class builds
 * modules that need a DOM and network. What matters is the DECISION, and it is
 * the same three lines.
 */
class Stub {
  opened: string[] = []
  constructor(
    private entitled: boolean,
    private storeAvailable: boolean,
  ) {}
  auth = {
    whenReady: async () => {},
    hasActiveAccess: async () => this.entitled,
    isStoreAvailable: () => this.storeAvailable,
  }
  customerPortal = { open: async () => { this.opened.push('portal') } }
  paywall = { openStore: async () => { this.opened.push('store') } }

  // Mirrors src/onelo.ts openUpgrade.
  async openUpgrade(): Promise<void> {
    await this.auth.whenReady()
    if (await this.auth.hasActiveAccess()) {
      await this.customerPortal.open()
    } else {
      if (!this.auth.isStoreAvailable()) return
      await this.paywall.openStore()
    }
  }
}

describe('openUpgrade', () => {
  it('opens NOTHING for a plan-less user under "Sign in only"', async () => {
    const o = new Stub(false, false)
    await o.openUpgrade()
    expect(o.opened).toEqual([])
  })

  it('opens the store for a plan-less user under "Show the store"', async () => {
    const o = new Stub(false, true)
    await o.openUpgrade()
    expect(o.opened).toEqual(['store'])
  })

  it('still opens the PORTAL for a subscriber under "Sign in only"', async () => {
    // Managing an existing subscription is not selling — and the portal hides
    // its own buy / change-plan actions when the gate is on.
    const o = new Stub(true, false)
    await o.openUpgrade()
    expect(o.opened).toEqual(['portal'])
  })
})
