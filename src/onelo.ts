import { OneloAuth } from './auth/auth'
import { OneloConfig } from '@onelo/core'

export class Onelo {
  readonly auth: OneloAuth

  constructor(config: OneloConfig) {
    this.auth = new OneloAuth(config)
  }
}
