import { httpGet, httpPost, mapSession, OneloSession, OneloError, extractErrorCode } from '@onelo/core'
import { AuthModal, type AuthPresentMode } from '../auth/auth-modal'
import { version as SDK_VERSION } from '../../package.json'
import { createModalCloseButton } from '../core/modal-close-button'

export class OneloPaywall {
  private apiUrl: string
  private publishableKey: string
  private getAccessToken: () => Promise<string | null>
  private onSession: (session: OneloSession) => Promise<void>

  constructor(
    apiUrl: string,
    publishableKey: string,
    getAccessToken: () => Promise<string | null>,
    onSession: (session: OneloSession) => Promise<void>,
  ) {
    this.apiUrl = apiUrl
    this.publishableKey = publishableKey
    this.getAccessToken = getAccessToken
    this.onSession = onSession
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
    let url = `${this.apiUrl}/api/sdk/paywall/store-initiate?key=${encodeURIComponent(this.publishableKey)}&callback_scheme=onelo-callback`
    if (lang) url += `&lang=${encodeURIComponent(lang)}`

    const { status, json } = await httpGet(url, { 'X-SDK-Version': SDK_VERSION })
    if (status !== 200) {
      const code = extractErrorCode(json)
      // e.g. store_not_configured (409), paywall_not_enabled (403),
      // in_app_store_not_allowed (409).
      throw OneloError.server(`Failed to initiate store flow: HTTP ${status}${code ? ` (${code})` : ''}`)
    }
    const j = json as Record<string, unknown>
    const storeUrl = j['store_url'] as string | undefined
    if (!storeUrl) throw OneloError.server('Invalid store-initiate response')

    return this._completeHostedCheckout(storeUrl, mode)
  }

  // NOTE: there is deliberately NO `openUpgrade` here. On native SDKs
  // (Swift/Electron/RN/Flutter/Android) `openUpgrade` hits `/upgrade-initiate` and
  // opens the `store_switch` checkout in the SYSTEM BROWSER (deep-link callback).
  // In `@onelo/js` a hosted page is shown in an IFRAME MODAL that resolves on a
  // `postMessage` — but the store's plan-switch terminals (scheduled downgrade,
  // month↔year) post nothing, so the modal would hang and a successful switch
  // would report as cancelled. So the web upgrade affordance routes through the
  // WORKING web surfaces instead: `Onelo.openUpgrade()` → `customerPortal.open()`
  // for a subscriber (the Portal's own "Change plan", which posts onelo:portal_done)
  // or `openStore()` for a non-subscriber. See onelo.ts.

  /** Shared tail for store-initiate: present the hosted /store/hosted page (which
   *  postMessages `onelo:code`), exchange the code for a session via
   *  hosted-callback, and hand it to auth. */
  private async _completeHostedCheckout(url: string, mode: AuthPresentMode): Promise<OneloSession | null> {
    const modal = new AuthModal()
    const result = await modal.open(url, mode)

    if (result.type === 'cancelled') return null
    if (result.type === 'error') throw OneloError.server(result.message)
    // Exhaustive on purpose. The store modal does not opt into the cross-tab
    // session watch, so this cannot fire — but the union is shared with auth,
    // and a silent `result.code` on a variant without one is how a refactor
    // turns into a runtime undefined.
    if (result.type !== 'code') return null

    const { status: cbStatus, json: cbJson } = await httpPost(
      `${this.apiUrl}/api/sdk/auth/hosted-callback`,
      { publishableKey: this.publishableKey, code: result.code },
      { 'X-SDK-Version': SDK_VERSION },
    )
    if (cbStatus !== 200) throw OneloError.server('Hosted-callback failed')
    const session = mapSession(cbJson as Record<string, unknown>)
    await this.onSession(session)
    return session
  }

  /**
   * Opens the hosted manage page (upgrade, cancel, payment method).
   * Returns the new plan string if the user changed their plan, or null if closed without changes.
   */
  async openManage(lang?: string): Promise<string | null> {
    const accessToken = await this.getAccessToken()
    if (!accessToken) throw OneloError.server('No active session — sign in before opening the manage page')

    let url = `${this.apiUrl}/api/sdk/paywall/manage-initiate?key=${encodeURIComponent(this.publishableKey)}`
    if (lang) url += `&lang=${encodeURIComponent(lang)}`

    const { status, json } = await httpGet(url, {
      'X-SDK-Version': SDK_VERSION,
      Authorization: `Bearer ${accessToken}`,
    })
    if (status !== 200) throw OneloError.server('Failed to initiate manage flow')
    const j = json as Record<string, unknown>
    const manageUrl = j['manage_url'] as string | undefined
    if (!manageUrl) throw OneloError.server('Invalid manage-initiate response')

    return this.openManageModal(manageUrl)
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private openManageModal(manageUrl: string): Promise<string | null> {
    return new Promise((resolve) => {
      // Validate postMessage against the HOSTED PAGE origin (where /manage/hosted
      // runs + posts from), NOT apiUrl. The manage page lives on the app/frontend
      // origin, a different subdomain than the backend apiUrl — deriving from
      // apiUrl rejected the onelo:plan_changed message.
      const allowedOrigin = new URL(manageUrl).origin

      // Build overlay — same approach as AuthModal.buildOverlay
      const overlay = document.createElement('div')
      overlay.style.cssText =
        'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;'

      const container = document.createElement('div')
      container.style.cssText =
        'position:relative;width:480px;height:640px;border-radius:12px;overflow:hidden;background:#111;'

      const iframe = document.createElement('iframe')
      iframe.src = manageUrl
      iframe.style.cssText = 'width:100%;height:100%;border:none;'
      iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin allow-popups')

      const cancelBtn = createModalCloseButton()

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
