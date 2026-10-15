/**
 * The screen the EMAIL TAB shows after handing a magic-link sign-in back.
 *
 * A magic link opens its own tab — the browser gives us no way to reuse the one
 * the user started in, and a tab we did not open with script cannot be closed by
 * script either. What we CAN do is make sure only one of them is the app.
 *
 * That tab still has to finish the exchange, because only a page on the
 * developer's origin may write to that origin's storage. Once it has, and once a
 * waiting tab has confirmed it took the session, this covers the page so the
 * user is not looking at two running copies of the same app. Adrian, 2026-08-18:
 * "w miejscu po magic linku co najwyżej powinniśmy widzieć wiadomość".
 *
 * Deliberately plain: it appears for a second before the user switches tabs,
 * and dressing it up would make it read like a page that wants something from
 * them. Only its ground, text and font come from the app's brand tokens (#681);
 * the first cover goes up before config arrives, so it starts neutral.
 */
import { NEUTRAL_BRAND_TOKENS, spinnerCss, type BrandTokens } from '@onelo/core'

const ID = 'onelo-handed-over'

/** How long to keep re-attaching the notice if the host app tears it out.
 *  Long enough to outlast a first render and a framework hydration pass. */
const WATCH_MS = 10_000

/** The live re-attach watcher, if any. Held at module level so `removeCover`
 *  can stop it — otherwise removing the cover just makes the observer put it
 *  straight back, and the two fight each other. */
let watcher: MutationObserver | null = null

function stopWatching(): void {
  watcher?.disconnect()
  watcher = null
}

/**
 * Cover the page the MOMENT a magic-link return is detected — before the
 * network exchange and before we know whether another tab will take over.
 *
 * Without this the app boots underneath, notices it is signed in and paints
 * itself, and the notice only lands afterwards: the user sees the app flash up
 * and then be replaced (reported 2026-08-18). A tab that arrives carrying a
 * one-time code is a return tab by definition, so covering it immediately is
 * correct — and if it turns out nobody was waiting, `removeCover` takes it away
 * and this tab becomes the app as normal.
 *
 * The wording is honest about the state at THIS point: the exchange has not
 * happened yet, so it cannot claim a sign-in.
 */
export function coverPage(t: BrandTokens = NEUTRAL_BRAND_TOKENS, heading = 'Signing you in…'): void {
  // `watch` from the very first moment: the app boots UNDER this cover and many
  // apps paint by replacing <body>, which would tear it out and produce exactly
  // the flash this prevents.
  // #728: `heading` is localized by the store return (the store's language),
  // and the pending cover carries the hosted pages' spinner, so the buyer's
  // last step looks like the checkout steps before it.
  render(heading, null, t, { watch: true, pending: true })
}

/** Take the cover away — nobody was waiting, so this tab becomes the app. */
export function removeCover(): void {
  if (typeof document === 'undefined') return
  // Stop the watcher FIRST. It exists to undo exactly this kind of removal.
  stopWatching()
  document.getElementById(ID)?.remove()
}

/**
 * @param waitingTab Whether a tab that was waiting acknowledged the hand-off.
 *   `true` names that tab; `false` never does — there is no such tab to point at
 *   (the link was opened after the original tab was closed); `null` while the
 *   answer is still out, so nothing is claimed yet (#535).
 */
export function showHandedOverNotice(
  appName?: string | null,
  waitingTab: boolean | null = true,
  t: BrandTokens = NEUTRAL_BRAND_TOKENS,
): void {
  render("You're signed in", appName ?? null, t, { watch: true, pending: waitingTab === null, waitingTab: waitingTab !== false })
}


