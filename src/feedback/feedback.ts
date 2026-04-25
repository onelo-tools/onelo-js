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
    if (options.userId) params.set('userId', options.userId)
    const active = this.getActiveFeatures()
    if (active.length > 0) params.set('session', JSON.stringify(active))

    const res = await fetch(`${this.apiUrl}/api/sdk/feedback/initiate?${params}`)
    if (!res.ok) throw new Error(`Feedback initiate failed: ${res.status}`)
    const { hosted_url } = await res.json() as { hosted_url: string }

    this._openModal(hosted_url)
  }

  private _openModal(url: string): void {
    const overlay = document.createElement('div')
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:2147483647;display:flex;align-items:center;justify-content:center'
    const container = document.createElement('div')
    container.style.cssText = 'width:480px;max-width:95vw;height:560px;max-height:90vh;border-radius:14px;overflow:hidden;position:relative'
    const iframe = document.createElement('iframe')
    iframe.src = url
    iframe.style.cssText = 'width:100%;height:100%;border:none'
    container.appendChild(iframe)
    overlay.appendChild(container)
    document.body.appendChild(overlay)

    const close = () => { document.body.removeChild(overlay); window.removeEventListener('message', onMsg) }
    overlay.addEventListener('click', e => { if (e.target === overlay) close() })

    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === 'onelo:feedback_submitted') close()
    }
    window.addEventListener('message', onMsg)
  }
}
