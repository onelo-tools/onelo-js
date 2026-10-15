import { installFailsafeClose } from '../core/failsafe-close'
import { createModalCloseButton } from '../core/modal-close-button'
import { BrandSource } from '@onelo/core'
import { bearerHeader, sendWithUserToken, type UserTokenSource } from '../core/user-token'

export interface FeedbackOptions {
  type?: 'bug' | 'feature_request' | 'general'
  area?: string
  userId?: string
}

export class OneloFeedback {
  /** The SDK's brand-token model (#681). `Onelo` shares its own. */
  private brand: BrandSource = new BrandSource()
  setBrandSource(brand: BrandSource): void {
    this.brand = brand
  }

  constructor(
    private readonly apiUrl: string,
    private readonly publishableKey: string,
    private readonly getActiveFeatures: () => string[],
    /** The signed-in Onelo user's access token (#820). Wired by `Onelo` to
     *  `auth`; with a session the initiate call carries it and the report names
     *  a verified reporter. Absent, the call is exactly as before. */
    private readonly userToken?: UserTokenSource,
  ) {}

  async open(options: FeedbackOptions = {}): Promise<void> {
    const hostedUrl = await this.initiate(options)
    this._openModal(hostedUrl, options)
  }

  /** Mint a hosted feedback URL (and with it a fresh reporter token `ft`). */
  private async initiate(options: FeedbackOptions): Promise<string> {
    const params = new URLSearchParams({ key: this.publishableKey })
    if (options.type) params.set('type', options.type)
    if (options.area) params.set('area', options.area)
    const active = this.getActiveFeatures()
    if (active.length > 0) params.set('session', JSON.stringify(active))

    const url = `${this.apiUrl}/api/sdk/feedback/initiate?${params}`
    // Signed in (#820): `Authorization: Bearer <access token>` makes the server
    // sign the token's user as a VERIFIED reporter. A refused token is refreshed
    // and retried once; refused again, the form still opens without it (as a
    // signed-out call would), so feedback never fails on identity.
    // userId travels as a header (X-Onelo-User-Id), never a query param, so it
    // never lands in the access-logged initiate URL. Without a session it is the
    // developer's unverified label; with one the server uses the token instead.
    const { status, json } = await sendWithUserToken(this.userToken, async ({ token }) => {
      const headers: Record<string, string> = {
        ...bearerHeader(token),
        ...(options.userId ? { 'X-Onelo-User-Id': options.userId } : {}),
      }
      const res = await fetch(url, Object.keys(headers).length > 0 ? { headers } : undefined)
      let body: unknown = null
      try { body = await res.json() } catch { /* non-JSON error body */ }
      return { status: res.status, json: body }
    }, () => {})
    if (status < 200 || status >= 300) throw new Error(`Feedback initiate failed: ${status}`)
    const hosted_url = (json as { hosted_url?: string } | null)?.hosted_url
    if (!hosted_url) throw new Error('Feedback initiate returned no hosted_url')
    return hosted_url
  }

  /**
   * Answer the hosted form's `onelo:renew_request` (kind `feedback`, #622). The
   * form's reporter token `ft` lives 30 minutes; a form left open longer asks
   * for a fresh one on submit. The same options are initiated again, so the
   * report keeps its reporter, type, area and session.
   */
  async renewReply(requestId: string, options: FeedbackOptions): Promise<Record<string, unknown>> {
    try {
      const hostedUrl = await this.initiate(options)
      return { type: 'onelo:renewed', request_id: requestId, hosted_url: hostedUrl }
    } catch {
      return { type: 'onelo:renew_failed', request_id: requestId, reason: 'renew_failed' }
    }
  }

  private _openModal(url: string, options: FeedbackOptions = {}): void {
    let hostedOrigin: string | null = null
    try { hostedOrigin = new URL(url).origin } catch { /* unusable URL: no renewal */ }
    // Container ground, radius and ✕ from the brand tokens (#681); the scrim
    // dims the host app and is not a brand surface.
    const t = this.brand.current()
    const overlay = document.createElement('div')
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:2147483647;display:flex;align-items:center;justify-content:center'
    const container = document.createElement('div')
    container.style.cssText = `width:480px;max-width:95vw;height:680px;max-height:90vh;border-radius:${t.card_radius}px;overflow:hidden;position:relative;background:${t.page_bg}`
    const iframe = document.createElement('iframe')
    iframe.src = url
    iframe.style.cssText = 'width:100%;height:100%;border:none'

    // Fail-safe ✕ ONLY. The canonical close ✕ is drawn by the hosted feedback
    // page itself (`HostedCloseX`) — identical on every platform. This SDK button
    // is a fail-safe for the skeleton / load-error window, hidden on a normal
    // load and hidden again on `onelo:ready`, so the two never stack into the
    // double-✕ (#40). `installFailsafeClose` keeps it hidden until a ~3.5s grace
    // without ready (no-flash, #44).
    const cancelBtn = createModalCloseButton(t)

    container.appendChild(iframe)
    container.appendChild(cancelBtn)
    overlay.appendChild(container)
    document.body.appendChild(overlay)

    const failsafe = installFailsafeClose(cancelBtn)

    // overlay.remove() is idempotent (no-op if already detached) — safe against a
    // double close now that ✕, backdrop, and postMessage can all trigger it.
    const close = () => { failsafe.dispose(); overlay.remove(); window.removeEventListener('message', onMsg) }
    overlay.addEventListener('click', e => { if (e.target === overlay) close() })
    cancelBtn.addEventListener('click', () => close())

    // Messages from the hosted feedback page:
    //  • onelo:ready              → page mounted, its canonical ✕ took over → hide our fail-safe ✕
    //  • onelo:feedback_close     → user tapped the canonical hosted ✕ → dismiss
    //  • onelo:feedback_submitted → submit auto-closed (existing)
    //  • onelo:renew_request      → the form's `ft` expired; answer with a fresh
    //                               hosted URL, only to this iframe at its origin (#622)
    const onMsg = (e: MessageEvent) => {
      const type = e.data?.type
      if (type === 'onelo:renew_request') {
        const requestId = e.data?.request_id
        if (e.data?.kind !== 'feedback' || typeof requestId !== 'string') return
        if (!hostedOrigin || e.origin !== hostedOrigin || e.source !== iframe.contentWindow) return
        void this.renewReply(requestId, options).then((reply) => {
          try { iframe.contentWindow?.postMessage(reply, hostedOrigin as string) } catch { /* modal closed */ }
        })
        return
      }
      if (type === 'onelo:ready') failsafe.markReady()
      else if (type === 'onelo:feedback_close' || type === 'onelo:feedback_submitted') close()
    }
    window.addEventListener('message', onMsg)
  }
}
