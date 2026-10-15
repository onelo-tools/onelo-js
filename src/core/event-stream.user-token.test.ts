/**
 * #518: the browser `EventSource` cannot send headers, so the signed-in user's
 * access token goes on the Stream Token mint (`POST /stream-token`), read fresh
 * on EVERY connect. A refused token is refreshed and retried once; refused
 * again, that connection is minted and opened anonymous (no Bearer, no userId).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OneloEventStream } from './event-stream'
import type { UserTokenSource } from './user-token'

class MockEventSource {
  static instances: MockEventSource[] = []
  url: string
  onerror: (() => void) | null = null
  readyState = 1
  constructor(url: string) { this.url = url; MockEventSource.instances.push(this) }
  addEventListener() {}
  close() { this.readyState = 2 }
}
const last = () => MockEventSource.instances.at(-1)!
const REFUSED = { status: 401, body: { detail: { error: 'invalid_user_token' } } }

async function settle(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve()
}

/** Mint replies consumed in order; the last repeats. Records the Authorization of each mint. */
function stubMint(replies: Array<{ status: number; body: unknown }> = []) {
  const bearers: Array<string | undefined> = []
  let n = 0
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    bearers.push((init.headers as Record<string, string>)['Authorization'])
    n++
    const r = replies.length > 1 ? replies.shift()! : replies[0] ?? { status: 200, body: { token: `tok-${n}` } }
    return { status: r.status, json: async () => r.body }
  }))
  return bearers
}

function tokens(current: string | null, refreshed: string | null = 'fresh') {
  const source = {
    current: vi.fn(async () => current),
    refresh: vi.fn(async () => refreshed),
  }
  return source
}

describe('OneloEventStream — user token on the Stream Token mint (#518)', () => {
  beforeEach(() => {
    MockEventSource.instances = []
    vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource)
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  const make = (source?: UserTokenSource) =>
    new OneloEventStream('https://api.onelo.tools', 'onelo_pk_test', undefined, source)

  it('signed in: the mint carries Authorization: Bearer <access token>', async () => {
    const bearers = stubMint()
    const s = make(tokens('access-1'))
    s.start('user-1')
    await settle()
    expect(bearers).toEqual(['Bearer access-1'])
    expect(new URL(last().url).searchParams.get('userId')).toBe('user-1')
    s.stop()
  })

  it('every reconnect reads a current token (never a cached one)', async () => {
    const bearers = stubMint()
    let current = 'access-1'
    const s = make({ current: async () => current, refresh: async () => null })
    s.start('user-1')
    await settle()
    current = 'access-2'
    s.reconnect()
    await settle()
    expect(bearers).toEqual(['Bearer access-1', 'Bearer access-2'])
    s.stop()
  })

  it('signed out: the mint carries no Authorization', async () => {
    const bearers = stubMint()
    const s = make(tokens(null))
    s.start(null)
    await settle()
    expect(bearers).toEqual([undefined])
    expect(new URL(last().url).searchParams.get('userId')).toBeNull()
    s.stop()
  })

  it('invalid_user_token → refresh once, re-mint with the new token, open as the user', async () => {
    const bearers = stubMint([REFUSED, { status: 200, body: { token: 'tok-ok' } }])
    const source = tokens('stale')
    const s = make(source)
    s.start('user-1')
    await settle()
    expect(bearers).toEqual(['Bearer stale', 'Bearer fresh'])
    expect(source.refresh).toHaveBeenCalledTimes(1)
    const url = new URL(last().url)
    expect(url.searchParams.get('token')).toBe('tok-ok')
    expect(url.searchParams.get('userId')).toBe('user-1')
    s.stop()
  })

  it('refused again → anonymous mint and stream (no Bearer, no userId), warned, not braked', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bearers = stubMint([REFUSED, REFUSED, { status: 200, body: { token: 'tok-anon' } }])
    const s = make(tokens('stale'))
    s.start('user-1')
    await settle()
    expect(bearers).toEqual(['Bearer stale', 'Bearer fresh', undefined])
    const url = new URL(last().url)
    expect(url.searchParams.get('token')).toBe('tok-anon')
    expect(url.searchParams.get('userId')).toBeNull()
    expect(warn.mock.calls.some((c) => String(c[0]).includes('invalid_user_token'))).toBe(true)
    // The stream is alive (not refused): the next reconnect tries the user again.
    s.reconnect()
    await settle()
    expect(bearers.at(-1)).toBe('Bearer stale')
    s.stop()
  })

  it('a 401 that is not invalid_user_token still brakes the stream (dead key)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bearers = stubMint([{ status: 401, body: { detail: 'invalid key' } }])
    const source = tokens('access-1')
    const s = make(source)
    s.start('user-1')
    await settle()
    expect(bearers).toHaveLength(1)
    expect(source.refresh).not.toHaveBeenCalled()
    expect(MockEventSource.instances).toHaveLength(0)
    s.stop()
  })
})
