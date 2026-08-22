/**
 * Cross-tab hand-off of a magic-link sign-in.
 *
 * WHY THIS EXISTS
 * ---------------
 * A magic link cannot open in the tab that asked for it: the email opens a NEW
 * tab, and the original — sitting on "Check your inbox" — has no `opener` and no
 * parent frame, so `postMessage` has nobody to talk to.
 *
 * The first attempt used the `storage` event, which per spec fires "in every
 * other Document" of the origin and is what most cross-tab auth examples use. It
 * did NOT arrive: measured live in Safari on 2026-08-18 with a listener attached
 * by hand in the waiting tab. So the channel was wrong, not the idea.
 * `BroadcastChannel` is the API built for this, and it was measured to work in
 * the same setup.
 *
 * ONE-WAY, DELIBERATELY
 * ---------------------
 * The session must be written by a page on the DEVELOPER'S origin — no other
 * origin can touch that storage — so the tab the email opened has to finish the
 * exchange. Then it stops: it shows "you can close this" and nothing else, ever.
 * Signing in happens in the tab the user started from, full stop (Adrian,
 * 2026-08-19).
 *
 * An earlier version acknowledged the announcement and let the email tab carry
 * on into the app when nobody answered. That exception is gone: it is what made
 * the email tab show an app, a store or a login form depending on timing, which
 * is exactly the unpredictability being removed. Nobody listening simply means
 * nobody was told.
 *
 * Carries NO SESSION, in either direction. The session is read through the normal
 * storage path — putting one in a channel every same-origin script can subscribe
 * to would hand a credential to the whole page.
 *
 * It MAY carry a `surfaceUrl`: the hosted screen the other tab was told to show
 * when the Access Gate refused entry ("No active plan", or the store). That URL
 * has to travel, because it cannot be re-derived: with no plan there is no
 * session, so a tab that asks the backend again is told — correctly — that
 * nobody is signed in, and lands back on the sign-in form. That is exactly what
 * both tabs did on 2026-08-18. The URL is scoped to this origin and its token is
 * single-use and short-lived.
 */

const CHANNEL = 'onelo_auth'

/** Sent by the tab that just completed a sign-in. */
export const SESSION_CREATED = 'onelo:session-created'

function open(): BroadcastChannel | null {
  // Safari gained BroadcastChannel in 15.4. Older browsers get no hand-off — the
  // waiting tab keeps waiting exactly as before, which is a degradation, never
  // a break.
  if (typeof BroadcastChannel === 'undefined') return null
  try {
    return new BroadcastChannel(CHANNEL)
  } catch {
    return null
  }
}

/**
 * Announce to other tabs that a magic-link sign-in finished here.
 *
 * Fire-and-forget: the announcing tab's own behaviour does not depend on whether
 * anyone heard. It shows its farewell notice either way, so there is nothing to
 * wait for and no timeout to get wrong.
 *
 * `surfaceUrl` is the hosted screen the Access Gate named when it refused entry.
 * It has to travel because it cannot be re-derived: a refused user has no
 * session, so a tab that asks the backend is told "nobody is signed in".
 */
export function publishSessionCreated(surfaceUrl?: string): void {
  const ch = open()
  if (!ch) return
  try {
    ch.postMessage({ type: SESSION_CREATED, surfaceUrl })
  } finally {
    // One-shot: nothing here needs a long-lived channel, and leaving one open
    // keeps a listener alive in a page that may be about to navigate.
    ch.close()
  }
}

/**
 * Call `onSession` when another tab reports a sign-in, and tell it we took over.
 * Returns an unsubscribe function; callers MUST use it — a live channel keeps
 * the page referenced.
 */
export function subscribeSessionCreated(
  onSession: (surfaceUrl?: string) => void,
): () => void {
  const ch = open()
  if (!ch) return () => {}

  const handler = (e: MessageEvent) => {
    if ((e.data as { type?: string })?.type !== SESSION_CREATED) return
    onSession((e.data as { surfaceUrl?: string })?.surfaceUrl)
  }
  ch.addEventListener('message', handler)

  return () => {
    ch.removeEventListener('message', handler)
    try { ch.close() } catch { /* already closed */ }
  }
}
