import { httpGet, OneloError } from '@onelo/core'
import { version as SDK_VERSION } from '../../package.json'
import { createModalCloseButton } from '../core/modal-close-button'

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
}

// Pre-connect loading skeleton, shown behind the portal iframe until the hosted
// page paints (the iframe had NO loading state before — just a bare #111 rect).
// Rendered as a `srcdoc` iframe so its @keyframes live in their own document and
// need no host-page CSP allowance. Layout mirrors the hosted PortalSkeleton
// (frontend/app/customer/portal/PortalSkeleton.tsx) 1:1 — same shape used by every
// SDK (RN/Swift/Electron/Flutter/Android) — so the cross-fade skeleton → hosted
// PortalSkeleton → loaded portal has zero layout shift. No branding bg is plumbed
// to the JS portal, so #111111 (the overlay's own ground) is used.
const PORTAL_SKELETON_HTML = `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#111111;font-family:-apple-system,sans-serif;overflow:hidden}
@keyframes onelo-shimmer{0%{background-position:-60vw 0}100%{background-position:100vw 0}}
.wrap{display:flex;flex-direction:column;align-items:center;width:100%;padding:48px 24px 0}
.col{width:100%;max-width:432px;display:flex;flex-direction:column;gap:14px}
.sk{background-color:rgba(255,255,255,0.04);background-image:linear-gradient(90deg,rgba(255,255,255,0) 0%,rgba(255,255,255,0.12) 50%,rgba(255,255,255,0) 100%);background-size:60vw 100%;background-repeat:no-repeat;background-attachment:fixed;animation:onelo-shimmer 2.4s linear infinite;border-radius:8px}
.strong{background-color:rgba(255,255,255,0.08);background-image:linear-gradient(90deg,rgba(255,255,255,0) 0%,rgba(255,255,255,0.18) 50%,rgba(255,255,255,0) 100%);background-size:60vw 100%;background-repeat:no-repeat;background-attachment:fixed;animation:onelo-shimmer 2.4s linear infinite;border-radius:9px}
.icon{width:64px;height:64px;border-radius:14px;margin-bottom:14px;background:rgba(255,255,255,0.06);border:1.5px solid rgba(255,255,255,0.1)}
.title{width:200px;height:22px;margin-bottom:10px;border-radius:6px}
.sub{width:80px;height:13px;opacity:0.7;margin-bottom:32px;border-radius:4px}
.c1{height:240px;border-radius:14px}
.c2{height:80px;border-radius:14px}
.c3{height:140px;border-radius:14px}
</style></head><body>
<div class="wrap">
<div class="sk icon"></div>
<div class="sk title"></div>
<div class="sk sub"></div>
<div class="col"><div class="strong c1"></div><div class="strong c2"></div><div class="strong c3"></div></div>
</div>
</body></html>`

// Neutral "Opening plans…" spinner — used INSTEAD of the manage-plan skeleton
// when the portal is opened from an upsell tap (open({intent:'change_plan'})).
// The portal-shaped skeleton reads as "Manage your plan is loading", which is the
// wrong page for an upgrade; this matches the hosted page's own PortalOpeningSpinner
// so the SDK overlay → hosted spinner → plan picker is one continuous loading state.
const OPENING_PLANS_HTML = `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{background:#111111;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.7)}
@keyframes onelo-op-spin{to{transform:rotate(360deg)}}
.box{display:flex;flex-direction:column;align-items:center;gap:12px}
.sp{width:28px;height:28px;border-radius:9999px;border:3px solid rgba(255,255,255,0.18);border-top-color:#f97316;animation:onelo-op-spin 0.8s linear infinite}
.t{font-size:13px}
</style></head><body>
<div class="box"><div class="sp"></div><div class="t">Opening plans…</div></div>
</body></html>`

export class OneloCustomerPortal {
  private apiUrl: string
  private publishableKey: string
  private getAccessToken: () => Promise<string | null>
  private onSessionInvalidated?: () => void

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
    const token = await this.getAccessToken()
    if (!token) throw new OneloError('not_authenticated', 'Sign in before opening the customer portal')

