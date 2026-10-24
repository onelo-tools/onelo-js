// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@onelo/core', async () => {
  const actual = await vi.importActual<typeof import('@onelo/core')>('@onelo/core')
  return { ...actual, httpPost: vi.fn() }
})

import { httpPost } from '@onelo/core'
import { AFFILIATE_STORAGE_KEY, OneloAffiliates } from './affiliates'

const CLICK = '11111111-2222-3333-4444-555555555555'
const SESSION = { accessToken: 'tok', user: { id: 'u1' } }

function at(search: string) {
  window.history.replaceState(null, '', `/${search}`)
}
const post = httpPost as unknown as ReturnType<typeof vi.fn>

function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
  }
}

beforeEach(() => {
  post.mockReset()
  Object.defineProperty(window, 'localStorage', { configurable: true, value: memoryStorage() })
})

describe('OneloAffiliates.capture (#929)', () => {
  it('stores nothing without consent and only counts a ?ref= anonymously', async () => {
    at('?ref=abcdef1234')
    post.mockResolvedValue({ status: 200, json: { counted: true } })
    const out = await new OneloAffiliates('https://api', 'pk', async () => SESSION).capture({ consent: false })
    expect(out.kept).toBe(false)
    expect(window.localStorage.getItem(AFFILIATE_STORAGE_KEY)).toBeNull()
    expect(post).toHaveBeenCalledTimes(1)
    expect(post.mock.calls[0][0]).toBe('https://api/v1/sdk/affiliates/refused')
  })

  it('records a consented ?ref= click, keeps it, and claims it for the signed-in user', async () => {
    at('?ref=ABCDEF1234')
    post.mockImplementation(async (url: string) =>
      url.endsWith('/click') ? { status: 200, json: { click_id: CLICK, kept: false } } : { status: 200, json: { claimed: true } },
    )
    const out = await new OneloAffiliates('https://api/', 'pk', async () => SESSION).capture({ consent: true })
    expect(out.kept).toBe(true)
    expect(post.mock.calls[0][1]).toMatchObject({ code: 'abcdef1234', source: 'sdk' })
    expect(post.mock.calls[1][0]).toBe('https://api/v1/sdk/affiliates/claim')
    expect(post.mock.calls[1][1]).toMatchObject({ userToken: 'tok', clickId: CLICK })
    expect(JSON.parse(window.localStorage.getItem(AFFILIATE_STORAGE_KEY)!)).toEqual({ click_id: CLICK, claimed_for: 'u1' })
  })

  it('keeps a click forwarded by the tracked link and claims it once', async () => {
    at(`?onelo_click=${CLICK}`)
    post.mockResolvedValue({ status: 200, json: { claimed: true } })
    const aff = new OneloAffiliates('https://api', 'pk', async () => SESSION)
    await aff.capture({ consent: true })
    await aff.claimForSession()
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('sends the kept click as existing so Onelo applies the winner rule', async () => {
    window.localStorage.setItem(AFFILIATE_STORAGE_KEY, JSON.stringify({ click_id: CLICK }))
    at('?ref=zzzzzz9999')
    post.mockResolvedValue({ status: 200, json: { click_id: CLICK, kept: true } })
    await new OneloAffiliates('https://api', 'pk', async () => null).capture({ consent: true })
    expect(post.mock.calls[0][1]).toMatchObject({ existing: CLICK })
  })

  it('keeps the click the tracked link forwards over an earlier one (last click decided by Onelo)', async () => {
    const earlier = '99999999-2222-3333-4444-555555555555'
    window.localStorage.setItem(AFFILIATE_STORAGE_KEY, JSON.stringify({ click_id: earlier, claimed_for: 'u1' }))
    at(`?onelo_click=${CLICK}`)
    post.mockResolvedValue({ status: 200, json: { claimed: true } })
    await new OneloAffiliates('https://api', 'pk', async () => SESSION).capture({ consent: true })
    expect(JSON.parse(window.localStorage.getItem(AFFILIATE_STORAGE_KEY)!)).toEqual({ click_id: CLICK, claimed_for: 'u1' })
    expect(post.mock.calls[0][1]).toMatchObject({ clickId: CLICK })
  })
})
