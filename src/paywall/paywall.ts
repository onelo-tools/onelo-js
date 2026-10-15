import { httpGet, httpPost, mapSession, OneloSession, OneloError, extractErrorCode, BrandSource } from '@onelo/core'
import { AuthModal, isExpiredAuthError, type AuthPresentMode } from '../auth/auth-modal'
import type { PlanChange } from '../core/plan-change'

/** `_completeHostedCheckout` outcome: the store's link died, open a fresh one (#619). */
const RESTART = Symbol('restart')
import { SDK_HEADERS } from '../core/sdk-headers'
import { createModalCloseButton } from '../core/modal-close-button'
import { rememberStoreReturnLook } from '../core/store-return-look'
import { isUserRevokedRefusal } from '../core/user-revoked'

export class OneloPaywall {
  private apiUrl: string
  private publishableKey: string
  private getAccessToken: () => Promise<string | null>
  private onSession: (session: OneloSession) => Promise<void>
  private getSession: () => Promise<OneloSession | null>
  private storeLinkChallenge: () => Promise<string | null>
  private renewPortal: ((requestId: string) => Promise<Record<string, unknown>>) | null = null
  /** The SDK's brand-token model (#681). `Onelo` shares its own. */
  private brand: BrandSource = new BrandSource()
  setBrandSource(brand: BrandSource): void {
    this.brand = brand
  }

  constructor(
    apiUrl: string,
    publishableKey: string,
    getAccessToken: () => Promise<string | null>,
    onSession: (session: OneloSession) => Promise<void>,
    /** Reads the current session back — `openStore()` resolves with it when the
     *  store finishes a plan switch that has no code to exchange (#599). */
    getSession: () => Promise<OneloSession | null> = async () => null,
    /** #727: the challenge a store magic link is paired to; its verifier stays
     *  in this page's storage (`OneloAuth.storeLinkChallenge`). */
    storeLinkChallenge: () => Promise<string | null> = async () => null,
  ) {
    this.apiUrl = apiUrl
    this.publishableKey = publishableKey
    this.getAccessToken = getAccessToken
    this.onSession = onSession
    this.getSession = getSession
    this.storeLinkChallenge = storeLinkChallenge
  }

  /** Lets the store modal answer a checkout's portal renewal (#642). Set by
   *  `Onelo` to the customer portal's `renewReply`. */
  setPortalRenewer(fn: ((requestId: string) => Promise<Record<string, unknown>>) | null): void {
    this.renewPortal = fn
  }

  /** Told when the store ended in a purchase or a plan switch (#659). Set by
   *  `Onelo` to its plan-change refresher. */
  private onPlanChange: ((change: PlanChange) => void) | null = null
  setPlanChangeHandler(fn: ((change: PlanChange) => void) | null): void {
    this.onPlanChange = fn
  }

  /**
   * Opens the hosted store page (plan selection + registration + payment).
   * Returns the session on success, or null if the user cancelled.
   *
   * @param mode  Presentation, default 'embedded' (inline iframe, matching
   *   Swift's inline flow and the auth view). loadAuthView threads its own mode
   *   through here so sign-in → store are presented consistently. Embedded works
   *   because /store/hosted is served with frame-ancestors '*' (next.config.ts,
   *   same as /auth/hosted and /manage/hosted); the store token is origin-gated
   *   at store-initiate and the code is postMessaged only to the validated
   *   origin, so the permissive framing is safe. Pass 'popup' for a top-level
   *   window if you prefer not to embed.
   */
  async openStore(lang?: string, mode: AuthPresentMode = 'embedded'): Promise<OneloSession | null> {
    // A store whose link died (#619: its renewal chain ended, or the device
    // slept past it) hands the link back; open a fresh one in the same place.
    // Each pass mints a new link, and the page only reports a dead one, so this
    // cannot spin: a live store never sends it.
    // In popup mode the dead popup is parked by AuthModal and the next pass
    // navigates it (a restart has no user gesture, so a new window.open would be
    // blocked, #625).
    for (let pass = 0; ; pass++) {
      let storeUrl: string
      try {
        storeUrl = await this.initiateStore(lang)
      } catch (e) {
        // A parked popup nothing will adopt must not linger.
        if (pass > 0) AuthModal.discardParkedPopup()
        throw e
      }
      const outcome = await this._completeHostedCheckout(storeUrl, mode)
      if (outcome !== RESTART) return outcome
    }
  }

