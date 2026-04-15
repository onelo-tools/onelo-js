export type UserRole = 'platform_owner' | 'creator' | 'member'

export interface OneloUser {
  id: string
  email: string | undefined
  role: UserRole
  tenantId: string | null
}

export interface OneloSession {
  accessToken: string
  refreshToken: string
  expiresAt: number
  user: OneloUser
}

export interface OneloConfig {
  /** Publishable key from Onelo dashboard (onelo_pk_live_...) */
  publishableKey: string
  /** Onelo API base URL — required. Get this from your Onelo dashboard snippet. */
  apiUrl: string
}

export interface ResolvedSDKConfig {
  supabaseUrl: string
  supabaseAnonKey: string
  tenantId: string
  allowCustomBranding: boolean
  appName: string | null
  appLogoUrl: string | null
}

export class OneloError extends Error {
  constructor(
    public readonly code:
      | 'not_authenticated'
      | 'hosted_flow_required'
      | 'invalid_publishable_key'
      | 'network_error'
      | 'server_error'
      | 'cancelled'
      | 'revoked'
      | 'user_revoked'
      | 'plan_required',
    message: string
  ) {
    super(message)
    this.name = 'OneloError'
  }

  static notAuthenticated() {
    return new OneloError('not_authenticated', 'User is not authenticated')
  }
  static hostedFlowRequired() {
    return new OneloError(
      'hosted_flow_required',
      'This app requires the hosted sign-in flow. Use loadAuthView().'
    )
  }
  static planRequired() {
    return new OneloError(
      'plan_required',
      'Custom UI requires a paid Onelo plan. Use loadAuthView() instead.'
    )
  }
  static invalidKey(msg: string) {
    return new OneloError('invalid_publishable_key', `Invalid publishable key: ${msg}`)
  }
  static network(msg: string) {
    return new OneloError('network_error', `Network error: ${msg}`)
  }
  static server(msg: string) {
    return new OneloError('server_error', msg)
  }
  static cancelled() {
    return new OneloError('cancelled', 'Sign in was cancelled')
  }
  static revoked() {
    return new OneloError('revoked', 'This application has been revoked')
  }
  static userRevoked() {
    return new OneloError('user_revoked', 'This user account has been suspended')
  }
}