    const url = `${this.apiUrl}/api/sdk/paywall/portal-initiate?key=${encodeURIComponent(this.publishableKey)}&callback_scheme=web`
    const { status, json } = await httpGet(url, {
      'X-SDK-Version': SDK_VERSION,
      Authorization: `Bearer ${token}`,
    })
    if (status !== 200) throw OneloError.server('Failed to initiate customer portal')
    const j = json as Record<string, unknown>
    const hostedUrl = j['hosted_url'] as string | undefined
    if (!hostedUrl) throw OneloError.server('Invalid portal-initiate response')

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
    const loadingHtml = opts?.intent === 'change_plan' ? OPENING_PLANS_HTML : PORTAL_SKELETON_HTML
    return this.openPortalModal(finalUrl, loadingHtml)
  }

  private openPortalModal(hostedUrl: string, loadingHtml: string = PORTAL_SKELETON_HTML): Promise<void> {
    return new Promise((resolve) => {
      let resolved = false
      const expectedOrigin = new URL(hostedUrl).origin

      // FULLSCREEN — the portal fills the entire browser window edge-to-edge
      // (like the hosted auth modal), so it reads as a full "subpage" rather
      // than a small floating card. Solid #111 ground, no centering, no fixed
      // dimensions.
      const overlay = document.createElement('div')
      overlay.style.cssText =
        'position:fixed;inset:0;z-index:2147483647;background:#111;'

      const container = document.createElement('div')
      container.style.cssText =
        'position:absolute;inset:0;background:#111;'

      const iframe = document.createElement('iframe')
      iframe.src = hostedUrl
      iframe.style.cssText = 'width:100%;height:100%;border:none;'
      // allow-popups-to-escape-sandbox: the Receipts list opens Stripe's hosted
      // invoice / receipt pages (and direct PDFs) in a new tab. WITHOUT this,
      // that tab inherits the iframe sandbox → an opaque/constrained context in
      // which Stripe's own "Download" navigation is blocked by Cross-Origin-
      // Opener-Policy. Escaping the sandbox opens a normal top-level tab where
      // the PDF downloads / the receipt page works.
      iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox')

      const cancelBtn = createModalCloseButton()

      // Loading skeleton — a srcdoc iframe stacked over the real one (later
      // sibling wins), pointer-events:none so clicks fall through, removed the
      // moment the real portal iframe fires 'load'. cancelBtn is appended LAST so
      // the ✕ stays clickable above the skeleton during loading.
      const skeleton = document.createElement('iframe')
      skeleton.setAttribute('aria-hidden', 'true')
      skeleton.setAttribute('sandbox', '')
      skeleton.srcdoc = loadingHtml
      skeleton.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:none;pointer-events:none;'
      iframe.addEventListener('load', () => skeleton.remove())

      container.appendChild(iframe)
      container.appendChild(skeleton)
      container.appendChild(cancelBtn)
      overlay.appendChild(container)
      document.body.appendChild(overlay)

      const close = (): void => {
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
        if (data?.type === 'onelo:portal_done') {
          if (typeof data.event === 'string' && PORTAL_REVOKE_EVENTS.has(data.event)) {
            this.onSessionInvalidated?.()
          }
          done()
          return
        }
        // After an upsell-tap auto-advance (open({intent:'change_plan'})), the
        // iframe hard-navigates to /store/hosted, which posts onelo:code on
        // payment success (or onelo:cancel / onelo:error). The user is already
        // signed in and the new entitlement arrives over SSE, so the modal just
        // needs to CLOSE — no code exchange here. Without this the portal modal
        // hung open on the store page after a successful Change plan.
        if (data?.type === 'onelo:code' || data?.type === 'onelo:cancel' || data?.type === 'onelo:error') {
          done()
        }
      }

      window.addEventListener('message', messageHandler)

      cancelBtn.addEventListener('click', () => done())

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) done()
      })
    })
  }
}
