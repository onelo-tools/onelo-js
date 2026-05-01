export class OneloForms {
  constructor(
    private readonly apiUrl: string,
    private readonly publishableKey: string,
  ) {}

  async submit(
    formSlug: string,
    data: Record<string, unknown>,
    submitterEmail?: string,
  ): Promise<{ success: boolean; message?: string }> {
    try {
      const body: Record<string, unknown> = { publishableKey: this.publishableKey, formSlug, data }
      if (submitterEmail) body.submitterEmail = submitterEmail
      const res = await fetch(`${this.apiUrl}/api/sdk/forms/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json() as { success: boolean; message?: string }
      return { success: json.success ?? false, message: json.message }
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : String(err) }
    }
  }
}
