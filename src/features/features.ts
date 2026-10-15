import { httpPost } from '@onelo/core'
import { OneloEventStream, type StreamConnectionIdentity } from '../core/event-stream'
import { bearerHeader, sendWithUserToken, type UserTokenSource } from '../core/user-token'

export type FeatureStatus =
  | 'enabled'
  | 'disabled'
  | 'greyed'
  | 'hidden'
  | 'upsell'
  | 'new'
  | 'beta'
  | 'coming_soon'

// Forward-compat: a status from a NEWER backend that this SDK doesn't recognize
// must fail CLOSED → 'hidden' (mirrors Swift's `guard FeatureStatus(rawValue:)
// else { drop }` → default `.hidden`). Fail-open (keeping the unknown string)
// would render a broken affordance as VISIBLE, since `FeatureState.isVisible`
// is `status !== 'hidden'`.
const KNOWN_STATUSES = new Set<string>([
  'enabled', 'disabled', 'greyed', 'hidden', 'upsell', 'new', 'beta', 'coming_soon',
])
function normalizeStatus(status: string): FeatureStatus {
  return (KNOWN_STATUSES.has(status) ? status : 'hidden') as FeatureStatus
}

/** Why a feature is in its current state. Forward-compatible: an unrecognized
 * reason from a newer backend normalizes to 'unknown' (mirrors Swift, where a
 * present-but-unknown reason once dropped the whole feature). */
export type FeatureReason =
  | 'user_override' | 'plan' | 'default' | 'static'
  | 'paywall_no_plan' | 'paywall_off' | 'suspended' | 'unknown'
const KNOWN_REASONS = new Set<string>([
  'user_override', 'plan', 'default', 'static', 'paywall_no_plan', 'paywall_off', 'suspended', 'unknown',
])
function normalizeReason(reason: string | undefined): FeatureReason | undefined {
  if (reason == null) return undefined
  return (KNOWN_REASONS.has(reason) ? reason : 'unknown') as FeatureReason
}

/** Upgrade affordance derived from reason + requiredPlan; null when the feature
 * is available or not plan-gated. */
export interface UpgradeHint {
  requiredPlan: string
  currentStatus: FeatureStatus
}

// Wire shape of a /resolve or SSE per-feature entry (snake_case from backend).
// Forward-compatible: unknown fields ignored; reason/plan/cta optional.
interface FeatureWire {
  status: string
  reason?: string
  required_plan?: string
  required_plan_label?: string
  upgrade_cta?: boolean
}
// Normalized internal cache entry (camelCase, validated).
interface FeatureEntry {
  status: FeatureStatus
  reason?: FeatureReason
  requiredPlan?: string
  requiredPlanLabel?: string
  upgradeCta: boolean
}
function wireToEntry(w: FeatureWire): FeatureEntry {
  return {
    status: normalizeStatus(w.status),
    reason: normalizeReason(w.reason),
    requiredPlan: w.required_plan,
    requiredPlanLabel: w.required_plan_label,
    upgradeCta: w.upgrade_cta ?? false,
  }
}

export class FeatureState {
  readonly name: string
  readonly status: FeatureStatus
  /** Why the feature is in this state (plan-gated, user override, …). */
  readonly reason?: FeatureReason
  /** Machine key of the plan that unlocks this feature — render the label. */
  readonly requiredPlan?: string
  /** Human display name of `requiredPlan` — render this, not the raw key. */
  readonly requiredPlanLabel?: string
  /** The developer enabled "tap to upgrade" for this feature. */
  readonly upgradeCta: boolean

  constructor(
    name: string,
    status: FeatureStatus,
    reason?: FeatureReason,
    requiredPlan?: string,
    requiredPlanLabel?: string,
    upgradeCta = false,
  ) {
    this.name = name
    this.status = status
    this.reason = reason
    this.requiredPlan = requiredPlan
    this.requiredPlanLabel = requiredPlanLabel
    this.upgradeCta = upgradeCta
  }

