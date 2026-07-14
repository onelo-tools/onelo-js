/**
 * AuthModal — hosted sign-in presenter for the web SDK.
 * Two modes:
 *  - 'popup'    (default): a top-level window (window.open). Immune to the hosted
 *               page's frame-ancestors CSP — behaves like the native Swift/Electron
 *               WebView (loads the page top-level, not framed).
 *  - 'embedded': an in-page iframe overlay. Nicer UX, but the hosted page must
 *               allow the app's origin in its frame-ancestors CSP (Onelo does this
 *               automatically once the origin is in the app's allowed origins;
 *               localhost works out of the box on a test key).
 */
import { createModalCloseButton } from '../core/modal-close-button'

export type AuthPresentMode = 'popup' | 'embedded'

export type AuthModalCallback =
  | { type: 'code'; code: string }
  | { type: 'cancelled' }
  | { type: 'error'; message: string }

export class AuthModal {
  private overlay: HTMLDivElement | null = null
  private container: HTMLDivElement | null = null
  private popup: Window | null = null
  private popupPoll: ReturnType<typeof setInterval> | null = null
  private messageHandler: ((e: MessageEvent) => void) | null = null
  private loadWatchdog: ReturnType<typeof setTimeout> | null = null
  /** How long to wait for the embedded hosted page to prove it loaded (it posts
   *  an early `onelo:resize` on render). If the iframe is refused by the page's
   *  frame-ancestors CSP — or fails to load — it renders and posts NOTHING, so
   *  silence past this window means "blocked"; we then surface an actionable
   *  error (suggest popup) instead of leaving a silent blank overlay. Generous
   *  so a slow first paint on a poor connection never false-positives — a real
   *  block posts nothing regardless of how long we wait. */
  private static readonly EMBED_LOAD_TIMEOUT_MS = 12000

  private clearLoadWatchdog(): void {
    if (this.loadWatchdog) {
      clearTimeout(this.loadWatchdog)
      this.loadWatchdog = null
    }
  }

  open(hostedUrl: string, mode: AuthPresentMode = 'popup'): Promise<AuthModalCallback> {
    return new Promise((resolve) => {
      // Validate postMessage against the HOSTED PAGE origin (where the sign-in UI
      // actually runs + posts from), NOT apiUrl. The hosted page lives on the
      // app/frontend origin (e.g. st.onelo.tools), which is a DIFFERENT subdomain
      // than the backend apiUrl (e.g. st.backend.onelo.tools) — deriving the
      // allowlist from apiUrl rejected every legitimate message.
      const allowedOrigin = new URL(hostedUrl).origin
      let settled = false
      const settle = (r: AuthModalCallback): void => {
        if (settled) return
        settled = true
        this.close()
        resolve(r)
      }

      this.messageHandler = (e: MessageEvent) => {
        if (e.origin !== allowedOrigin) return
        // ANY message from the hosted origin (the early onelo:resize, a store
        // ready ping, or a final code/cancel/error) proves the iframe actually
        // loaded — cancel the embedded load watchdog so a slow-but-loaded page
        // with a user still typing is never kicked out as "blocked".
        this.clearLoadWatchdog()
        const data = e.data as Record<string, unknown>
        // We deliberately IGNORE onelo:resize for the container size: on web the
        // modal is a big 16:9 takeover and the hosted page centres its own content
        // inside (a native-window resize-to-content would shrink it). The message
        // still usefully proved load above (clearLoadWatchdog).
        if (data?.type === 'onelo:code' && typeof data.code === 'string') settle({ type: 'code', code: data.code })
        else if (data?.type === 'onelo:cancel') settle({ type: 'cancelled' })
        else if (data?.type === 'onelo:error') settle({ type: 'error', message: String(data.message ?? 'Auth error') })
      }
      window.addEventListener('message', this.messageHandler)

      if (mode === 'popup') {
        this.popup = window.open(
          hostedUrl,
          'onelo-auth',
          'width=480,height=680,menubar=no,toolbar=no,location=no,status=no',
        )
        if (!this.popup) {
          settle({ type: 'error', message: 'Popup was blocked. Allow popups for sign-in, or use loadAuthView({ mode: "embedded" }).' })
          return
        }
        // The user closing the popup without finishing = cancelled.
        this.popupPoll = setInterval(() => {
          if (this.popup && this.popup.closed) settle({ type: 'cancelled' })
        }, 400)
      } else {
        this.overlay = this.buildOverlay(hostedUrl)
        document.body.appendChild(this.overlay)
        const cancelBtn = this.overlay.querySelector<HTMLButtonElement>('[data-onelo-cancel]')
        cancelBtn?.addEventListener('click', () => settle({ type: 'cancelled' }))
        // Arm the load watchdog. Cancelled by the first message from the hosted
        // origin (see messageHandler); if the frame is CSP-refused / fails, it
        // posts nothing and this fires with an actionable error instead of a
        // silent blank overlay — restoring the visible-error property the popup
        // mode has for its blocked case.
        this.loadWatchdog = setTimeout(() => {
          settle({
            type: 'error',
            message:
              'The hosted page could not be loaded inline — check this origin is in the app\'s allowed origins, or use loadAuthView({ mode: "popup" }).',
          })
        }, AuthModal.EMBED_LOAD_TIMEOUT_MS)
      }
    })
  }

  close(): void {
    this.clearLoadWatchdog()
    if (this.messageHandler) {
      window.removeEventListener('message', this.messageHandler)
      this.messageHandler = null
    }
    if (this.popupPoll) {
      clearInterval(this.popupPoll)
      this.popupPoll = null
    }
    if (this.popup && !this.popup.closed) this.popup.close()
    this.popup = null
    this.overlay?.remove()
    this.overlay = null
    this.container = null
  }

  private buildOverlay(hostedUrl: string): HTMLDivElement {
    // Truly fullscreen: edge-to-edge, no margin, no 16:9 box — the hosted page
    // (sign-in / store) fills the whole viewport and centres its own content,
    // identical on browser / desktop / mobile web. `inset:0` fixed tracks the
    // viewport with no JS resizing needed.
    const overlay = document.createElement('div')
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2147483647',
      'background:#111',
    ].join(';')

    const container = document.createElement('div')
    container.style.cssText = [
      'position:absolute', 'inset:0',
      'overflow:hidden',
      'background:#111',
    ].join(';')
    this.container = container

    const iframe = document.createElement('iframe')
    iframe.src = hostedUrl
    iframe.style.cssText = 'width:100%;height:100%;border:none;'
    iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin allow-popups')

    const cancelBtn = createModalCloseButton()

    container.appendChild(iframe)
    container.appendChild(cancelBtn)
    overlay.appendChild(container)
    return overlay
  }
}
