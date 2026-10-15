import { httpGet, OneloError, extractErrorCode, NEUTRAL_BRAND_TOKENS, BrandSource, spinnerCss, portalSkeletonHtml, type BrandTokens } from '@onelo/core'
import { SDK_HEADERS } from '../core/sdk-headers'
import { createModalCloseButton } from '../core/modal-close-button'
import { installFailsafeClose } from '../core/failsafe-close'
import { classifyHandBack } from '../core/hand-back'
import type { PlanChange } from '../core/plan-change'
import { isUserRevokedRefusal } from '../core/user-revoked'

// Hard account-lifecycle events the portal can signal back — each clears the
// local session so the app re-authenticates. Single source of truth for the
// event→clear decision, mirroring Swift `OneloAuth.portalRevokeEvents` and the
// Flutter/Electron revoke sets. Broadened from the single
// `account_deletion_scheduled` so a signout-on-refund (`account_revoked`, emitted
// by the hosted portal after a lapsed refund with signout enabled) also logs the
// web buyer out — matching the native deep-link path.
const PORTAL_REVOKE_EVENTS = new Set([
  'account_deletion_scheduled',
  'account_revoked',
  'session_compromised',
])

interface PortalInitiateResponse {
  hosted_url: string
  app_name?: string
  app_logo_url?: string | null
  /** Branding "Brand color" (#601). Null when the app has none set. */
  primary_color?: string | null
  /** Branding "Page background" (#601). */
  checkout_bg_color?: string | null
  /** Resolved brand tokens (#681); preferred over the two fields above. */
  brand_tokens?: unknown
}

// Pre-connect loading skeleton, shown behind the portal iframe until the hosted
// page paints — the shared `portalSkeletonHtml` in @onelo/core (#681: painted
// from the brand tokens; portal-initiate `brand_tokens`, else config, else
// neutral). Re-exported so callers keep importing it from here.
export { portalSkeletonHtml }

