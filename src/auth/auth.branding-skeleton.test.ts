// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OneloAuth } from './auth'
import { parseBrandTokens, skeletonSoftFill } from '@onelo/core'

const API = 'https://backend.test'
const HOSTED = 'https://st.onelo.tools/auth/hosted?token=art_test'
let releaseConfig: (() => void) | null = null

const BRANDINGS = [
  {
    name: 'violet light',
    tokens: {
      version: 1,
      page_bg: '#f4efff', brand: '#8b2be2', card_bg: '#ffffff', text: '#21152e',
      text_muted: 'rgba(33,21,46,0.65)', border: '#c9b3df', button_bg: '#8b2be2',
      button_text: '#ffffff', button_radius: 4, field_radius: 9, card_radius: 18,
      body_font: 'Arial, sans-serif', heading_font: 'Arial, sans-serif',
      spinner_track: 'rgba(33,21,46,0.15)', light_bg: true,
    },
  },
  {
    name: 'teal dark',
    tokens: {
      version: 1,
      page_bg: '#071b20', brand: '#31d6c2', card_bg: '#103238', text: '#f1fffd',
      text_muted: 'rgba(241,255,253,0.65)', border: '#28565b', button_bg: '#31d6c2',
      button_text: '#071b20', button_radius: 22, field_radius: 3, card_radius: 7,
      body_font: 'Arial, sans-serif', heading_font: 'Arial, sans-serif',
      spinner_track: 'rgba(241,255,253,0.15)', light_bg: false,
    },
  },
]

