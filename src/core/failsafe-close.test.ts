// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { installFailsafeClose } from './failsafe-close'

describe('installFailsafeClose (#40 fail-safe close ✕)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('hides the button immediately on mount (no double-✕ on a normal load)', () => {
    const btn = document.createElement('button')
    btn.style.display = 'flex'
    installFailsafeClose(btn)
    expect(btn.style.display).toBe('none')
  })

  it('reveals the button — restoring its ORIGINAL display — after the grace with no ready', () => {
    const btn = document.createElement('button')
    btn.style.display = 'flex' // e.g. the portal chip
    installFailsafeClose(btn, 3500)
    vi.advanceTimersByTime(3499)
    expect(btn.style.display).toBe('none') // not yet
    vi.advanceTimersByTime(1)
    expect(btn.style.display).toBe('flex') // grace elapsed → shown, flex preserved
  })

  it('restores empty/default display for a button with no inline display (the feedback ✕)', () => {
    const btn = document.createElement('button') // no inline display set
    installFailsafeClose(btn, 1000)
    expect(btn.style.display).toBe('none')
    vi.advanceTimersByTime(1000)
    expect(btn.style.display).toBe('')
  })

  it('markReady() keeps it hidden and cancels the pending grace reveal (#44 no-flash)', () => {
    const btn = document.createElement('button')
    btn.style.display = 'flex'
    const fs = installFailsafeClose(btn, 3500)
    fs.markReady()
    expect(btn.style.display).toBe('none')
    vi.advanceTimersByTime(10_000)
    expect(btn.style.display).toBe('none') // never flashed
  })

  it('markReady() after a late reveal hides the button again (slow load then ready)', () => {
    const btn = document.createElement('button')
    btn.style.display = 'flex'
    const fs = installFailsafeClose(btn, 3500)
    vi.advanceTimersByTime(3500)
    expect(btn.style.display).toBe('flex') // revealed by grace
    fs.markReady()
    expect(btn.style.display).toBe('none') // hosted ✕ took over → hide ours
  })

  it('rearm() brings the fail-safe back after markReady (portal → store re-navigation)', () => {
    const btn = document.createElement('button')
    btn.style.display = 'flex'
    const fs = installFailsafeClose(btn, 3500)
    fs.markReady() // portal page hid it
    expect(btn.style.display).toBe('none')
    fs.rearm() // navigated to /store/hosted (no canonical ✕)
    expect(btn.style.display).toBe('none') // hidden during the new grace…
    vi.advanceTimersByTime(3500)
    expect(btn.style.display).toBe('flex') // …then revealed, since store never signals ready
  })

  it('rearm() then a fresh markReady hides it again (destination that DOES signal ready)', () => {
    const btn = document.createElement('button')
    btn.style.display = 'flex'
    const fs = installFailsafeClose(btn, 3500)
    fs.markReady()
    fs.rearm()
    fs.markReady() // new page posted ready before the grace elapsed
    vi.advanceTimersByTime(5000)
    expect(btn.style.display).toBe('none')
  })

  it('dispose() cancels the pending grace reveal (modal closed before load)', () => {
    const btn = document.createElement('button')
    btn.style.display = 'flex'
    const fs = installFailsafeClose(btn, 3500)
    fs.dispose()
    vi.advanceTimersByTime(10_000)
    expect(btn.style.display).toBe('none')
  })
})
