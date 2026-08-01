import { installFailsafeClose } from '../core/failsafe-close'

export interface FeedbackOptions {
  type?: 'bug' | 'feature_request' | 'general'
  area?: string
  userId?: string
}

export class OneloFeedback {
  constructor(
    private readonly apiUrl: string,
    private readonly publishableKey: string,
    private readonly getActiveFeatures: () => string[],
  ) {}

  async open(options: FeedbackOptions = {}): Promise<void> {
    const params = new URLSearchParams({ key: this.publishableKey })
    if (options.type) params.set('type', options.type)
    if (options.area) params.set('area', options.area)
    const active = this.getActiveFeatures()
    if (active.length > 0) params.set('session', JSON.stringify(active))

    // userId travels as a header (X-Onelo-User-Id), never a query param, so it
    // never lands in the access-logged initiate URL.
    const res = await fetch(`${this.apiUrl}/api/sdk/feedback/initiate?${params}`,
      options.userId ? { headers: { 'X-Onelo-User-Id': options.userId } } : undefined)
    if (!res.ok) throw new Error(`Feedback initiate failed: ${res.status}`)
    const { hosted_url } = await res.json() as { hosted_url: string }

    this._openModal(hosted_url)
  }

  private _openModal(url: string): void {
    const overlay = document.createElement('div')
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:2147483647;display:flex;align-items:center;justify-content:center'
    const container = document.createElement('div')
    container.style.cssText = 'width:480px;max-width:95vw;height:680px;max-height:90vh;border-radius:14px;overflow:hidden;position:relative'
    const iframe = document.createElement('iframe')
    iframe.src = url
    iframe.style.cssText = 'width:100%;height:100%;border:none'

    // Fail-safe ✕ ONLY. The canonical close ✕ is drawn by the hosted feedback
    // page itself (`HostedCloseX`) — identical on every platform. This SDK button
    // is a fail-safe for the skeleton / load-error window, hidden on a normal
    // load and hidden again on `onelo:ready`, so the two never stack into the
    // double-✕ (#40). `installFailsafeClose` keeps it hidden until a ~3.5s grace
    // without ready (no-flash, #44).
    const cancelBtn = document.createElement('button')
    cancelBtn.setAttribute('data-onelo-cancel', '')
    cancelBtn.setAttribute('aria-label', 'Close')
    cancelBtn.textContent = '✕'
    cancelBtn.style.cssText = 'position:absolute;top:10px;right:12px;background:transparent;border:none;color:rgba(255,255,255,0.5);font-size:18px;cursor:pointer;line-height:1;padding:4px;z-index:1'

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
    const onMsg = (e: MessageEvent) => {
      const type = e.data?.type
      if (type === 'onelo:ready') failsafe.markReady()
      else if (type === 'onelo:feedback_close' || type === 'onelo:feedback_submitted') close()
    }
    window.addEventListener('message', onMsg)
  }
}
