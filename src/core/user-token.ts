/**
 * Proof of the signed-in end user on Features calls (#510, #518).
 *
 * The Features endpoints (resolve, batch-ping, poll, module-token, the Event
 * Stream and its Stream Token) accept `Authorization: Bearer <Onelo access
 * token>` from a publishable-key caller and take the user from the token
 * instead of the `userId` in the body (server: `backend/app/lib/features/end_user.py`). A token the server refuses
 * answers `401 {"detail":{"error":"invalid_user_token"}}` and never falls back
 * to the `userId`.
 *
 * This module is the ONE place that decides what a Features call sends:
 * - signed in: the current access token (read fresh per call, so an expired
 *   one is never reused — `auth.getSession()` refreshes near expiry);
 * - refused: refresh once and retry once (one refresh per refusal episode);
 * - refused again: the call is made anonymous (no token, no `userId`) and the
 *   caller is told, so it can surface the refusal. It never loops.
 */

/** Where the Features calls read the signed-in user's access token. */
export interface UserTokenSource {
  /** The current access token, or null when no Onelo user is signed in. */
  current(): Promise<string | null>
  /** Refresh the session and return the new access token (null when that fails). */
  refresh(): Promise<string | null>
}

/** The error code the server answers with for a refused user token. */
export const INVALID_USER_TOKEN = 'invalid_user_token'

/** How one attempt of a Features call proves (or does not prove) the user. */
export interface UserTokenAttempt {
  /** The Bearer to send, or null for no `Authorization` header. */
  token: string | null
  /** True for the final fallback after a refused token: send no `userId` either. */
  anonymous: boolean
}

/** `Authorization` header for an attempt — empty when it carries no token. */
export function bearerHeader(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/** True for the server's `401 invalid_user_token` (FastAPI `{detail:{error}}`, or a flat `{error}`). */
export function isInvalidUserToken(status: number, json: unknown): boolean {
  if (status !== 401 || json === null || typeof json !== 'object') return false
  const j = json as { detail?: unknown; error?: unknown }
  const detail = j.detail
  const code = detail !== null && typeof detail === 'object' ? (detail as { error?: unknown }).error : j.error
  return code === INVALID_USER_TOKEN
}

/** Read a token from the source, treating a failure or an empty value as "no token". */
export async function readUserToken(fn: (() => Promise<string | null>) | undefined): Promise<string | null> {
  if (!fn) return null
  try {
    const token = await fn()
    return typeof token === 'string' && token.length > 0 ? token : null
  } catch {
    // A token source that fails (storage error, refresh network error) counts
    // as "no token": the call still goes out, exactly as a signed-out one would.
    return null
  }
}

/**
 * Per-source refusal state, shared by every call that uses the same source
 * (Features and the Event Stream get the same object from `Onelo`).
 *
 * Why it exists: a successful refresh saves the session, which notifies the
 * auth listeners, and `Onelo` answers that with `features.load()` — a NEW
 * Features call. If the server keeps refusing even fresh tokens (for example a
 * key whose app is not the one the user signed in to), a per-call "refresh
 * once" would refresh → reload → be refused → refresh … without end. So a
 * refusal-triggered refresh happens at most once per refusal episode:
 * concurrent refusals share the refresh in flight, and after it no further
 * refresh is made until a token is accepted again or the user changes
 * (`resetUserTokenRefusal`).
 */
interface RefusalState {
  spent: boolean
  inFlight: Promise<string | null> | null
}
const refusalStates = new WeakMap<UserTokenSource, RefusalState>()
function refusalState(source: UserTokenSource): RefusalState {
  let state = refusalStates.get(source)
  if (!state) {
    state = { spent: false, inFlight: null }
    refusalStates.set(source, state)
  }
  return state
}

/**
 * The refreshed token to retry a refused call with — or null when this refusal
 * episode already used its one refresh (then the caller goes anonymous).
 */
export function refreshAfterRefusal(source: UserTokenSource | null | undefined): Promise<string | null> {
  if (!source) return Promise.resolve(null)
  const state = refusalState(source)
  if (state.inFlight) return state.inFlight
  if (state.spent) return Promise.resolve(null)
  state.spent = true
  const run = readUserToken(() => source.refresh())
  state.inFlight = run
  void run.finally(() => { if (state.inFlight === run) state.inFlight = null })
  return run
}

/** A call that carried a token got an answer other than a refusal: the next
 *  refusal may refresh again. */
export function userTokenAccepted(source: UserTokenSource | null | undefined): void {
  if (source) refusalState(source).spent = false
}

/** A different user signed in (or signed out): start a new refusal episode. */
export function resetUserTokenRefusal(source: UserTokenSource | null | undefined): void {
  if (source) refusalState(source).spent = false
}

/** True when a token-bearing answer proves the token was accepted: only a 2xx
 *  from an endpoint that checks the token before answering. Anything else (a
 *  403 from the security guard, a throttled 204 from batch-ping, a 5xx) may
 *  come before the token is looked at, so it says nothing about it. */
function accepted(status: number): boolean {
  return status >= 200 && status < 300
}

/**
 * Send one Features call with the signed-in user's token.
 *
 * `send` performs a single request for the given attempt. When the server
 * refuses the token, the session is refreshed (at most once per refusal
 * episode, see `refreshAfterRefusal`) and the call retried once; if that is
 * refused too (or there is no refreshed token), `onRefused` runs and, unless
 * `anonymousFallback` is false, the call is sent one last time as anonymous.
 * The response of the last attempt made is returned.
 *
 * `provesAcceptance` is false for an endpoint whose 2xx does not prove the
 * token was checked (batch-ping answers a throttled 204 before looking at it);
 * such a call never ends a refusal episode.
 */
export async function sendWithUserToken<R extends { status: number; json: unknown }>(
  source: UserTokenSource | null | undefined,
  send: (attempt: UserTokenAttempt) => Promise<R>,
  onRefused: () => void,
  anonymousFallback = true,
  provesAcceptance = true,
): Promise<R> {
  const token = await readUserToken(source ? () => source.current() : undefined)
  const first = await send({ token, anonymous: false })
  if (token === null) return first
  if (!isInvalidUserToken(first.status, first.json)) {
    if (provesAcceptance && accepted(first.status)) userTokenAccepted(source)
    return first
  }

  let last = first
  const fresh = await refreshAfterRefusal(source)
  if (fresh !== null) {
    last = await send({ token: fresh, anonymous: false })
    if (!isInvalidUserToken(last.status, last.json)) {
      if (provesAcceptance && accepted(last.status)) userTokenAccepted(source)
      return last
    }
  }
  onRefused()
  if (!anonymousFallback) return last
  return send({ token: null, anonymous: true })
}
