import { describe, it, expect, beforeEach } from 'vitest'
import { TokenStorage, TOKEN_KEYS } from '../../src/core/storage'

// Use in-memory fallback (no real localStorage in vitest by default)
describe('TokenStorage', () => {
  let storage: TokenStorage

  beforeEach(() => {
    storage = new TokenStorage()
  })

  it('returns null for missing key', async () => {
    expect(await storage.get(TOKEN_KEYS.ACCESS_TOKEN)).toBeNull()
  })

  it('stores and retrieves a value', async () => {
    await storage.set(TOKEN_KEYS.ACCESS_TOKEN, 'tok_abc')
    expect(await storage.get(TOKEN_KEYS.ACCESS_TOKEN)).toBe('tok_abc')
  })

  it('deletes a key', async () => {
    await storage.set(TOKEN_KEYS.ACCESS_TOKEN, 'tok_abc')
    await storage.delete(TOKEN_KEYS.ACCESS_TOKEN)
    expect(await storage.get(TOKEN_KEYS.ACCESS_TOKEN)).toBeNull()
  })

  it('clears all keys', async () => {
    await storage.set(TOKEN_KEYS.ACCESS_TOKEN, 'tok_abc')
    await storage.set(TOKEN_KEYS.REFRESH_TOKEN, 'ref_xyz')
    await storage.clear()
    expect(await storage.get(TOKEN_KEYS.ACCESS_TOKEN)).toBeNull()
    expect(await storage.get(TOKEN_KEYS.REFRESH_TOKEN)).toBeNull()
  })
})
