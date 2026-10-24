/**
 * Marketing Consent (#818) for Apps that build their own sign-up or waitlist
 * screen. The hosted sign-up page asks by itself; these pieces let a custom
 * screen ask the same question with the same words.
 *
 * The rules — the parent App's switch, "an App that sells asks at Checkout",
 * the one wording per parent — live in the backend
 * (`backend/app/lib/marketing_consent.py`); `/api/sdk/config` answers with
 * `signup_marketing_consent` and the sign-up records exactly that text.
 */
/** Should a custom sign-up screen show the optional checkbox, and with what text. */
interface SignupMarketingConsent {
    /** False when the App does not ask at sign-up (or sells: Checkout asks). */
    asked: boolean;
    /** The checkbox label, already filled in. Null when not asked. */
    text: string | null;
    /** The language `text` is in; sent back with the consent. */
    language: string | null;
}
interface SignUpOptions {
    /** The person ticked the Marketing Consent checkbox your screen showed with
     *  `getSignupMarketingConsent()`'s text. Never pre-tick it. */
    marketingConsent?: boolean;
}
/** The waitlist's checkboxes: the reserved purposes a join may carry. */
interface WaitlistConsent {
    /** Marketing Consent — optional, never pre-ticked. */
    marketing?: boolean;
    /** The waitlist's custom checkbox, when the waitlist has one. */
    custom?: boolean;
}
interface WaitlistJoinOptions {
    consent?: WaitlistConsent;
}

/**
 * Brand tokens (#681) — the ONE model every JS-family SDK (js, electron,
 * react-native) draws its native chrome from: spinner, close ✕ chip, retry
 * buttons, skeletons, error screens, modal containers, consent card.
 *
 * The backend resolves the app's Branding once (`resolve_brand_tokens`, the
 * twin of the frontend `resolveBrandTokens`) and sends the result as
 * `brand_tokens` on `/api/sdk/config` and on the store / portal / manage /
 * upgrade initiate responses. SDKs never re-derive a theme: they parse that
 * object here and paint with it.
 *
 * Older backends do not send it. Then the two colours they always sent
 * (`primary_color`, `checkout_bg_color`) seed the same shape with the
 * registry's bg-aware defaults. Before any response arrives the SDK paints the
 * NEUTRAL set — a grey accent on the dark page default, never Onelo orange.
 */
interface BrandTokens {
    version: number;
    page_bg: string;
    brand: string;
    card_bg: string;
    text: string;
    /** May be an `rgba(...)` string. */
    text_muted: string;
    border: string;
    button_bg: string;
    button_text: string;
    /** px */
    button_radius: number;
    /** px */
    field_radius: number;
    /** px */
    card_radius: number;
    /** CSS font-family stack. */
    body_font: string;
    heading_font: string;
    /** May be an `rgba(...)` string. */
    spinner_track: string;
    light_bg: boolean;
}
/**
 * An SDK's one in-memory brand-token model. The SDK's composition root owns a
 * single instance and hands it to every module that draws chrome: config sets
 * it, an initiate response carrying `brand_tokens` refreshes it, and until
 * either arrives it holds the NEUTRAL set.
 */
declare class BrandSource {
    private tokens;
    current(): BrandTokens;
    set(tokens: BrandTokens | null | undefined): void;
    /** Adopt the branding a config / initiate response carries (if any) and
     *  return the tokens to paint with. */
    adopt(json: unknown): BrandTokens;
}

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
    /**
     * Has this user proved their address receives mail (Email Verification,
     * #819)? From the backend's `email_verified`; undefined when an older
     * backend did not send it. OAuth, Magic Link and an e-mailed password reset
     * count as verified.
     */
    emailVerified?: boolean;
    /**
     * Why `allowedIn` is false, when the server named a reason the app may want
     * to branch on. Today only `'email_unverified'`: the parent App requires
     * Email Verification and this user has not opened the link yet. Absent when
     * allowed in or when the reason is the paywall. Unknown values must be
     * tolerated (forward-compatible).
     */
    accessReason?: string;
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
    readonly code: 'not_authenticated' | 'hosted_flow_required' | 'invalid_publishable_key' | 'network_error' | 'server_error' | 'cancelled' | 'revoked' | 'user_revoked' | 'session_ended' | 'plan_required' | 'no_active_plan' | 'timeout' | 'in_app_store_not_allowed' | 'verification_rate_limited' | 'email_verification_off' | 'invalid_verification_token' | 'invalid_verify_redirect';
    constructor(code: 'not_authenticated' | 'hosted_flow_required' | 'invalid_publishable_key' | 'network_error' | 'server_error' | 'cancelled' | 'revoked' | 'user_revoked' | 'session_ended' | 'plan_required' | 'no_active_plan' | 'timeout' | 'in_app_store_not_allowed' | 'verification_rate_limited' | 'email_verification_off' | 'invalid_verification_token' | 'invalid_verify_redirect', message: string);
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
    /** The account was BANNED. Only a real ban may say "suspended" — never an
     *  ended or replaced session (see sessionEnded). */
    static userRevoked(): OneloError;
    /**
     * The session is over — it expired, was replaced (`session_compromised`:
     * the same refresh token was presented again outside the server's grace
     * window) or is not recognised (`session_invalid`). NOT an account action:
     * the user just signs in again. The SDK has already cleared the session and
     * fired `onAuthStateChange(null)`.
     */
    static sessionEnded(): OneloError;
    /** Email Verification (#819): at most 3 verification e-mails an hour. */
    static verificationRateLimited(): OneloError;
    /** Email Verification is Off for this App (Auth → Sign-up on the parent App). */
    static emailVerificationOff(): OneloError;
    /** The `redirectTo` given for the verification link is not one of the App's
     *  allowed web origins, nor `<registered-scheme>://…`. */
    static invalidVerifyRedirect(): OneloError;
    /** The verification link was used, replaced by a newer one, or expired. */
    static invalidVerificationToken(): OneloError;
}

