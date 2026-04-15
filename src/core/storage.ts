/**
 * Token storage using localStorage with in-memory fallback
 * (for environments where localStorage is unavailable, e.g. SSR).
 */

export const TOKEN_KEYS = {
  ACCESS_TOKEN: 'onelo_access_token',
  REFRESH_TOKEN: 'onelo_refresh_token',
  EXPIRES_AT: 'onelo_expires_at',
  USER_JSON: 'onelo_user',
} as const

export type TokenKey = typeof TOKEN_KEYS[keyof typeof TOKEN_KEYS]

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