afterEach(() => {
  releaseConfig?.()
  releaseConfig = null
  document.body.replaceChildren()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('SDK auth skeleton first paint', () => {
  it.each(BRANDINGS)('keeps the $name app Branding visible until hosted auth is ready', async ({ tokens }) => {
    let configStarted!: () => void
    const requestStarted = new Promise<void>((resolve) => { configStarted = resolve })
    let unlockConfig!: () => void
    const configGate = new Promise<void>((resolve) => { unlockConfig = resolve })
    releaseConfig = unlockConfig

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/sdk/config')) {
        configStarted()
        await configGate
        return { status: 200, ok: true, json: async () => ({
            supabase_url: 'https://project.supabase.co',
            supabase_anon_key: 'anon',
            tenant_id: 'tenant-1',
            brand_tokens: tokens,
          }) }
      }
      return { status: 200, ok: true, json: async () => ({ action: 'present', surface: 'sign_in', url: HOSTED }) }
    }) as unknown as typeof fetch)

    const auth = new OneloAuth({ apiUrl: API, publishableKey: 'onelo_pk_test' })
    const pending = auth.loadAuthView()
    await requestStarted
    await Promise.resolve()
    expect(document.querySelector('iframe[aria-hidden="true"]')).toBeNull()
    expect(document.body.childElementCount).toBe(0)

    unlockConfig()
    releaseConfig = null
    await vi.waitFor(() => expect(document.querySelector('iframe[aria-hidden="true"]')).toBeTruthy())

    const overlay = document.body.lastElementChild as HTMLElement
    const container = overlay.firstElementChild as HTMLElement
    const skeleton = container.querySelector('iframe[aria-hidden="true"]') as HTMLIFrameElement
    const hosted = container.querySelector('iframe:not([aria-hidden="true"])') as HTMLIFrameElement

    const normalizedPageBg = document.createElement('div')
    normalizedPageBg.style.background = tokens.page_bg
    expect(overlay.style.background).toBe(normalizedPageBg.style.background)
    expect(skeleton.srcdoc).toContain(`body{background:${tokens.page_bg}`)
    // #948: soft blocks use the light-aware fill (border on a light page).
    expect(skeleton.srcdoc).toContain(`.sk{background-color:${skeletonSoftFill(parseBrandTokens(tokens)!)}`)
    expect(skeleton.srcdoc).toContain(`border-radius:${tokens.button_radius}px`)
    expect(skeleton.srcdoc).toContain(`border-radius:${tokens.card_radius}px`)
    expect(hosted.style.opacity).toBe('0')

    const otherFrame = document.createElement('iframe')
    document.body.appendChild(otherFrame)
    window.dispatchEvent(new MessageEvent('message', {
      origin: new URL(HOSTED).origin,
      data: { type: 'onelo:ready' },
      source: otherFrame.contentWindow,
    }))
    expect(hosted.style.opacity).toBe('0')
    expect(container.querySelector('iframe[aria-hidden="true"]')).toBeTruthy()

    window.dispatchEvent(new MessageEvent('message', {
      origin: new URL(HOSTED).origin,
      data: { type: 'onelo:ready' },
      source: hosted.contentWindow,
    }))

    expect(hosted.style.opacity).toBe('1')
    expect(container.querySelector('iframe[aria-hidden="true"]')).toBeNull()

    container.querySelector<HTMLButtonElement>('[data-onelo-cancel]')?.click()
    await expect(pending).resolves.toBeNull()
  })

  it.each([
    {
      name: 'legacy colors',
      config: { primary_color: '#0055ff', checkout_bg_color: '#ffffff' },
      page: '#ffffff',
      // #948: a light page paints the soft blocks with the border colour.
      card: '#e4e4e7',
      button: '#0055ff',
    },
    {
      name: 'no branding fields',
      config: {},
      page: '#111111',
      card: '#1a1a1a',
      button: '#a1a1aa',
    },
  ])('renders $name through the real SDK auth flow', async ({ config, page, card, button }) => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      return { status: 200, ok: true, json: async () => url.includes('/api/sdk/config')
        ? { supabase_url: 'https://project.supabase.co', supabase_anon_key: 'anon', tenant_id: 'tenant-1', ...config }
        : { action: 'present', surface: 'sign_in', url: HOSTED } }
    }) as unknown as typeof fetch)

    const auth = new OneloAuth({ apiUrl: API, publishableKey: 'onelo_pk_test' })
    await auth.whenReady()
    const pending = auth.loadAuthView()
    await vi.waitFor(() => expect(document.querySelector('iframe[aria-hidden="true"]')).toBeTruthy())

    const overlay = document.body.querySelector('div') as HTMLElement
    const container = overlay.firstElementChild as HTMLElement
    const skeleton = container.querySelector('iframe[aria-hidden="true"]') as HTMLIFrameElement
    const normalizedPage = document.createElement('div')
    normalizedPage.style.background = page
    expect(overlay.style.background).toBe(normalizedPage.style.background)
    expect(skeleton.srcdoc).toContain(`body{background:${page}`)
    expect(skeleton.srcdoc).toContain(`.sk{background-color:${card}`)
    expect(auth.brand.current().button_bg).toBe(button)

    container.querySelector<HTMLButtonElement>('[data-onelo-cancel]')?.click()
    await expect(pending).resolves.toBeNull()
  })

  // #948: the skeleton takes the hosted form's shape from /api/sdk/config.
  it.each([
    { providers: [], magic: false, pills: 0 },
    { providers: ['google'], magic: true, pills: 1 },
    { providers: ['google', 'github', 'apple'], magic: false, pills: 3 },
  ])('draws $pills pills, magic link $magic, from config', async ({ providers, magic, pills }) => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      return { status: 200, ok: true, json: async () => url.includes('/api/sdk/config')
        ? { supabase_url: 'https://project.supabase.co', supabase_anon_key: 'anon', tenant_id: 'tenant-1', oauth_providers: providers, magic_link_enabled: magic }
        : { action: 'present', surface: 'sign_in', url: HOSTED } }
    }) as unknown as typeof fetch)

    const auth = new OneloAuth({ apiUrl: API, publishableKey: 'onelo_pk_test' })
    await auth.whenReady()
    expect(auth.authSkeletonShape()).toEqual({ socialCount: pills, magicLink: magic })
    const pending = auth.loadAuthView()
    await vi.waitFor(() => expect(document.querySelector('iframe[aria-hidden="true"]')).toBeTruthy())
    const container = (document.body.querySelector('div') as HTMLElement).firstElementChild as HTMLElement
    const html = (container.querySelector('iframe[aria-hidden="true"]') as HTMLIFrameElement).srcdoc
    expect(html.split('class="strong pill"').length - 1).toBe(pills)
    expect(html.includes('class="sk magic"')).toBe(magic)

    container.querySelector<HTMLButtonElement>('[data-onelo-cancel]')?.click()
    await expect(pending).resolves.toBeNull()
  })
})
