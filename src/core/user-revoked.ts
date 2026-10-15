import { extractErrorCode } from '@onelo/core'

/**
 * #831 — every Onelo SDK endpoint refuses a banned or deleted App User with
 * one answer: `403 {"detail":{"error":"user_revoked","message":"You don't have
 * access"}}` (the presence heartbeat answers the same body with 401). The SDK
 * reports it as `OneloError.userRevoked()`, never retries it, and never asks
 * for a refresh because of it: the user is refused until the ban is lifted.
 */
export const USER_REVOKED = 'user_revoked'

export function isUserRevokedRefusal(json: unknown): boolean {
  return extractErrorCode(json) === USER_REVOKED
}
