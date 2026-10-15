import { httpGet, httpPost, OneloError, statusColor, type BrandTokens } from '@onelo/core'
import type { OneloAuth } from '../auth/auth'
import type { OneloEventStream } from '../core/event-stream'
import { isUserRevokedRefusal } from '../core/user-revoked'

/**
 * Legal-consent gate for the Web SDK — parity with Swift's
 * `OneloAuth.requiredConsents()`/`acceptConsent()` + `OneloAuthView`'s blocking
 * gate, and Electron's `OneloConsent`. Same backend contract
 * (`/v1/sdk/consent/*`) and same SSE signal (`legal.consent_required`).
 *
 * Presentation is web-native: a full-screen, non-dismissible overlay rendered
 * by the SDK itself. Swift/Electron load the branded hosted gate page in a
 * native WebView; the browser can't iframe that page cross-origin (the hosted
 * origin ships `X-Frame-Options: DENY` / `frame-ancestors 'none'`), so on the
 * web the SDK draws its own overlay — document title + a "Review" link to the
 * full hosted document + Accept / Sign out. It is a true hard block: a fixed
 * full-viewport layer at max z-index with the page scroll locked, and NO close
 * affordance, so the only exits are Accept (records consent) or Sign out.
 *
 * `block` docs (Terms, or a Privacy version with "Require in-app acceptance")
 * hard-gate; `notify` docs never reach here (the backend sets `blocking:false`).
 */

const SDK_PLATFORM = 'js'

/**
 * The consent card's styles, all from the app's brand tokens (#681): card
 * surface/radius/text, the brand-coloured review link, the brand button for
 * Accept, a bordered secondary Sign out, and the named danger status colour for
 * errors. The scrim dims the host app and is not a brand surface.
 */
export function consentCardStyles(t: BrandTokens): Record<'overlay' | 'card' | 'heading' | 'body' | 'link' | 'error' | 'decline' | 'accept', string> {
  return {
    overlay: [
      'position:fixed', 'inset:0', 'z-index:2147483647',
      'display:flex', 'align-items:center', 'justify-content:center', 'padding:20px',
      'background:rgba(0,0,0,0.6)',
      `font-family:${t.body_font}`,
    ].join(';'),
    card: [
      'width:100%', 'max-width:440px', 'box-sizing:border-box',
      `background:${t.card_bg}`, `color:${t.text}`, `border-radius:${t.card_radius}px`, 'padding:28px',
      `border:1px solid ${t.border}`, 'box-shadow:0 20px 60px rgba(0,0,0,0.35)',
    ].join(';'),
    heading: `margin:0 0 10px;font-size:19px;font-weight:600;line-height:1.25;font-family:${t.heading_font};`,
    body: `margin:0 0 16px;font-size:14px;line-height:1.5;color:${t.text_muted};`,
    link: `display:inline-block;margin:0 0 20px;font-size:13.5px;color:${t.brand};text-decoration:none;`,
    error: `display:none;margin:0 0 14px;font-size:13px;line-height:1.4;color:${statusColor(t, 'danger')};`,
    decline: [
      'flex:0 0 auto', 'padding:11px 16px', `border-radius:${t.button_radius}px`, 'cursor:pointer',
      'font-size:14px', 'font-weight:500', 'background:transparent',
      `border:1px solid ${t.border}`, `color:${t.text}`,
    ].join(';'),
    accept: [
      'flex:1', 'padding:11px 16px', `border-radius:${t.button_radius}px`, 'cursor:pointer',
      'font-size:14px', 'font-weight:600', `background:${t.button_bg}`, `border:1px solid ${t.button_bg}`,
      `color:${t.button_text}`,
    ].join(';'),
  }
}

export type OneloConsentEnforcement = 'block' | 'notify' | 'unknown'

export interface OneloConsentRequirement {
  /** "terms" | "privacy" | "dpa" | "cookies" (open set). */
  docType: string
  versionId: string
  version: string
  enforcement: OneloConsentEnforcement
  /** Server-computed: enforcement=block AND effective_at<=now. The one gate signal. */
  blocking: boolean
  /** Public document URL (read-only page) — the "Review" link target. */
  url: string | null
  /** Gate-mode URL (document + accept/decline) — used by native SDKs' WebViews. */
  consentUrl: string | null
}

