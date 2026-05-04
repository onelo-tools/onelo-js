import * as _onelo_core from '@onelo/core';
import { OneloConfig, OneloSession } from '@onelo/core';
export { OneloConfig, OneloError, OneloSession, OneloUser } from '@onelo/core';

declare class OneloAuth {
    private storage;
    private apiUrl;
    private publishableKey;
    private pkceVerifier;
    private resolvedConfig;
    private heartbeatTimer;
    private static readonly HEARTBEAT_MS;
    private initPromise;
    private authStateListeners;
    isReady: boolean;
    isRevoked: boolean;
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
    loadAuthView(openStore?: () => Promise<OneloSession | null>): Promise<OneloSession | null>;
    private getHostedUrl;
    signIn(email: string, password: string): Promise<OneloSession>;
    signUp(email: string, password: string): Promise<OneloSession>;
    signOut(): Promise<void>;
    getSession(): Promise<OneloSession | null>;
    refreshSession(): Promise<OneloSession | null>;
    onAuthStateChange(callback: (session: OneloSession | null) => void): () => void;
    private startHeartbeat;
    private stopHeartbeat;
    private saveSession;
    private notifyListeners;
    /** Import a session obtained outside of OneloAuth (e.g. from paywall flow). Saves tokens and notifies listeners. */
    importSession(session: OneloSession): Promise<void>;
    sendMagicLink(email: string, redirectTo?: string): Promise<void>;
    sendPasswordReset(email: string, redirectTo?: string): Promise<void>;
}

type FeatureStatus = 'enabled' | 'disabled' | 'greyed' | 'hidden' | 'upsell' | 'new' | 'beta' | 'coming_soon';
declare class FeatureState {
    readonly name: string;
    readonly status: FeatureStatus;
    constructor(name: string, status: FeatureStatus);
    get isEnabled(): boolean;
    get isDisabled(): boolean;
    get isVisible(): boolean;
    get isGreyed(): boolean;
    get isUpsell(): boolean;
    get isNew(): boolean;
    get isBeta(): boolean;
    get isComingSoon(): boolean;
    get badgeLabel(): string | null;
}
interface OneloFeaturesOptions {
    /** Suppress the anonymous-mode identify() warning. See OneloConfig.suppressIdentifyWarning. */
    suppressIdentifyWarning?: boolean;
}
declare class OneloFeatures {
    private readonly apiUrl;
    private readonly publishableKey;
    private cache;
    private discoveredNames;
    private configVersion;
    private pollTimer;
    private pingDebounce;
    private currentUserId;
    private monitor;
    private suppressIdentifyWarning;
    private anonymousWarningLogged;
    constructor(apiUrl: string, publishableKey: string, monitor?: {
        _trackFeatureCall: (name: string) => void;
    }, options?: OneloFeaturesOptions);
    /** Declare feature names upfront — triggers a batch-ping immediately. */
    declare(names: string[]): void;
    /** Returns the current state for a feature. Auto-registers on first call. */
    feature(name: string): FeatureState;
    /** Load features for a user (or anonymous). Called by Onelo orchestrator. */
    load(userId: string | null): Promise<void>;
    /** Returns names of all features with an active status (enabled, new, or beta). */
    getActiveFeatures(): string[];
    /** Stop background polling. Call when SDK is no longer needed. */
    stopPolling(): void;
    /** Clears the local feature cache and resets the config version. The next feature() call will re-fetch. */
    invalidateCache(): void;
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
    private _poll;
    private _startPolling;
}

interface MonitorEventOptions {
    ok: boolean;
    durationMs?: number;
    error?: string;
    meta?: Record<string, unknown>;
}
declare class OneloMonitor {
    private readonly publishableKey;
    private readonly apiUrl;
    private readonly sessionId;
    private buffer;
    private flushTimer;
    private currentUserId;
    constructor(publishableKey: string, apiUrl: string);
    /** Sets the current user ID attached to all subsequent monitor events. Call after login/logout if not using Onelo Auth. */
    setUserId(userId: string | null): void;
    _trackFeatureCall(featureName: string): void;
    track<T>(featureName: string, fn: () => Promise<T> | T, options?: {
        meta?: Record<string, unknown>;
    }): Promise<T>;
    event(featureName: string, opts: MonitorEventOptions): void;
    flush(): Promise<void>;
    destroy(): void;
    private _push;
    private _registerGlobalHandlers;
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
    check(requiredPlan: string, userPlan?: string): boolean;
    /**
     * Opens the hosted store page (plan selection + registration + payment).
     * Returns the session on success, or null if the user cancelled.
     */
    openStore(lang?: string): Promise<OneloSession | null>;
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

declare class Onelo {
    readonly auth: OneloAuth;
    readonly features: OneloFeatures;
    readonly monitor: OneloMonitor;
    readonly feedback: OneloFeedback;
    readonly paywall: OneloPaywall;
    readonly forms: OneloForms;
    readonly waitlist: OneloWaitlist;
    private authUnsubscribe;
    constructor(config: OneloConfig);
    /**
     * Open the sign-in flow. Automatically routes based on app config:
     * - waitlist_mode + sdk_redirect_url → opens developer's waitlist/store page
     * - paywall_enabled → opens hosted store (plan selection + registration)
     * - otherwise → opens hosted sign-in
     */
    loadAuthView(): Promise<_onelo_core.OneloSession | null>;
    /** Only needed when NOT using Onelo Auth (own auth system). */
    identify(userId: string): Promise<void>;
    /** Release background timers. Call when the SDK instance is no longer needed. */
    destroy(): void;
}

export { FeatureState, type FeatureStatus, type FeedbackOptions, type MonitorEventOptions, Onelo, OneloFeatures, OneloFeedback, OneloForms, OneloMonitor, OneloPaywall, OneloWaitlist };
