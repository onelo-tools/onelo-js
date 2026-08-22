import { TOKEN_KEYS, type TokenKey } from '@onelo/core'

export { TOKEN_KEYS, type TokenKey }

/**
 * Token storage using localStorage with in-memory fallback
 * (for environments where localStorage is unavailable, e.g. SSR).
 */
export class TokenStorage {
  private memory: Map<string, string> = new Map()
  private useLocalStorage: boolean

  constructor() {
    this.useLocalStorage = typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
  }

  async get(key: string): Promise<string | null> {
    if (this.useLocalStorage) {
      try {
        // Prefer the persisted value, but fall back to the memory copy: after a
        // failed write we hold the only copy there.
        return localStorage.getItem(key) ?? this.memory.get(key) ?? null
      } catch {
        this.useLocalStorage = false
      }
    }
    return this.memory.get(key) ?? null
  }

  async set(key: string, value: string): Promise<void> {
    // Always keep a memory copy. `localStorage.setItem` throws in Safari private
    // browsing, when storage is disabled, and on quota — and the throw used to
    // propagate out of saveSession, aborting the sign-in AFTER the one-time code
    // had already been exchanged. The backend had minted a session, the code was
    // spent, and the user was left signed out with nothing to retry.
    //
    // Degrading to memory keeps the session alive for the tab: worse than
    // persistence (a reload signs them out), far better than losing a completed
    // sign-in. Logged, never swallowed — a developer whose users mysteriously
    // lose their session on refresh needs to see WHY.
    this.memory.set(key, value)
    if (!this.useLocalStorage) return
    try {
      localStorage.setItem(key, value)
    } catch (err) {
      this.useLocalStorage = false
      console.warn(
        '[Onelo] localStorage is unavailable (private browsing, disabled storage, or quota) — ' +
        'the session will live for this tab only and a reload will sign the user out. ' +
        'Original error:',
        err,
      )
    }
  }

  async delete(key: string): Promise<void> {
    // BOTH copies, always. `set` deliberately writes to memory as well as
    // localStorage, so removing only the persisted one left the value readable
    // through `get`'s memory fallback — a delete that did not delete. Harmless
    // for tokens that get overwritten on the next sign-in; not harmless for the
    // single-use magic-link verifier, where a stale value binds the NEXT link.
    this.memory.delete(key)
    if (!this.useLocalStorage) return
    try {
      localStorage.removeItem(key)
    } catch (err) {
      // Never swallow: a verifier or token we believe is gone but is not is a
      // security-relevant surprise, not a detail.
      console.warn('[Onelo] could not remove a stored value:', err)
    }
  }

  async clear(): Promise<void> {
    // BOTH copies, always — the `else` here was a real sign-out bug.
    //
    // `set` deliberately writes to memory AS WELL AS localStorage, and `get`
    // falls back to memory. So clearing only localStorage left every token
    // readable: `signOut()` cleared storage, told listeners the session was
    // gone, and the very next `getSession()` handed the same session straight
    // back out of memory. The app stayed signed in and never returned to the
    // sign-in screen (reported 2026-08-18).
    //
    // This is the same defect fixed in `delete` above, missed here because the
    // branch reads as an either/or when the two stores are actually both live.
    this.memory.clear()
    if (!this.useLocalStorage) return
    for (const key of Object.values(TOKEN_KEYS)) {
      try {
        localStorage.removeItem(key)
      } catch (err) {
        // Never swallow: tokens we believe are gone but are not is exactly the
        // surprise this function exists to prevent.
        console.warn('[Onelo] could not clear stored session:', err)
      }
    }
  }
}
