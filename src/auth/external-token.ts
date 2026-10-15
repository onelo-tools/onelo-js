/**
 * The exchange door, seen from the browser (#798, ADR-0032).
 *
 * An App that signs its users in with Supabase, Clerk, Firebase or any OpenID
 * Connect issuer hands the SDK a function that returns the issuer's current
 * token. `POST /api/sdk/auth/exchange` turns that token into an ordinary Onelo
 * session: a 30-minute access token and NO refresh token. Renewal is another
 * exchange with a fresh issuer token, so the SDK never reads or stores the
 * issuer's token.
 *
 * This module holds what is specific to that door: the call, what each answer
 * means for the session, and when to renew. `OneloAuth` owns the session
 * itself (storage, single-flight, the cross-tab lock, the retry backoff).
 */
import { httpPost, OneloError } from '@onelo/core'
import { SDK_HEADERS } from '../core/sdk-headers'

/**
 * Returns the sign-in provider's current token, or nothing when no user is
 * signed in there. May answer synchronously or with a promise.
 */
export type ExternalTokenGetter = () => string | null | undefined | Promise<string | null | undefined>

/** Renew at this share of the session's lifetime… */
const RENEW_AT = 0.8
/** …moved earlier by up to this share of that point, so the tabs of one user
 *  (and the users of one App after a deploy) do not all renew in one second. */
const RENEW_JITTER = 0.1

/**
 * Seconds before expiry at which an external session is renewed: between 72%
 * and 80% of its lifetime has passed (21.6–24 minutes of 30).
 */
export function renewalLeadSeconds(expiresIn: number, random: () => number = Math.random): number {
  const renewAfter = expiresIn * RENEW_AT * (1 - RENEW_JITTER * random())
  return expiresIn - renewAfter
}

/** The lead used before this tab has exchanged once (a 30-minute session, no jitter). */
export const DEFAULT_EXTERNAL_LEAD_SECONDS = renewalLeadSeconds(1800, () => 0)

/** Refusals of the token's validity window, retried with a fresh token. */
const RETRY_WITH_A_FRESH_TOKEN: ReadonlySet<string> = new Set(['token_expired', 'token_not_yet_valid'])

export type ExchangeOutcome =
  /** 200: the body `mapSession` reads (`{ session, user }`). */
  | { kind: 'session'; json: Record<string, unknown> }
  /** Try again later; the current session, if any, stays. `staleToken` marks
   *  a refusal of the provider token's validity window (#836): once the Onelo
   *  access token itself has expired, such a refusal ends the session. */
  | { kind: 'transient'; error: OneloError; staleToken: boolean }
  /** The door refused this user or this token: the session is over. */
  | { kind: 'ended'; error: OneloError }

/** `{detail: {error | error_code, message}}`, or `{detail: "text"}` for an unknown key. */
function refusalOf(json: unknown): { code: string | undefined; message: string | undefined } {
  const detail = json !== null && typeof json === 'object' ? (json as { detail?: unknown }).detail : undefined
  if (typeof detail === 'string') return { code: undefined, message: detail }
  if (detail === null || typeof detail !== 'object') return { code: undefined, message: undefined }
  const d = detail as Record<string, unknown>
  const code = d['error'] ?? d['error_code']
  return {
    code: typeof code === 'string' ? code : undefined,
    message: typeof d['message'] === 'string' ? (d['message'] as string) : undefined,
  }
}

/**
 * Exchange one issuer token. A network failure rejects (the caller treats it
 * as transient, like any other lost request).
 */
export async function exchangeExternalToken(
  apiUrl: string,
  publishableKey: string,
  token: string,
): Promise<ExchangeOutcome> {
  const { status, json } = await httpPost(
    `${apiUrl}/api/sdk/auth/exchange`,
    { publishableKey, token },
    { ...SDK_HEADERS },
  )
  if (status === 200 && json !== null && typeof json === 'object') {
    return { kind: 'session', json: json as Record<string, unknown> }
  }
  const { code, message } = refusalOf(json)
  const named = code ? `${code}, HTTP ${status}` : `HTTP ${status}`
  // 429: a rate limit, the App's MAU cap or the hourly new-user cap. 5xx
  // includes `503 issuer_unavailable` (the issuer's keys cannot be read). None
  // of them says anything about this user: keep the session and retry.
  //
  // `token_expired` / `token_not_yet_valid` say the TOKEN is not valid at this
  // moment (a provider client that answered from a stale cache, a clock a few
  // seconds off), not that the user is gone: the retry asks the provider for a
  // new one. A user really signed out there returns no token, which ends the
  // session without coming here.
  if (status === 429 || status >= 500 || status === 200 || (code !== undefined && RETRY_WITH_A_FRESH_TOKEN.has(code))) {
    return {
      kind: 'transient',
      staleToken: code !== undefined && RETRY_WITH_A_FRESH_TOKEN.has(code),
      error: OneloError.server(`The sign-in token could not be exchanged right now (${named})`),
    }
  }
  if (code === 'banned') return { kind: 'ended', error: OneloError.userRevoked() }
  if (code === 'no_plan_available') return { kind: 'ended', error: OneloError.noActivePlan() }
  if (code === 'sign_in_mode_onelo') {
    return {
      kind: 'ended',
      error: new OneloError(
        'session_ended',
        'Onelo refused the sign-in token (sign_in_mode_onelo): this App\'s Sign-in Mode is Onelo Auth. ' +
        'Set the Sign-in Mode to your provider in the Onelo dashboard before calling useExternalToken().',
      ),
    }
  }
  return {
    kind: 'ended',
    error: new OneloError(
      'session_ended',
      `Onelo refused the sign-in token (${named})${message ? `: ${message}` : ''}`,
    ),
  }
}
