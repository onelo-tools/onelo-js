import { OneloAuth } from './auth/auth'
import { OneloConfig } from './core/types'

export class Onelo {
  readonly auth: OneloAuth

  constructor(config: OneloConfig) {
    this.auth = new OneloAuth(config)
  }
}
