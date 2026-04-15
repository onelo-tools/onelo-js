import { generateCodeVerifier, generateCodeChallenge } from '@onelo/core'
import { httpGet, httpPost, checkHostedFlowRequired } from '@onelo/core'
import { mapSession } from '@onelo/core'
import { TokenStorage, TOKEN_KEYS } from '../core/storage'
import { AuthModal } from './auth-modal'
import {
  OneloConfig,
  OneloSession,
  OneloUser,
  OneloError,
  ResolvedSDKConfig,
} from '@onelo/core'
import { version as SDK_VERSION } from '../../package.json'

export class OneloAuth {
  private storage: TokenStorage
  private apiUrl: string
  private publishableKey: string
  private pkceVerifier: string | null = null
  private resolvedConfig: ResolvedSDKConfig | null = null
  private initPromise: Promise<void>
  private authStateListeners: Array<(session: OneloSession | null) => void> = []

  isReady = false
  isRevoked = false
  allowCustomBranding = false
  appName: string = 'App'
  appLogoUrl: string | null = null

  constructor(config: OneloConfig) {
    if (!config.apiUrl) throw new Error('[Onelo] apiUrl is required')
    if (!config.publishableKey) throw new Error('[Onelo] publishableKey is required')
    this.apiUrl = config.apiUrl
    this.publishableKey = config.publishableKey
    this.storage = new TokenStorage()
    this.initPromise = this.initialize()
  }

  private async initialize(): Promise<void> {
    try {
      const verifier = generateCodeVerifier()
      this.pkceVerifier = verifier
      const challenge = await generateCodeChallenge(verifier)
      const url = `${this.apiUrl}/api/sdk/config?key=${encodeURIComponent(this.publishableKey)}&code_challenge=${encodeURIComponent(challenge)}`
      const { status, json } = await httpGet(url, { 'X-SDK-Version': SDK_VERSION })
      if (status === 401 || status === 404) throw OneloError.invalidKey('Server rejected the key')
      if (status !== 200) throw OneloError.server(`Config request failed: HTTP ${status}`)
      const j = json as Record<string, unknown>
      this.resolvedConfig = {
        supabaseUrl: j['supabase_url'] as string,
        supabaseAnonKey: j['supabase_anon_key'] as string,
        tenantId: j['tenant_id'] as string,
        allowCustomBranding: (j['allow_custom_branding'] as boolean) ?? false,
        appName: (j['app_name'] as string | null) ?? null,
        appLogoUrl: (j['app_logo_url'] as string | null) ?? null,
      }
      this.allowCustomBranding = this.resolvedConfig.allowCustomBranding
      if (this.resolvedConfig.appName) this.appName = this.resolvedConfig.appName
      this.appLogoUrl = this.resolvedConfig.appLogoUrl
      this.isReady = true
    } catch (e) {
      if (e instanceof OneloError && e.code === 'invalid_publishable_key') {
        this.isRevoked = true
      }
    }
  }

  async whenReady(): Promise<void> {
    await this.initPromise
  }

  // ── Hosted flow ─────────────────────────────────────────────────────────────

  async loadAuthView(): Promise<OneloSession | null> {
    await this.initPromise
    if (this.isRevoked) throw OneloError.invalidKey('Application key has been revoked')
    const hostedUrl = await this.getHostedUrl()
    const modal = new AuthModal(this.apiUrl)
    const result = await modal.open(hostedUrl)

    if (result.type === 'cancelled') return null
    if (result.type === 'error') throw OneloError.server(result.message)

    const { status, json } = await httpPost(
      `${this.apiUrl}/api/sdk/auth/hosted-callback`,
      { publishableKey: this.publishableKey, code: result.code },
      { 'X-SDK-Version': SDK_VERSION }
    )
    if (status !== 200) throw OneloError.server('Hosted callback failed')
    const session = mapSession(json as Record<string, unknown>)
    await this.saveSession(session)
    return session
  }

  private async getHostedUrl(): Promise<string> {
    const { status, json } = await httpGet(
      `${this.apiUrl}/api/sdk/auth/initiate?key=${encodeURIComponent(this.publishableKey)}&callback_scheme=onelo-callback`,
      { 'X-SDK-Version': SDK_VERSION }
    )
    if (status !== 200) throw OneloError.server('Failed to initiate hosted auth flow')
    const j = json as Record<string, unknown>
    const hostedUrl = j['hosted_url'] as string | undefined
    if (!hostedUrl) throw OneloError.server('Invalid initiate response')
    if (j['app_name']) this.appName = j['app_name'] as string
    if (j['app_logo_url']) this.appLogoUrl = j['app_logo_url'] as string
    return hostedUrl
  }