  get isEnabled(): boolean { return this.status === 'enabled' || this.status === 'new' || this.status === 'beta' }
  get isDisabled(): boolean { return this.status === 'disabled' }
  get isVisible(): boolean { return this.status !== 'hidden' }
  get isGreyed(): boolean { return this.status === 'greyed' }
  get isUpsell(): boolean { return this.status === 'upsell' }
  get isNew(): boolean { return this.status === 'new' }
  get isBeta(): boolean { return this.status === 'beta' }
  get isComingSoon(): boolean { return this.status === 'coming_soon' }

  /** Promo/lock badge (parity with Swift): New/Beta/Coming Soon, 🔒 for greyed
   *  (locked — never hide it), and "Available in <plan>" for upsell. */
  get badgeLabel(): string | null {
    switch (this.status) {
      case 'new': return 'New'
      case 'beta': return 'Beta'
      case 'coming_soon': return 'Coming Soon'
      case 'greyed': return '🔒'
      case 'upsell':
        if (this.requiredPlanLabel) return `Available in ${this.requiredPlanLabel}`
        if (this.requiredPlan) return `Available in ${this.requiredPlan}`
        return 'Upgrade'
      default: return null
    }
  }

  /** Non-null when the feature is plan-blocked AND the backend named the
   *  unlocking plan — surface in upgrade-prompt UI. */
  get upgradeHint(): UpgradeHint | null {
    if (
      this.reason === 'plan' &&
      this.requiredPlan &&
      (this.status === 'greyed' || this.status === 'hidden' || this.status === 'upsell' || this.status === 'coming_soon')
    ) {
      return { requiredPlan: this.requiredPlan, currentStatus: this.status }
    }
    return null
  }
}

/** Error thrown by {@link OneloFeatures.moduleToken}. `code` mirrors the Swift
 *  `OneloFeaturesError` cases so cross-platform handling/docs line up 1:1. */
export type OneloFeaturesErrorCode =
  | 'not_authenticated'   // no signed-in user, or their access token was refused even after a refresh
  | 'not_entitled'        // 403 — current user lacks access to the slug
  /** @deprecated Secure Mode is retired; the server no longer answers with it. */
  | 'secure_mode_required'
  /** @deprecated Secure Mode is retired; the server no longer answers with it. */
  | 'invalid_user_hash'
  | 'network_error'       // transport failure or malformed response

export class OneloFeaturesError extends Error {
  constructor(readonly code: OneloFeaturesErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'OneloFeaturesError'
    // Restore the prototype chain so `instanceof` holds under down-level targets.
    Object.setPrototypeOf(this, OneloFeaturesError.prototype)
  }
}

const CACHE_KEY_PREFIX = 'onelo_features_'
const INSTANCE_KEY = 'onelo_feature_instance_id'
// refresh() coalesces bursts to one REST call/sec unless force=true (parity
// with Swift `_refreshDebounce`).
const REFRESH_DEBOUNCE_MS = 1000

// Module-level singleton: the resolved id is cached for the whole JS realm so a
// SECOND `OneloFeatures` constructed in the same realm reuses it even when
// localStorage can't dedup (setItem throws in private mode / quota, or the two
// constructions race before the first write is observable — React StrictMode
// remount, SSR+client). Without this the fallback minted a fresh volatile id per
// construction, so the backend's TOFU (`feature_discovery_instances`, one row
// per distinct id) accumulated one-ping throwaway "instances" — the root of the
// "2 instances per 1 browser" registry bloat. One realm → one id, always.
let cachedInstanceId: string | null = null

/** Stable per-install id (localStorage, cached at module scope), sent as
 * `X-Onelo-Instance-Id` so the backend can trust-on-first-use authorize
 * test-env discovery — WITHOUT it, batch-ping 403s `missing_instance_id` and
 * auto-discovery is broken in test env. Falls back to a volatile id when storage
 * is unavailable, but that id is still cached at module scope so a same-realm
 * second construction reuses it instead of minting a new row. */
