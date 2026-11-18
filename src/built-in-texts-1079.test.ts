// @vitest-environment jsdom
/**
 * #1079 — the Web SDK's own texts (the modal close chip, "Signing you in…" and
 * the magic-link notice, the consent gate, the feature badges, the OneloError
 * messages an App User may be shown) are in the App User's Page Language: the
 * one `/api/sdk/config` answers (`page_language`, chosen by the backend from
 * the App's language, else the browser language, within the App Languages,
 * #1074). English until the first answer; the developer's content (app name,
 * plan names) is shown as written.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

let configAnswer: Record<string, unknown> = {}
type Answer = { status: number; json: unknown }
const defaultGet = async (url: string): Promise<Answer> => {
  if (url.includes('/api/sdk/config')) {
    return { status: 200, json: { supabase_url: 's', supabase_anon_key: 'a', tenant_id: 't', app_name: 'Acme', ...configAnswer } }
  }
  if (url.includes('/consent/required')) return { status: 200, json: { required: [] } }
  if (url.includes('/store-initiate')) return { status: 200, json: { store_url: 'https://st.test/store/hosted?token=srt_1' } }
  if (url.includes('/upgrade-initiate')) return { status: 404, json: { detail: 'plan_not_purchasable' } }
  if (url.includes('/flow/init')) return { status: 200, json: { action: 'authorized' } }
  return { status: 404, json: {} }
}
const httpGet = vi.fn(defaultGet)
vi.mock('@onelo/core', async (orig) => ({
  ...(await orig<typeof import('@onelo/core')>()),
  httpGet: (url: string) => httpGet(url),
}))
vi.mock('./auth/auth-modal', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./auth/auth-modal')>()),
  AuthModal: class {
    static discardParkedPopup = vi.fn()
    open = vi.fn(async () => ({ type: 'cancelled' }))
  },
}))

import { OneloError, PAGE_LANGUAGES, adoptPageLanguage, resetPageLanguageForTest } from '@onelo/core'
import { ONELO_TEXTS, PAGE_LANGUAGE_STORAGE_KEY, oneloText } from './core/texts'
import { createModalCloseButton } from './core/modal-close-button'
import { coverPage, removeCover, showHandedOverNotice } from './core/handed-over-notice'
import { signingInText } from './core/store-return-look'
import { FeatureState } from './features/features'
import { OneloAuth } from './auth/auth'
import { OneloConsent } from './consent/consent'
import { OneloPaywall } from './paywall/paywall'
import { OneloCustomerPortal } from './customer-portal/customer-portal'
import { OneloWaitlist } from './waitlist/waitlist'
import { OneloFeedback } from './feedback/feedback'
import { Onelo } from './onelo'

const API = 'https://api.test'
const KEY = 'onelo_pk_test_1079'

beforeEach(() => {
  // An in-memory localStorage (the runtime's own is not usable under jsdom here).
  const store = new Map<string, string>()
  const ls = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => store.clear(),
  }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: ls })
  Object.defineProperty(window, 'localStorage', { configurable: true, value: ls })
  configAnswer = {}
  httpGet.mockClear()
  httpGet.mockImplementation(defaultGet)
  vi.stubGlobal('navigator', { ...globalThis.navigator, language: 'de-DE' })
})

afterEach(() => {
  resetPageLanguageForTest()
  removeCover()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
  window.localStorage.clear()
  window.sessionStorage.clear()
})

function langSentTo(path: string): string | null {
  const call = httpGet.mock.calls.find((c) => new URL(c[0]).pathname === path)
  if (!call) throw new Error(`no request to ${path}`)
  return new URL(call[0]).searchParams.get('lang')
}

async function readyAuth(config: Record<string, unknown> = {}) {
  const auth = new OneloAuth({ apiUrl: API, publishableKey: KEY, ...config })
  await auth.whenReady()
  return auth
}

describe('the texts table', () => {
  it('has every text in every supported language', () => {
    expect(Object.keys(ONELO_TEXTS).sort()).toEqual([...PAGE_LANGUAGES].sort())
    const keys = Object.keys(ONELO_TEXTS.en).sort()
    for (const lang of PAGE_LANGUAGES) {
      expect(Object.keys(ONELO_TEXTS[lang]).sort(), lang).toEqual(keys)
      for (const [key, value] of Object.entries(ONELO_TEXTS[lang])) {
        expect(value.trim(), `${lang}.${key}`).not.toBe('')
      }
    }
  })

  it('keeps every placeholder of the English text', () => {
    const holes = (s: string) => (s.match(/\{[a-z]+\}/g) ?? []).sort()
    for (const lang of PAGE_LANGUAGES) {
      for (const [key, en] of Object.entries(ONELO_TEXTS.en)) {
        expect(holes(ONELO_TEXTS[lang][key as keyof typeof ONELO_TEXTS.en]), `${lang}.${key}`).toEqual(holes(en))
      }
    }
  })

  it('a language Onelo does not translate into reads English', () => {
    expect(oneloText('close', {}, 'sv')).toBe('Close')
  })
})

describe('Page Language from /api/sdk/config', () => {
  it('is English until the backend answers, then the answer', async () => {
    const auth = new OneloAuth({ apiUrl: API, publishableKey: KEY })
    expect(auth.pageLanguage).toBe('en')
    configAnswer = { page_language: 'pl' }
    await auth.whenReady()
    expect(auth.pageLanguage).toBe('pl')
  })

  it('an answer without page_language (older backend) leaves the language as it was', async () => {
    adoptPageLanguage('fr')
    const auth = await readyAuth()
    expect(auth.pageLanguage).toBe('fr')
    configAnswer = { page_language: null }
    expect((await readyAuth()).pageLanguage).toBe('fr')
  })

  it('is kept for the next page load: its first paint already speaks it', async () => {
    configAnswer = { page_language: 'it' }
    await readyAuth()
    expect(window.localStorage.getItem(PAGE_LANGUAGE_STORAGE_KEY)).toBe('it')
    resetPageLanguageForTest()
    // A fresh page load (a magic-link return covers before config answers).
    configAnswer = {}
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    window.history.replaceState({}, '', '/app?onelo_code=abc')
    try {
      const auth = new OneloAuth({ apiUrl: API, publishableKey: KEY })
      expect(auth.pageLanguage).toBe('it')
      expect(document.getElementById('onelo-handed-over')!.querySelector('h1')!.textContent).toBe('Accesso in corso…')
      await auth.whenReady().catch(() => {})
    } finally {
      window.history.replaceState({}, '', '/')
    }
  })

  it('is asked with the App language, else the browser language', async () => {
    await readyAuth({ language: 'pt-PT' })
    expect(langSentTo('/api/sdk/config')).toBe('pt-PT')
    httpGet.mockClear()
    await readyAuth()
    expect(langSentTo('/api/sdk/config')).toBe('de-DE')
  })
})

describe('the App language is the default lang of every Page Language request', () => {
  it('flow/init', async () => {
    const auth = await readyAuth({ language: 'nl' })
    httpGet.mockClear()
    await (auth as unknown as { resolveFlow(t: string | null): Promise<unknown> }).resolveFlow(null)
    expect(langSentTo('/api/sdk/flow/init')).toBe('nl')
  })

  it('store-initiate; a language passed to the call wins', async () => {
    const paywall = new OneloPaywall(API, KEY, async () => 'jwt', async () => {})
    paywall.setAppLanguage('fr')
    await paywall.openStore()
    expect(langSentTo('/api/sdk/paywall/store-initiate')).toBe('fr')
    httpGet.mockClear()
    document.body.innerHTML = ''
    await paywall.openStore('es')
    expect(langSentTo('/api/sdk/paywall/store-initiate')).toBe('es')
  })

  it('upgrade-initiate', async () => {
    const portal = new OneloCustomerPortal(API, KEY, async () => 'jwt')
    portal.setAppLanguage('it')
    await portal.openUpgrade().catch(() => {})
    expect(langSentTo('/api/sdk/paywall/upgrade-initiate')).toBe('it')
  })

  it('consent/required', async () => {
    const auth = { getSession: async () => ({ accessToken: 'at' }), brand: { current: () => ({}) } }
    await new OneloConsent(API, KEY, auth as never, false, 'es').requiredConsents()
    expect(langSentTo('/v1/sdk/consent/required')).toBe('es')
  })

  it('waitlist join; the join option wins', async () => {
    const bodies: Array<Record<string, unknown>> = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body))
      return { ok: true, json: async () => ({ ok: true }) }
    }))
    const waitlist = new OneloWaitlist(API, KEY, 'nl')
    await waitlist.join(undefined, 'a@b.test')
    await waitlist.join(undefined, 'a@b.test', { language: 'pl' })
    expect(bodies.map((b) => b.language)).toEqual(['nl', 'pl'])
  })

  it('the hosted feedback form carries the App language; without one the browser says it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      status: 200,
      json: async () => ({ hosted_url: 'https://h.test/feedback/hosted?key=k&ft=t' }),
    })))
    const feedback = new OneloFeedback(API, KEY, () => [])
    await feedback.open()
    expect(new URL(document.querySelector('iframe')!.src).searchParams.get('lang')).toBeNull()
    document.body.innerHTML = ''
    feedback.setAppLanguage('de')
    await feedback.open()
    expect(new URL(document.querySelector('iframe')!.src).searchParams.get('lang')).toBe('de')
  })

  it('Onelo hands its language to every module', () => {
    const onelo = new Onelo({ apiUrl: API, publishableKey: KEY, language: 'pl' })
    expect(onelo.auth.appLanguage).toBe('pl')
    onelo.destroy()
  })
})

describe('the widgets speak the Page Language', () => {
  it('the close chip', () => {
    expect(createModalCloseButton().getAttribute('aria-label')).toBe('Close')
    adoptPageLanguage('de')
    const btn = createModalCloseButton()
    expect(btn.getAttribute('aria-label')).toBe('Schließen')
    expect(btn.getAttribute('title')).toBe('Schließen')
  })

  it('"Signing you in…" and the magic-link notice; the App name as written', () => {
    adoptPageLanguage('pl')
    coverPage()
    const el = document.getElementById('onelo-handed-over')!
    expect(el.querySelector('h1')!.textContent).toBe('Logujemy Cię…')
    showHandedOverNotice('Turingo', true)
    expect(el.querySelector('h1')!.textContent).toBe('Zalogowano')
    expect(el.querySelector('p')!.textContent).toBe(
      'Kontynuuj w karcie Turingo, od której zaczęło się logowanie — tę kartę możesz zamknąć.',
    )
    showHandedOverNotice(null, false)
    expect(el.querySelector('p')!.textContent).toBe('Możesz zamknąć tę kartę i ponownie otworzyć aplikację.')
  })

  it('the store return\'s "Signing you in…" in all eight languages', () => {
    expect(signingInText('it')).toBe('Accesso in corso…')
    expect(signingInText('nl-BE')).toBe('Je wordt ingelogd…')
    expect(signingInText(null)).toBe('Signing you in…')
  })

  it('the feature badges; the plan name as written', () => {
    adoptPageLanguage('fr')
    expect(new FeatureState('a', 'new').badgeLabel).toBe('Nouveau')
    expect(new FeatureState('a', 'coming_soon').badgeLabel).toBe('Bientôt disponible')
    expect(new FeatureState('a', 'upsell', 'plan', 'pro', 'Pro Max').badgeLabel).toBe('Disponible avec le plan Pro Max')
    expect(new FeatureState('a', 'upsell').badgeLabel).toBe('Changer de plan')
    expect(new FeatureState('a', 'greyed').badgeLabel).toBe('🔒')
  })

  it('the feature badges keep their English words in English', () => {
    expect(new FeatureState('a', 'coming_soon').badgeLabel).toBe('Coming soon')
    expect(new FeatureState('a', 'upsell', 'plan', 'pro', 'Pro').badgeLabel).toBe('Available in Pro')
    expect(new FeatureState('a', 'upsell').badgeLabel).toBe('Change plan')
  })

  it('OneloError messages an App User may be shown; codes unchanged', () => {
    adoptPageLanguage('es')
    const e = OneloError.sessionEnded()
    expect(e.code).toBe('session_ended')
    expect(e.message).toBe('Tu sesión ha terminado — vuelve a iniciar sesión')
    expect(OneloError.invalidKey('x').message).toBe('Invalid publishable key: x')
  })
})

describe('the consent gate', () => {
  const blocking = {
    version_id: 'v1', doc_type: 'privacy', version: '2', enforcement: 'block', blocking: true,
    url: 'https://legal.test/privacy',
  }
  function gate(acceptStatus = 200) {
    const auth = {
      getSession: async () => ({ accessToken: 'at' }),
      brand: { current: () => ({ body_font: 'x', card_bg: '#fff', text: '#000', card_radius: 8, border: '#ccc', heading_font: 'x', text_muted: '#666', brand: '#00f', button_radius: 6, button_bg: '#00f', button_text: '#fff', status: {} }) },
      signOut: vi.fn(async () => {}),
    }
    httpGet.mockImplementation(async (url: string): Promise<Answer> =>
      url.includes('/consent/required') ? { status: 200, json: { required: [blocking] } } : { status: 404, json: {} })
    const consent = new OneloConsent(API, KEY, auth as never, false)
    vi.spyOn(consent, 'acceptConsent').mockImplementation(async () => {
      if (acceptStatus !== 200) throw new Error('offline')
    })
    return consent
  }

  it('speaks the Page Language: the hosted gate\'s words, the document\'s name, its lang', async () => {
    adoptPageLanguage('pt')
    expect(await gate().presentGateIfNeeded()).toBe(true)
    const overlay = document.querySelector('[data-onelo-consent-gate]')!
    expect(overlay.getAttribute('lang')).toBe('pt')
    expect(overlay.querySelector('h2')!.textContent).toBe('Atualizámos o documento «Política de Privacidade»')
    expect(overlay.querySelector('p')!.textContent).toBe('Leia e aceite o documento para continuar')
    expect(overlay.querySelector('a')!.textContent).toBe('Ler o documento «Política de Privacidade» completo ↗')
    expect([...overlay.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Terminar sessão', 'Aceitar e continuar'])
  })

  it('a failed save says so in the Page Language and keeps the gate up', async () => {
    adoptPageLanguage('nl')
    await gate(500).presentGateIfNeeded()
    const overlay = document.querySelector('[data-onelo-consent-gate]')!
    const accept = [...overlay.querySelectorAll('button')][1]
    accept.click()
    await vi.waitFor(() => expect(accept.textContent).toBe('Accepteren en doorgaan'))
    const error = [...overlay.querySelectorAll('p')][1]
    expect(error.textContent).toBe('Opslaan is mislukt — controleer je verbinding en probeer het opnieuw.')
    expect(document.querySelector('[data-onelo-consent-gate]')).toBeTruthy()
  })

  it('English stays English', async () => {
    await gate().presentGateIfNeeded()
    const overlay = document.querySelector('[data-onelo-consent-gate]')!
    expect(overlay.querySelector('h2')!.textContent).toBe('We’ve updated our Privacy Policy')
    expect([...overlay.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Sign out', 'Accept & Continue'])
  })
})

// The hosted pages' and Python's dictionaries, read as text: the published SDK
// repository has no frontend/ or backend/, so the pins are skipped there.
const ROOT = join(__dirname, '..', '..', '..')
const FRONTEND_LIB = join(ROOT, 'frontend', 'lib')
const FRAME_TEXT = join(ROOT, 'backend', 'app', 'lib', 'legal', 'page_frame_text.py')
const NOTICE_TEXT = join(ROOT, 'backend', 'app', 'lib', 'email', 'account_notice_mail_text.py')
const hasRepo = ['hosted-notice-i18n.ts', 'store-i18n.ts', 'sign-in-pages-i18n.ts'].every((f) => existsSync(join(FRONTEND_LIB, f)))
  && existsSync(FRAME_TEXT) && existsSync(NOTICE_TEXT)

/** `field`'s first string value in each locale block (`  en: {` …) of a TS dictionary. */
function tsWords(file: string, field: string): Record<string, string> {
  const src = readFileSync(join(FRONTEND_LIB, file), 'utf-8')
  const out: Record<string, string> = {}
  const blocks = src.split(/\n {2}(en|pl|de|fr|es|it|pt|nl): \{\n/)
  for (let i = 1; i < blocks.length; i += 2) {
    const m = blocks[i + 1].match(new RegExp(`\\b${field}: (?:\\(plan\\) => )?(['"\`])(.*?)\\1`))
    if (m && !(blocks[i] in out)) out[blocks[i]] = m[2].replace('${plan}', '{plan}')
  }
  return out
}

/** `key`'s first value in each `"en": {` … block of a Python text module. */
function pyWords(file: string, key: string): Record<string, string> {
  const src = readFileSync(file, 'utf-8')
  const out: Record<string, string> = {}
  const blocks = src.split(/\n\s+"(en|pl|de|fr|es|it|pt|nl)": \{\n/)
  for (let i = 1; i < blocks.length; i += 2) {
    const m = blocks[i + 1].match(new RegExp(`"${key}": "((?:[^"\\\\]|\\\\.)*)"`))
    if (m && !(blocks[i] in out)) out[blocks[i]] = m[1]
  }
  return out
}

describe.skipIf(!hasRepo)('the words are the hosted pages\' own', () => {
  function pin(textKey: keyof typeof ONELO_TEXTS.en, words: Record<string, string>) {
    for (const lang of PAGE_LANGUAGES) expect(ONELO_TEXTS[lang][textKey], `${textKey} ${lang}`).toBe(words[lang])
  }

  it('badges: hosted-notice-i18n.ts lockComingSoon / lockAvailableIn, the Store\'s changePlan', () => {
    pin('badgeComingSoon', tsWords('hosted-notice-i18n.ts', 'lockComingSoon'))
    pin('badgeAvailableIn', tsWords('hosted-notice-i18n.ts', 'lockAvailableIn'))
    pin('badgeUpgrade', tsWords('store-i18n.ts', 'changePlan'))
  })

  it('"Signing you in…" is the Store\'s; "You\'re signed in" the sign-in pages\'', () => {
    pin('signingIn', tsWords('store-i18n.ts', 'signingIn'))
    pin('signedIn', tsWords('sign-in-pages-i18n.ts', 'signedInTitle'))
  })

  it('consent gate: the hosted gate\'s frame and the legal notices\' document names', () => {
    pin('consentHeading', pyWords(FRAME_TEXT, 'gate_updated'))
    pin('consentBody', pyWords(FRAME_TEXT, 'gate_review'))
    pin('signOut', pyWords(FRAME_TEXT, 'gate_decline'))
    pin('acceptAndContinue', pyWords(FRAME_TEXT, 'gate_accept'))
    pin('docTerms', pyWords(NOTICE_TEXT, 'doc_terms'))
    pin('docPrivacy', pyWords(NOTICE_TEXT, 'doc_privacy'))
    pin('docDpa', pyWords(NOTICE_TEXT, 'doc_dpa'))
    pin('docCookies', pyWords(NOTICE_TEXT, 'doc_cookies'))
  })
})
