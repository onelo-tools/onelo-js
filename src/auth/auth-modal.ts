/**
 * AuthModal — hosted sign-in presenter for the web SDK.
 *
 * Two modes. `Auth.loadAuthView()` always passes an explicit mode and defaults to
 * 'embedded'; the parameter default below is only a fallback for direct callers.
 *  - 'embedded' (what the SDK uses): an in-page iframe overlay — sign-in renders
 *               INSIDE the app's own window, which is what web users expect. The
 *               hosted page must allow the app's origin in its frame-ancestors
 *               CSP; Onelo does that automatically once the origin is in the
 *               app's allowed origins.
 *  - 'popup':   a top-level window (window.open). Escape hatch for origins you
 *               can't add (a sandbox/preview host), and immune to frame-ancestors
 *               CSP — it loads the page top-level like the native Swift/Electron
 *               WebViews do.
 *
 * Allowed-origins rule (enforced by `_check_origin_allowed` in the backend — it
 * keys off `applications.is_live`, NOT the key type):
 *  - app NOT live + empty list  → fail-open, any origin works (localhost included)
 *  - app NOT live + non-empty   → exact match required; localhost must be listed
 *  - app live                   → non-empty list required, exact match
 */
import { subscribeSessionCreated } from '../core/session-channel'
import { createModalCloseButton } from '../core/modal-close-button'
import { installFailsafeClose } from '../core/failsafe-close'

export type AuthPresentMode = 'popup' | 'embedded'

// Pre-connect loading skeleton, shown BEHIND the auth iframe until the hosted
// page paints (the iframe had NO loading state before — just a bare #111 rect,
// so a slow first paint read as a broken black screen). Same pattern the portal
// already uses: a `srcdoc` iframe so its @keyframes live in their own document
// and need no host-page CSP allowance.
//
// Layout mirrors the hosted sign-in form 1:1 — logo 64, heading 200×22,
// subheading 140×13, then the form column — so the cross-fade skeleton → real
// form has zero layout shift.
//
// Social pills are deliberately OMITTED: the SDK can't know how many providers
// are enabled before the page loads, and guessing would flash buttons that never
// appear. The hosted skeleton makes the same choice when socialCount = 0.
/**
 * Width of the sign-in column, in px. MUST equal `AUTH_COLUMN_WIDTH_PX` in
 * frontend/lib/auth-layout.ts — this skeleton is drawn directly underneath the
 * hosted form, so any disagreement shows up as the column jumping width the moment
 * the page takes over.
 *
 * The SDK ships separately from the page, so they cannot share a module at runtime.
 * frontend/__tests__/auth-column-width.test.ts reads BOTH files and fails when the
 * numbers diverge. That check exists because they DID diverge: 0.37.0 shipped
 * `clamp(300px, 60vw, 420px)` here while the page had already standardised on 300px,
 * so a 420px skeleton handed over to a 300px form — a visible 1.4× jump.
 */
const AUTH_COLUMN_WIDTH_PX = 300