function resolveInstanceId(): string {
  if (cachedInstanceId) return cachedInstanceId
  const gen = () =>
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `js_${Date.now()}_${Math.random().toString(36).slice(2)}`
  try {
    if (typeof localStorage !== 'undefined') {
      const existing = localStorage.getItem(INSTANCE_KEY)
      if (existing) { cachedInstanceId = existing; return existing }
      const id = gen()
      localStorage.setItem(INSTANCE_KEY, id)
      cachedInstanceId = id
      return id
    }
  } catch { /* private mode / quota — fall through to a volatile id (cached below) */ }
  // Cache even the volatile id: a second construction in this realm must reuse
  // it rather than mint a fresh one and double the instance rows.
  cachedInstanceId = gen()
  return cachedInstanceId
}

export interface OneloFeaturesOptions {
  /** Suppress the anonymous-mode identify() warning. See OneloConfig.suppressIdentifyWarning. */
  suppressIdentifyWarning?: boolean
  /** Explicit feature environment ('test'|'live'), forwarded on resolve/batch-ping/SSE. See OneloConfig.featureEnvironment. */
  featureEnvironment?: string
  /** Status returned for a slug not (yet) in the resolved snapshot. Fail-closed
   *  'hidden' by default; set 'enabled' in dev to preview gates before toggling
   *  them in the dashboard. Parity with Swift/RN/Electron `featureDefaultStatus`. */
  featureDefaultStatus?: FeatureStatus
  /** The signed-in Onelo user's access token, sent as `Authorization: Bearer`
   *  on every Features call so the server knows who the user really is. Wired by
   *  `Onelo` to `auth`; without it the calls carry no token. */
  userToken?: UserTokenSource
}

// v2 persists the FULL entry (reason/plan/cta) so a cold-start `up_to_date`
// still renders upgrade badges. `string` values are tolerated on read for
// back-compat with the v1 (status-only) cache format.
interface CachedSnapshot {
  configVersion: number
  features: Record<string, FeatureEntry | string>
}

export class OneloFeatures {
  private readonly apiUrl: string
  private readonly publishableKey: string
  private readonly featureEnvironment?: string
  private cache: Map<string, FeatureEntry> = new Map()
  private discoveredNames: Set<string> = new Set()
  private configVersion = 0
  private pingDebounce: ReturnType<typeof setTimeout> | null = null
  private currentUserId: string | null = null
  // Signed-in user's access token source (Bearer on every Features call).
  private readonly userToken: UserTokenSource | null
  private userTokenRefusedWarned = false
  // Bumped by every load(): a load that resumes after a newer one started must
  // not point the shared stream back at its (stale) identity.
  private loadGeneration = 0
  private readonly instanceId = resolveInstanceId()
  private monitor: { _trackFeatureCall: (name: string) => void; recordFlag?: (key: string, value: string) => void } | null = null
  private suppressIdentifyWarning: boolean
  // Status for a slug not present in the resolved snapshot (fail-closed 'hidden').
  private readonly defaultStatus: FeatureStatus
  // Change subscribers — fired whenever the resolved snapshot mutates (SSE Deploy,
  // identity swap, invalidateCache) so React/Vue hosts can re-render. Parity with
  // Electron/RN subscribe().
  private changeListeners = new Set<() => void>()
  private anonymousWarningLogged = false
  // Live-update channel: the shared multiplexed event stream, owned by Onelo
  // and attached post-construction via attachStream(). Null in environments or
  // tests that never wire one — load() then falls back to a one-shot resolve.
  private stream: OneloEventStream | null = null
  // Identity-bound readiness. A persisted snapshot is useful for fast first
  // paint, but only a response confirmed for this load generation may release
  // ready().
  private firstEventReceived = false
  private confirmedGeneration = -1
  private confirmedUserId: string | null = null
  private confirmedVersion = 0
  private snapshotConfirmed = false
  private readonly readyWaiters = new Set<() => void>()
  // refresh() debounce cursor (parity with Swift lastRefreshAt).
  private lastRefreshAt = 0
  private identityLoaded = false
  private streamConnection: StreamConnectionIdentity | null = null
  private streamConnectionGeneration = -1