  private async initiateStore(lang?: string): Promise<string> {
    let url = `${this.apiUrl}/api/sdk/paywall/store-initiate?key=${encodeURIComponent(this.publishableKey)}&callback_scheme=onelo-callback`
    if (lang) url += `&lang=${encodeURIComponent(lang)}`
    const returnUrl = storeReturnUrl()
    if (returnUrl) {
      url += `&return_url=${encodeURIComponent(returnUrl)}`
      // #727: a magic link asked from this store comes back through this page,
      // which holds the verifier. Only with a page to come back to.
      const challenge = await this.storeLinkChallenge().catch(() => null)
      if (challenge) url += `&code_challenge=${encodeURIComponent(challenge)}`
    }

    const { status, json } = await httpGet(url, { ...SDK_HEADERS })
    if (status !== 200) {
      if (isUserRevokedRefusal(json)) throw OneloError.userRevoked()
      const code = extractErrorCode(json)
      // e.g. store_not_configured (409), paywall_not_enabled (403),
      // in_app_store_not_allowed (409).
      throw OneloError.server(`Failed to initiate store flow: HTTP ${status}${code ? ` (${code})` : ''}`)
    }
    const j = json as Record<string, unknown>
    this.brand.adopt(j)
    // #728: a store that continues in this window comes back to a fresh page
    // load; its "Signing you in…" wears this Branding and language from the
    // first frame, before the config request answers.
    if (returnUrl) rememberStoreReturnLook(this.publishableKey, this.brand.current(), lang ?? null)
    const storeUrl = j['store_url'] as string | undefined
    if (!storeUrl) throw OneloError.server('Invalid store-initiate response')
    return storeUrl
  }

  // NOTE: there is deliberately NO `openUpgrade` here. An entitled user's
  // upgrade (`Onelo.openUpgrade()`) is `customerPortal.openUpgrade()`: it asks
  // `/upgrade-initiate` — the destination every SDK gets — and shows the answer
  // in the portal's modal, which already handles every store hand-back (#615),
  // answers the checkout's portal renewal (#642) and reloads a dead link (#619).
  // It used to open the portal page and let it ask `/portal-upgrade`; that hop
  // cost ~13 s (#670). A plan-less user still buys through `openStore()`.

  /** Shared tail for store-initiate: present the hosted /store/hosted page (which
   *  postMessages `onelo:code`), exchange the code for a session via
   *  hosted-callback, and hand it to auth. */
  private async _completeHostedCheckout(url: string, mode: AuthPresentMode): Promise<OneloSession | null | typeof RESTART> {
    const modal = new AuthModal(this.brand)
    const result = await modal.open(url, mode, { renewPortal: this.renewPortal ?? undefined })

    if (result.type === 'cancelled') return null
    if (result.type === 'error') {
      if (isExpiredAuthError(result.message)) return RESTART
      throw OneloError.server(result.message)
    }
    // A plan switch finished without a checkout (#599): no code, the buyer is
    // the signed-in user and stays so. Resolve with that session — a success.
    if (result.type === 'done') {
      this.onPlanChange?.({ kind: 'switched', reason: result.reason })
      return this.getSession()
    }
    // Exhaustive on purpose. The store modal does not opt into the cross-tab
    // session watch, so this cannot fire — but the union is shared with auth,
    // and a silent `result.code` on a variant without one is how a refactor
    // turns into a runtime undefined.
    if (result.type !== 'code') return null

    const { status: cbStatus, json: cbJson } = await httpPost(
      `${this.apiUrl}/api/sdk/auth/hosted-callback`,
      { publishableKey: this.publishableKey, code: result.code },
      { ...SDK_HEADERS },
    )
    if (cbStatus !== 200) throw OneloError.server('Hosted-callback failed')
    const session = mapSession(cbJson as Record<string, unknown>)
    await this.onSession(session)
    this.onPlanChange?.({ kind: 'purchase' })
    return session
  }

  /**
   * Opens the hosted manage page (upgrade, cancel, payment method).
   * Returns the new plan string if the user changed their plan, or null if closed without changes.
   */
  async openManage(lang?: string): Promise<string | null> {
    const manageUrl = await this.initiateManage(lang)
    return this.openManageModal(manageUrl, lang)
  }

  private async initiateManage(lang?: string): Promise<string> {
    const accessToken = await this.getAccessToken()
    if (!accessToken) throw OneloError.server('No active session — sign in before opening the manage page')

    let url = `${this.apiUrl}/api/sdk/paywall/manage-initiate?key=${encodeURIComponent(this.publishableKey)}`
    if (lang) url += `&lang=${encodeURIComponent(lang)}`

    const { status, json } = await httpGet(url, {
      ...SDK_HEADERS,
      Authorization: `Bearer ${accessToken}`,
    })
    if (isUserRevokedRefusal(json)) throw OneloError.userRevoked()
    if (status !== 200) throw OneloError.server('Failed to initiate manage flow')
    const j = json as Record<string, unknown>
    this.brand.adopt(j)
    const manageUrl = j['manage_url'] as string | undefined
    if (!manageUrl) throw OneloError.server('Invalid manage-initiate response')
    return manageUrl
  }

