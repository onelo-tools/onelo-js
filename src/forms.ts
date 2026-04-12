import type { _OneloClient } from './client'
import type { FormResult } from './types'

export interface FormSubmitOptions {
  submitterEmail?: string
}

export class OneloForms {
  private readonly _client: _OneloClient

  constructor(client: _OneloClient) {
    this._client = client
  }

  async submit(
    formSlug: string,
    data: Record<string, unknown>,
    options?: FormSubmitOptions
  ): Promise<FormResult> {
    return this._client.post<FormResult>('/api/sdk/forms/submit', {
      publishableKey: this._client.publishableKey,
      formSlug,
      data,
      submitterEmail: options?.submitterEmail,
    })
  }
}
