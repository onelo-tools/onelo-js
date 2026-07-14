import * as _onelo_core from '@onelo/core';
import { OneloConfig, OneloSession, OneloEntitlement } from '@onelo/core';
export { OneloConfig, OneloEntitlement, OneloError, OneloSession, OneloUser } from '@onelo/core';

type AuthPresentMode = 'popup' | 'embedded';

/**
 * OneloEventStream — one browser `EventSource` connection to
 * `GET /api/sdk/features/stream`, multiplexed for every module (features,
 * auth, …). Mirrors the Swift `OneloEventStream`: a single connection per app,
 * a name→handlers registry, and bounded-backoff reconnection.
 *
 * The endpoint authenticates via the `key` query param (publishable key), so
 * it is fully compatible with browser `EventSource` — which cannot set an
 * `Authorization` header. The native `EventSource` implements the WHATWG SSE
 * parser (per-event dispatch, keepalive comments, `retry:`), so unlike Swift
 * there is nothing to hand-roll.
 *
 * Lifecycle is owned by the composition root (`Onelo`), not by any single
 * consumer: consumers only `on()` (register handlers) and `addParamProvider()`;
 * `Onelo` calls `start()/stop()/destroy()` (driven today by the features
 * identity bridge).
 */
type SseHandler = (data: Record<string, unknown>) => void;
type ParamProvider = () => Record<string, string>;
declare class OneloEventStream {
    private readonly apiUrl;
    private readonly publishableKey;
    private readonly sdkVersion?;
    private source;
    private readonly handlers;
    private readonly paramProviders;
    private userId;
    private started;
    private destroyed;
    private reconnectAttempts;
    private reconnectTimer;
    private lifecycleBound;
    private readonly lifecycleListeners;
    private readonly _onVisibility;
    private readonly _onOnline;
    constructor(apiUrl: string, publishableKey: string, sdkVersion?: string | undefined);
    /**
     * Register a handler for a named server event (`connected`, `features_updated`,
     * `session.revoked`, …). Survives reconnects. Register BEFORE `start()` (e.g.
     * in a module constructor) so no event is missed between connect and sign-in.
     */
    on(event: string, handler: SseHandler): void;
    /**
     * Extra query params, read fresh on EVERY (re)connect — used for values that
     * change over the connection's life (e.g. features' `since_version`), so a
     * reconnect always sends the current value.
     */
    addParamProvider(fn: ParamProvider): void;
    /**
     * Register a callback fired on a lifecycle resume — the tab becomes visible or
     * the network comes back online (the same signals that drive
     * reconnectIfStale). Consumers use this to reconcile state via REST in
     * parallel with the SSE catch-up (e.g. OneloFeatures.refresh()). Survives for
     * the stream's life; there is no unregister (listeners live as long as the
     * stream). A listener throwing never breaks the stream.
     */
    onLifecycleResume(fn: () => void): void;
    private _notifyLifecycle;
    /**
     * Open (or re-open) the connection for a user. Idempotent: a repeat call with
     * the same userId while already connected is a no-op (no needless reconnect).
     * A changed userId reconnects so per-user routing (features + session.revoked
     * targeting) is correct.
     */
    start(userId: string | null): void;
    /** Close the connection and cancel any pending reconnect. */
    stop(): void;
    /** Permanent teardown — cannot be restarted. */
    destroy(): void;
    /**
     * Reconnect ONLY if the connection actually dropped — the browser throttled
     * or closed it while the tab was backgrounded, or the network changed.
     * `EventSource.readyState` (0 CONNECTING · 1 OPEN · 2 CLOSED) is authoritative
     * for a real drop.
     *
     * We deliberately do NOT run a silence-based watchdog timer (as the Swift SDK
     * does): the browser `EventSource` hides the server's `:keepalive` comments,
     * so "no named event in N seconds" does NOT imply a dead connection on a quiet
     * app — a periodic reconnect would false-positive and worsen connection-pool
     * pressure (the 2026-07 exhaustion outage). Lifecycle events (visibility /
     * online) are the correct, false-positive-free browser signal.
     */
    reconnectIfStale(): void;
    private _bindLifecycle;
    private _unbindLifecycle;
    /**
     * Force a fresh connection NOW, re-reading all params (base + providers).
     * Used after a consumer resets a provider value — e.g. features'
     * `invalidateCache()` sets `since_version = 0`, and only a reconnect makes
     * the server resend a full snapshot (a live connection stays silent).
     * No-op when not started or destroyed.
     */
    reconnect(): void;
    private _supported;
    private _connect;
    private _scheduleReconnect;
    private _clearReconnect;
    private _close;
}