const DOC_TITLES: Record<string, string> = {
  terms: 'Terms of Service',
  privacy: 'Privacy Policy',
  dpa: 'Data Processing Agreement',
  cookies: 'Cookies Policy',
}

function titleFor(docType: string): string {
  if (!docType) return 'Legal agreement' // never render a bare "— updated"
  return DOC_TITLES[docType] ?? docType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Map a backend `/required` row → requirement. Unknown enforcement → 'unknown';
 *  missing `blocking` → false (never gate on a doc the server didn't mark). */
function mapRequirement(j: Record<string, unknown>): OneloConsentRequirement | null {
  const versionId = j['version_id']
  if (typeof versionId !== 'string') return null
  const rawEnf = j['enforcement']
  const enforcement: OneloConsentEnforcement =
    rawEnf === 'block' || rawEnf === 'notify' ? rawEnf : 'unknown'
  return {
    docType: typeof j['doc_type'] === 'string' ? (j['doc_type'] as string) : '',
    versionId,
    version: typeof j['version'] === 'string' ? (j['version'] as string) : '',
    enforcement,
    blocking: j['blocking'] === true,
    url: typeof j['url'] === 'string' ? (j['url'] as string) : null,
    consentUrl: typeof j['consent_url'] === 'string' ? (j['consent_url'] as string) : null,
  }
}

export class OneloConsent {
  private readonly apiUrl: string
  private readonly publishableKey: string
  private readonly auth: OneloAuth
  private readonly autoPresent: boolean

  /** Bumped on each `legal.consent_required` push (parity with Swift's
   *  @Published consentRevision). Observe via `onConsentRequired`. */
  private _consentRevision = 0
  private readonly revisionListeners = new Set<(revision: number) => void>()

  /** Held from the top of presentGateIfNeeded across its `requiredConsents`
   *  round-trip, so two concurrent callers (sign-in + a buffered SSE push) can't
   *  both open a gate. Set synchronously before the first await. */
  private _presenting = false
  /** The live gate overlay, if one is open — prevents a second. */
  private _gateOverlay: HTMLElement | null = null
  /** Saved `body.style.overflow` so the scroll lock is reversible. */
  private _prevBodyOverflow: string | null = null
  /** Set once dispose() runs — blocks any late re-present (e.g. an in-flight
   *  accept's re-check firing after teardown, which would zombie a new overlay
   *  and re-lock scroll forever). */
  private _disposed = false
  /** Sibling nodes we marked `inert` while the gate is up (ONLY the ones we
   *  changed) so restore never clears an inert the host app set itself. */
  private _inertedSiblings: Element[] = []
  /** Tab-trap keydown handler, removed on close. */
  private _trapHandler: ((e: KeyboardEvent) => void) | null = null

  constructor(apiUrl: string, publishableKey: string, auth: OneloAuth, autoPresent = true) {
    this.apiUrl = apiUrl
    this.publishableKey = publishableKey
    this.auth = auth
    this.autoPresent = autoPresent
  }

  // ── Observable revision (mirrors Swift @Published consentRevision) ──────────

  get consentRevision(): number {
    return this._consentRevision
  }

  /** Subscribe to `legal.consent_required` pushes (revision bumps). Returns an
   *  unsubscribe fn. Use when you build your own consent UI instead of the
   *  auto-presented gate. */
  onConsentRequired(listener: (revision: number) => void): () => void {
    this.revisionListeners.add(listener)
    return () => { this.revisionListeners.delete(listener) }
  }

  // ── Data API (mirrors Swift/Electron requiredConsents / acceptConsent) ───────

  /**
   * Fetch the signed-in user's outstanding legal documents. Requires a session;
   * returns `[]` when signed out. Fail-open: any network/non-200/parse failure
   * returns `[]` (never throws) — the gate surfaces real blocking updates, not
   * network blips.
   */
  async requiredConsents(): Promise<OneloConsentRequirement[]> {
    const session = await this.auth.getSession()
    if (!session) return []
    try {
      const { status, json } = await httpGet(`${this.apiUrl}/v1/sdk/consent/required`, {
        Authorization: `Bearer ${session.accessToken}`,
        'X-Publishable-Key': this.publishableKey,
        'X-Onelo-Sdk-Platform': SDK_PLATFORM,
      })
      if (status !== 200) return []
      const rows = (json as { required?: unknown }).required
      if (!Array.isArray(rows)) return []
      return rows
        .map((r) => mapRequirement(r as Record<string, unknown>))
        .filter((r): r is OneloConsentRequirement => r !== null)
    } catch {
      return []
    }
  }

  /**
   * Record acceptance of a legal document version. Requires a session. Throws
   * `OneloError` on no-session or a non-2xx response. Server-side idempotent.
   */
  async acceptConsent(versionId: string): Promise<void> {
    const session = await this.auth.getSession()
    if (!session) throw OneloError.notAuthenticated()
    const { status, json } = await httpPost(
      `${this.apiUrl}/v1/sdk/consent/accept`,
      { document_version_id: versionId },
      {
        Authorization: `Bearer ${session.accessToken}`,
        'X-Publishable-Key': this.publishableKey,
        'X-Onelo-Sdk-Platform': SDK_PLATFORM,
      },
    )
    if (isUserRevokedRefusal(json)) throw OneloError.userRevoked()
    if (status === 401) throw OneloError.notAuthenticated()
    if (status < 200 || status >= 300) throw OneloError.server(`Failed to record consent: HTTP ${status}`)
  }

  // ── SSE wiring ──────────────────────────────────────────────────────────────

  /**
   * Register the `legal.consent_required` listener on the shared stream. The
   * event is a signal only (payload ignored) — on receipt we bump the revision,
   * notify observers, and auto-present the gate if one is warranted.
   */
  attachEventStream(stream: OneloEventStream): void {
    stream.on('legal.consent_required', () => {
      this._consentRevision++
      for (const l of [...this.revisionListeners]) {
        try { l(this._consentRevision) } catch { /* a listener must never break the stream */ }
      }
      if (this.autoPresent) void this.presentGateIfNeeded()
    })
  }

  // ── Gate presentation (web-native, non-dismissible) ──────────────────────────

  /**
   * Check for an outstanding BLOCKING consent and, if present, open the gate.
   * Returns true if a gate was shown. No-op when: not in a browser, no session,
   * no blocking document, or a gate is already open.
   */
  async presentGateIfNeeded(): Promise<boolean> {
    if (this._disposed) return false // torn down — never re-present (zombie guard)
    if (typeof document === 'undefined') return false // SSR / non-browser
    if (this._presenting) return false
    if (this._gateOverlay) return false
    this._presenting = true
    try {
      const items = await this.requiredConsents()
      const blocker = items.find((i) => i.blocking)
      if (!blocker) return false
      this._presentGate(blocker)
      return true
    } finally {
      this._presenting = false
    }
  }

  private _presentGate(requirement: OneloConsentRequirement): void {
    const overlay = this._buildOverlay(requirement)
    this._gateOverlay = overlay
    // Lock page scroll so the app behind can't be scrolled.
    this._prevBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.body.appendChild(overlay)

    // Real modality — NOT just a visual/pointer cover. Without this a keyboard or
    // AT user could Tab to controls behind the overlay and activate them (the
    // hard block would be pointer-only). `inert` removes each sibling from the
    // tab order, pointer targets, and the a11y tree. Only inert nodes we changed,
    // so restore is exact and never clears an inert the host app set.
    for (const el of Array.from(document.body.children)) {
      if (el !== overlay && !el.hasAttribute('inert')) {
        el.setAttribute('inert', '')
        this._inertedSiblings.push(el)
      }
    }
    // Move focus into the gate and trap Tab within it (belt-and-braces for
    // engines with partial `inert`). Escape is deliberately NOT a close — the
    // gate is non-dismissible; the only exits are Accept / Sign out.
    const focusables = Array.from(overlay.querySelectorAll<HTMLElement>('a[href],button'))
    focusables[focusables.length - 1]?.focus() // the Accept button
    this._trapHandler = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab' || focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || !overlay.contains(active))) {
        e.preventDefault(); last.focus()
      } else if (!e.shiftKey && (active === last || !overlay.contains(active))) {
        e.preventDefault(); first.focus()
      }
    }
    overlay.addEventListener('keydown', this._trapHandler)
  }

  private _closeGate(): void {
    if (this._trapHandler && this._gateOverlay) {
      this._gateOverlay.removeEventListener('keydown', this._trapHandler)
    }
    this._trapHandler = null
    // Un-inert the siblings we disabled (restore is exact — see _presentGate).
    for (const el of this._inertedSiblings) el.removeAttribute('inert')
    this._inertedSiblings = []
    if (this._gateOverlay) {
      this._gateOverlay.remove()
      this._gateOverlay = null
    }
    if (this._prevBodyOverflow !== null) {
      document.body.style.overflow = this._prevBodyOverflow
      this._prevBodyOverflow = null
    }
  }

  /**
   * Accept → record, then RE-CHECK (documents stack — there may be another
   * blocking doc). Any non-accept → sign out. Mirrors Swift/Electron
   * `handleConsent`. On a transient accept failure the gate STAYS up so the user
   * can retry rather than being bounced out.
   */
  private async _handleConsentAction(
    action: string,
    requirement: OneloConsentRequirement,
    els: { accept: HTMLButtonElement; decline: HTMLButtonElement; error: HTMLElement },
  ): Promise<void> {
    if (action === 'accept') {
      els.accept.disabled = true
      els.decline.disabled = true
      els.error.style.display = 'none'
      els.accept.textContent = 'Saving…'
      try {
        await this.acceptConsent(requirement.versionId)
      } catch {
        // Keep the gate up; let the user retry (a blocking doc must not be
        // bypassable just because one request failed).
        els.accept.disabled = false
        els.decline.disabled = false
        els.accept.textContent = 'Accept & Continue'
        els.error.textContent = 'Could not save — check your connection and try again.'
        els.error.style.display = 'block'
        return
      }
      this._closeGate()
      // Re-check for the NEXT blocking document (they stack).
      await this.presentGateIfNeeded()
    } else {
      // Decline → sign out (no server decline endpoint; parity with Swift).
      this._closeGate()
      await this.auth.signOut().catch(() => { /* best-effort — session may be partly cleared */ })
    }
  }

  private _buildOverlay(requirement: OneloConsentRequirement): HTMLElement {
    const docTitle = titleFor(requirement.docType)

    const overlay = document.createElement('div')
    overlay.setAttribute('data-onelo-consent-gate', '')
    overlay.setAttribute('role', 'dialog')
    overlay.setAttribute('aria-modal', 'true')
    const st = consentCardStyles(this.auth.brand.current())
    overlay.style.cssText = st.overlay

    const card = document.createElement('div')
    card.style.cssText = st.card

    const h = document.createElement('h2')
    h.textContent = `${docTitle} — updated`
    h.style.cssText = st.heading

    const p = document.createElement('p')
    p.textContent = `Please review and accept our updated ${docTitle} to keep using the app.`
    p.style.cssText = st.body

    card.appendChild(h)
    card.appendChild(p)

    // "Review full document" link → opens the read-only hosted page in a new tab.
    // Only render for a safe http(s) URL (defensive against a non-http scheme).
    if (requirement.url && /^https?:\/\//i.test(requirement.url)) {
      const link = document.createElement('a')
      link.href = requirement.url
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      link.textContent = `Review full ${docTitle} ↗`
      link.style.cssText = st.link
      card.appendChild(link)
    }

    const error = document.createElement('p')
    error.style.cssText = st.error

    const row = document.createElement('div')
    row.style.cssText = 'display:flex;gap:10px;margin-top:4px;'

    const decline = document.createElement('button')
    decline.type = 'button'
    decline.textContent = 'Sign out'
    decline.style.cssText = st.decline

    const accept = document.createElement('button')
    accept.type = 'button'
    accept.textContent = 'Accept & Continue'
    accept.style.cssText = st.accept

    const els = { accept, decline, error }
    accept.addEventListener('click', () => { void this._handleConsentAction('accept', requirement, els) })
    decline.addEventListener('click', () => { void this._handleConsentAction('decline', requirement, els) })

    row.appendChild(decline)
    row.appendChild(accept)
    card.appendChild(error)
    card.appendChild(row)
    overlay.appendChild(card)
    return overlay
  }

  /** Tear down any open gate + restore scroll. Called from `Onelo.destroy()`.
   *  Marks the instance disposed so a late accept re-check can't zombie a new
   *  gate (and re-lock scroll) after teardown. */
  dispose(): void {
    this._disposed = true
    this._closeGate()
  }
}
