/**
 * Store Hand-back (#615) — the ONE decoder for "the hosted page is finished".
 *
 * The hosted store and Customer Portal tell the SDK they are done with one of
 * these postMessages (produced by one helper on the page,
 * frontend/lib/store-hand-back.ts, plus the portal's Done):
 *   `onelo:code`        a purchase finished → exchange the code
 *   `onelo:done`        a plan switch finished without a code (reason:
 *                       plan_switched | switch_scheduled | plan_switch_pending)
 *   `onelo:portal_done` the Customer Portal closed (optional `event`)
 *   `onelo:cancel`      closed without finishing; with reason `expired` the
 *                       link died (#619) and the opener starts the surface again
 *   `onelo:error`       failed
 * Every modal that shows a hosted page classifies messages here, so a new
 * terminal is taught to every container at once.
 */
export type HandBack =
  | { kind: 'purchase'; code: string }
  /** Success, never a cancel: the buyer is signed in; the SDK reconciles the plan at once (#659). */
  | { kind: 'switched'; reason: string }
  | { kind: 'portal_closed'; event: string | null }
  | { kind: 'cancelled' }
  /** The page's link is dead (#619). Not a cancel: the SDK that opened it runs
   *  its initiate again and loads the fresh URL in the same container. */
  | { kind: 'expired' }
  | { kind: 'error'; message: string }

/** Returns the hand-back a message carries, or null for anything else
 *  (`onelo:ready`, `onelo:resize`, renewal requests, foreign messages). */
export function classifyHandBack(data: unknown): HandBack | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  switch (d.type) {
    case 'onelo:code':
      return typeof d.code === 'string' ? { kind: 'purchase', code: d.code } : null
    case 'onelo:done':
      return { kind: 'switched', reason: String(d.reason ?? '') }
    case 'onelo:portal_done':
      return { kind: 'portal_closed', event: typeof d.event === 'string' ? d.event : null }
    case 'onelo:cancel':
      return d.reason === 'expired' ? { kind: 'expired' } : { kind: 'cancelled' }
    case 'onelo:error':
      return { kind: 'error', message: String(d.message ?? 'Auth error') }
    default:
      return null
  }
}