declare class OneloAuth {
    private storage;
    private apiUrl;
    private publishableKey;
    private pkceVerifier;
    private resolvedConfig;
    private heartbeatTimer;
    private refreshTimer;
    private static readonly HEARTBEAT_MS;
    /** Refresh this many seconds before the access token expires. */
    private static readonly REFRESH_LEAD_SECONDS;
    private refreshInFlight;
    /** Web Lock name — scoped per publishable key so sibling apps don't serialise
     *  against each other. */
    private static readonly REFRESH_LOCK_PREFIX;
    /** Bound the WAIT for the cross-tab lock. A stuck/orphaned holder must never
     *  hang refresh forever (the class of bug that froze supabase-js auth — Web
     *  Locks issues #1594/#2111); on timeout we fall back to an un-serialised
     *  refresh, which is strictly better than hanging or dropping the session. */
    private static readonly REFRESH_LOCK_TIMEOUT_MS;
    private initPromise;
    private authStateListeners;
    isReady: boolean;
    isRevoked: boolean;
    /** True once the backend reports this USER's session is no longer valid
     *  (revoked / banned / all sessions server-revoked) — surfaced via the
     *  heartbeat 401 or a refresh user_revoked. Parity with Swift isUserRevoked. */
    isUserRevoked: boolean;
    private signOutEpoch;
    allowCustomBranding: boolean;
    appName: string;
    appLogoUrl: string | null;
    paywallEnabled: boolean;
    waitlistMode: boolean;
    sdkRedirectUrl: string | null;
    storeUrl: string | null;
    manageUrl: string | null;
    constructor(config: OneloConfig);
    private initialize;
    whenReady(): Promise<void>;
    /**
     * Open the Onelo hosted flow (sign-in → store → content).
     *
     * The routing decision is CENTRALISED on the backend (`/api/sdk/flow/init`)
     * so every SDK behaves identically — there is no per-SDK paywall / sign-in-vs-
     * store logic left to drift (the class of bug that let JS jump straight to the
     * store and skip sign-in). We send our current session (if any); the backend
     * decides ONCE:
     *   - authorized      → we already have access → return the session (content).
     *   - present sign-in → open /auth/hosted (it chains sign-in → store → done
     *                       itself when a paywall applies).
     *   - present store   → signed-in, no plan → open /store/hosted (bound to us).
     * Either "present" surface ends by postMessaging ONE final code, which we
     * exchange for a session. Waitlist redirect stays here — it's a plain
     * redirect, not a routing decision the backend flow owns.
     *
     * @param options.mode  'embedded' (default) renders the hosted page inline in
     *   an iframe — the web equivalent of Swift's WKWebView, never popup-blocked
     *   (requires the app origin in allowed origins; localhost works on a test
     *   key). 'popup' opens a top-level window.
     */
    loadAuthView(options?: {
        mode?: AuthPresentMode;
    }): Promise<OneloSession | null>;
    /**
     * Resolve the next flow step from the backend. Sends the current access token
     * (if any) as a Bearer so the backend sees whether we're signed in + entitled,
     * then returns 'authorized' (no UI) or 'present' with the hosted URL to open.
     */
    private resolveFlow;
    signIn(email: string, password: string): Promise<OneloSession>;
    signUp(email: string, password: string): Promise<OneloSession>;
    signOut(): Promise<void>;
    getSession(): Promise<OneloSession | null>;
    /**
     * True when the current session's user has an active paid entitlement.
     * Snapshot read of the persisted session (no network) — mirrors Swift's
     * `hasActiveAccess`. Returns false when there is no session.
     */
    hasActiveAccess(): Promise<boolean>;
    /**
     * Re-fetch the user's entitlement from the backend and, if it changed,
     * rebuild + persist the session so `hasActiveAccess()` and auth-state
     * listeners see the new value. Call after an external checkout or on app
     * resume. Best-effort: returns the currently-cached entitlement on any
     * non-200/network failure and never throws (mirrors Swift
     * `revalidateEntitlement`).
     */
    revalidateEntitlement(): Promise<OneloEntitlement>;
    /** Refresh the access token, rotating the refresh token. Coordinated so the
     *  SAME refresh token is never sent twice (which the backend treats as a
     *  stolen-token replay and hard-revokes the whole session — the multi-tab /
     *  reload-race forced-logout bug). Layer 1: single-flight within this tab.
     *  Layer 2: a cross-tab Web Lock. Falls back to a plain refresh where Web
     *  Locks are unavailable or the lock wait times out. */
    refreshSession(): Promise<OneloSession | null>;
    /** Layer 2 — cross-tab exclusivity via the Web Locks API. Only one tab holds
     *  the lock at a time; the winner's `_doRefresh` reads the refresh token
     *  INSIDE the lock, so a tab that waited reads the already-rotated token (or a
     *  still-fresh one) rather than the stale token another tab just used. */
    private _refreshCoordinated;
    private _doRefresh;
    /**
     * Wire the shared event stream (called once by Onelo). Registers a
     * `session.revoked` listener so a server-side revoke (refund lapse, admin
     * force-logout, account deletion, ban) signs the user out in ~sub-second —
     * the real-time complement to the ≤13-min heartbeat fallback. Registered once
     * and survives sign-in/sign-out cycles, exactly like the Swift SDK.
     */
    attachEventStream(stream: OneloEventStream): void;
    /**
     * Handle a `session.revoked` push. Filters to the current user (one app can
     * have multiple buyers multiplexed on the shared stream); a missing
     * `app_user_id` is treated as "current user" (forward-compat). No session →
     * ignore. Teardown mirrors the heartbeat-401 path exactly.
     */
    private _handleSessionRevoked;
    onAuthStateChange(callback: (session: OneloSession | null) => void): () => void;
    private startHeartbeat;
    private stopHeartbeat;
    /**
     * Schedule a background refresh of the access token to fire `REFRESH_LEAD_SECONDS`
     * before it expires. Idempotent — cancels any pending refresh first. Without this,
     * an idle app would carry a stale token past its TTL and the next request would 401.
     */
    private scheduleRefresh;
    private clearRefreshTimer;
    private saveSession;
    private notifyListeners;
    /** Import a session obtained outside of OneloAuth (e.g. from paywall flow). Saves tokens and notifies listeners. */
    importSession(session: OneloSession): Promise<void>;
    sendMagicLink(email: string, redirectTo?: string): Promise<void>;
    sendPasswordReset(email: string, redirectTo?: string): Promise<void>;
}

