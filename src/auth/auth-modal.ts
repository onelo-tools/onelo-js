/**
 * AuthModal — iframe overlay for hosted sign-in flow.
 * Equivalent of WKWebView (Swift) and BrowserWindow (Electron).
 */

export type AuthModalCallback =
  | { type: 'code'; code: string }
  | { type: 'cancelled' }
  | { type: 'error'; message: string }

export class AuthModal {
  private overlay: HTMLDivElement | null = null
  private messageHandler: ((e: MessageEvent) => void) | null = null
  private readonly allowedOrigin: string

  constructor(apiUrl: string) {
    // Validate postMessage against the Onelo API origin
    this.allowedOrigin = new URL(apiUrl).origin
  }

  open(hostedUrl: string): Promise<AuthModalCallback> {
    return new Promise((resolve) => {
      this.overlay = this.buildOverlay(hostedUrl)
      document.body.appendChild(this.overlay)

      // Listen for postMessage from hosted page
      this.messageHandler = (e: MessageEvent) => {
        if (e.origin !== this.allowedOrigin) return
        const data = e.data as Record<string, unknown>
        if (data?.type === 'onelo:code' && typeof data.code === 'string') {
          this.close()
          resolve({ type: 'code', code: data.code })
        } else if (data?.type === 'onelo:cancel') {
          this.close()
          resolve({ type: 'cancelled' })
        } else if (data?.type === 'onelo:error') {
          this.close()
          resolve({ type: 'error', message: String(data.message ?? 'Auth error') })
        }
      }
      window.addEventListener('message', this.messageHandler)

      // Cancel button click
      const cancelBtn = this.overlay.querySelector<HTMLButtonElement>('[data-onelo-cancel]')
      cancelBtn?.addEventListener('click', () => {
        this.close()
        resolve({ type: 'cancelled' })
      })
    })
  }

  close(): void {
    if (this.messageHandler) {
      window.removeEventListener('message', this.messageHandler)
      this.messageHandler = null
    }
    this.overlay?.remove()
    this.overlay = null
  }

  private buildOverlay(hostedUrl: string): HTMLDivElement {
    const overlay = document.createElement('div')
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2147483647',
      'background:rgba(0,0,0,0.75)',
      'display:flex', 'align-items:center', 'justify-content:center',
    ].join(';')

    const container = document.createElement('div')
    container.style.cssText = [
      'position:relative',
      'width:480px', 'height:640px',
      'border-radius:12px', 'overflow:hidden',
      'background:#111',
    ].join(';')

    const iframe = document.createElement('iframe')
    iframe.src = hostedUrl
    iframe.style.cssText = 'width:100%;height:100%;border:none;'
    iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin allow-popups')

    const cancelBtn = document.createElement('button')
    cancelBtn.setAttribute('data-onelo-cancel', '')
    cancelBtn.textContent = '✕'
    cancelBtn.style.cssText = [
      'position:absolute', 'top:10px', 'right:12px',
      'background:transparent', 'border:none',
      'color:rgba(255,255,255,0.5)', 'font-size:18px',
      'cursor:pointer', 'line-height:1', 'padding:4px',
    ].join(';')

    container.appendChild(iframe)
    container.appendChild(cancelBtn)
    overlay.appendChild(container)
    return overlay
  }
}