const AUTH_SKELETON_HTML = `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box;margin:0;padding:0}
/* Centred exactly like the hosted page's own Suspense fallback
   (frontend/app/auth/hosted/page.tsx): flex centre + min-height:100vh on a
   #111111 ground. Top-aligning here would make the placeholder jump to the
   middle the moment the real form paints. */
body{background:#111111;font-family:-apple-system,sans-serif;overflow:hidden;
  display:flex;align-items:center;justify-content:center;min-height:100vh}
@keyframes onelo-shimmer{0%{background-position:-60vw 0}100%{background-position:100vw 0}}
.wrap{display:flex;flex-direction:column;align-items:center;width:100%;padding:24px}
/* Width comes from AUTH_COLUMN_WIDTH_PX above — never type a number here.
   Keep it identical to HostedAuthForm.tsx
   and OAuthButtons.tsx — four files render the same column and any drift shows
   up as a width jump when the hosted page replaces this placeholder. */
.col{width:100%;max-width:${AUTH_COLUMN_WIDTH_PX}px;display:flex;flex-direction:column;gap:10px}
.sk{background-color:rgba(255,255,255,0.04);background-image:linear-gradient(90deg,rgba(255,255,255,0) 0%,rgba(255,255,255,0.14) 50%,rgba(255,255,255,0) 100%);background-size:60vw 100%;background-repeat:no-repeat;background-attachment:fixed;animation:onelo-shimmer 2.4s linear infinite;border-radius:8px}
.strong{background-color:rgba(255,255,255,0.08);background-image:linear-gradient(90deg,rgba(255,255,255,0) 0%,rgba(255,255,255,0.20) 50%,rgba(255,255,255,0) 100%);background-size:60vw 100%;background-repeat:no-repeat;background-attachment:fixed;animation:onelo-shimmer 2.4s linear infinite;border-radius:9px}
.logo{width:64px;height:64px;border-radius:14px;margin-bottom:14px;background:rgba(255,255,255,0.06);border:1.5px solid rgba(255,255,255,0.1)}
.head{width:200px;height:22px;margin-bottom:10px;border-radius:6px}
.sub{width:140px;height:13px;opacity:0.7;margin-bottom:28px;border-radius:4px}
.lbl{width:38px;height:11px}
.lbl2{width:58px;height:11px}
.forgot{width:90px;height:11px;opacity:0.7}
.input{height:44px}
.cta{height:48px;margin-top:6px;border-radius:10px}
.row{display:flex;justify-content:space-between;align-items:center}
.link{width:200px;height:12px;opacity:0.6;margin-top:6px;align-self:center}
</style></head><body>
<div class="wrap">
<div class="sk logo"></div>
<div class="sk head"></div>
<div class="sk sub"></div>
<div class="col">
<div class="sk lbl"></div>
<div class="strong input" style="margin-bottom:2px"></div>
<div class="row"><div class="sk lbl2"></div><div class="sk forgot"></div></div>
<div class="strong input"></div>
<div class="strong cta"></div>
<div class="sk link"></div>
</div>
</div>
</body></html>`

export type AuthModalCallback =
  | { type: 'code'; code: string }
  | { type: 'cancelled' }
  | { type: 'error'; message: string }
  /** Another TAB finished a magic-link sign-in while this modal was waiting.
   *
   *  No code to exchange: either the other tab wrote the session to shared
   *  storage (read it back), or the Access Gate refused entry and named the
   *  screen owed instead — `surfaceUrl`. That URL cannot be re-derived here,
   *  because a refused user has no session and asking the backend again answers
   *  "nobody is signed in". */
  | { type: 'session'; surfaceUrl?: string }

export class AuthModal {
  private overlay: HTMLDivElement | null = null
  private container: HTMLDivElement | null = null
  private popup: Window | null = null
  private popupPoll: ReturnType<typeof setInterval> | null = null
  private messageHandler: ((e: MessageEvent) => void) | null = null
  private unsubscribeSession: (() => void) | null = null
  private loadWatchdog: ReturnType<typeof setTimeout> | null = null
  /** Fail-safe ✕ controller for the embedded overlay (see failsafe-close.ts). */
  private failsafe: { markReady: () => void; rearm: () => void; dispose: () => void } | null = null
  /** The skeleton iframe shown behind the hosted page until it paints. */
  private skeleton: HTMLIFrameElement | null = null
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

  /**
   * @param watchCrossTabSession Settle with `{type:'session'}` if ANOTHER tab
   *   signs this user in while the modal is open. Opt-in, and only the auth
   *   flow asks for it: the STORE is also presented through this modal, and a
   *   sign-in happening elsewhere is no reason to close a checkout the buyer is
   *   part-way through.
   */
  open(
    hostedUrl: string,
    mode: AuthPresentMode = 'popup',
    { watchCrossTabSession = false }: { watchCrossTabSession?: boolean } = {},
  ): Promise<AuthModalCallback> {
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
        // `onelo:ready` = the hosted SIGN-IN page mounted. Two effects:
        //   1. drop the skeleton (the real form is painted underneath),
        //   2. keep the SDK's fail-safe ✕ hidden — sign-in is the FIRST screen
        //      of the app, not a modal over content, so there is nothing to go
        //      back to and no ✕ should ever show on a healthy load.
        // The STORE (also presented through loadAuthView) does NOT post this
        // message, so its fail-safe ✕ still appears after the grace period —
        // which is required: closing the store without buying must resolve null.
        if (data?.type === 'onelo:ready') {
          this.failsafe?.markReady()
          this.skeleton?.remove()
          this.skeleton = null
        }
        // We deliberately IGNORE onelo:resize for the container size: on web the
        // modal is a big 16:9 takeover and the hosted page centres its own content
        // inside (a native-window resize-to-content would shrink it). The message
        // still usefully proved load above (clearLoadWatchdog).
        if (data?.type === 'onelo:code' && typeof data.code === 'string') settle({ type: 'code', code: data.code })
        else if (data?.type === 'onelo:cancel') settle({ type: 'cancelled' })
        else if (data?.type === 'onelo:error') settle({ type: 'error', message: String(data.message ?? 'Auth error') })
      }
      window.addEventListener('message', this.messageHandler)