type FeatureStatus = 'enabled' | 'disabled' | 'greyed' | 'hidden' | 'upsell' | 'new' | 'beta' | 'coming_soon';
/** Why a feature is in its current state. Forward-compatible: an unrecognized
 * reason from a newer backend normalizes to 'unknown' (mirrors Swift, where a
 * present-but-unknown reason once dropped the whole feature). */
type FeatureReason = 'user_override' | 'plan' | 'default' | 'static' | 'paywall_no_plan' | 'paywall_off' | 'suspended' | 'unknown';
/** Upgrade affordance derived from reason + requiredPlan; null when the feature
 * is available or not plan-gated. */
interface UpgradeHint {
    requiredPlan: string;
    currentStatus: FeatureStatus;
}
declare class FeatureState {
    readonly name: string;
    readonly status: FeatureStatus;
    /** Why the feature is in this state (plan-gated, user override, …). */
    readonly reason?: FeatureReason;
    /** Machine key of the plan that unlocks this feature — render the label. */
    readonly requiredPlan?: string;
    /** Human display name of `requiredPlan` — render this, not the raw key. */
    readonly requiredPlanLabel?: string;
    /** The developer enabled "tap to upgrade" for this feature. */
    readonly upgradeCta: boolean;
    constructor(name: string, status: FeatureStatus, reason?: FeatureReason, requiredPlan?: string, requiredPlanLabel?: string, upgradeCta?: boolean);
    get isEnabled(): boolean;
    get isDisabled(): boolean;
    get isVisible(): boolean;
    get isGreyed(): boolean;
    get isUpsell(): boolean;
    get isNew(): boolean;
    get isBeta(): boolean;
    get isComingSoon(): boolean;
    /** Promo/lock badge (parity with Swift): New/Beta/Coming Soon, 🔒 for greyed
     *  (locked — never hide it), and "Available in <plan>" for upsell. */
    get badgeLabel(): string | null;
    /** Non-null when the feature is plan-blocked AND the backend named the
     *  unlocking plan — surface in upgrade-prompt UI. */
    get upgradeHint(): UpgradeHint | null;
}
/** Error thrown by {@link OneloFeatures.moduleToken}. `code` mirrors the Swift
 *  `OneloFeaturesError` cases so cross-platform handling/docs line up 1:1. */