  /**
   * Answer the hosted manage page's `onelo:renew_request` (kind `manage`,
   * #621). The manage token lives 15 minutes; a page left open past that asks
   * this SDK for a fresh manage URL. The user is still signed in here, so a new
   * one is minted through manage-initiate with their own access token —
   * nothing revives the dead token. Signed out → `not_authenticated`, and the
   * page shows its branded "signed out" screen.
   */
  async manageRenewReply(requestId: string, lang?: string): Promise<Record<string, unknown>> {
    if (!(await this.getAccessToken())) {
      return { type: 'onelo:renew_failed', request_id: requestId, reason: 'not_authenticated' }
    }
    try {
      const hostedUrl = await this.initiateManage(lang)
      return { type: 'onelo:renewed', request_id: requestId, hosted_url: hostedUrl }
    } catch {
      return { type: 'onelo:renew_failed', request_id: requestId, reason: 'renew_failed' }
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private openManageModal(manageUrl: string, lang?: string): Promise<string | null> {
    return new Promise((resolve) => {
      // Validate postMessage against the HOSTED PAGE origin (where /manage/hosted
      // runs + posts from), NOT apiUrl. The manage page lives on the app/frontend
      // origin, a different subdomain than the backend apiUrl — deriving from
      // apiUrl rejected the onelo:plan_changed message.
      const allowedOrigin = new URL(manageUrl).origin

      // Build overlay — same approach as AuthModal.buildOverlay; container,
      // radius and ✕ from the brand tokens (#681). The scrim dims the host app.
      const t = this.brand.current()
      const overlay = document.createElement('div')
      overlay.style.cssText =
        'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;'

      const container = document.createElement('div')
      container.style.cssText =
        `position:relative;width:480px;height:640px;border-radius:${t.card_radius}px;overflow:hidden;background:${t.page_bg};`

      const iframe = document.createElement('iframe')
      iframe.src = manageUrl
      iframe.style.cssText = 'width:100%;height:100%;border:none;'
      iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin allow-popups')

      const cancelBtn = createModalCloseButton(t)

      container.appendChild(iframe)
      container.appendChild(cancelBtn)
      overlay.appendChild(container)
      document.body.appendChild(overlay)

      const close = (): void => {
        window.removeEventListener('message', messageHandler)
        overlay.remove()
      }

      const messageHandler = (e: MessageEvent): void => {
        if (e.origin !== allowedOrigin) return
        const data = e.data as Record<string, unknown>
        // The page's manage token died (#621): mint a fresh page and answer
        // only this iframe, at the hosted origin.
        if (data?.type === 'onelo:renew_request' && data.kind === 'manage' && typeof data.request_id === 'string') {
          if (e.source !== iframe.contentWindow) return
          const requestId = data.request_id
          void this.manageRenewReply(requestId, lang).then((reply) => {
            try { iframe.contentWindow?.postMessage(reply, allowedOrigin) } catch { /* modal closed */ }
          })
          return
        }
        if (data?.type === 'onelo:plan_changed' && typeof data.plan === 'string') {
          close()
          resolve(data.plan)
        } else if (data?.type === 'onelo:cancel' || data?.type === 'onelo:error') {
          close()
          resolve(null)
        }
      }

      window.addEventListener('message', messageHandler)

      cancelBtn.addEventListener('click', () => {
        close()
        resolve(null)
      })
    })
  }
}

/**
 * The page the store returns the buyer to (#726). The embedded store sends this
 * page's window to provider sign-in and to the checkout; afterwards the buyer
 * lands back HERE, with `onelo_store_code` for `Auth` to exchange. The backend
 * keeps it only when its origin is this page's own and an allowed origin.
 * Onelo's one-time parameters and the fragment are left out.
 */
export function storeReturnUrl(): string | null {
  if (typeof window === 'undefined' || !window.location) return null
  try {
    const u = new URL(window.location.href)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    for (const k of ['onelo_code', 'onelo_store_code', 'onelo_gate', 'onelo_link']) u.searchParams.delete(k)
    u.hash = ''
    return u.toString()
  } catch {
    return null
  }
}