  constructor(
    apiUrl: string,
    publishableKey: string,
    monitor?: { _trackFeatureCall: (name: string) => void; recordFlag?: (key: string, value: string) => void },
    options?: OneloFeaturesOptions,
  ) {
    this.apiUrl = apiUrl
    this.publishableKey = publishableKey
    if (monitor) this.monitor = monitor
    this.suppressIdentifyWarning = options?.suppressIdentifyWarning ?? false
    this.featureEnvironment = options?.featureEnvironment
    this.defaultStatus = options?.featureDefaultStatus ?? 'hidden'
    this.userToken = options?.userToken ?? null
  }

  /** Subscribe to feature-state changes — fired on every snapshot mutation (an
   *  admin's Deploy over SSE, an identity swap, invalidateCache). Returns an
   *  unsubscribe function. Use it to re-read feature() and re-render (React: wrap
   *  in useSyncExternalStore; Vue: trigger a ref). Parity with Electron/RN. */
  subscribe(listener: () => void): () => void {
    this.changeListeners.add(listener)
    return () => { this.changeListeners.delete(listener) }
  }

  private _emitChange(): void {
    for (const l of this.changeListeners) {
      try { l() } catch { /* a listener throwing must not break the others */ }
    }
  }

  /**
   * Wire the shared multiplexed event stream (called once by Onelo). Registers
   * features' listeners + the dynamic query params (`since_version` changes over
   * the connection's life; `environment` is optional). Handlers survive
   * reconnects and receive the already-parsed event `data`.
   */
  attachStream(stream: OneloEventStream): void {
    this.stream = stream
    stream.addParamProvider(() => {
      const p: Record<string, string> = {
        since_version: String(this.snapshotConfirmed ? this.confirmedVersion : 0),
        instance_id: this.instanceId,
      }
      if (this.featureEnvironment) p['environment'] = this.featureEnvironment
      return p
    })
    stream.onConnectionIdentity((identity) => {
      this.streamConnection = identity
      this.streamConnectionGeneration = identity === null ? -1 : this.loadGeneration
    })
    // `connected` (client behind) and `features_updated` (admin Deploy) both
    // carry a fresh snapshot; `up_to_date` just confirms the version.
    const currentStreamIsBound = (): boolean => {
      const connection = this.streamConnection
      return connection !== null &&
        this.streamConnectionGeneration === this.loadGeneration &&
        connection.userId === this.currentUserId &&
        !connection.anonymousFallback
    }
    const applyIfSnapshot = (data: Record<string, unknown>) => {
      if (!currentStreamIsBound()) return
      const features = data['features'] as Record<string, FeatureWire> | undefined
      if (features) {
        const v = typeof data['config_version'] === 'number' ? (data['config_version'] as number) : this.configVersion
        this._applySnapshot(v, features, this.loadGeneration, this.currentUserId)
        this._signalFirstEvent(this.loadGeneration, this.currentUserId)
      }
    }
    stream.on('connected', applyIfSnapshot)
    stream.on('features_updated', applyIfSnapshot)
    stream.on('up_to_date', (data) => {
      if (!currentStreamIsBound()) return
      if (typeof data['config_version'] === 'number') this.configVersion = data['config_version'] as number
      if (typeof data['config_version'] !== 'number') return
      this.confirmedVersion = data['config_version'] as number
      this._signalFirstEvent(this.loadGeneration, this.currentUserId)
    })
    // Foreground / network-resume → reconcile the snapshot via REST (debounced),
    // parity with Swift `_resyncOnLifecycle`. The stream itself already reconnects
    // a dropped SSE socket on these same signals; this adds the instant cache
    // reconcile Swift runs in parallel. Debounced (not force) so rapid
    // tab-switching coalesces — the browser fires visibilitychange far more often
    // than a native app foregrounds, and a flurry of resolves would pressure the
    // connection pool (2026-07 exhaustion outage).
    stream.onLifecycleResume(() => { void this.refresh() })
    // Dashboard "Discover Features" button pushes `discovery_requested` over SSE
    // to force connected clients to re-send a batch-ping (so newly-referenced
    // slugs register). Parity with OneloFeatures.swift:150 — without this
    // handler the JS EventSource never even subscribes to the event
    // (event-stream only listens for names with a registered handler), so the
    // dashboard button silently no-ops for every web client. Debounced ping,
    // same as declare()/feature().
    stream.on('discovery_requested', () => this._scheduleBatchPing())
  }