type OneloFeaturesErrorCode = 'not_authenticated' | 'not_entitled' | 'secure_mode_required' | 'invalid_user_hash' | 'network_error';
declare class OneloFeaturesError extends Error {
    readonly code: OneloFeaturesErrorCode;
    constructor(code: OneloFeaturesErrorCode, message?: string);
}
interface OneloFeaturesOptions {
    /** Suppress the anonymous-mode identify() warning. See OneloConfig.suppressIdentifyWarning. */
    suppressIdentifyWarning?: boolean;
    /** Explicit feature environment ('test'|'live'), forwarded on resolve/batch-ping/SSE. See OneloConfig.featureEnvironment. */
    featureEnvironment?: string;
    /** Status returned for a slug not (yet) in the resolved snapshot. Fail-closed
     *  'hidden' by default; set 'enabled' in dev to preview gates before toggling
     *  them in the dashboard. Parity with Swift/RN/Electron `featureDefaultStatus`. */
    featureDefaultStatus?: FeatureStatus;
}
declare class OneloFeatures {
    private readonly apiUrl;
    private readonly publishableKey;
    private readonly featureEnvironment?;
    private cache;
    private discoveredNames;
    private configVersion;
    private pingDebounce;
    private currentUserId;
    private currentUserIdHash;
    private readonly instanceId;
    private monitor;
    private suppressIdentifyWarning;
    private readonly defaultStatus;
    private changeListeners;
    private anonymousWarningLogged;
    private stream;
    private firstEventReceived;
    private readonly readyWaiters;
    private lastRefreshAt;
    constructor(apiUrl: string, publishableKey: string, monitor?: {
        _trackFeatureCall: (name: string) => void;
        recordFlag?: (key: string, value: string) => void;
    }, options?: OneloFeaturesOptions);
    /** Subscribe to feature-state changes — fired on every snapshot mutation (an
     *  admin's Deploy over SSE, an identity swap, invalidateCache). Returns an
     *  unsubscribe function. Use it to re-read feature() and re-render (React: wrap
     *  in useSyncExternalStore; Vue: trigger a ref). Parity with Electron/RN. */
    subscribe(listener: () => void): () => void;
    private _emitChange;
    /**
     * Wire the shared multiplexed event stream (called once by Onelo). Registers
     * features' listeners + the dynamic query params (`since_version` changes over
     * the connection's life; `environment` is optional). Handlers survive
     * reconnects and receive the already-parsed event `data`.
     */
    attachStream(stream: OneloEventStream): void;
    /** Declare feature names upfront — triggers a batch-ping immediately. */
    declare(names: string[]): void;
    /** Returns the current state for a feature. Auto-registers on first call. */
    feature(name: string): FeatureState;
    /** Load features for a user (or anonymous). Called by Onelo orchestrator.
     * Restores cache for instant UI, then opens an SSE channel that delivers
     * live updates whenever an admin clicks Deploy in the dashboard. */
    load(userId: string | null, userIdHash?: string | null): Promise<void>;
    /** Returns names of all features with an active status (enabled, new, or beta). */
    getActiveFeatures(): string[];
    /** Clear features' own background timer. The shared event stream is owned and
     * torn down by Onelo (see Onelo.destroy → stream.destroy), NOT here — closing
     * it from features would also drop auth's session.revoked subscription. Kept
     * named `stopPolling` for back-compat with the old polling-based API. */
    stopPolling(): void;
    /** Clears the local feature cache and resets the config version, then forces
     * the shared stream to reconnect so the server resends a full snapshot
     * (`since_version=0`). Without the reconnect a live connection stays silent
     * and the cache would only refill on the next admin Deploy. */
    invalidateCache(): void;
    /** Resolves once the first live snapshot has been applied (SSE `connected` /
     * `up_to_date`, or a REST resolve), or after `timeoutMs` — whichever first.
     * Never rejects. Lets a host await a settled state before first paint to avoid
     * a resolve→SSE flicker. Parity with Swift `ready(timeout:)`. Multiple callers
     * resolve together on the first event (or each on its own timeout). */
    ready(timeoutMs?: number): Promise<void>;
    /** Force-reconcile the snapshot from the server via REST (does NOT touch the
     * SSE stream). Debounced to one call/sec unless `force` (use force from a
     * user-initiated "Refresh" action). Never throws — a network error leaves the
     * cached state intact and SSE catches up later. Parity with Swift
     * `refresh(force:)`. */
    refresh(force?: boolean): Promise<void>;
    /** Requests a short-lived (60s) per-feature JWT from
     * `POST /api/sdk/features/module-token` — proof the current user is entitled
     * to `slug`, which the host forwards to its OWN backend/CDN to gate code
     * download. The backend re-verifies entitlement on every request. Parity with
     * Swift `moduleToken(for:)`.
     *
     * Throws {@link OneloFeaturesError}:
     * - `not_authenticated` — no user identified yet (no network call is made)
     * - `not_entitled` (403) — the user lacks access to `slug`
     * - `secure_mode_required` (401) — app requires `userIdHash`, none supplied
     * - `invalid_user_hash` (401) — supplied `userIdHash` failed backend HMAC
     * - `network_error` — transport failure or malformed response */
    moduleToken(slug: string): Promise<string>;
    /** Signals all pending ready() callers that the first snapshot arrived.
     * Idempotent — subsequent calls are no-ops. Parity with Swift
     * `_signalFirstEvent`. */
    private _signalFirstEvent;
    private _scheduleBatchPing;
    private _batchPing;
    private _resolve;
    /**
     * Logs a one-time warning when the backend reports anonymous mode (no userId)
     * AND at least one targeted feature was hidden purely because of it. Helps
     * developers using their own auth system catch missing identify() calls.
     * Suppressed via OneloConfig.suppressIdentifyWarning.
     */
    private _maybeWarnAnonymous;
    private _cacheKey;
    private _loadCache;
    private _writeCache;
    private _applySnapshot;
}

