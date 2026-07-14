/**
 * PII scrubber for Monitor payloads — mirrors the backend denylist + value
 * patterns (`backend/app/routes/sdk_monitor.py` PII_KEY_DENYLIST /
 * PII_VALUE_PATTERNS) and the Swift `MonitorScrubber`, so secrets never leave
 * the browser in plaintext. The backend re-scrubs server-side; this closes the
 * on-the-wire gap (the whole point of a client scrubber).
 *
 * Boundary anchoring: the backend uses lookbehind `(?<![A-Za-z0-9])`. Browser
 * Safari < 16.4 does NOT support lookbehind, and a lookbehind regex *literal*
 * throws a SyntaxError at MODULE LOAD — which would break the entire SDK
 * import. So we anchor with a leading capture group `(^|[^A-Za-z0-9])` and
 * re-emit it in the replacement — functionally equivalent, universally
 * parseable. (Trailing lookahead `(?![A-Za-z0-9])` is fine everywhere.)
 */

const REDACTED = '[REDACTED]'
const MAX_DEPTH = 10 // hard stop against deeply-nested attacker input

// Key denylist — a key whose lowercased name contains any of these (or has a
// `key` segment) has its value fully redacted. Mirrors PII_KEY_DENYLIST.
const KEY_DENYLIST = [
  'password', 'passwd', 'secret', 'token', 'api_key', 'apikey',
  'authorization', 'cookie', 'credential', 'private_key',
  'client_secret', 'cvv', 'ssn',
] as const

// Value patterns — group 1 is the leading boundary char (re-emitted); the rest
// of the match is the secret and is dropped. Mirror of PII_VALUE_PATTERNS.
const VALUE_PATTERNS: readonly RegExp[] = [
  /(^|[^A-Za-z0-9])Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /(^|[^A-Za-z0-9])eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+(?![A-Za-z0-9])/g, // JWT
  /(^|[^A-Za-z0-9])(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}(?![A-Za-z0-9])/g,           // Stripe-style
  /(^|[^A-Za-z0-9])onelo_(?:pk|sk|rk)_(?:live|test)_[A-Za-z0-9]{8,}(?![A-Za-z0-9])/g,      // Onelo keys
  /(^|[^A-Za-z0-9])(?:4[0-9]{3}|5[1-5][0-9]{2}|3[47][0-9]{2}|6(?:011|5[0-9]{2}))[\s-][0-9]{4}[\s-][0-9]{4}[\s-][0-9]{4}(?![A-Za-z0-9])/g, // CC separated
  /(^|[^A-Za-z0-9])(?:4|5[1-5]|6(?:011|5))[0-9]{14,}(?![0-9])/g,                           // CC unseparated
  /(^|[^A-Za-z0-9])3[47][0-9]{13,}(?![0-9])/g,                                             // Amex
]

function keyIsPii(key: string): boolean {
  const k = key.toLowerCase()
  if (KEY_DENYLIST.some((p) => k.includes(p))) return true
  // `key` segment (after normalising separators) catches custom secret headers
  // (x-anthropic-key / x-groq-key) without false-positives like "monkey".
  return k.replace(/-/g, '_').split('_').includes('key')
}

/** Redact secret-looking substrings from a free-text string. */
export function scrubText(text: string): string {
  let out = text
  for (const pat of VALUE_PATTERNS) out = out.replace(pat, (_m, boundary: string) => boundary + REDACTED)
  return out
}

function scrubValue(value: unknown, redacted: Set<string>, depth: number): unknown {
  // Depth cap: drop the whole subtree (stricter than the backend's pass-through;
  // matches Swift — a runaway-nested payload can't smuggle secrets past the cap).
  if (depth >= MAX_DEPTH) return REDACTED
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, redacted, depth + 1))
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === '_onelo_redacted') { out[k] = v; continue } // never recurse our own marker
      if (keyIsPii(k)) { redacted.add(k); out[k] = REDACTED }
      else out[k] = scrubValue(v, redacted, depth + 1)
    }
    return out
  }
  if (typeof value === 'string') return scrubText(value)
  return value
}

/**
 * Returns a NEW scrubbed meta object; adds `_onelo_redacted` (sorted key list)
 * when any key was redacted. Never mutates the input. `undefined` passes through.
 */
export function scrubMeta(meta: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (meta == null) return meta
  const redacted = new Set<string>()
  const cleaned = scrubValue(meta, redacted, 0) as Record<string, unknown>
  if (redacted.size > 0) cleaned['_onelo_redacted'] = Array.from(redacted).sort()
  return cleaned
}
