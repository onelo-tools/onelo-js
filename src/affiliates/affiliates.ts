import { httpPost } from '@onelo/core'

/**
 * Affiliate referral capture for apps with the Onelo SDK (#929).
 *
 * The app captures the referral itself: no paste-in script is needed. A visitor
 * arrives with `?ref=<code>` (an Affiliate linking straight to the app) or
 * `?onelo_click=<id>` (forwarded by Onelo's tracked link after consent there).
 *
 * Consent comes first. Call `capture({ consent })` once the visitor answered
 * your cookie question:
 *   - `consent: false` stores nothing on the device; a `?ref=` only adds one
 *     to the Affiliate's anonymous total.
 *   - `consent: true` keeps the click in localStorage (`onelo_aff`). Which of
 *     two clicks stays is the program's winner rule, decided by Onelo.
 * When a user is signed in (now or later), the kept click is tied to them, so
 * any purchase they make is attributed, whichever checkout opens.
 */
export const AFFILIATE_STORAGE_KEY = 'onelo_aff'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CODE = /^[A-Za-z0-9]{6,32}$/

interface Kept {
  click_id: string
  claimed_for?: string
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

function read(): Kept | null {
  try {
    const raw = storage()?.getItem(AFFILIATE_STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as Kept) : null
    return parsed && UUID.test(parsed.click_id) ? parsed : null
  } catch {
    return null
  }
}

function write(kept: Kept): void {
  try {
    storage()?.setItem(AFFILIATE_STORAGE_KEY, JSON.stringify(kept))
  } catch {
    // Storage blocked: the referral is simply not kept.
  }
}

export class OneloAffiliates {
  constructor(
    private readonly apiUrl: string,
    private readonly publishableKey: string,
    private readonly getSession: () => Promise<{ accessToken: string; user: { id: string } } | null>,
  ) {}

  /** The referral in the current address, if any. */
  private fromLocation(): { code: string | null; clickId: string | null } {
    if (typeof window === 'undefined') return { code: null, clickId: null }
    const params = new URLSearchParams(window.location.search)
    const code = params.get('ref')
    const clickId = params.get('onelo_click')
    return {
      code: code && CODE.test(code) ? code.toLowerCase() : null,
      clickId: clickId && UUID.test(clickId) ? clickId : null,
    }
  }

  /**
   * Capture the referral after the visitor's cookie answer. Stores nothing
   * without consent. Answers whether a referral is now kept on this device.
   */
  async capture({ consent }: { consent: boolean }): Promise<{ kept: boolean }> {
    const { code, clickId } = this.fromLocation()
    const base = this.apiUrl.replace(/\/$/, '')
    if (!consent) {
      if (code) {
        await httpPost(`${base}/v1/sdk/affiliates/refused`, { publishableKey: this.publishableKey, code }).catch(() => undefined)
      }
      return { kept: false }
    }
    const existing = read()
    if (code) {
      const res = await httpPost(`${base}/v1/sdk/affiliates/click`, {
        publishableKey: this.publishableKey,
        code,
        source: 'sdk',
        ...(existing ? { existing: existing.click_id } : {}),
      }).catch(() => null)
      const id = (res?.json as { click_id?: string } | undefined)?.click_id
      if (res && res.status === 200 && id && UUID.test(id) && id !== existing?.click_id) write({ click_id: id })
    } else if (clickId && clickId !== existing?.click_id) {
      // Onelo's tracked link already recorded this click and applied the
      // program's winner rule; the id it forwards is the one to keep.
      write({ click_id: clickId })
    }
    await this.claimForSession()
    return { kept: read() !== null }
  }

  /** Tie the kept click to the signed-in user once. Called on every sign-in. */
  async claimForSession(): Promise<void> {
    const kept = read()
    if (!kept) return
    const session = await this.getSession().catch(() => null)
    if (!session?.accessToken || kept.claimed_for === session.user.id) return
    const res = await httpPost(`${this.apiUrl.replace(/\/$/, '')}/v1/sdk/affiliates/claim`, {
      publishableKey: this.publishableKey,
      userToken: session.accessToken,
      clickId: kept.click_id,
    }).catch(() => null)
    if (res && res.status === 200) write({ ...kept, claimed_for: session.user.id })
  }
}
