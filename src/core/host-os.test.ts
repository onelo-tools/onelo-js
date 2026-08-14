// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { hostOS } from './host-os'

/**
 * These pin the reason the web SDK sends an OS at all: onelo-js also runs
 * inside Capacitor/Cordova shells, which ARE App Store apps, and the
 * "Require plan on sign-up" gate must be suppressed there.
 * docs/superpowers/plans/2026-08-14-post-purchase-identity.md
 */
describe('hostOS', () => {
  const w = window as unknown as Record<string, unknown>
  afterEach(() => {
    delete w.Capacitor
    delete w.cordova
  })

  it('reports web in a plain browser', () => {
    expect(hostOS()).toBe('web')
  })

  it('reports ios inside a Capacitor iOS shell', () => {
    w.Capacitor = { getPlatform: () => 'ios' }
    expect(hostOS()).toBe('ios')
  })

  it('reports android inside a Capacitor Android shell', () => {
    w.Capacitor = { getPlatform: () => 'android' }
    expect(hostOS()).toBe('android')
  })

  it('reports web for Capacitor running as a PWA', () => {
    w.Capacitor = { getPlatform: () => 'web' }
    expect(hostOS()).toBe('web')
  })

  it('falls back to Capacitor.platform when getPlatform is absent', () => {
    w.Capacitor = { platform: 'ios' }
    expect(hostOS()).toBe('ios')
  })

  it('reports ios inside a Cordova iOS shell', () => {
    w.cordova = { platformId: 'ios' }
    expect(hostOS()).toBe('ios')
  })

  it('does not throw when Capacitor is present but malformed', () => {
    w.Capacitor = {}
    expect(hostOS()).toBe('web')
  })
})