/**
 * Whose error is an uncaught error — the developer's app, or the Onelo SDK?
 * (#548 / #549.) Every JS-family monitor classifies a `global_error` at capture
 * and sends the answer as `meta.origin`, so the backend can keep the SDK's own
 * errors out of the developer's Monitor data and quota.
 *
 * Two signals, strongest first:
 *  1. The error is a `OneloError` — raised by the SDK by construction. This is
 *     the one that survives a production bundle, where SDK code and app code
 *     share one minified file and stack frames cannot tell them apart.
 *  2. The error's TOP stack frame (where it was thrown) is in the SDK's own
 *     files: an installed `@onelo/*` package (npm, Vite's `@onelo_js.js`
 *     pre-bundle, Metro, webpack-internal) or the SDK sources in this monorepo.
 *     Only the top frame counts: an app callback the SDK invoked has the SDK
 *     BELOW it and is still the app's error.
 * Anything else is the app's.
 */
type ErrorOrigin = 'onelo_sdk' | 'app';

/**
 * Email Verification calls (#819) for Apps that build their own screen.
 *
 * The default needs none of this: when the parent App requires Email
 * Verification, Onelo's hosted flow shows "check your inbox", resends, and
 * hands the session back by itself. These two calls exist for paid-plan Apps
 * with their own UI (sdk-auth.md: custom UI is the developer's choice).
 * The rules — 24 h links, single use, newest wins, 3 sends an hour — live in
 * the backend (`backend/app/lib/email_verification.py`).
 */

interface ResendVerificationResult {
    /** True when a new e-mail went out (the previous link stopped working). */
    sent: boolean;
    /** True when the address was already verified — nothing was sent. */
    emailVerified: boolean;
}

type AuthPresentMode = 'popup' | 'embedded';
/** #948: which sign-in methods the hosted form will draw, as far as the SDK
 *  knows before the window opens (from /api/sdk/config). Unknown reads as the
 *  smallest shape — no pills, no magic link — so the skeleton never flashes a
 *  button the hosted page does not show. */
interface AuthSkeletonShape {
    /** Enabled OAuth providers (one secondary pill each, then an "or" divider). */
    socialCount: number;
    /** Passwordless sign-in on: a centred link row under the password field. */
    magicLink: boolean;
}

/**
 * Proof of the signed-in end user on Features calls (#510, #518).
 *
 * The Features endpoints (resolve, batch-ping, poll, module-token, the Event
 * Stream and its Stream Token) accept `Authorization: Bearer <Onelo access
 * token>` from a publishable-key caller and take the user from the token
 * instead of the `userId` in the body (server: `backend/app/lib/features/end_user.py`). A token the server refuses
 * answers `401 {"detail":{"error":"invalid_user_token"}}` and never falls back
 * to the `userId`.
 *
 * This module is the ONE place that decides what a Features call sends:
 * - signed in: the current access token (read fresh per call, so an expired
 *   one is never reused — `auth.getSession()` refreshes near expiry);
 * - refused: refresh once and retry once (one refresh per refusal episode);
 * - refused again: the call is made anonymous (no token, no `userId`) and the
 *   caller is told, so it can surface the refusal. It never loops.
 */
/** Where the Features calls read the signed-in user's access token. */
interface UserTokenSource {
    /** The current access token, or null when no Onelo user is signed in. */
    current(): Promise<string | null>;
    /** Refresh the session and return the new access token (null when that fails). */
    refresh(): Promise<string | null>;
}