      // ── Magic link finishes in a DIFFERENT TAB ───────────────────────────
      // The email cannot open in this tab, so the sign-in completes in a new
      // one and posts nothing back here — this modal would sit on "Check your
      // inbox" forever while the user is already signed in next door. That is
      // what Adrian saw on 2026-08-18.
      //
      // The other tab announces the sign-in over a BroadcastChannel; there is
      // nothing to exchange here, so settle and let the caller read the session
      // back from storage. See core/session-channel.ts for why this is NOT the
      // `storage` event — that was tried first and measured NOT to arrive.
      if (watchCrossTabSession) {
        this.unsubscribeSession = subscribeSessionCreated(
          (surfaceUrl) => settle({ type: 'session', surfaceUrl }),
        )
      }

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
          // Name the PROTOCOL mismatch when that is what it is. The old message
          // blamed allowed origins unconditionally, and a developer running a
          // plain `http://localhost` dev server against the https hosted page
          // spent hours checking a list that was already correct. Safari blocks
          // cross-protocol frame access outright ("Protocols must match"), and
          // no origin allowlist can change that — the dev server has to serve
          // https, or the flow has to run in popup mode.
          let hint =
            'check this origin is in the app\'s allowed origins, or use loadAuthView({ mode: "popup" })'
          try {
            const pageProtocol = window.location.protocol
            const hostedProtocol = new URL(hostedUrl).protocol
            if (pageProtocol === 'http:' && hostedProtocol === 'https:') {
              hint =
                `this page is served over ${pageProtocol}// while the hosted page is ${hostedProtocol}// — ` +
                'browsers block frame access across protocols. Serve your dev server over https, ' +
                'or use loadAuthView({ mode: "popup" }). This is NOT an allowed-origins problem'
            }
          } catch { /* URL parse — fall back to the generic hint */ }
          settle({
            type: 'error',
            message: `The hosted page could not be loaded inline — ${hint}.`,
          })
        }, AuthModal.EMBED_LOAD_TIMEOUT_MS)
      }
    })
  }

  close(): void {
    this.clearLoadWatchdog()
    this.failsafe?.dispose()
    this.failsafe = null
    this.skeleton = null
    if (this.messageHandler) {
      window.removeEventListener('message', this.messageHandler)
      this.messageHandler = null
    }
    if (this.unsubscribeSession) {
      this.unsubscribeSession()
      this.unsubscribeSession = null
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

    // Skeleton FIRST (painted underneath) so the hosted page cross-fades over a
    // shaped placeholder instead of a black rectangle. Dropped on `onelo:ready`.
    const skeleton = document.createElement('iframe')
    skeleton.setAttribute('aria-hidden', 'true')
    skeleton.setAttribute('sandbox', '')
    skeleton.srcdoc = AUTH_SKELETON_HTML
    skeleton.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:none;pointer-events:none;'
    this.skeleton = skeleton

    const iframe = document.createElement('iframe')
    iframe.src = hostedUrl
    iframe.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:none;'
    // allow-popups-to-escape-sandbox is required, not cosmetic: without it the
    // OAuth popup inherits this sandbox (opaque origin, no storage), and
    // Google/Apple reject the resulting context. With it, the popup is an
    // ordinary top-level window — the only kind of context the providers allow
    // themselves to be loaded in at all.
    iframe.setAttribute(
      'sandbox',
      'allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox',
    )

    // #40 hosted-close unification: the SDK must NOT draw an always-on ✕ over a
    // healthy hosted page. Sign-in is the app's FIRST screen — nothing sits
    // behind it — so a ✕ there reads as "this is a modal over something", which
    // is exactly the wrong affordance. `installFailsafeClose` keeps the button
    // hidden on mount and reveals it ONLY if the page never signals `onelo:ready`
    // (blocked frame / dead network), so the user is never trapped.
    const cancelBtn = createModalCloseButton()
    this.failsafe = installFailsafeClose(cancelBtn)

    container.appendChild(skeleton)
    container.appendChild(iframe)
    container.appendChild(cancelBtn)
    overlay.appendChild(container)
    return overlay
  }
}