function render(
  heading: string,
  appName: string | null,
  t: BrandTokens,
  { watch = false, pending = false, waitingTab = true }: { watch?: boolean; pending?: boolean; waitingTab?: boolean } = {},
): void {
  if (typeof document === 'undefined' || !document.body) return

  // An existing cover is UPDATED, never stacked: this is the same overlay
  // graduating from "signing you in" to the final message, and a second one
  // would double the backdrop and darken the text.
  const existing = document.getElementById(ID)
  if (existing) {
    const h = existing.querySelector('h1')
    const p = existing.querySelector('p')
    if (h) h.textContent = heading
    if (p) p.textContent = bodyText(appName, pending, waitingTab)
    existing.style.background = t.page_bg
    existing.style.color = t.text
    // The spinner belongs to the pending state only.
    if (!pending) existing.querySelector('[data-onelo-spinner]')?.remove()
    if (watch) keepAttached(existing)
    return
  }

  const root = document.createElement('div')
  root.id = ID
  root.setAttribute('role', 'status')
  root.setAttribute('aria-live', 'polite')
  Object.assign(root.style, {
    position: 'fixed',
    inset: '0',
    // Opaque, not a translucent scrim: the app underneath has already booted
    // and must not be readable or clickable through this.
    background: t.page_bg,
    color: t.text,
    zIndex: '2147483647',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    padding: '24px',
    font: `400 15px/1.5 ${t.body_font}`,
  } as Partial<CSSStyleDeclaration>)

  const title = document.createElement('h1')
  title.textContent = heading
  Object.assign(title.style, {
    margin: '0 0 8px',
    font: '600 18px/1.3 inherit',
  } as Partial<CSSStyleDeclaration>)

  const body = document.createElement('p')
  body.textContent = bodyText(appName, pending, waitingTab)
  Object.assign(body.style, {
    margin: '0',
    maxWidth: '320px',
    color: t.text_muted,
  } as Partial<CSSStyleDeclaration>)

  if (pending) {
    // #728: the hosted pages' ring (brand arc on the token track).
    const spin = document.createElement('div')
    spin.setAttribute('data-onelo-spinner', '')
    spin.setAttribute('aria-hidden', 'true')
    const css = document.createElement('style')
    css.textContent = spinnerCss(t, 'onelo-handed-over-spin')
    const ring = document.createElement('div')
    ring.className = 'onelo-handed-over-spin'
    ring.style.margin = '0 auto 16px'
    spin.append(css, ring)
    root.append(spin)
  }
  root.append(title, body)
  document.body.appendChild(root)
  if (watch) keepAttached(root)
}

/** Names the other tab rather than saying "the app": the user is looking at two
 *  tabs that appear identical and has to pick one. Empty while still signing in
 *  — there is nothing useful to say yet. */
function bodyText(appName: string | null, pending: boolean, waitingTab = true): string {
  // Nothing useful to say while the exchange is still in flight, and the heading
  // already carries it.
  if (pending) return ''
  // Nobody answered: do not send the user looking for a tab that was never told
  // (#535). The session is in this browser's storage, so opening the app again
  // finds it.
  if (!waitingTab) {
    return appName
      ? `You can close this tab and open ${appName} again.`
      : 'You can close this tab and open the app again.'
  }
  return appName
    ? `Continue in the ${appName} tab you started from — you can close this one.`
    : 'Continue in the tab you started from — you can close this one.'
}

function keepAttached(root: HTMLElement): void {
  // ── Survive the host app's own rendering ────────────────────────────────────
  // The app underneath has already booted, and many apps paint themselves by
  // replacing the contents of <body> once they learn they are signed in. That
  // wipes this overlay out along with everything else — the notice appears for a
  // frame and the user is left looking at a second running copy of the app,
  // which is exactly the outcome this exists to prevent (observed 2026-08-18).
  //
  // So put it back. Watching is bounded: after WATCH_MS the app has finished its
  // first paint, and an observer that lived forever would keep this page pinned
  // and fight any deliberate cleanup.
  if (typeof MutationObserver === 'undefined') return
  stopWatching()
  watcher = new MutationObserver(() => {
    if (!document.getElementById(ID) && document.body) document.body.appendChild(root)
  })
  watcher.observe(document.body, { childList: true })
  setTimeout(stopWatching, WATCH_MS)
}
