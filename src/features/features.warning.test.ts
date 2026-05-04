/**
 * Tests for the anonymous-mode identify() warning emitted by OneloFeatures._resolve.
 * The backend reports `anonymous: true` + `targeting_misses: N` whenever a request
 * arrives without a userId AND targeted features had to fall back to "hidden".
 * The SDK surfaces this as a one-time console.warn so developers using their own
 * auth system can spot a missing onelo.identify(userId) call.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const httpPostMock = vi.fn()
const httpGetMock = vi.fn()

vi.mock('@onelo/core', async () => {
  const actual = await vi.importActual<typeof import('@onelo/core')>('@onelo/core')
  return {
    ...actual,
    httpPost: (...args: unknown[]) => httpPostMock(...args),
    httpGet: (...args: unknown[]) => httpGetMock(...args),
  }
})

import { OneloFeatures } from './features'

describe('OneloFeatures identify() warning', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    httpPostMock.mockReset()
    httpGetMock.mockReset()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('warns once when backend reports anonymous=true with targeting misses', async () => {
    httpPostMock.mockResolvedValue({
      status: 200,
      json: { features: {}, anonymous: true, targeting_misses: 2 },
    })

    const features = new OneloFeatures('https://api', 'pk_test')
    await features.load(null)

    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0][0]).toContain('2 feature(s) hidden')
    expect(warnSpy.mock.calls[0][0]).toContain('onelo.identify(userId)')
  })

  it('only warns once even when load() is called multiple times', async () => {
    httpPostMock.mockResolvedValue({
      status: 200,
      json: { features: {}, anonymous: true, targeting_misses: 1 },
    })

    const features = new OneloFeatures('https://api', 'pk_test')
    await features.load(null)
    await features.load(null)
    await features.load(null)

    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  it('does not warn when anonymous=false', async () => {
    httpPostMock.mockResolvedValue({
      status: 200,
      json: { features: {}, anonymous: false, targeting_misses: 0 },
    })

    const features = new OneloFeatures('https://api', 'pk_test')
    await features.load('user-123')

    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('does not warn when anonymous=true but targeting_misses is 0', async () => {
    // Anonymous request but no targeted features were defined → no actionable warning
    httpPostMock.mockResolvedValue({
      status: 200,
      json: { features: {}, anonymous: true, targeting_misses: 0 },
    })

    const features = new OneloFeatures('https://api', 'pk_test')
    await features.load(null)

    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('does not warn when suppressIdentifyWarning is true', async () => {
    httpPostMock.mockResolvedValue({
      status: 200,
      json: { features: {}, anonymous: true, targeting_misses: 5 },
    })

    const features = new OneloFeatures('https://api', 'pk_test', undefined, {
      suppressIdentifyWarning: true,
    })
    await features.load(null)

    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('does not warn when backend response omits the anonymous flag (legacy)', async () => {
    // Older backend versions don't set the flag — SDK must not emit false positives
    httpPostMock.mockResolvedValue({
      status: 200,
      json: { features: {} },
    })

    const features = new OneloFeatures('https://api', 'pk_test')
    await features.load(null)

    expect(warnSpy).not.toHaveBeenCalled()
  })
})
