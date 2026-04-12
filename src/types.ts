// ─── Feature types ────────────────────────────────────────────────────────────

export type FeatureStatus = 'enabled' | 'greyed' | 'hidden' | 'upsell'

export interface FeatureState {
  status: FeatureStatus
}

export interface ResolveResponse {
  features: Record<string, FeatureState>
  ttl: number
}

// ─── Form types ───────────────────────────────────────────────────────────────

export interface FormResult {
  success: boolean
  message: string
}

// ─── Waitlist types ───────────────────────────────────────────────────────────

export interface WaitlistResult {
  success: boolean
  position?: number
  alreadyJoined: boolean
}

// ─── SDK config ───────────────────────────────────────────────────────────────

export interface OneloConfig {
  publishableKey: string
  /** Override API base URL. Defaults to https://api.onelo.tools */
  baseUrl?: string
}

export interface IdentifyOptions {
  plan?: string
}
