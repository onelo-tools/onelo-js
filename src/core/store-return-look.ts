/**
 * The look of the app-window store's last step (#728).
 *
 * The embedded store leaves the app's iframe for the checkout and comes back to
 * this page with `onelo_store_code`. The page reloads, so the SDK starts over:
 * on its first tick it covers the page with "Signing you in…" — before
 * `/api/sdk/config` answers, i.e. before it knows the app's Branding. It used to
 * paint the neutral set (a near-black page) in English, which looked unrelated
 * to the branded, localized checkout the buyer just left.
 *
 * So when the store opens, this tab remembers the Branding the store-initiate
 * answer carried and the store's language, in sessionStorage — it survives
 * this tab's trip to the checkout and back and is never shared with other tabs.
 * Best effort: storage can be blocked, and the cover then falls back to the
 * neutral look as before.
 */
import type { BrandTokens } from '@onelo/core'

const KEY = 'onelo:store-return-look'
/** A checkout outlives its store link by far less; an older entry is stale. */
const MAX_AGE_MS = 2 * 60 * 60 * 1000

export interface StoreReturnLook {
  tokens: BrandTokens
  lang: string | null
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null
  } catch {
    return null
  }
}

export function rememberStoreReturnLook(publishableKey: string, tokens: BrandTokens, lang: string | null): void {
  try {
    storage()?.setItem(KEY, JSON.stringify({ pk: publishableKey, tokens, lang, at: Date.now() }))
  } catch { /* storage full or blocked — the cover stays neutral */ }
}

export function recallStoreReturnLook(publishableKey: string, now = Date.now()): StoreReturnLook | null {
  try {
    const raw = storage()?.getItem(KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as { pk?: unknown; tokens?: Partial<BrandTokens>; lang?: unknown; at?: unknown }
    if (v.pk !== publishableKey || typeof v.at !== 'number' || now - v.at > MAX_AGE_MS) return null
    const t = v.tokens
    if (!t || typeof t.page_bg !== 'string' || typeof t.text !== 'string' || typeof t.brand !== 'string') return null
    return { tokens: t as BrandTokens, lang: typeof v.lang === 'string' ? v.lang : null }
  } catch {
    return null
  }
}

export function forgetStoreReturnLook(): void {
  try { storage()?.removeItem(KEY) } catch { /* nothing to forget */ }
}

/** "Signing you in…" in the store's languages — the hosted store's
 *  `signingIn` (frontend/lib/store-i18n.ts); keep the two in step. */
const SIGNING_IN: Record<string, string> = {
  en: 'Signing you in…',
  pl: 'Logujemy Cię…',
  de: 'Sie werden angemeldet…',
  fr: 'Connexion en cours…',
  es: 'Iniciando sesión…',
  pt: 'A iniciar sessão…',
}

export function signingInText(lang?: string | null): string {
  const base = (lang ?? '').split('-')[0].toLowerCase()
  return SIGNING_IN[base] ?? SIGNING_IN.en
}