  /** Declare feature names upfront — triggers a batch-ping immediately. */
  declare(names: string[]): void {
    for (const name of names) this.discoveredNames.add(name)
    this._scheduleBatchPing()
  }

  /** Returns the current state for a feature. Auto-registers on first call. */
  feature(name: string): FeatureState {
    const isNew = !this.discoveredNames.has(name)
    this.discoveredNames.add(name)
    if (isNew) this._scheduleBatchPing()
    if (isNew) this.monitor?._trackFeatureCall(name)
    const entry = this.cache.get(name)
    const status = entry?.status ?? this.defaultStatus
    // Record the flag value on EVERY evaluation (not just first) so Monitor's
    // flag↔error correlation reflects the state at error time (parity w/ Swift).
    this.monitor?.recordFlag?.(name, status)
    return new FeatureState(name, status, entry?.reason, entry?.requiredPlan, entry?.requiredPlanLabel, entry?.upgradeCta ?? false)
  }

  /** Load features for a user (or anonymous). Called by Onelo orchestrator.
   * Restores cache for instant UI, then opens an SSE channel that delivers
   * live updates whenever an admin clicks Deploy in the dashboard.
   *
   * @param _userIdHash Deprecated and ignored: Secure Mode is retired, and the
   *   signed-in Onelo user is proven with their access token automatically. */
  async load(userId: string | null, _userIdHash?: string | null): Promise<void> {
    const generation = ++this.loadGeneration
    this.identityLoaded = true
    this.currentUserId = userId
    this.streamConnection = null
    this.streamConnectionGeneration = -1
    this.firstEventReceived = false
    this.snapshotConfirmed = false
    this.confirmedGeneration = -1
    this.confirmedUserId = null
    this.confirmedVersion = 0
    this._loadCache(userId)
    // Cache swapped for this identity (restored from disk or empty) → notify
    // subscribers so the UI re-renders with the new identity's state.
    this._emitChange()
    await this._batchPing()
    // A newer load (sign-in / sign-out while this one awaited) owns the stream.
    if (generation !== this.loadGeneration) return
    if (this.stream && typeof EventSource !== 'undefined') {
      // Live channel: (re)point the shared stream at this user. The stream
      // multiplexes features + auth over ONE connection.
      this.stream.start(userId)
    } else {
      // No stream wired, or an environment without EventSource (some SSR
      // contexts): one-shot resolve — correct initial state, no live updates.
      await this._resolve(userId, generation)
    }
  }

  /** Returns names of all features with an active status (enabled, new, or beta). */
  getActiveFeatures(): string[] {
    const active: string[] = []
    for (const [name, entry] of this.cache) {
      if (entry.status === 'enabled' || entry.status === 'new' || entry.status === 'beta') {
        active.push(name)
      }
    }
    return active
  }

  /** Clear features' own background timer. The shared event stream is owned and
   * torn down by Onelo (see Onelo.destroy → stream.destroy), NOT here — closing
   * it from features would also drop auth's session.revoked subscription. Kept
   * named `stopPolling` for back-compat with the old polling-based API. */
  stopPolling(): void {
    if (this.pingDebounce !== null) {
      clearTimeout(this.pingDebounce)
      this.pingDebounce = null
    }
  }

  /** Clears the local feature cache and resets the config version, then forces
   * the shared stream to reconnect so the server resends a full snapshot
   * (`since_version=0`). Without the reconnect a live connection stays silent
   * and the cache would only refill on the next admin Deploy. */
  invalidateCache(): void {
    this.cache.clear()
    this.configVersion = 0
    this.confirmedVersion = 0
    this.snapshotConfirmed = false
    this.firstEventReceived = false
    this.confirmedGeneration = -1
    this.confirmedUserId = null
    this._writeCache()
    this._emitChange()
    this.stream?.reconnect()
  }