type SseHandler = (data: Record<string, unknown>) => void;
type ParamProvider = () => Record<string, string>;
/** Identity attached to the currently open stream connection. `anonymousFallback`
 * is true when a signed-in token was refused and the stream was opened without
 * a user; that connection must never replace a signed-in snapshot. */
interface StreamConnectionIdentity {
    userId: string | null;
    anonymousFallback: boolean;
}
declare class OneloEventStream {
    private readonly apiUrl;
    private readonly publishableKey;
    private readonly sdkVersion?;
    /** The signed-in user's access token, sent on the Stream Token mint. */
    private readonly userToken?;
    private source;
    private readonly handlers;
    private readonly paramProviders;
    private readonly connectionListeners;
    private userId;
    private started;
    private destroyed;
    private reconnectAttempts;
    private reconnectTimer;
    private connectGeneration;
    private minting;
    private refused;
    private lifecycleBound;
    private userTokenRefusedWarned;
    private readonly lifecycleListeners;
    private readonly _onVisibility;
    private readonly _onOnline;
    constructor(apiUrl: string, publishableKey: string, sdkVersion?: string | undefined, 
    /** The signed-in user's access token, sent on the Stream Token mint. */
    userToken?: UserTokenSource | undefined);
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
    /**
     * Observe which identity the current socket actually authenticated. This is
     * distinct from the requested user: a refused user token opens an anonymous
     * fallback stream while retaining the requested userId for the next retry.
     */
    onConnectionIdentity(fn: (identity: StreamConnectionIdentity | null) => void): void;
    private _setConnectionIdentity;
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
    /**
     * Mint one Stream Token. The Publishable Key travels here — in a header, on a
     * POST — and never anywhere near the stream URL.
     *
     * Throws `StreamCredentialRefused` on 401/403 (a dead key: permanent) and a
     * plain Error on anything else (offline, 5xx, a token-less body: transient).
     * A 503 from an unreachable key lookup therefore retries rather than killing
     * the stream, which is the Reachability invariant the backend upholds.
     *
     * The status branch below sees a 401/403 whatever content-type it arrives in.
     * `httpPost` used to parse the body BEFORE anyone could read the status
     * (`onelo-core/src/http.ts`), so a WAF or proxy rendering a GENUINE refusal as
     * an HTML page threw a network error, landed in the transient branch, and was
     * retried forever — straight past this brake. It now reads the status first
     * and hands a refusal back with an empty `json`, so the check below catches it
     * (#97; `event-stream.test.ts` proves the brake stops on an HTML 403).
     *
     * The inverse still holds, and is what keeps this honest: an HTML 5xx is an
     * unreachable intermediary, not a verdict on the key, and stays transient —
     * so does any other unparseable answer. Only 401 and 403 brake.
     *
     * The mint is bounded by `MINT_TIMEOUT_MS` via an `AbortController`; see that
     * constant for the hang it exists to end.
     *
     * `X-Publishable-Key` and, when a user is signed in, `Authorization: Bearer
     * <access token>` are the only headers sent. Platform and version stay on the
     * stream URL, where the connection they describe actually is.
     *
     * Resolves to the token plus whether it had to be minted anonymous because
     * the user's access token was refused even after a refresh.
     *
     * The environment is deliberately NOT sent: `?environment=` on the stream URL
     * (supplied by the features param provider) overrides the token's pinned env
     * server-side, so pinning it twice would just be a second place to drift.
     */
    private _mintStreamToken;
    private _connect;
    private _openWithToken;
    private _warnUserTokenRefused;
    private _mintAndOpen;
    private _scheduleReconnect;
    private _clearReconnect;
    private _close;
}

/**
 * Plan change after a Store Hand-back (#659) — the ONE place this SDK reacts
 * to "the buyer just bought or switched a plan".
 *
 * The hosted store / Customer Portal only closes the modal. Waiting for the
 * Event Stream left the app on the old plan for about a minute, so on every
 * successful hand-back the SDK reconciles at once:
 *   - features: a forced REST re-resolve (past the 1 s debounce),
 *   - entitlement: a re-read of `/api/sdk/auth/user` (`hasActiveAccess`).
 * A `plan_switch_pending` hand-back means Stripe has not applied the switch
 * yet, so the features are re-checked on a bounded backoff until the snapshot
 * differs from the one before the hand-back, or the delays run out.
 *
 * The live complement is the stream's `paywall.access_changed` (#635), which
 * the backend sends when the grant really changes; whichever lands first wins.
 */
/** What a container reports when a hosted page finished. Only a purchase or a
 *  switch can move the plan; every other kind is ignored. */
type PlanChange = {
    kind: 'purchase';
} | {
    kind: 'switched';
    reason: string;
};