interface MonitorEventOptions {
    ok: boolean;
    durationMs?: number;
    error?: string;
    meta?: Record<string, unknown>;
}
/** Always-on context the SDK attaches to every event's meta (mirrors Swift's enrichMeta). */
interface MonitorContext {
    appVersion?: string;
    appBuild?: string;
    bundleId?: string;
    environment?: string;
}
declare class OneloMonitor {
    private readonly publishableKey;
    private readonly apiUrl;
    private readonly sessionId;
    private buffer;
    private readonly flags;
    private readonly breadcrumbs;
    private flushTimer;
    private currentUserId;
    /** Pre-built static meta merged into every event (sdk + app). Computed once. */
    private readonly staticMeta;
    private readonly environment?;
    constructor(publishableKey: string, apiUrl: string, context?: MonitorContext);
    /**
     * Returns a new meta object with always-on context merged in. SDK-owned keys
     * (`sdk`, `app`) are authoritative and override any caller-supplied value;
     * `environment` is only filled when the caller did not set it per-event.
     * Never mutates the caller's meta.
     */
    private _enrich;
    /** Sets the current user ID attached to all subsequent monitor events. Call after login/logout if not using Onelo Auth. */
    setUserId(userId: string | null): void;
    _trackFeatureCall(featureName: string): void;
    /**
     * Record the current value of a feature flag for flag↔error correlation.
     * Called by OneloFeatures on every evaluation. LRU: re-recording a key moves
     * it to most-recent; the buffer is capped at MAX_FLAGS. Not an event — just
     * updates the snapshot attached to future error captures.
     */
    recordFlag(key: string, value: string): void;
    track<T>(featureName: string, fn: () => Promise<T> | T, options?: {
        meta?: Record<string, unknown>;
    }): Promise<T>;
    event(featureName: string, opts: MonitorEventOptions): void;
    /**
     * Add a breadcrumb — a step in the trail leading to an error. Snapshotted into
     * `meta.breadcrumbs` on the next error capture. Ring-buffered (cap 100). The
     * message is scrubbed of secrets on the way in. Parity with Swift.
     */
    breadcrumb(message: string, opts?: {
        category?: string;
        data?: Record<string, string>;
    }): void;
    /**
     * Manually capture an error/exception with its stack + the active breadcrumbs
     * and feature flags (parity with Swift's `capture`). Use for caught errors you
     * still want reported. Never throws.
     */
    capture(error: unknown, opts?: {
        featureName?: string;
        meta?: Record<string, unknown>;
    }): void;
    /** Fold stack/errorType into a caller's meta without mutating it. */
    private _withError;
    /**
     * Flush the buffered events. `useBeacon` (set on the crash/unload path) prefers
     * `navigator.sendBeacon` + `keepalive` so the batch survives the page going
     * away — the browser analog of Swift's synchronous `_flushSync`.
     */
    flush(useBeacon?: boolean): Promise<void>;
    destroy(): void;
    private _push;
    /**
     * Internal: routed here by the module-level window-error handlers (see
     * `_installGlobalHandlers`). Only the current active monitor receives these.
     * `_push` already flushes on a `global_error` source.
     */
    _onGlobalError(message: string, stack?: string): void;
}