  /** Resolves once the first live snapshot has been applied (SSE `connected` /
   * `up_to_date`, or a REST resolve), or after `timeoutMs` — whichever first.
   * Never rejects. Lets a host await a settled state before first paint to avoid
   * a resolve→SSE flicker. Parity with Swift `ready(timeout:)`. Multiple callers
   * resolve together on the first event (or each on its own timeout). */
  ready(timeoutMs = 1500): Promise<void> {
    if (
      this.firstEventReceived &&
      this.snapshotConfirmed &&
      this.confirmedGeneration === this.loadGeneration &&
      this.confirmedUserId === this.currentUserId
    ) return Promise.resolve()
    return new Promise<void>((resolve) => {
      let settled = false
      const finish = (): void => {
        if (settled) return
        settled = true
        this.readyWaiters.delete(finish)
        resolve()
      }
      this.readyWaiters.add(finish)
      setTimeout(finish, Math.max(0, timeoutMs))
    })
  }

  /** Force-reconcile the snapshot from the server via REST (does NOT touch the
   * SSE stream). Debounced to one call/sec unless `force` (use force from a
   * user-initiated "Refresh" action). Never throws — a network error leaves the
   * cached state intact and SSE catches up later. Parity with Swift
   * `refresh(force:)`. */
  async refresh(force = false): Promise<void> {
    if (!this.identityLoaded) return
    const now = Date.now()
    if (!force && now - this.lastRefreshAt < REFRESH_DEBOUNCE_MS) return
    this.lastRefreshAt = now
    await this._resolve(this.currentUserId, this.loadGeneration)
  }

