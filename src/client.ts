const DEFAULT_BASE_URL = 'https://api.onelo.tools'

export class _OneloClient {
  readonly publishableKey: string
  readonly baseUrl: string
  private _userId: string | null = null
  private _plan: string | undefined = undefined

  constructor(publishableKey: string, baseUrl?: string) {
    this.publishableKey = publishableKey
    this.baseUrl = (baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
  }

  setIdentity(userId: string, plan?: string): void {
    this._userId = userId
    this._plan = plan
  }

  get userId(): string | null {
    return this._userId
  }

  get plan(): string | undefined {
    return this._plan
  }

  async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const res = await globalThis.fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      throw new Error(`Onelo API error ${res.status} on ${path}`)
    }
    return res.json() as Promise<T>
  }
}