interface FeedbackOptions {
    type?: 'bug' | 'feature_request' | 'general';
    area?: string;
    userId?: string;
}
declare class OneloFeedback {
    private readonly apiUrl;
    private readonly publishableKey;
    private readonly getActiveFeatures;
    constructor(apiUrl: string, publishableKey: string, getActiveFeatures: () => string[]);
    open(options?: FeedbackOptions): Promise<void>;
    private _openModal;
}

declare class OneloPaywall {
    private apiUrl;
    private publishableKey;
    private getAccessToken;
    private onSession;
    constructor(apiUrl: string, publishableKey: string, getAccessToken: () => Promise<string | null>, onSession: (session: OneloSession) => Promise<void>);
    /**
     * Opens the hosted store page (plan selection + registration + payment).
     * Returns the session on success, or null if the user cancelled.
     *
     * @param mode  Presentation, default 'embedded' (inline iframe, matching
     *   Swift's inline flow and the auth view). loadAuthView threads its own mode
     *   through here so sign-in → store are presented consistently. Embedded works
     *   because /store/hosted is served with frame-ancestors '*' (next.config.ts,
     *   same as /auth/hosted and /manage/hosted); the store token is origin-gated
     *   at store-initiate and the code is postMessaged only to the validated
     *   origin, so the permissive framing is safe. Pass 'popup' for a top-level
     *   window if you prefer not to embed.
     */
    openStore(lang?: string, mode?: AuthPresentMode): Promise<OneloSession | null>;
    /** Shared tail for store-initiate: present the hosted /store/hosted page (which
     *  postMessages `onelo:code`), exchange the code for a session via
     *  hosted-callback, and hand it to auth. */
    private _completeHostedCheckout;
    /**
     * Opens the hosted manage page (upgrade, cancel, payment method).
     * Returns the new plan string if the user changed their plan, or null if closed without changes.
     */
    openManage(lang?: string): Promise<string | null>;
    private openManageModal;
}

declare class OneloForms {
    private readonly apiUrl;
    private readonly publishableKey;
    constructor(apiUrl: string, publishableKey: string);
    submit(formSlug: string, data: Record<string, unknown>, submitterEmail?: string): Promise<{
        success: boolean;
        message?: string;
    }>;
}

