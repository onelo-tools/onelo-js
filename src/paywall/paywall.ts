import { httpGet, httpPost, mapSession, OneloSession, OneloError } from '@onelo/core'
import { AuthModal } from '../auth/auth-modal'
import { version as SDK_VERSION } from '../../package.json'

const TIER: Record<string, number> = { free: 0, pro: 1, business: 2, enterprise: 3 }

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

  check(requiredPlan: string, userPlan: string = 'free'): boolean {
    const req = TIER[requiredPlan]
    const usr = TIER[userPlan]
    if (req === undefined || usr === undefined) return false
    return usr >= req
  }

  /**
   * Opens the hosted store page (plan selection + registration + payment).
   * Returns the session on success, or null if the user cancelled.
   */
  async openStore(lang?: string): Promise<OneloSession | null> {
    let url = `${this.apiUrl}/api/sdk/paywall/store-initiate?key=${encodeURIComponent(this.publishableKey)}&callback_scheme=onelo-callback`
    if (lang) url += `&lang=${encodeURIComponent(lang)}`

    const { status, json } = await httpGet(url, { 'X-SDK-Version': SDK_VERSION })
    if (status !== 200) throw OneloError.server('Failed to initiate store flow')
    const j = json as Record<string, unknown>
    const storeUrl = j['store_url'] as string | undefined
    if (!storeUrl) throw OneloError.server('Invalid store-initiate response')

    const modal = new AuthModal(this.apiUrl)
    const result = await modal.open(storeUrl)

    if (result.type === 'cancelled') return null
    if (result.type === 'error') throw OneloError.server(result.message)

    const { status: cbStatus, json: cbJson } = await httpPost(
      `${this.apiUrl}/api/sdk/auth/hosted-callback`,
      { publishableKey: this.publishableKey, code: result.code },
      { 'X-SDK-Version': SDK_VERSION },
    )
    if (cbStatus !== 200) throw OneloError.server('Store hosted-callback failed')
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
      const allowedOrigin = new URL(this.apiUrl).origin

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
