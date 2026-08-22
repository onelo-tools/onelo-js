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
 * Deliberately plain and unbranded: it appears for a second before the user
 * switches tabs, and dressing it up would make it read like a page that wants
 * something from them.
 */

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
export function coverPage(): void {
  // `watch` from the very first moment: the app boots UNDER this cover and many
  // apps paint by replacing <body>, which would tear it out and produce exactly
  // the flash this prevents.
  render('Signing you in…', null, { watch: true, pending: true })
}

/** Take the cover away — nobody was waiting, so this tab becomes the app. */
export function removeCover(): void {
  if (typeof document === 'undefined') return
  // Stop the watcher FIRST. It exists to undo exactly this kind of removal.
  stopWatching()
  document.getElementById(ID)?.remove()
}

export function showHandedOverNotice(appName?: string | null): void {
  render("You're signed in", appName ?? null, { watch: true })
}


function render(
  heading: string,
  appName: string | null,
  { watch = false, pending = false }: { watch?: boolean; pending?: boolean } = {},
): void {
  if (typeof document === 'undefined' || !document.body) return

  // An existing cover is UPDATED, never stacked: this is the same overlay
  // graduating from "signing you in" to the final message, and a second one
  // would double the backdrop and darken the text.
  const existing = document.getElementById(ID)
  if (existing) {
    const [h, p] = existing.children as unknown as HTMLElement[]
    if (h) h.textContent = heading
    if (p) p.textContent = bodyText(appName, pending)
    if (watch) keepAttached(existing)
    return
  }

  const root = document.createElement('div')
  root.id = ID
  root.setAttribute('role', 'status')
  Object.assign(root.style, {
    position: 'fixed',
    inset: '0',
    // Opaque, not a translucent scrim: the app underneath has already booted
    // and must not be readable or clickable through this.
    background: '#111111',
    color: '#ffffff',
    zIndex: '2147483647',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    padding: '24px',
    font: '400 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  } as Partial<CSSStyleDeclaration>)

  const title = document.createElement('h1')
  title.textContent = heading
  Object.assign(title.style, {
    margin: '0 0 8px',
    font: '600 18px/1.3 inherit',
  } as Partial<CSSStyleDeclaration>)

  const body = document.createElement('p')
  body.textContent = bodyText(appName, pending)
  Object.assign(body.style, {
    margin: '0',
    maxWidth: '320px',
    opacity: '0.6',
  } as Partial<CSSStyleDeclaration>)

  root.append(title, body)
  document.body.appendChild(root)
  if (watch) keepAttached(root)
}

/** Names the other tab rather than saying "the app": the user is looking at two
 *  tabs that appear identical and has to pick one. Empty while still signing in
 *  — there is nothing useful to say yet. */
function bodyText(appName: string | null, pending: boolean): string {
  // Nothing useful to say while the exchange is still in flight, and the heading
  // already carries it.
  if (pending) return ''
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
