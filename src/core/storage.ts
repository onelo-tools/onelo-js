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
      return localStorage.getItem(key)
    }
    return this.memory.get(key) ?? null
  }

  async set(key: string, value: string): Promise<void> {
    if (this.useLocalStorage) {
      localStorage.setItem(key, value)
    } else {
      this.memory.set(key, value)
    }
  }

  async delete(key: string): Promise<void> {
    if (this.useLocalStorage) {
      localStorage.removeItem(key)
    } else {
      this.memory.delete(key)
    }
  }

  async clear(): Promise<void> {
    if (this.useLocalStorage) {
      for (const key of Object.values(TOKEN_KEYS)) {
        localStorage.removeItem(key)
      }
    } else {
      this.memory.clear()
    }
  }
}
