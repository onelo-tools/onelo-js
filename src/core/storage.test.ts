import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { TokenStorage, TOKEN_KEYS } from './storage'

/**
 * A completed sign-in must not be lost because the browser refused to persist it.
 *
 * `localStorage.setItem` throws in Safari private browsing, when storage is
 * disabled, and on quota. The write used to be unguarded, so the throw
 * propagated out of `saveSession` — aborting the sign-in AFTER the one-time code
 * had been exchanged. The backend had minted a session, the code was spent, and
 * the user was left signed out with nothing to retry.
 */
const realLocalStorage = globalThis.localStorage
const realWindow = (globalThis as { window?: unknown }).window

function installStorage(impl: Partial<Storage>) {
  // TokenStorage decides from `window.localStorage`, so BOTH must be present —
  // this suite runs in the node environment, which has neither.
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: impl })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: impl },
  })
}

beforeEach(() => { vi.restoreAllMocks() })
afterEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: realLocalStorage })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: realWindow })
})

describe('TokenStorage when localStorage refuses writes', () => {
  it('does NOT throw — the sign-in survives', async () => {
    installStorage({
      getItem: () => null,
      setItem: () => { throw new DOMException('QuotaExceededError') },
      removeItem: () => {},
    })
    const s = new TokenStorage()
    await expect(s.set(TOKEN_KEYS.ACCESS_TOKEN, 'tok')).resolves.toBeUndefined()
  })

  it('keeps the value readable for this tab', async () => {
    installStorage({
      getItem: () => null,
      setItem: () => { throw new Error('denied') },
      removeItem: () => {},
    })
    const s = new TokenStorage()
    await s.set(TOKEN_KEYS.ACCESS_TOKEN, 'tok')
    // Degraded, not lost: a reload signs them out, but the session works now.
    expect(await s.get(TOKEN_KEYS.ACCESS_TOKEN)).toBe('tok')
  })

  it('warns instead of failing silently', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    installStorage({
      getItem: () => null,
      setItem: () => { throw new Error('denied') },
      removeItem: () => {},
    })
    await new TokenStorage().set(TOKEN_KEYS.ACCESS_TOKEN, 'tok')
    expect(warn).toHaveBeenCalled()
    expect(String(warn.mock.calls[0][0])).toMatch(/localStorage is unavailable/)
  })

  it('still persists normally when localStorage works', async () => {
    const store = new Map<string, string>()
    installStorage({
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) },
      removeItem: (k: string) => { store.delete(k) },
    })
    const s = new TokenStorage()
    await s.set(TOKEN_KEYS.USER_JSON, '{"id":"u1"}')
    expect(store.get(TOKEN_KEYS.USER_JSON)).toBe('{"id":"u1"}')
    expect(await s.get(TOKEN_KEYS.USER_JSON)).toBe('{"id":"u1"}')
  })
})

describe('clear', () => {
  it('leaves NOTHING readable — the sign-out bug', async () => {
    // `set` writes memory AND localStorage, and `get` falls back to memory. So
    // clearing only the persisted copy left every token readable: signOut()
    // cleared, notified "signed out", and the next getSession() handed the same
    // session back. The app stayed signed in (reported 2026-08-18).
    //
    // The persisted path must be LIVE for this to mean anything — with no
    // browser storage the old code took its `else` branch and cleared memory,
    // so the bug was invisible.
    const store = new Map<string, string>()
    installStorage({
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) },
      removeItem: (k: string) => { store.delete(k) },
    })

    const s = new TokenStorage()
    await s.set(TOKEN_KEYS.ACCESS_TOKEN, 'at')
    await s.set(TOKEN_KEYS.REFRESH_TOKEN, 'rt')

    await s.clear()

    expect(store.get(TOKEN_KEYS.ACCESS_TOKEN), 'persisted copy').toBeUndefined()
    expect(await s.get(TOKEN_KEYS.ACCESS_TOKEN), 'memory copy').toBeNull()
    expect(await s.get(TOKEN_KEYS.REFRESH_TOKEN)).toBeNull()
  })

  it('clears the memory copy even when persistence failed', async () => {
    // Safari private browsing: the write degraded to memory only. Sign-out has
    // to reach that copy too, or it clears nothing at all.
    installStorage({
      getItem: () => null,
      setItem: () => { throw new Error('denied') },
      removeItem: () => {},
    })

    const s = new TokenStorage()
    await s.set(TOKEN_KEYS.ACCESS_TOKEN, 'at')
    expect(await s.get(TOKEN_KEYS.ACCESS_TOKEN)).toBe('at')

    await s.clear()
    expect(await s.get(TOKEN_KEYS.ACCESS_TOKEN)).toBeNull()
  })
})
