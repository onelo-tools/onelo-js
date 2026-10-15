import { waitlistConsentField, type WaitlistJoinOptions } from '@onelo/core'

export class OneloWaitlist {
  constructor(
    private readonly apiUrl: string,
    private readonly publishableKey: string,
  ) {}

  async join(
    slug: string | undefined,
    email: string,
    /** #818: the checkboxes your form showed — `{ consent: { marketing, custom } }`. */
    options?: WaitlistJoinOptions,
  ): Promise<{ success: boolean; position?: number; alreadyJoined: boolean }> {
    try {
      const body: Record<string, unknown> = {
        publishableKey: this.publishableKey, email, ...waitlistConsentField(options),
      }
      if (slug !== undefined) body.slug = slug
      const res = await fetch(`${this.apiUrl}/api/sdk/waitlist/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      // Backend contract: 2xx with { ok: true, position?, alreadyJoined? }; errors are
      // non-2xx FastAPI { detail } bodies.
      const json = await res.json().catch(() => ({})) as { ok?: boolean; position?: number; alreadyJoined?: boolean }
      const success = res.ok && json.ok === true
      return { success, position: json.position, alreadyJoined: success && json.alreadyJoined === true }
    } catch (err) {
      return { success: false, alreadyJoined: false }
    }
  }
}