  // ── Custom UI (paid plans only) ─────────────────────────────────────────────

  async signIn(email: string, password: string): Promise<OneloSession> {
    await this.initPromise
    if (!this.allowCustomBranding) throw OneloError.planRequired()
    if (!this.pkceVerifier) this.pkceVerifier = generateCodeVerifier()
    const { status, json } = await httpPost(
      `${this.apiUrl}/api/sdk/auth/signin`,
      { email, password, publishableKey: this.publishableKey, code_verifier: this.pkceVerifier },
      { 'X-SDK-Version': SDK_VERSION }
    )
    checkHostedFlowRequired(json)
    const j = json as Record<string, unknown>
    if (status === 403) {
      const detail = j['detail'] as Record<string, unknown> | undefined
      if (detail?.['error'] === 'user_revoked') throw OneloError.userRevoked()
      throw OneloError.server((detail?.['message'] ?? j['error']) as string)
    }
    if (status !== 200) throw OneloError.server(`Sign in failed: HTTP ${status}`)
    this.pkceVerifier = null
    const session = mapSession(j)
    await this.saveSession(session)
    return session
  }

  async signUp(email: string, password: string): Promise<OneloSession> {
    await this.initPromise
    if (!this.allowCustomBranding) throw OneloError.planRequired()
    if (!this.pkceVerifier) this.pkceVerifier = generateCodeVerifier()
    const { status, json } = await httpPost(
      `${this.apiUrl}/api/sdk/auth/signup`,
      { email, password, publishableKey: this.publishableKey, code_verifier: this.pkceVerifier },
      { 'X-SDK-Version': SDK_VERSION }
    )
    checkHostedFlowRequired(json)
    const j = json as Record<string, unknown>
    if (status !== 200) throw OneloError.server(`Sign up failed: HTTP ${status}`)
    this.pkceVerifier = null
    const session = mapSession(j)
    await this.saveSession(session)
    return session
  }

  // ── Session management ──────────────────────────────────────────────────────

  async signOut(): Promise<void> {
    await this.storage.clear()
    this.notifyListeners(null)
  }

  async getSession(): Promise<OneloSession | null> {
    const [accessToken, refreshToken, expiresAtStr, userJson] = await Promise.all([
      this.storage.get(TOKEN_KEYS.ACCESS_TOKEN),
      this.storage.get(TOKEN_KEYS.REFRESH_TOKEN),
      this.storage.get(TOKEN_KEYS.EXPIRES_AT),
      this.storage.get(TOKEN_KEYS.USER_JSON),
    ])
    if (!accessToken || !refreshToken || !userJson) return null
    const expiresAt = parseInt(expiresAtStr ?? '0', 10)
    if (Date.now() / 1000 > expiresAt - 60) {
      return this.refreshSession()
    }
    return { accessToken, refreshToken, expiresAt, user: JSON.parse(userJson) as OneloUser }
  }

  async refreshSession(): Promise<OneloSession | null> {
    const refreshToken = await this.storage.get(TOKEN_KEYS.REFRESH_TOKEN)
    if (!refreshToken) return null
    const { status, json } = await httpPost(
      `${this.apiUrl}/api/sdk/auth/refresh`,
      { publishableKey: this.publishableKey, refreshToken },
      { 'X-SDK-Version': SDK_VERSION }
    )
    checkHostedFlowRequired(json)
    const j = json as Record<string, unknown>
    if (j['error'] === 'user_revoked') { await this.storage.clear(); this.notifyListeners(null); throw OneloError.userRevoked() }
    if (j['error'] === 'app_revoked') { await this.storage.clear(); this.notifyListeners(null); throw OneloError.revoked() }
    if (status !== 200) { await this.storage.clear(); this.notifyListeners(null); return null }
    const session = mapSession(j)
    await this.saveSession(session)
    return session
  }

  onAuthStateChange(callback: (session: OneloSession | null) => void): () => void {
    this.authStateListeners.push(callback)
    return () => {
      this.authStateListeners = this.authStateListeners.filter(l => l !== callback)
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private async saveSession(session: OneloSession): Promise<void> {
    await Promise.all([
      this.storage.set(TOKEN_KEYS.ACCESS_TOKEN, session.accessToken),
      this.storage.set(TOKEN_KEYS.REFRESH_TOKEN, session.refreshToken),
      this.storage.set(TOKEN_KEYS.EXPIRES_AT, String(session.expiresAt)),
      this.storage.set(TOKEN_KEYS.USER_JSON, JSON.stringify(session.user)),
    ])
    this.notifyListeners(session)
  }

  private notifyListeners(session: OneloSession | null): void {
    for (const cb of this.authStateListeners) cb(session)
  }
}
