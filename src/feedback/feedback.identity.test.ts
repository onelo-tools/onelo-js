// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OneloFeedback } from './feedback'
import type { UserTokenSource } from '../core/user-token'

/**
 * #820 — a signed-in Onelo Auth user's report names a VERIFIED reporter: the
 * initiate call carries `Authorization: Bearer <access token>`, from which the
 * server signs the reporter with `rv=true`. Signed out, nothing is sent and the
 * report stays anonymous; an explicit `userId` stays an unverified label.
 */
type Call = { url: string; headers: Record<string, string> }

describe('OneloFeedback — Onelo Auth reporter (#820)', () => {
  let calls: Call[]
  let answers: Array<{ status: number; json: unknown }>

  beforeEach(() => {
    document.body.innerHTML = ''
    calls = []
    answers = []
    ;(globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, headers: { ...((init?.headers as Record<string, string>) ?? {}) } })
      const a = answers.shift() ?? { status: 200, json: { hosted_url: 'https://hosted.example/feedback' } }
      return { ok: a.status >= 200 && a.status < 300, status: a.status, json: async () => a.json }
    })
  })
  afterEach(() => { vi.restoreAllMocks() })

  const source = (token: string | null, refreshed: string | null = null): UserTokenSource => ({
    current: async () => token,
    refresh: async () => refreshed,
  })

  it('signed in: sends the access token as Bearer, no userId needed', async () => {
    const fb = new OneloFeedback('https://api.example', 'pk_x', () => [], source('AT_1'))
    await fb.open({ type: 'bug' })
    expect(calls).toHaveLength(1)
    expect(calls[0].headers['Authorization']).toBe('Bearer AT_1')
    expect(calls[0].headers['X-Onelo-User-Id']).toBeUndefined()
    expect(calls[0].url).not.toContain('AT_1')
  })

  it('signed out: no Authorization header and no userId — anonymous', async () => {
    const fb = new OneloFeedback('https://api.example', 'pk_x', () => [], source(null))
    await fb.open()
    expect(calls[0].headers['Authorization']).toBeUndefined()
    expect(calls[0].headers['X-Onelo-User-Id']).toBeUndefined()
  })

  it('signed out with an explicit userId: the unverified label still travels', async () => {
    const fb = new OneloFeedback('https://api.example', 'pk_x', () => [], source(null))
    await fb.open({ userId: 'dev-42' })
    expect(calls[0].headers['Authorization']).toBeUndefined()
    expect(calls[0].headers['X-Onelo-User-Id']).toBe('dev-42')
  })

  it('without a token source (3-argument constructor) the call is unchanged', async () => {
    const fb = new OneloFeedback('https://api.example', 'pk_x', () => [])
    await fb.open()
    expect(calls[0].headers['Authorization']).toBeUndefined()
  })

  it('a refused token is refreshed once and retried with the fresh one', async () => {
    answers.push({ status: 401, json: { detail: { error: 'invalid_user_token' } } })
    const fb = new OneloFeedback('https://api.example', 'pk_x', () => [], source('AT_OLD', 'AT_NEW'))
    await fb.open()
    expect(calls.map(c => c.headers['Authorization'])).toEqual(['Bearer AT_OLD', 'Bearer AT_NEW'])
    expect(document.querySelector('iframe')).not.toBeNull()
  })

  it('refused even after refresh: the form still opens, without the token', async () => {
    answers.push({ status: 401, json: { detail: { error: 'invalid_user_token' } } })
    answers.push({ status: 401, json: { detail: { error: 'invalid_user_token' } } })
    const fb = new OneloFeedback('https://api.example', 'pk_x', () => [], source('AT_OLD', 'AT_NEW'))
    await fb.open({ userId: 'dev-42' })
    expect(calls).toHaveLength(3)
    expect(calls[2].headers['Authorization']).toBeUndefined()
    expect(calls[2].headers['X-Onelo-User-Id']).toBe('dev-42')
    expect(document.querySelector('iframe')).not.toBeNull()
  })
})