declare class OneloWaitlist {
    private readonly apiUrl;
    private readonly publishableKey;
    constructor(apiUrl: string, publishableKey: string);
    join(slug: string | undefined, email: string): Promise<{
        success: boolean;
        position?: number;
        alreadyJoined: boolean;
    }>;
}

declare class OneloCustomerPortal {
    private apiUrl;
    private publishableKey;
    private getAccessToken;
    private onSessionInvalidated?;
    constructor(apiUrl: string, publishableKey: string, getAccessToken: () => Promise<string | null>, onSessionInvalidated?: () => void);
    /**
     * Open the hosted Customer Portal ("Manage your plan").
     *
     * @param opts.intent  `'change_plan'` opens the portal straight into the plan
     *   picker (the portal auto-runs its own "Change plan" on load) instead of the
     *   management home — so a subscriber tapping an upsell lands on the plans, not
     *   "in front of the door". Used by {@link Onelo.openUpgrade}. Falls back to the
     *   management home if a plan change isn't available for this subscription.
     */
    open(opts?: {
        intent?: 'change_plan';
    }): Promise<void>;
    private openPortalModal;
}

type OneloConsentEnforcement = 'block' | 'notify' | 'unknown';
interface OneloConsentRequirement {
    /** "terms" | "privacy" | "dpa" | "cookies" (open set). */
    docType: string;
    versionId: string;
    version: string;
    enforcement: OneloConsentEnforcement;
    /** Server-computed: enforcement=block AND effective_at<=now. The one gate signal. */
    blocking: boolean;
    /** Public document URL (read-only page) — the "Review" link target. */
    url: string | null;
    /** Gate-mode URL (document + accept/decline) — used by native SDKs' WebViews. */
    consentUrl: string | null;
}
declare class OneloConsent {
    private readonly apiUrl;
    private readonly publishableKey;
    private readonly auth;
    private readonly autoPresent;
    /** Bumped on each `legal.consent_required` push (parity with Swift's
     *  @Published consentRevision). Observe via `onConsentRequired`. */
    private _consentRevision;
    private readonly revisionListeners;
    /** Held from the top of presentGateIfNeeded across its `requiredConsents`
     *  round-trip, so two concurrent callers (sign-in + a buffered SSE push) can't
     *  both open a gate. Set synchronously before the first await. */
    private _presenting;
    /** The live gate overlay, if one is open — prevents a second. */
    private _gateOverlay;
    /** Saved `body.style.overflow` so the scroll lock is reversible. */
    private _prevBodyOverflow;
    /** Set once dispose() runs — blocks any late re-present (e.g. an in-flight
     *  accept's re-check firing after teardown, which would zombie a new overlay
     *  and re-lock scroll forever). */
    private _disposed;
    /** Sibling nodes we marked `inert` while the gate is up (ONLY the ones we
     *  changed) so restore never clears an inert the host app set itself. */
    private _inertedSiblings;
    /** Tab-trap keydown handler, removed on close. */
    private _trapHandler;
    constructor(apiUrl: string, publishableKey: string, auth: OneloAuth, autoPresent?: boolean);
    get consentRevision(): number;
    /** Subscribe to `legal.consent_required` pushes (revision bumps). Returns an
     *  unsubscribe fn. Use when you build your own consent UI instead of the
     *  auto-presented gate. */
    onConsentRequired(listener: (revision: number) => void): () => void;
    /**
     * Fetch the signed-in user's outstanding legal documents. Requires a session;
     * returns `[]` when signed out. Fail-open: any network/non-200/parse failure
     * returns `[]` (never throws) — the gate surfaces real blocking updates, not
     * network blips.
     */
    requiredConsents(): Promise<OneloConsentRequirement[]>;
    /**
     * Record acceptance of a legal document version. Requires a session. Throws
     * `OneloError` on no-session or a non-2xx response. Server-side idempotent.
     */
    acceptConsent(versionId: string): Promise<void>;
    /**
     * Register the `legal.consent_required` listener on the shared stream. The
     * event is a signal only (payload ignored) — on receipt we bump the revision,
     * notify observers, and auto-present the gate if one is warranted.
     */
    attachEventStream(stream: OneloEventStream): void;
    /**
     * Check for an outstanding BLOCKING consent and, if present, open the gate.
     * Returns true if a gate was shown. No-op when: not in a browser, no session,
     * no blocking document, or a gate is already open.
     */
    presentGateIfNeeded(): Promise<boolean>;
    private _presentGate;
    private _closeGate;
    /**
     * Accept → record, then RE-CHECK (documents stack — there may be another
     * blocking doc). Any non-accept → sign out. Mirrors Swift/Electron
     * `handleConsent`. On a transient accept failure the gate STAYS up so the user
     * can retry rather than being bounced out.
     */
    private _handleConsentAction;
    private _buildOverlay;
    /** Tear down any open gate + restore scroll. Called from `Onelo.destroy()`.
     *  Marks the instance disposed so a late accept re-check can't zombie a new
     *  gate (and re-lock scroll) after teardown. */
    dispose(): void;
}