// Neutral "Opening plans…" spinner — used INSTEAD of the manage-plan skeleton
// when the portal is opened from an upsell tap (open({intent:'change_plan'})).
// The portal-shaped skeleton reads as "Manage your plan is loading", which is the
// wrong page for an upgrade; this matches the hosted page's own PortalOpeningSpinner
// so the SDK overlay → hosted spinner → plan picker is one continuous loading state.
// #601/#681: arc = brand, track = spinner_track, ground = page_bg, label =
// text_muted — all brand tokens; unknown → the neutral set, never Onelo orange.
export function openingPlansHtml(t: BrandTokens = NEUTRAL_BRAND_TOKENS): string {
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{background:${t.page_bg};font-family:${t.body_font};display:flex;align-items:center;justify-content:center;color:${t.text_muted}}
${spinnerCss(t)}
.box{display:flex;flex-direction:column;align-items:center;gap:12px}
.t{font-size:13px}
</style></head><body>
<div class="box"><div class="sp"></div><div class="t">Opening plans…</div></div>
</body></html>`
}

export class OneloCustomerPortal {
  private apiUrl: string
  private publishableKey: string
  private getAccessToken: () => Promise<string | null>
  private onSessionInvalidated?: () => void
  /** The SDK's brand-token model (#681). `Onelo` shares its own. */
  private brand: BrandSource = new BrandSource()
  setBrandSource(brand: BrandSource): void {
    this.brand = brand
  }

  constructor(
    apiUrl: string,
    publishableKey: string,
    getAccessToken: () => Promise<string | null>,
    onSessionInvalidated?: () => void,
  ) {
    this.apiUrl = apiUrl
    this.publishableKey = publishableKey
    this.getAccessToken = getAccessToken
    this.onSessionInvalidated = onSessionInvalidated
  }

  /** Told when the store opened from the portal ended in a purchase or a plan
   *  switch (#659). Set by `Onelo` to its plan-change refresher. */
  private onPlanChange: ((change: PlanChange) => void) | null = null
  setPlanChangeHandler(fn: ((change: PlanChange) => void) | null): void {
    this.onPlanChange = fn
  }

  /**
   * Open the hosted Customer Portal ("Manage your plan").
   *
   * @param opts.intent  `'change_plan'` opens the portal straight into the plan
   *   picker (the portal auto-runs its own "Change plan" on load) instead of the
   *   management home — so a subscriber tapping an upsell lands on the plans, not
   *   "in front of the door". Used by {@link Onelo.openUpgrade}. Falls back to the
   *   management home if a plan change isn't available for this subscription.
   */
  async open(opts?: { intent?: 'change_plan' }): Promise<void> {
    const { hostedUrl, json: j } = await this.initiate()

    // Thread the intent to the hosted page as a query param — the portal reads
    // `?intent=change_plan` and auto-advances into its existing Change-plan flow.
    let finalUrl = hostedUrl
    if (opts?.intent) {
      try {
        const u = new URL(hostedUrl)
        u.searchParams.set('intent', opts.intent)
        finalUrl = u.toString()
      } catch {
        // hostedUrl always absolute in practice; leave it untouched if not.
      }
    }

    // Upsell-tap flow shows a neutral spinner overlay, not the manage-plan skeleton.
    const t = this.brand.adopt(j)
    const loadingHtml = opts?.intent === 'change_plan' ? openingPlansHtml(t) : portalSkeletonHtml(t)
    return this.openPortalModal(finalUrl, loadingHtml, t)
  }

  /**
   * The upsell tap of an entitled user (#670): ask the backend where the
   * upgrade goes — `/upgrade-initiate`, the same `resolve_upgrade_destination`
   * the hosted portal's `/portal-upgrade` asks — and open that answer directly:
   * the plan-switch picker, the store for a first real purchase, or the portal's
   * explanation when plan changes are unavailable. It used to open the Customer
   * Portal page and let THAT page ask, which put a whole hosted page (server
   * render + hydrate) in front of the store: about 13 s of "Opening plans…".
   *
   * Shown in the portal's own modal, so everything the portal flow had holds:
   * the store's hand-back closes it and reconciles the plan (#615, #659), its
   * checkout's portal renewal is answered (#642), and a dead store link is
   * replaced by a fresh one in the same modal (#619). No `plan` is sent: on web
   * the buyer picks in the store (browse mode), as before.
   *
   * @internal Used by {@link Onelo.openUpgrade}.
   * @throws OneloError `not_authenticated` when signed out or the access token
   *   is refused; `server_error` carrying the backend's code on any other refusal
   *   (e.g. `in_app_store_not_allowed`). Nothing is opened in either case.
   */
  async openUpgrade(): Promise<void> {
    const { upgradeUrl, json } = await this.initiateUpgrade()
    const t = this.brand.adopt(json)
    return this.openPortalModal(upgradeUrl, openingPlansHtml(t), t, {
      reinitiate: async () => (await this.initiateUpgrade()).upgradeUrl,
    })
  }

  /** GET upgrade-initiate with the user's access token → the resolved URL. */
  private async initiateUpgrade(): Promise<{ upgradeUrl: string; json: Record<string, unknown> }> {
    const token = await this.getAccessToken()
    if (!token) throw new OneloError('not_authenticated', 'Sign in before opening an upgrade')

    // callback_scheme=web: the pages hand back by postMessage to this window,
    // whose Origin the backend binds on the minted token (#592).
    const url = `${this.apiUrl}/api/sdk/paywall/upgrade-initiate?key=${encodeURIComponent(this.publishableKey)}&callback_scheme=web`
    const { status, json } = await httpGet(url, {
      ...SDK_HEADERS,
      Authorization: `Bearer ${token}`,
    })
    if (isUserRevokedRefusal(json)) throw OneloError.userRevoked()
    if (status === 401) throw new OneloError('not_authenticated', 'The session can no longer open an upgrade')
    if (status !== 200) {
      const code = extractErrorCode(json)
      throw OneloError.server(`Failed to initiate upgrade: HTTP ${status}${code ? ` (${code})` : ''}`)
    }
    const j = json as Record<string, unknown>
    const upgradeUrl = j['upgrade_url'] as string | undefined
    if (!upgradeUrl) throw OneloError.server('Invalid upgrade-initiate response: missing upgrade_url')
    return { upgradeUrl, json: j }
  }

  /** GET portal-initiate with the user's access token → the hosted URL. */
  private async initiate(): Promise<{ hostedUrl: string; json: Record<string, unknown> }> {
    const token = await this.getAccessToken()
    if (!token) throw new OneloError('not_authenticated', 'Sign in before opening the customer portal')

    const url = `${this.apiUrl}/api/sdk/paywall/portal-initiate?key=${encodeURIComponent(this.publishableKey)}&callback_scheme=web`
    const { status, json } = await httpGet(url, {
      ...SDK_HEADERS,
      Authorization: `Bearer ${token}`,
    })
    if (isUserRevokedRefusal(json)) throw OneloError.userRevoked()
    if (status === 401) throw new OneloError('not_authenticated', 'The session can no longer open the customer portal')
    if (status !== 200) throw OneloError.server('Failed to initiate customer portal')
    const j = json as Record<string, unknown>
    const hostedUrl = j['hosted_url'] as string | undefined
    if (!hostedUrl) throw OneloError.server('Invalid portal-initiate response')
    return { hostedUrl, json: j }
  }

  /**
   * Answer the hosted portal's `onelo:renew_request` (#613 / #614). The portal
   * page's token lives ten minutes; when an action meets a dead one, the page
   * asks this SDK for a fresh portal and repeats the action. The user is still
   * signed in here, so a new portal is minted with their own access token —
   * nothing revives the dead token. Signed out → `renew_failed`, and the page
   * shows its branded "signed out" screen.
   */
  async renewReply(requestId: string): Promise<Record<string, unknown>> {
    try {
      const { hostedUrl } = await this.initiate()
      return { type: 'onelo:renewed', request_id: requestId, hosted_url: hostedUrl }
    } catch (e) {
      const reason = e instanceof OneloError && e.code === 'not_authenticated' ? 'not_authenticated' : 'renew_failed'
      return { type: 'onelo:renew_failed', request_id: requestId, reason }
    }
  }

  /**
   * @param opts.reinitiate  Mints a fresh URL for this surface. When given, a
   *   dead link handed back by the page (`onelo:cancel` reason `expired`, #619)
   *   is replaced in the same iframe instead of closing the modal. A portal
   *   needs none: its store re-enters through the portal renewal (#614).
   */
  private openPortalModal(
    hostedUrl: string,
    loadingHtml: string,
    t: BrandTokens,
    opts?: { reinitiate?: () => Promise<string> },
  ): Promise<void> {
    return new Promise((resolve) => {
      let resolved = false
      const expectedOrigin = new URL(hostedUrl).origin

      // FULLSCREEN — the portal fills the entire browser window edge-to-edge
      // (like the hosted auth modal), so it reads as a full "subpage" rather
      // than a small floating card. Solid brand page_bg ground, no centering, no
      // fixed dimensions.
      const overlay = document.createElement('div')
      overlay.style.cssText =
        `position:fixed;inset:0;z-index:2147483647;background:${t.page_bg};`

      const container = document.createElement('div')
      container.style.cssText =
        `position:absolute;inset:0;background:${t.page_bg};`

      const iframe = document.createElement('iframe')
      iframe.src = hostedUrl
      iframe.style.cssText = 'width:100%;height:100%;border:none;'
      // allow-popups-to-escape-sandbox: the Receipts list opens Stripe's hosted
      // invoice / receipt pages (and direct PDFs) in a new tab. WITHOUT this,
      // that tab inherits the iframe sandbox → an opaque/constrained context in
      // which Stripe's own "Download" navigation is blocked by Cross-Origin-
      // Opener-Policy. Escaping the sandbox opens a normal top-level tab where
      // the PDF downloads / the receipt page works.
      // allow-top-navigation-by-user-activation (#726): the portal's "View
      // plans" store leaves for sign-in and checkout in this page's window.
      iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation')

      // Fail-safe ✕ ONLY. The canonical close ✕ is drawn by the hosted portal
      // page itself (`HostedCloseX`, shown because we pass callback_scheme=web).
      // This SDK chip is a fail-safe for the skeleton / load-error window, hidden
      // on a normal load and on `onelo:ready`, so the two never stack into the
      // double-✕ (#40). Its click still runs the same dismiss (done()).
      const cancelBtn = createModalCloseButton(t)
      const failsafe = installFailsafeClose(cancelBtn)

      // Loading skeleton — a srcdoc iframe stacked over the real one (later
      // sibling wins), pointer-events:none so clicks fall through, removed the
      // moment the real portal iframe fires 'load'. cancelBtn is appended LAST so
      // the ✕ (once the fail-safe reveals it) stays clickable above the skeleton.
      const skeleton = document.createElement('iframe')
      skeleton.setAttribute('aria-hidden', 'true')
      skeleton.setAttribute('sandbox', '')
      skeleton.srcdoc = loadingHtml
      skeleton.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:none;pointer-events:none;'
      // First 'load' = the portal page itself (hides its own ✕ via `onelo:ready`).
      // A SUBSEQUENT 'load' = an in-iframe navigation — the upsell change_plan flow
      // hard-navigates this same iframe to /store/hosted, a new document. Re-arm the
      // fail-safe so the ✕ comes back unless that page, too, signals `onelo:ready`
      // (the store does, and repeats it at its window load, #682) — never trapped.
      let firstLoad = true
      iframe.addEventListener('load', () => {
        skeleton.remove()
        if (firstLoad) { firstLoad = false; return }
        failsafe.rearm()
      })

      container.appendChild(iframe)
      container.appendChild(skeleton)
      container.appendChild(cancelBtn)
      overlay.appendChild(container)
      document.body.appendChild(overlay)

      const close = (): void => {
        failsafe.dispose()
        window.removeEventListener('message', messageHandler)
        overlay.remove()
      }

      const done = (): void => {
        if (resolved) return
        resolved = true
        close()
        resolve()
      }

      const messageHandler = (e: MessageEvent): void => {
        if (e.origin !== expectedOrigin) return
        if (e.source !== iframe.contentWindow) return
        const data = e.data as Record<string, unknown>
        // Hosted page mounted → its canonical ✕ took over → hide our fail-safe ✕
        // (kills the double-✕, #40). Not a close signal — the modal stays open.
        if (data?.type === 'onelo:ready') {
          failsafe.markReady()
          return
        }
        // The portal (or the store it opened, #614) asks for a fresh portal
        // token. Answered only to this iframe, at the portal's origin.
        if (data?.type === 'onelo:renew_request' && data.kind === 'portal' && typeof data.request_id === 'string') {
          const requestId = data.request_id
          void this.renewReply(requestId).then((reply) => {
            try { iframe.contentWindow?.postMessage(reply, expectedOrigin) } catch { /* modal closed */ }
          })
          return
        }
        // Every finish goes through the one Store Hand-back decoder (#615): the
        // portal's own Done (with an optional hard account event), or — after
        // "Change plan" / an upsell auto-advance navigated this iframe to the
        // store — the store's purchase / plan-switch / cancel / error. The user
        // is already signed in, so there is no code exchange here: the modal
        // closes and a purchase / switch reconciles the plan at once (#659) —
        // the stream alone left the old plan on screen for about a minute.
        const hb = classifyHandBack(data)
        if (!hb) return
        if (hb.kind === 'expired' && opts?.reinitiate) {
          const reinitiate = opts.reinitiate
          void reinitiate().then(
            (fresh) => {
              if (resolved) return
              // Same origin only: the fresh page must be one this modal trusts.
              let freshOrigin: string | null = null
              try { freshOrigin = new URL(fresh).origin } catch { /* not a URL */ }
              if (freshOrigin !== expectedOrigin) { done(); return }
              failsafe.rearm()
              iframe.src = fresh
            },
            () => done(),
          )
          return
        }
        if (hb.kind === 'portal_closed' && hb.event && PORTAL_REVOKE_EVENTS.has(hb.event)) {
          this.onSessionInvalidated?.()
        }
        done()
        if (hb.kind === 'purchase') this.onPlanChange?.({ kind: 'purchase' })
        else if (hb.kind === 'switched') this.onPlanChange?.({ kind: 'switched', reason: hb.reason })
      }

      window.addEventListener('message', messageHandler)

      cancelBtn.addEventListener('click', () => done())

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) done()
      })
    })
  }
}
