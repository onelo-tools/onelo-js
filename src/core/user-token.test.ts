import { describe, it, expect, vi } from 'vitest'
import { resetUserTokenRefusal, sendWithUserToken } from './user-token'

const REFUSED = { status: 401, json: { detail: { error: 'invalid_user_token' } } }
const OK = { status: 200, json: {} }

describe('sendWithUserToken — one refresh per refusal episode (#518 R1-1)', () => {
  it('concurrent refusals share one refresh; later refusals in the episode go anonymous', async () => {
    const source = { current: vi.fn(async () => 'stale'), refresh: vi.fn(async () => 'fresh') }
    const send = vi.fn(async ({ token }: { token: string | null }) => (token ? REFUSED : OK))
    await Promise.all([
      sendWithUserToken(source, send, () => {}),
      sendWithUserToken(source, send, () => {}),
    ])
    await sendWithUserToken(source, send, () => {})
    expect(source.refresh).toHaveBeenCalledTimes(1)
  })

  it('an accepted token opens a new episode; so does a user change', async () => {
    const source = { current: vi.fn(async () => 'stale'), refresh: vi.fn(async () => 'fresh') }
    let refuse = true
    const send = vi.fn(async ({ token }: { token: string | null }) => (token && refuse ? REFUSED : OK))
    await sendWithUserToken(source, send, () => {})
    refuse = false
    await sendWithUserToken(source, send, () => {}) // accepted → episode over
    refuse = true
    await sendWithUserToken(source, send, () => {})
    expect(source.refresh).toHaveBeenCalledTimes(2)
    resetUserTokenRefusal(source)
    await sendWithUserToken(source, send, () => {})
    expect(source.refresh).toHaveBeenCalledTimes(3)
  })

  it('only a 2xx from a token-checking call ends an episode (R2-1)', async () => {
    const source = { current: vi.fn(async () => 'stale'), refresh: vi.fn(async () => 'fresh') }
    const refusing = vi.fn(async ({ token }: { token: string | null }) => (token ? REFUSED : OK))
    await sendWithUserToken(source, refusing, () => {})
    expect(source.refresh).toHaveBeenCalledTimes(1)
    // Answers that can come before the token is checked do not re-arm the refresh:
    await sendWithUserToken(source, async () => ({ status: 403, json: {} }), () => {})
    await sendWithUserToken(source, async () => ({ status: 503, json: {} }), () => {})
    // batch-ping: a throttled 204 (or even a 200) proves nothing about the token.
    await sendWithUserToken(source, async () => ({ status: 204, json: null }), () => {}, true, false)
    await sendWithUserToken(source, async () => OK, () => {}, true, false)
    await sendWithUserToken(source, refusing, () => {})
    expect(source.refresh).toHaveBeenCalledTimes(1)
  })
})