declare class Onelo {
    readonly auth: OneloAuth;
    readonly features: OneloFeatures;
    readonly monitor: OneloMonitor;
    readonly feedback: OneloFeedback;
    readonly paywall: OneloPaywall;
    readonly forms: OneloForms;
    readonly waitlist: OneloWaitlist;
    readonly customerPortal: OneloCustomerPortal;
    /** Legal-consent gate (Terms/Privacy updates for signed-in users). */
    readonly consent: OneloConsent;
    private authUnsubscribe;
    private readonly eventStream;
    constructor(config: OneloConfig);
    /**
     * Open the sign-in flow. The routing (sign-in vs store vs "already have
     * access") is decided by the backend `/api/sdk/flow/init`, so behaviour is
     * identical across every SDK — no client logic to drift.
     * - waitlist_mode + sdk_redirect_url → opens developer's waitlist/store page
     * - otherwise → the backend flow picks sign-in or store and chains them; the
     *   hosted page returns once the user has access.
     * Presentation defaults to an inline iframe (`mode:'embedded'`), matching
     * Swift's inline WKWebView; pass `mode:'popup'` for a top-level window.
     */
    loadAuthView(options?: {
        mode?: AuthPresentMode;
    }): Promise<_onelo_core.OneloSession | null>;
    /**
     * Only needed when NOT using Onelo Auth (own auth system). Pass `userIdHash`
     * (HMAC-SHA256 computed on YOUR server, `"user:"+userId`) to satisfy Secure
     * Mode targeting — the SDK forwards it and never computes it.
     */
    identify(userId: string, userIdHash?: string): Promise<void>;
    /**
     * Open the upgrade flow for a plan-blocked feature — call it when the user taps
     * a gated tile whose `feature.upgradeCta` is set. Routes to the right WORKING
     * web surface by billing state:
     *   - active subscriber → `customerPortal.open()` (the Portal's "Change plan" —
     *     upgrade / downgrade / interval switch, all handled + confirmed there).
     *   - otherwise         → `paywall.openStore()` (pick + buy a plan).
     *
     * Unlike the native SDKs, `@onelo/js` does NOT drive `/upgrade-initiate`'s
     * `store_switch` checkout: that flow completes via a deep-link / postMessage the
     * in-iframe store-switch terminals don't emit, so it would hang the modal. The
     * Portal is the web-correct door for an existing subscriber's plan change.
     *
     * `plan` is accepted for cross-platform call-site parity (Swift/Electron/RN pass
     * `feature.requiredPlan`); on web the Portal/Store show the plans, so it is
     * advisory only. Fire-and-forget: the resulting plan change reaches the SDK via
     * SSE and fires `features.subscribe()`. Requires a signed-in Onelo Auth user.
     */
    openUpgrade(_plan?: string): Promise<void>;
    /** Release background timers. Call when the SDK instance is no longer needed. */
    destroy(): void;
}

export { type AuthPresentMode, type FeatureReason, FeatureState, type FeatureStatus, type FeedbackOptions, type MonitorContext, type MonitorEventOptions, Onelo, OneloConsent, type OneloConsentEnforcement, type OneloConsentRequirement, OneloCustomerPortal, OneloFeatures, OneloFeaturesError, type OneloFeaturesErrorCode, OneloFeedback, OneloForms, OneloMonitor, OneloPaywall, OneloWaitlist, type UpgradeHint };
