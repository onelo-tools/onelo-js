type UserRole = 'platform_owner' | 'creator' | 'member';
/**
 * Whether the user currently has an active paid entitlement.
 * Mirrors the backend `user.entitlement` string ("active" | "none") and the
 * Swift `OneloEntitlement` enum. A MISSING value must always decode to
 * `'none'` — never treat an absent entitlement as active.
 */
type OneloEntitlement = 'active' | 'none';
interface OneloUser {
    id: string;
    email: string | undefined;
    role: UserRole;
    tenantId: string | null;
    /** Active-access flag from the backend; absent → 'none'. */
    entitlement: OneloEntitlement;
    /**
     * **May this person see the app?** Computed by Onelo, never here.
     *
     * The rule — no paywall, or a live grant — used to be re-derived in every SDK
     * from two raw settings. Three languages, three copies, and the JS one
     * answered TRUE while config was still loading, so a plan-less user walked
     * into a paid app on every page load (2026-08-18). The server now ships the
     * conclusion; reading it is the whole of an SDK's job here.
     *
     * Optional so an older backend that omits it still parses. When it is absent
     * the SDK falls back to the old derivation — see `isAllowedIn`.
     */
    allowedIn?: boolean;
}
interface OneloSession {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    user: OneloUser;
}
interface OneloConfig {
    /** Publishable key from Onelo dashboard (onelo_pk_live_...) */
    publishableKey: string;
    /** Onelo API base URL — required. Get this from your Onelo dashboard snippet. */
    apiUrl: string;
    /** App bundle identifier (e.g. "com.example.myapp"). Required for live apps with registered bundle IDs. */
    bundleId?: string;
    /**
     * Custom URL scheme for deep-link callbacks — how the hosted auth/store/customer-portal
     * flow returns to your app when it runs in the SYSTEM BROWSER (e.g. store upgrade, or a
     * Stripe redirect that leaves the in-app WebView). MUST match the scheme you register
     * natively: Android `<intent-filter>` `<data android:scheme="…"/>` + iOS Info.plist
     * `CFBundleURLSchemes`. Use a scheme UNIQUE to your app (e.g. "myapp") to avoid
     * collisions with other Onelo-based apps on the same device. Defaults to "onelorn".
     */
    callbackScheme?: string;
    /**
     * App release version (e.g. "1.2.0"). Auto-attached to every Monitor event as
     * `meta.app.version` and surfaces as the "Release" column in Feature Health.
     * Set it once here — never per-event.
     */
    appVersion?: string;
    /**
     * App build number (e.g. "420"). Auto-attached as `meta.app.build` and surfaces
     * as the "App build" column in Feature Health. Set once here — never per-event.
     */
    appBuild?: string;
    /**
     * Deployment environment label for Monitor events ("production" | "staging" | "dev").
     * Auto-attached as `meta.environment` and surfaces as the "Environment" column.
     * A per-event `meta.environment` you set on an individual event overrides this default.
     */
    environment?: string;
    /**
     * Suppress the "no userId — call onelo.identify()" console warning that fires when
     * features resolve in anonymous mode while targeted features exist. Set to true if
     * your app is intentionally anonymous (e.g. a public marketing site with no auth).
     * Default: false.
     */
    suppressIdentifyWarning?: boolean;
    /**
     * Explicit Feature environment: 'test' or 'live'. Forwarded to the backend so
     * it resolves the matching feature snapshot regardless of the key prefix — set
     * the SAME value here and in your backend SDK so a client and its server agree
     * on env. On Node, omitting this falls back to the ONELO_FEATURE_ENVIRONMENT
     * env var; if still unset the backend uses the key prefix (old behavior).
     * See docs/architecture/feature-environment-explicit.md.
     */
    featureEnvironment?: 'test' | 'live';
    /**
     * Auto-present the blocking legal-consent gate (Terms/Privacy updates) on
     * sign-in and when the backend pushes `legal.consent_required`. Default: true.
     * Set to false to drive your own UI via `onelo.consent.requiredConsents()` /
     * `onelo.consent.onConsentRequired()`.
     */
    autoPresentConsentGate?: boolean;
    /**
     * Status returned by `onelo.features.feature(name)` for a slug not (yet) in the
     * resolved snapshot. Fail-closed 'hidden' by default — a feature instrumented in
     * code but not enabled in the dashboard stays hidden in production. Set 'enabled'
     * in dev to preview new gates before toggling them. 1:1 with Swift
     * `Onelo(featureDefaultStatus:)`. (Read by the React Native, JS, and Electron SDKs.)
     */
    featureDefaultStatus?: 'enabled' | 'disabled' | 'greyed' | 'hidden' | 'upsell' | 'new' | 'beta' | 'coming_soon';
    /**
     * When true (default), the SDK force-refreshes its feature snapshot whenever the
     * app returns to the FOREGROUND, so a Deploy that landed while backgrounded
     * reconciles immediately instead of waiting for the poll. Set false to rely on
     * poll + SSE only. 1:1 with Swift `Onelo(autoLifecycleRefresh:)`. (Currently read
     * by the React Native SDK.)
     */
    autoLifecycleRefresh?: boolean;
}
declare class OneloError extends Error {
    readonly code: 'not_authenticated' | 'hosted_flow_required' | 'invalid_publishable_key' | 'network_error' | 'server_error' | 'cancelled' | 'revoked' | 'user_revoked' | 'plan_required' | 'no_active_plan' | 'timeout' | 'in_app_store_not_allowed';
    constructor(code: 'not_authenticated' | 'hosted_flow_required' | 'invalid_publishable_key' | 'network_error' | 'server_error' | 'cancelled' | 'revoked' | 'user_revoked' | 'plan_required' | 'no_active_plan' | 'timeout' | 'in_app_store_not_allowed', message: string);
    static notAuthenticated(): OneloError;
    static hostedFlowRequired(): OneloError;
    /**
     * The DEVELOPER's app is on a plan that doesn't allow custom auth UI. This is
     * a build-time configuration error — the fix is to use the hosted flow
     * (loadAuthView) or upgrade the Onelo plan. NOT for an end-user's lapsed
     * subscription — see noActivePlan().
     */
    static planRequired(): OneloError;
    /**
     * The END USER has no active subscription (it lapsed or was cancelled) — the
     * backend cleared the session. This is NOT a config error and NOT an account
     * revocation: route the user to your store / upgrade flow to re-subscribe.
     */
    static noActivePlan(): OneloError;
    static invalidKey(msg: string): OneloError;
    static network(msg: string): OneloError;
    static server(msg: string): OneloError;
    static timeout(msg: string): OneloError;
    static cancelled(): OneloError;
    static revoked(): OneloError;
    static userRevoked(): OneloError;
}

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
    /** True once this tab has handed a magic-link sign-in to another tab.
     *
     *  It is then DONE: it shows "continue in the other tab" and must present
     *  nothing else. Without this the host app's own startup call to
     *  loadAuthView() opened a sign-in form on top of that notice, so the tab the
     *  user was told to leave asked them to log in again (reported 2026-08-19). */
    private handedOverToAnotherTab;
    allowCustomBranding: boolean;
    appName: string;
    appLogoUrl: string | null;
    paywallEnabled: boolean;
    /** False when Paywall → Access Gate is "Sign in only": this app never sells
     *  in-app. Read it before offering ANY upgrade CTA — see isStoreAvailable(). */
    inAppStoreAllowed: boolean;
    /**
     * Which hosted surface `loadAuthView()` last opened: `sign_in`, `store`,
     * `no_plan`, or null when nothing was presented (the caller was already
     * authorized, or the flow never got that far).
     *
     * `/api/sdk/flow/init` decides this centrally and the SDK used to drop it, so
     * a host app that got `null` back could not tell "cancelled the sign-in" from
     * "declined to buy" from "was shown 'no active plan'". The return type stays
     * `OneloSession | null` — this is additive, and reading it is optional.
     */
    lastPresentedSurface: string | null;
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
    /** Trade a one-time hosted code for a session. One implementation, because
     *  the hosted flow can hand a code back from more than one surface. */
    private exchangeHostedCode;
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
     * True when this app has the paywall enabled (from `/api/sdk/config`).
     *
     * Parity with the Electron and React Native SDKs, which have had this since
     * the launch gates were written. It was MISSING here — and the JS auth snippet
     * shipped `onelo.auth.isPaywallEnabled()` anyway, so every developer who
     * followed our own web documentation called a function that did not exist.
     *
     * Accurate only after `whenReady()` resolves; false before config loads.
     */
    isPaywallEnabled(): boolean;
    /**
     * May this app open a store at all?
     *
     * False when the developer chose Paywall → Access Gate → "Sign in only":
     * buyers pay on their website, so nothing in the app may show plans, a
     * checkout, or an "upgrade" CTA that leads to one.
     *
     * Check it before rendering any upsell. The backend refuses store-initiate in
     * that state (409 `in_app_store_not_allowed`), so ignoring this only turns a
     * hidden button into a dead one — but a dead button is still a broken screen.
     *
     * Accurate after `whenReady()`; true before config loads, so an early call
     * cannot hide a store the developer does sell through.
     */
    isStoreAvailable(): boolean;
    /**
     * **Should this user see your app?** The ONE signal to gate your UI on.
     *
     * `signed in && (no paywall || has paid access)`.
     *
     * Gating on a session alone is a paid-product giveaway: the session says WHO
     * someone is and nothing about whether they may be here. That is not
     * hypothetical — it is what happened when the gate had to be hand-assembled
     * from three separate reads, which is what this method replaces. Mirrors
     * Swift's `isAllowedIn` and the Flutter getter of the same name.
     *
     * Call it AFTER `whenReady()`: `isPaywallEnabled()` is false until config
     * loads, so an early call can answer true for an unentitled user. The Swift
     * property folds `isReady` in because it is observable; here readiness is
     * awaited, not observed, so awaiting is the caller's half of the contract.
     */
    isAllowedIn(): Promise<boolean>;
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
    /**
     * @param announce Tell OTHER TABS a sign-in just happened. Only a genuine
     *   sign-in announces. A token REFRESH must not: a tab sitting on the
     *   sign-in screen would settle its modal, look for the session, find none
     *   (the refresh happened in a different tab, not this one) and report a
     *   cancelled sign-in — worse than the waiting it replaced.
     */
    private saveSession;
    private notifyListeners;
    /** Import a session obtained outside of OneloAuth (e.g. from paywall flow). Saves tokens and notifies listeners. */
    importSession(session: OneloSession): Promise<void>;
    /**
     * Email a sign-in link. **Custom-UI path — paid plans only.**
     *
     * The plan gate matches `signIn()` / `signUp()` above. It was missing here, so
     * on a free plan the call succeeded, the mail went out, and the developer had
     * an API they could never finish: without `allowCustomBranding` they may not
     * build their own sign-in screen at all, which is the only place this method
     * makes sense. Either both are gated or neither; a half-working API is worse
     * than a refused one.
     *
     * On a free plan use the hosted sign-in page (`loadAuthView()`), where magic
     * link is available to everyone and the return trip is already wired.
     */
    sendMagicLink(email: string, redirectTo?: string): Promise<void>;
    /** End this tab's part in the flow: show the farewell notice and refuse to
     *  present anything afterwards — including the host app's own startup call to
     *  loadAuthView(), which otherwise opened a login form on top of the notice. */
    private finishAsMessengerTab;
    /**
     * Tell the hosted page which page to send the browser back to.
     *
     * Only magic link needs this, and only on the web: every other hosted step
     * finishes inside the iframe and answers by postMessage, but a magic link is
     * opened LATER from an email, in a tab that has no way back to this one. The
     * hosted page passes this along when it requests the link, and the BACKEND
     * validates it against the app's allowed origins — so this value is a
     * suggestion, never a trusted input. A page that lies about its own URL only
     * gets a 400.
     */
    private withReturnTo;
    /**
     * Write the magic-link verifier somewhere the NEXT tab can read it.
     *
     * Returns false when the value did not actually reach durable storage, which
     * is the only signal `sendMagicLink` needs: no durable verifier → no
     * challenge. `TokenStorage.set` degrades to an in-memory map rather than
     * throwing (Safari private mode, disabled storage), and that map is invisible
     * to the tab the email opens — so a successful `set` is NOT proof of
     * persistence. Reading it back through a fresh instance is.
     */
    private persistMagicLinkVerifier;
    /**
     * Finish a magic-link sign-in after the browser has returned to your page.
     *
     * The email opens a new tab on Onelo, which consumes the link and sends the
     * browser to the `redirectTo` you passed to `sendMagicLink`, with a one-time
     * code appended as `onelo_code`. This exchanges that code for a session.
     *
     * Called automatically during `init()`, so most apps never call it directly;
     * it is public for apps that route their own way and want to control when the
     * exchange happens.
     *
     * Resolves to the session, or null when the URL carries no code — the normal
     * case on every ordinary page load, and deliberately not an error.
     */
    completeFromUrl(): Promise<OneloSession | null>;
    /** The body of `completeFromUrl` WITHOUT the `initPromise` await, so
     *  `initialize()` can run it without waiting on itself. */
    private exchangeCodeFromUrl;
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
    /** Serialises all drains so a timer flush and an error flush can't overlap. */
    private flushChain;
    /** Epoch ms until which we hold off sending (set from a 429 `Retry-After`). */
    private retryAfterUntil;
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
     *
     * Drains are SERIALISED through one promise chain: the 15s timer, an error
     * auto-flush and an explicit `flush()` must never drain concurrently, because
     * a retried send now spans seconds and two overlapping drains would interleave
     * batches (and the second would observe an empty buffer and report "sent").
     */
    flush(useBeacon?: boolean): Promise<void>;
    private _drain;
    /**
     * Unload/crash path. This is genuinely BEST-EFFORT and CANNOT be retried: the
     * document is going away, so there is no later tick in which to try again and
     * no way to observe the result — `sendBeacon` only reports that the request was
     * queued, never that the server accepted it, and a `keepalive` fetch outlives
     * the JS context that would handle its response. Treat these events as
     * "handed to the browser", NOT as delivered.
     *
     * Uses CORS-safelisted `text/plain`: `application/json` forces an OPTIONS
     * preflight that browsers routinely drop during unload, discarding the very
     * batch we're trying to save. The backend parses the JSON body regardless.
     */
    private _sendBeacon;
    /**
     * Deliver one batch, retrying network failures and 5xx with bounded
     * exponential backoff. Returns true when the batch is settled (accepted, or
     * rejected in a way retrying cannot fix); false when retries were exhausted
     * and the caller should re-queue.
     */
    /** One POST. Never throws — classifies the result instead. */
    private _sendOnce;
    /**
     * Put an undelivered batch back at the FRONT of the buffer so the next flush
     * retries it, then re-apply the cap.
     *
     * Priority policy under a sustained outage: NEWEST EVENTS WIN. The buffer is
     * trimmed from the front, so the oldest re-queued events are the first to go.
     * This matches `_push`'s newest-wins eviction, keeps memory bounded at
     * MAX_BUFFER_SIZE regardless of how long the backend is down, and prevents a
     * stuck batch from starving live telemetry. Drops are reported, never silent.
     */
    private _requeue;
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
    }): Promise<OneloSession | null>;
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

export { type AuthPresentMode, type FeatureReason, FeatureState, type FeatureStatus, type FeedbackOptions, type MonitorContext, type MonitorEventOptions, Onelo, type OneloConfig, OneloConsent, type OneloConsentEnforcement, type OneloConsentRequirement, OneloCustomerPortal, type OneloEntitlement, OneloError, OneloFeatures, OneloFeaturesError, type OneloFeaturesErrorCode, OneloFeedback, OneloForms, OneloMonitor, OneloPaywall, type OneloSession, type OneloUser, OneloWaitlist, type UpgradeHint };