  /** A comparable picture of the current snapshot — the plan-change refresher
   *  (#659) re-checks until it differs. @internal */
  snapshotKey(): string {
    return JSON.stringify([...this.cache.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
  }

  /** Requests a short-lived (60s) per-feature JWT from
   * `POST /api/sdk/features/module-token` — proof the current user is entitled
   * to `slug`, which the host forwards to its OWN backend/CDN to gate code
   * download. The backend re-verifies entitlement on every request. Parity with
   * Swift `moduleToken(for:)`.
   *
   * Throws {@link OneloFeaturesError}:
   * - `not_authenticated` — no user identified yet (no network call is made), or
   *   the signed-in user's access token was refused even after a refresh
   * - `not_entitled` (403) — the user lacks access to `slug`
   * - `network_error` — transport failure or malformed response */
  async moduleToken(slug: string): Promise<string> {
    const userId = this.currentUserId
    if (!userId) throw new OneloFeaturesError('not_authenticated')
    let status: number
    let json: Record<string, unknown>
    try {
      // A module token is always for a user, so a refused token ends here
      // (`not_authenticated`) instead of retrying anonymously.
      const res = await sendWithUserToken(
        this.userToken,
        ({ token }) => httpPost(
          `${this.apiUrl}/api/sdk/features/module-token`,
          { publishableKey: this.publishableKey, userId, slug },
          bearerHeader(token),
        ),
        () => this._warnUserTokenRefused(),
        false,
      )
      status = res.status
      json = (res.json ?? {}) as Record<string, unknown>
    } catch {
      throw new OneloFeaturesError('network_error')
    }
    if (status === 200) {
      const token = json['token']
      if (typeof token === 'string' && token.length > 0) return token
      throw new OneloFeaturesError('network_error')
    }
    if (status === 401) {
      // FastAPI HTTPException(detail={"error": ...}) → body is { detail: { error } }.
      const detail = json['detail'] as Record<string, unknown> | undefined
      const errCode = (detail?.['error'] ?? json['error']) as string | undefined
      if (errCode === 'secure_mode_required') throw new OneloFeaturesError('secure_mode_required')
      if (errCode === 'invalid_user_hash') throw new OneloFeaturesError('invalid_user_hash')
      throw new OneloFeaturesError('not_authenticated')
    }
    if (status === 403) throw new OneloFeaturesError('not_entitled')
    throw new OneloFeaturesError('network_error')
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  /** Signals all pending ready() callers that the first snapshot arrived.
   * Idempotent — subsequent calls are no-ops. Parity with Swift
   * `_signalFirstEvent`. */
  private _signalFirstEvent(generation: number, userId: string | null): void {
    if (generation !== this.loadGeneration || userId !== this.currentUserId || !this.identityLoaded) return
    if (this.firstEventReceived && this.confirmedGeneration === generation) return
    this.firstEventReceived = true
    this.snapshotConfirmed = true
    this.confirmedGeneration = generation
    this.confirmedUserId = userId
    const waiters = Array.from(this.readyWaiters)
    this.readyWaiters.clear()
    for (const w of waiters) w()
  }

  private _scheduleBatchPing(): void {
    if (this.pingDebounce !== null) clearTimeout(this.pingDebounce)
    this.pingDebounce = setTimeout(() => {
      this.pingDebounce = null
      void this._batchPing()
    }, 1000)
  }

  private async _batchPing(): Promise<void> {
    const names = Array.from(this.discoveredNames)
    if (names.length === 0) return
    // Registering NEW slugs (discovery) is test-env only server-side. On LIVE
    // env batch-ping just bumps last_seen_at — sample it at ~1% to avoid
    // fleet-scale write amplification (parity with Swift's _shouldBatchPingOnLoad).
    // "test" = explicit featureEnvironment OR a `_test_` key prefix — the latter
    // mirrors the backend's effective_env key-prefix fallback, so a test-keyed
    // app WITHOUT the env var still discovers (isn't silently sampled away).
    const isTestEnv = this.featureEnvironment === 'test' || this.publishableKey.includes('_test_')
    if (!isTestEnv && Math.random() > 0.01) return
    try {
      await sendWithUserToken(this.userToken, ({ token }) => httpPost(
        `${this.apiUrl}/api/sdk/features/batch-ping`,
        {
          publishableKey: this.publishableKey,
          features: names,
          ...(this.featureEnvironment ? { environment: this.featureEnvironment } : {}),
        },
        {
          ...bearerHeader(token),
          // Trust-on-first-use device id — REQUIRED or the backend 403s
          // test-env discovery with `missing_instance_id`.
          'X-Onelo-Instance-Id': this.instanceId,
          // Explicit SDK platform. A browser `fetch` CANNOT set User-Agent (it's
          // a forbidden header), so the backend's UA-based platform detection
          // sees "Mozilla/…" and stores sdk_platform = NULL for every web app.
          // Sending it explicitly lets the registry + Deploy Access show "JS"
          // (the SSE path already reports platform=js the same way).
          'X-Onelo-Sdk-Platform': 'js',
        },
      ), () => this._warnUserTokenRefused(), true, false)
    } catch {
      // best-effort
    }
  }

  private async _resolve(userId: string | null, generation = this.loadGeneration): Promise<void> {
    if (!this.identityLoaded) return
    try {
      const { status, json } = await sendWithUserToken(this.userToken, ({ token, anonymous }) => {
        const body: Record<string, unknown> = { publishableKey: this.publishableKey }
        // `userId` rides along with the token: the server ignores it when the
        // token is valid, and a server without #517 still resolves by it.
        if (userId && !anonymous) body['userId'] = userId
        if (this.featureEnvironment) body['environment'] = this.featureEnvironment
        return httpPost(`${this.apiUrl}/api/sdk/features/resolve`, body, bearerHeader(token))
      }, () => this._warnUserTokenRefused(), userId === null)
      if (status !== 200) return
      if (generation !== this.loadGeneration || userId !== this.currentUserId) return
      const j = json as Record<string, unknown>
      if (userId !== null && j['anonymous'] === true) return
      const features = j['features'] as Record<string, FeatureWire> | undefined
      if (features) {
        this._applySnapshot(
          typeof j['config_version'] === 'number' ? (j['config_version'] as number) : this.configVersion,
          features,
          generation,
          userId,
        )
      }
      this._maybeWarnAnonymous(j)
      // A successful resolve is a settled snapshot too — unblocks ready() on the
      // no-SSE / SSR fallback path where no `connected` event ever arrives.
      this._signalFirstEvent(generation, userId)
    } catch {
      // keep existing cache
    }
  }

  /** The server refused the signed-in user's access token even after a refresh,
   *  so the call went out anonymous. Features has no error callback; this
   *  one-time warning is its error channel (like the anonymous-mode warning). */
  private _warnUserTokenRefused(): void {
    if (this.userTokenRefusedWarned) return
    this.userTokenRefusedWarned = true
    // eslint-disable-next-line no-console
    console.warn(
      '[Onelo] The signed-in user\'s access token was refused by Features (invalid_user_token) ' +
      'even after a refresh, so the request was made without a user. ' +
      'Check that the publishableKey belongs to the app the user signed in to.',
    )
  }

  /**
   * Logs a one-time warning when the backend reports anonymous mode (no userId)
   * AND at least one targeted feature was hidden purely because of it. Helps
   * developers using their own auth system catch missing identify() calls.
   * Suppressed via OneloConfig.suppressIdentifyWarning.
   */
  private _maybeWarnAnonymous(response: Record<string, unknown>): void {
    if (this.suppressIdentifyWarning || this.anonymousWarningLogged) return
    if (response['anonymous'] !== true) return
    const misses = typeof response['targeting_misses'] === 'number' ? (response['targeting_misses'] as number) : 0
    if (misses <= 0) return
    this.anonymousWarningLogged = true
    // eslint-disable-next-line no-console
    console.warn(
      `[Onelo] ${misses} feature(s) hidden because no user is identified.\n` +
      `If you handle auth yourself, call onelo.identify(userId) after login so per-user/per-plan targeting can apply.\n` +
      `If your app is intentionally anonymous, pass suppressIdentifyWarning: true in OneloConfig to silence this.`
    )
  }

  // ── Cache ───────────────────────────────────────────────────────────────────

  private _cacheKey(userId: string | null): string {
    return `${CACHE_KEY_PREFIX}${this.publishableKey}_${userId ?? 'anon'}`
  }

  private _loadCache(userId: string | null): void {
    this.cache.clear()
    this.configVersion = 0
    this.confirmedVersion = 0
    if (typeof localStorage === 'undefined') return
    try {
      const raw = localStorage.getItem(this._cacheKey(userId))
      if (!raw) return
      const parsed = JSON.parse(raw) as CachedSnapshot
      if (typeof parsed.configVersion !== 'number' || !parsed.features) return
      this.configVersion = parsed.configVersion
      for (const [name, cached] of Object.entries(parsed.features)) {
        // v1 back-compat: an old cache stored a bare status string.
        if (typeof cached === 'string') {
          this.cache.set(name, { status: normalizeStatus(cached), upgradeCta: false })
        } else if (cached && typeof cached === 'object') {
          this.cache.set(name, {
            status: normalizeStatus(cached.status),
            reason: normalizeReason(cached.reason),
            requiredPlan: cached.requiredPlan,
            requiredPlanLabel: cached.requiredPlanLabel,
            upgradeCta: cached.upgradeCta ?? false,
          })
        }
      }
    } catch {
      // corrupted cache — ignore
    }
  }

  private _writeCache(): void {
    if (typeof localStorage === 'undefined') return
    try {
      const features: Record<string, FeatureEntry> = {}
      for (const [name, entry] of this.cache) features[name] = entry
      const snapshot: CachedSnapshot = { configVersion: this.configVersion, features }
      localStorage.setItem(this._cacheKey(this.currentUserId), JSON.stringify(snapshot))
    } catch {
      // localStorage quota / private mode — ignore
    }
  }

  private _applySnapshot(
    version: number,
    features: Record<string, FeatureWire>,
    generation = this.loadGeneration,
    userId = this.currentUserId,
  ): void {
    // Existing internal callers always pass the generation and identity. The
    // two-argument form remains a useful test seam for parsing a wire snapshot
    // before an orchestrator has loaded an identity.
    const directSnapshot = arguments.length < 3
    if (!directSnapshot && (!this.identityLoaded || generation !== this.loadGeneration || userId !== this.currentUserId)) return
    this.configVersion = version
    this.confirmedVersion = version
    this.snapshotConfirmed = true
    this.cache.clear()
    for (const [name, wire] of Object.entries(features)) {
      this.cache.set(name, wireToEntry(wire))
    }
    this._writeCache()
    this._emitChange()
  }
}