/**
 * The exchange door, seen from the browser (#798, ADR-0032).
 *
 * An App that signs its users in with Supabase, Clerk, Firebase or any OpenID
 * Connect issuer hands the SDK a function that returns the issuer's current
 * token. `POST /api/sdk/auth/exchange` turns that token into an ordinary Onelo
 * session: a 30-minute access token and NO refresh token. Renewal is another
 * exchange with a fresh issuer token, so the SDK never reads or stores the
 * issuer's token.
 *
 * This module holds what is specific to that door: the call, what each answer
 * means for the session, and when to renew. `OneloAuth` owns the session
 * itself (storage, single-flight, the cross-tab lock, the retry backoff).
 */

/**
 * Returns the sign-in provider's current token, or nothing when no user is
 * signed in there. May answer synchronously or with a promise.
 */
type ExternalTokenGetter = () => string | null | undefined | Promise<string | null | undefined>;

declare class OneloAuth {
    /** Lets the auth/store modal answer a checkout's portal renewal (#642).
     *  Set by `Onelo` to the customer portal's `renewReply`. */
    private renewPortal;
    setPortalRenewer(fn: ((requestId: string) => Promise<Record<string, unknown>>) | null): void;
    /** Told when a hosted flow this class presented ended in a purchase or a
     *  plan switch (#659). Set by `Onelo` to its plan-change refresher. */
    private onPlanChange;
    setPlanChangeHandler(fn: ((change: PlanChange) => void) | null): void;
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
     *  Locks issues #1594/#2111). On timeout this tab never refreshes on its own
     *  (that would resend the token the holder has in flight): it adopts the
     *  holder's result if it has landed, else keeps the session and retries. */
    private static readonly REFRESH_LOCK_TIMEOUT_MS;
    /** Retry a TRANSIENT refresh failure (offline, a lost response, 429, 5xx —
     *  incl. `503 refresh_unavailable`) with backoff: 5 s, 10 s, 20 s, 40 s,
     *  then every 60 s. The session is kept. The first retry lands inside the
     *  server's 30 s refresh-token grace window, so a request whose response was
     *  lost is retried while the server still accepts that token. */
    private static readonly REFRESH_RETRY_BASE_MS;
    private static readonly REFRESH_RETRY_MAX_MS;
    private refreshRetryAttempt;
    /** Until this time (ms) getSession() does not start another refresh on its
     *  own — the scheduled retry owns it. Stops an app that reads the session
     *  often from hammering /auth/refresh during an outage. */
    private refreshBackoffUntil;
    /** The App's own sign-in provider, once handed over with useExternalToken().
     *  While set, the session is renewed by exchanging a fresh provider token
     *  (there is no refresh token) and no Onelo sign-in screen is ever shown. */
    private externalToken;
    /** True while the `storage` listener that keeps external sign-out in step
     *  across tabs is attached (#836). */
    private externalStorageListener;
    /** The last exchange was refused because the provider's token was outside
     *  its validity window (#836). Once the Onelo access token has expired too,
     *  the session ends instead of being retried forever. */
    private externalTokenStale;
    /** This tab has already told its listeners about the external sign-out, so
     *  a later renewal attempt that finds the mark stays silent (#836). */
    private externalSignOutHeard;
    /** Seconds before expiry at which the external session is renewed: set with
     *  jitter by each exchange this tab makes. */
    private externalLeadSeconds;
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
    /** The SDK's one brand-token model (#681), shared with every modal. `Onelo`
     *  passes its own; a standalone OneloAuth keeps a private one. */
    readonly brand: BrandSource;
    /** #948: the hosted form's sign-in methods for the loading skeleton. Before
     *  config (or on an older backend) the minimal shape: never a pill the page
     *  will not draw. */
    authSkeletonShape(): AuthSkeletonShape;
    constructor(config: OneloConfig, brand?: BrandSource);
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
    /** A code from a hosted flow that may have chained into the store: exchange
     *  it, then reconcile the plan at once (#659) instead of waiting for the
     *  stream — a sign-in without a purchase only costs one extra resolve. */
    private exchangeStoreCode;
    /**
     * Start the hosted flow over after the page reported its flow token spent.
     *
     * The popup the page ran in was parked by AuthModal rather than closed, so
     * the new flow reuses it instead of calling `window.open` without a user
     * gesture, which browsers block (#625). Whatever the new pass does, a popup
     * it did not adopt (it answered "authorized", or it failed) is closed here.
     */
    private restartFlow;
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
    /**
     * #818 — should your own sign-up screen show the optional Marketing Consent
     * checkbox, and with what text? Set on the parent App in Auth → Sign-up; an
     * App that sells asks at Checkout instead (`asked` false). Show `text`
     * unticked and pass the person's choice to `signUp(..., { marketingConsent })`.
     * Accurate after `whenReady()`.
     */
    getSignupMarketingConsent(): SignupMarketingConsent;
    signUp(email: string, password: string, options?: SignUpOptions): Promise<OneloSession>;
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
     *  Layer 2: a cross-tab Web Lock. Falls back to a plain refresh only where
     *  Web Locks are unavailable; a lock-wait timeout adopts the other tab's
     *  result or reports a transient `timeout` — it never resends the token. */
    refreshSession(): Promise<OneloSession | null>;
    /** Layer 2 — cross-tab exclusivity via the Web Locks API. Only one tab holds
     *  the lock at a time; the winner's `_doRefresh` reads the refresh token
     *  INSIDE the lock, so a tab that waited reads the already-rotated token (or a
     *  still-fresh one) rather than the stale token another tab just used. */
    private _refreshCoordinated;
    /** If another tab changed the stored refresh token since `seen` was read,
     *  return the outcome it left in storage: its rotated session, or null when
     *  it ended the session. `undefined` = nothing changed, this tab must act. */
    private _adoptOtherTabRefresh;
    /** The complete session in storage, or null. */
    private _storedSession;
    /** True when the stored session can be renewed: an Onelo Auth session by its
     *  refresh token, an external one (which has none) by the provider function. */
    private _hasRenewal;
    /** The stored value that changes whenever ANY tab renews the session: the
     *  refresh token rotates for Onelo Auth; an external session has only its
     *  access token. */
    private _renewalKey;
    /** How long before expiry the session is renewed. */
    private _refreshLeadSeconds;
    /**
     * Use the App's own sign-in (Supabase, Clerk, Firebase or any OpenID Connect
     * issuer) instead of Onelo Auth (#798, ADR-0032). The App's Sign-in Mode must
     * be set to that provider in the Onelo dashboard.
     *
     * `getToken` returns the provider's CURRENT token, or nothing when no user is
     * signed in there. The SDK exchanges it for an Onelo session at once, keeps
     * that session where every Module reads it, and asks `getToken` again to
     * renew it before it lapses (the session lasts 30 minutes; renewal happens
     * after about 80% of that). When `getToken` returns nothing the session ends
     * and `onAuthStateChange(null)` fires. No Onelo sign-in screen is ever shown.
     *
     * Call it once on start, and again whenever the provider's user changes
     * (sign-in, sign-out, a different account).
     *
     * Resolves to the session, or null when the provider has no user. Rejects
     * with an `OneloError` when Onelo refuses the token (`session_ended`,
     * `user_revoked`, `no_active_plan`) or cannot be reached; a failure that can
     * pass (offline, a rate limit) is retried in the background.
     */
    useExternalToken(getToken: ExternalTokenGetter): Promise<OneloSession | null>;
    /** Renew an external session: ask the provider for its current token and
     *  exchange it. The single-flight and the cross-tab lock above apply as for a
     *  refresh, so concurrent callers share one exchange. */
    private _doExternalExchange;
    /** True when an external session was signed out, in this tab or another one
     *  sharing the storage, and no new provider sign-in has happened since. */
    private _externalSignedOut;
    /** Keep this tab in step with the others (#836). The browser fires `storage`
     *  in every OTHER tab of the origin when one writes localStorage: a sign-out
     *  there ends the session here at once, and a new session written there (a
     *  new provider sign-in) is adopted and renewed here. */
    private _listenForOtherTabs;
    /** Clear the stored session and tell listeners. */
    private _endSession;
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
    /** Re-arm the refresh after a transient failure, with backoff (see
     *  REFRESH_RETRY_BASE_MS). Reset by the next saved session. */
    private _scheduleRefreshRetry;
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
     * The challenge a store magic link is paired to (#727), or null.
     *
     * The embedded store runs in an iframe whose storage the browser partitions
     * under this site, so the tab an e-mailed link opens can never read a
     * verifier the store kept. This page's own storage it can: the verifier stays
     * here (the same one-per-browser slot the hosted sign-in uses) and only its
     * challenge goes to `/store-initiate`. The link then returns through this
     * page, which proves "same browser" in `completePairedLink`. Null when the
     * verifier cannot be kept durably — the store then keeps the code screen.
     */
    storeLinkChallenge(): Promise<string | null>;
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
    /** #728: the store return's "Signing you in…" in the Branding and language
     *  of the store the buyer just left (remembered when it opened); the config
     *  is not in yet on the first tick. */
    private coverStoreReturn;
    /**
     * The store brought the buyer back to this page (#726).
     *
     * The embedded store sent this window to provider sign-in and the checkout;
     * when the purchase is done it returns here with the store's one-time code.
     * Unlike a magic-link tab this IS the app: exchange, sign in, report the
     * purchase, carry on. The code is single-use and was minted for the store
     * token this SDK opened; the backend's hosted-callback is the same exchange
     * the in-frame store uses.
     */
    private completeStoreReturn;
    /**
     * A paired magic link (#535) arrived on this page, UNSPENT.
     *
     * The link page cannot tell which browser it is in; this page can. If this
     * browser holds the verifier the requesting tab stored, it IS that browser:
     * the backend spends the link and answers with a code, and this finishes in
     * one click exactly like `onelo_code` below. If not — another browser, another
     * device, a mail scanner — the backend spends nothing and names the screen
     * where the person types the code the requesting tab shows. This tab then
     * leaves for it and signs nobody in.
     */
    private completePairedLink;
    /**
     * Send the signed-in user a fresh Email Verification link (#819).
     *
     * Only for Apps with their own screen: when the parent App requires Email
     * Verification, Onelo's hosted flow already shows "check your inbox" with a
     * resend button and hands the session back by itself. The previous link
     * stops working; at most 3 e-mails an hour (`verification_rate_limited`).
     * Throws `email_verification_off` when the App has Email verification Off.
     *
     * `redirectTo` — your own landing page (an allowed web origin) or
     * `<your-scheme>://…`; the link then carries `onelo_verify_token` for
     * `confirmEmail`. Omitted, the link opens Onelo's hosted page.
     */
    resendVerificationEmail(options?: {
        redirectTo?: string;
    }): Promise<ResendVerificationResult>;
    /**
     * Confirm the user's address with the `onelo_verify_token` your own landing
     * page received from the verification link (#819). Single use. When a
     * session is signed in on this device, it is refreshed so `isAllowedIn()`
     * opens the app without waiting for the next scheduled refresh.
     */
    confirmEmail(token: string): Promise<void>;
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
type OneloFeaturesErrorCode = 'not_authenticated' | 'not_entitled'
/** @deprecated Secure Mode is retired; the server no longer answers with it. */
 | 'secure_mode_required'
/** @deprecated Secure Mode is retired; the server no longer answers with it. */
 | 'invalid_user_hash' | 'network_error';
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
    /** The signed-in Onelo user's access token, sent as `Authorization: Bearer`
     *  on every Features call so the server knows who the user really is. Wired by
     *  `Onelo` to `auth`; without it the calls carry no token. */
    userToken?: UserTokenSource;
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
    private readonly userToken;
    private userTokenRefusedWarned;
    private loadGeneration;
    private readonly instanceId;
    private monitor;
    private suppressIdentifyWarning;
    private readonly defaultStatus;
    private changeListeners;
    private anonymousWarningLogged;
    private stream;
    private firstEventReceived;
    private confirmedGeneration;
    private confirmedUserId;
    private confirmedVersion;
    private snapshotConfirmed;
    private readonly readyWaiters;
    private lastRefreshAt;
    private identityLoaded;
    private streamConnection;
    private streamConnectionGeneration;
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
     * live updates whenever an admin clicks Deploy in the dashboard.
     *
     * @param _userIdHash Deprecated and ignored: Secure Mode is retired, and the
     *   signed-in Onelo user is proven with their access token automatically. */
    load(userId: string | null, _userIdHash?: string | null): Promise<void>;
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
    /** A comparable picture of the current snapshot — the plan-change refresher
     *  (#659) re-checks until it differs. @internal */
    snapshotKey(): string;
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
    moduleToken(slug: string): Promise<string>;
    /** Signals all pending ready() callers that the first snapshot arrived.
     * Idempotent — subsequent calls are no-ops. Parity with Swift
     * `_signalFirstEvent`. */
    private _signalFirstEvent;
    private _scheduleBatchPing;
    private _batchPing;
    private _resolve;
    /** The server refused the signed-in user's access token even after a refresh,
     *  so the call went out anonymous. Features has no error callback; this
     *  one-time warning is its error channel (like the anonymous-mode warning). */
    private _warnUserTokenRefused;
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
    _onGlobalError(message: string, stack?: string, origin?: ErrorOrigin): void;
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
    /** The signed-in Onelo user's access token (#820). Wired by `Onelo` to
     *  `auth`; with a session the initiate call carries it and the report names
     *  a verified reporter. Absent, the call is exactly as before. */
    private readonly userToken?;
    /** The SDK's brand-token model (#681). `Onelo` shares its own. */
    private brand;
    setBrandSource(brand: BrandSource): void;
    constructor(apiUrl: string, publishableKey: string, getActiveFeatures: () => string[], 
    /** The signed-in Onelo user's access token (#820). Wired by `Onelo` to
     *  `auth`; with a session the initiate call carries it and the report names
     *  a verified reporter. Absent, the call is exactly as before. */
    userToken?: UserTokenSource | undefined);
    open(options?: FeedbackOptions): Promise<void>;
    /** Mint a hosted feedback URL (and with it a fresh reporter token `ft`). */
    private initiate;
    /**
     * Answer the hosted form's `onelo:renew_request` (kind `feedback`, #622). The
     * form's reporter token `ft` lives 30 minutes; a form left open longer asks
     * for a fresh one on submit. The same options are initiated again, so the
     * report keeps its reporter, type, area and session.
     */
    renewReply(requestId: string, options: FeedbackOptions): Promise<Record<string, unknown>>;
    private _openModal;
}

declare class OneloPaywall {
    private apiUrl;
    private publishableKey;
    private getAccessToken;
    private onSession;
    private getSession;
    private storeLinkChallenge;
    private renewPortal;
    /** The SDK's brand-token model (#681). `Onelo` shares its own. */
    private brand;
    setBrandSource(brand: BrandSource): void;
    constructor(apiUrl: string, publishableKey: string, getAccessToken: () => Promise<string | null>, onSession: (session: OneloSession) => Promise<void>, 
    /** Reads the current session back — `openStore()` resolves with it when the
     *  store finishes a plan switch that has no code to exchange (#599). */
    getSession?: () => Promise<OneloSession | null>, 
    /** #727: the challenge a store magic link is paired to; its verifier stays
     *  in this page's storage (`OneloAuth.storeLinkChallenge`). */
    storeLinkChallenge?: () => Promise<string | null>);
    /** Lets the store modal answer a checkout's portal renewal (#642). Set by
     *  `Onelo` to the customer portal's `renewReply`. */
    setPortalRenewer(fn: ((requestId: string) => Promise<Record<string, unknown>>) | null): void;
    /** Told when the store ended in a purchase or a plan switch (#659). Set by
     *  `Onelo` to its plan-change refresher. */
    private onPlanChange;
    setPlanChangeHandler(fn: ((change: PlanChange) => void) | null): void;
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
    private initiateStore;
    /** Shared tail for store-initiate: present the hosted /store/hosted page (which
     *  postMessages `onelo:code`), exchange the code for a session via
     *  hosted-callback, and hand it to auth. */
    private _completeHostedCheckout;
    /**
     * Opens the hosted manage page (upgrade, cancel, payment method).
     * Returns the new plan string if the user changed their plan, or null if closed without changes.
     */
    openManage(lang?: string): Promise<string | null>;
    private initiateManage;
    /**
     * Answer the hosted manage page's `onelo:renew_request` (kind `manage`,
     * #621). The manage token lives 15 minutes; a page left open past that asks
     * this SDK for a fresh manage URL. The user is still signed in here, so a new
     * one is minted through manage-initiate with their own access token —
     * nothing revives the dead token. Signed out → `not_authenticated`, and the
     * page shows its branded "signed out" screen.
     */
    manageRenewReply(requestId: string, lang?: string): Promise<Record<string, unknown>>;
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
    join(slug: string | undefined, email: string, 
    /** #818: the checkboxes your form showed — `{ consent: { marketing, custom } }`. */
    options?: WaitlistJoinOptions): Promise<{
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
    /** The SDK's brand-token model (#681). `Onelo` shares its own. */
    private brand;
    setBrandSource(brand: BrandSource): void;
    constructor(apiUrl: string, publishableKey: string, getAccessToken: () => Promise<string | null>, onSessionInvalidated?: () => void);
    /** Told when the store opened from the portal ended in a purchase or a plan
     *  switch (#659). Set by `Onelo` to its plan-change refresher. */
    private onPlanChange;
    setPlanChangeHandler(fn: ((change: PlanChange) => void) | null): void;
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
    /**
     * The upsell tap of an entitled user (#670): ask the backend where the
     * upgrade goes — `/upgrade-initiate`, the same `resolve_upgrade_destination`
     * the hosted portal's `/portal-upgrade` asks — and open that answer directly:
     * the plan-switch picker, the store for a first real purchase, or the portal's
     * explanation when plan changes are unavailable. It used to open the Customer
     * Portal page and let THAT page ask, which put a whole hosted page (server
     * render + hydrate) in front of the store: about 13 s of "Opening plans…".
     *
     * Shown in the portal's own modal, so everything the portal flow had holds:
     * the store's hand-back closes it and reconciles the plan (#615, #659), its
     * checkout's portal renewal is answered (#642), and a dead store link is
     * replaced by a fresh one in the same modal (#619). No `plan` is sent: on web
     * the buyer picks in the store (browse mode), as before.
     *
     * @internal Used by {@link Onelo.openUpgrade}.
     * @throws OneloError `not_authenticated` when signed out or the access token
     *   is refused; `server_error` carrying the backend's code on any other refusal
     *   (e.g. `in_app_store_not_allowed`). Nothing is opened in either case.
     */
    openUpgrade(): Promise<void>;
    /** GET upgrade-initiate with the user's access token → the resolved URL. */
    private initiateUpgrade;
    /** GET portal-initiate with the user's access token → the hosted URL. */
    private initiate;
    /**
     * Answer the hosted portal's `onelo:renew_request` (#613 / #614). The portal
     * page's token lives ten minutes; when an action meets a dead one, the page
     * asks this SDK for a fresh portal and repeats the action. The user is still
     * signed in here, so a new portal is minted with their own access token —
     * nothing revives the dead token. Signed out → `renew_failed`, and the page
     * shows its branded "signed out" screen.
     */
    renewReply(requestId: string): Promise<Record<string, unknown>>;
    /**
     * @param opts.reinitiate  Mints a fresh URL for this surface. When given, a
     *   dead link handed back by the page (`onelo:cancel` reason `expired`, #619)
     *   is replaced in the same iframe instead of closing the modal. A portal
     *   needs none: its store re-enters through the portal renewal (#614).
     */
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

/**
 * Affiliate referral capture for apps with the Onelo SDK (#929).
 *
 * The app captures the referral itself: no paste-in script is needed. A visitor
 * arrives with `?ref=<code>` (an Affiliate linking straight to the app) or
 * `?onelo_click=<id>` (forwarded by Onelo's tracked link after consent there).
 *
 * Consent comes first. Call `capture({ consent })` once the visitor answered
 * your cookie question:
 *   - `consent: false` stores nothing on the device; a `?ref=` only adds one
 *     to the Affiliate's anonymous total.
 *   - `consent: true` keeps the click in localStorage (`onelo_aff`). Which of
 *     two clicks stays is the program's winner rule, decided by Onelo.
 * When a user is signed in (now or later), the kept click is tied to them, so
 * any purchase they make is attributed, whichever checkout opens.
 */
declare const AFFILIATE_STORAGE_KEY = "onelo_aff";
declare class OneloAffiliates {
    private readonly apiUrl;
    private readonly publishableKey;
    private readonly getSession;
    constructor(apiUrl: string, publishableKey: string, getSession: () => Promise<{
        accessToken: string;
        user: {
            id: string;
        };
    } | null>);
    /** The referral in the current address, if any. */
    private fromLocation;
    /**
     * Capture the referral after the visitor's cookie answer. Stores nothing
     * without consent. Answers whether a referral is now kept on this device.
     */
    capture({ consent }: {
        consent: boolean;
    }): Promise<{
        kept: boolean;
    }>;
    /** Tie the kept click to the signed-in user once. Called on every sign-in. */
    claimForSession(): Promise<void>;
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
    /** Affiliate referral capture (#929): call `affiliates.capture({ consent })`. */
    readonly affiliates: OneloAffiliates;
    private authUnsubscribe;
    private readonly eventStream;
    private readonly planChange;
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
     * @deprecated The signed-in Onelo user is used automatically: Features calls
     * prove them with their access token. `userIdHash` is ignored (Secure Mode is
     * retired). Kept so existing code compiles.
     */
    identify(userId: string, userIdHash?: string): Promise<void>;
    /**
     * Open the upgrade flow for a plan-blocked feature — call it when the user taps
     * a gated tile whose `feature.upgradeCta` is set. Routes by billing state:
     *   - entitled user → straight to where the backend resolves the upgrade
     *     (`/upgrade-initiate`, the same decision as every other SDK): the plan
     *     picker for a subscriber, the store for a free-tier user's first
     *     purchase, or the portal's explanation when plan changes are off. Opened
     *     in the Customer Portal's modal; no portal page in front of it (#670).
     *   - otherwise → `paywall.openStore()` (pick + buy a plan).
     *
     * `plan` is accepted for cross-platform call-site parity (Swift/Electron/RN pass
     * `feature.requiredPlan`); on web the buyer picks in the store, so it is
     * advisory only. The resulting plan change is reconciled the moment the page
     * hands back (#659) and fires `features.subscribe()`. Requires a signed-in
     * Onelo Auth user.
     */
    openUpgrade(_plan?: string): Promise<void>;
    /** Release background timers. Call when the SDK instance is no longer needed. */
    destroy(): void;
}

export { AFFILIATE_STORAGE_KEY, type AuthPresentMode, type BrandTokens, type ExternalTokenGetter, type FeatureReason, FeatureState, type FeatureStatus, type FeedbackOptions, type MonitorContext, type MonitorEventOptions, Onelo, OneloAffiliates, type OneloConfig, OneloConsent, type OneloConsentEnforcement, type OneloConsentRequirement, OneloCustomerPortal, type OneloEntitlement, OneloError, OneloFeatures, OneloFeaturesError, type OneloFeaturesErrorCode, OneloFeedback, OneloForms, OneloMonitor, OneloPaywall, type OneloSession, type OneloUser, OneloWaitlist, type SignUpOptions, type SignupMarketingConsent, type UpgradeHint, type WaitlistConsent, type WaitlistJoinOptions };
