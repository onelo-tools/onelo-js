import { httpGet, OneloError } from '@onelo/core'
import { version as SDK_VERSION } from '../../package.json'

interface PortalInitiateResponse {
  hosted_url: string
  app_name?: string
  app_logo_url?: string | null
}

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

  async open(): Promise<void> {
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

    return this.openPortalModal(hostedUrl)
  }

  private openPortalModal(hostedUrl: string): Promise<void> {
    return new Promise((resolve) => {
      let resolved = false
      const expectedOrigin = new URL(hostedUrl).origin

      const overlay = document.createElement('div')
      overlay.style.cssText =
        'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;'

      const container = document.createElement('div')
      container.style.cssText =
        'position:relative;width:480px;height:640px;border-radius:12px;overflow:hidden;background:#111;'

      const iframe = document.createElement('iframe')
      iframe.src = hostedUrl
      iframe.style.cssText = 'width:100%;height:100%;border:none;'
      iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin allow-popups')

      const cancelBtn = document.createElement('button')
      cancelBtn.setAttribute('data-onelo-cancel', '')
      cancelBtn.textContent = '✕'
      cancelBtn.style.cssText =
        'position:absolute;top:10px;right:12px;background:transparent;border:none;color:rgba(255,255,255,0.5);font-size:18px;cursor:pointer;line-height:1;padding:4px;'

      container.appendChild(iframe)
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
          if (data.event === 'account_deletion_scheduled') {
            this.onSessionInvalidated?.()
          }
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
