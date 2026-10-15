import { describe, it, expect, vi, afterEach } from 'vitest'
import { Onelo } from './onelo'

// #518 wiring: Onelo hands features the signed-in session's access token
// (auth.getSession) and, on a refused token, auth.refreshSession.
describe('Onelo — Features calls use the auth session token (#518)', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('resolve carries the session access token; a refused one is refreshed through auth', async () => {
    const bearers: Array<string | undefined> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string> | undefined)?.['Authorization']
      if (String(url).includes('/features/resolve')) {
        bearers.push(auth)
        if (auth === 'Bearer old') {
          return { status: 401, json: async () => ({ detail: { error: 'invalid_user_token' } }) }
        }
      }
      return { status: 200, json: async () => ({ features: {} }) }
    }))
    const onelo = new Onelo({ publishableKey: 'onelo_pk_test_x', apiUrl: 'https://api.onelo.tools' })
    // Let the constructor's anonymous load(null) finish before measuring.
    await new Promise((r) => setTimeout(r, 0))
    const session = (token: string) => ({ accessToken: token, refreshToken: 'r', expiresAt: 0, user: { id: 'u1' } })
    vi.spyOn(onelo.auth, 'getSession').mockResolvedValue(session('old') as never)
    const refresh = vi.spyOn(onelo.auth, 'refreshSession').mockResolvedValue(session('new') as never)

    bearers.length = 0
    await onelo.features.refresh(true)

    expect(bearers).toEqual(['Bearer old', 'Bearer new'])
    expect(refresh).toHaveBeenCalledTimes(1)
    onelo.destroy()
  })

  it('a server that refuses every token does not loop refresh → reload → refresh (R1-1)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const featureCalls: Array<string | undefined> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string> | undefined)?.['Authorization']
      if (String(url).includes('/api/sdk/features/')) {
        featureCalls.push(auth)
        if (auth) return { status: 401, json: async () => ({ detail: { error: 'invalid_user_token' } }) }
      }
      return { status: 200, json: async () => ({ features: {} }) }
    }))
    // Test key → batch-ping always fires on load, which is what drove the loop.
    const onelo = new Onelo({ publishableKey: 'onelo_pk_test_x', apiUrl: 'https://api.onelo.tools' })
    onelo.features.declare(['hero'])
    await new Promise((r) => setTimeout(r, 0))
    let n = 0
    const session = () => ({ accessToken: `tok-${n}`, refreshToken: 'r', expiresAt: 0, user: { id: 'u1' } })
    vi.spyOn(onelo.auth, 'getSession').mockImplementation(async () => session() as never)
    // Like the real refresh: a new token, saved, and the auth listeners notified
    // — which makes Onelo re-run features.load() for the same user.
    const refresh = vi.spyOn(onelo.auth, 'refreshSession').mockImplementation(async () => {
      n++
      const s = session()
      ;(onelo.auth as unknown as { notifyListeners: (s: unknown) => void }).notifyListeners(s)
      return s as never
    })
    const notify = (onelo.auth as unknown as { notifyListeners: (s: unknown) => void })
    notify.notifyListeners(session()) // sign-in → features.load('u1')
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0))

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(featureCalls.length).toBeLessThan(15)
    onelo.destroy()
  })

  it('a throttled batch-ping (204) does not re-arm the refresh while resolve keeps refusing (R2-1)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const featureCalls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string> | undefined)?.['Authorization']
      if (String(url).includes('/batch-ping')) { featureCalls.push('ping'); return { status: 204, json: async () => null } }
      if (String(url).includes('/api/sdk/features/')) {
        featureCalls.push('resolve')
        if (auth) return { status: 401, json: async () => ({ detail: { error: 'invalid_user_token' } }) }
      }
      return { status: 200, json: async () => ({ features: {} }) }
    }))
    const onelo = new Onelo({ publishableKey: 'onelo_pk_test_x', apiUrl: 'https://api.onelo.tools' })
    onelo.features.declare(['hero'])
    await new Promise((r) => setTimeout(r, 0))
    let n = 0
    const session = () => ({ accessToken: `tok-${n}`, refreshToken: 'r', expiresAt: 0, user: { id: 'u1' } })
    vi.spyOn(onelo.auth, 'getSession').mockImplementation(async () => session() as never)
    const notify = (s: unknown) => (onelo.auth as unknown as { notifyListeners: (s: unknown) => void }).notifyListeners(s)
    const refresh = vi.spyOn(onelo.auth, 'refreshSession').mockImplementation(async () => {
      n++
      const s = session()
      notify(s)
      return s as never
    })
    notify(session())
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0))

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(featureCalls.length).toBeLessThan(15)
    onelo.destroy()
  })
})

// #820 wiring: Onelo hands feedback the same signed-in session token, so a
// signed-in user's report names a verified reporter without a userId.
describe('Onelo — feedback initiate uses the auth session token (#820)', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('feedback.open() sends the session access token as Bearer', async () => {
    const initiates: Array<string | undefined> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/feedback/initiate')) {
        initiates.push((init?.headers as Record<string, string> | undefined)?.['Authorization'])
        return { ok: true, status: 200, json: async () => ({ hosted_url: 'https://hosted.example/f' }) }
      }
      return { ok: true, status: 200, json: async () => ({ features: {} }) }
    }))
    const onelo = new Onelo({ publishableKey: 'onelo_pk_test_x', apiUrl: 'https://api.onelo.tools' })
    await new Promise((r) => setTimeout(r, 0))
    vi.spyOn(onelo.auth, 'getSession').mockResolvedValue(
      { accessToken: 'at-1', refreshToken: 'r', expiresAt: 0, user: { id: 'u1' } } as never)
    // jsdom-free: stop before the modal is drawn — only the initiate matters here.
    vi.spyOn(onelo.feedback as unknown as { _openModal: () => void }, '_openModal').mockImplementation(() => {})

    await onelo.feedback.open()

    expect(initiates).toEqual(['Bearer at-1'])
    onelo.destroy()
  })
})
