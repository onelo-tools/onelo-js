import { OneloConfig, OneloSession } from '@onelo/core';
export { OneloConfig, OneloError, OneloSession, OneloUser } from '@onelo/core';

declare class OneloAuth {
    private storage;
    private apiUrl;
    private publishableKey;
    private pkceVerifier;
    private resolvedConfig;
    private initPromise;
    private authStateListeners;
    isReady: boolean;
    isRevoked: boolean;
    allowCustomBranding: boolean;
    appName: string;
    appLogoUrl: string | null;
    constructor(config: OneloConfig);
    private initialize;
    whenReady(): Promise<void>;
    loadAuthView(): Promise<OneloSession | null>;
    private getHostedUrl;
    signIn(email: string, password: string): Promise<OneloSession>;
    signUp(email: string, password: string): Promise<OneloSession>;
    signOut(): Promise<void>;
    getSession(): Promise<OneloSession | null>;
    refreshSession(): Promise<OneloSession | null>;
    onAuthStateChange(callback: (session: OneloSession | null) => void): () => void;
    private saveSession;
    private notifyListeners;
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
declare class OneloFeatures {
    private readonly apiUrl;
    private readonly publishableKey;
    private cache;
    private discoveredNames;
    private configVersion;
    private pollTimer;
    private pingDebounce;
    private currentUserId;
    constructor(apiUrl: string, publishableKey: string);
    /** Declare feature names upfront — triggers a batch-ping immediately. */
    declare(names: string[]): void;
    /** Returns the current state for a feature. Auto-registers on first call. */
    feature(name: string): FeatureState;
    /** Load features for a user (or anonymous). Called by Onelo orchestrator. */
    load(userId: string | null): Promise<void>;
    /** Stop background polling. Call when SDK is no longer needed. */
    stopPolling(): void;
    private _scheduleBatchPing;
    private _batchPing;
    private _resolve;
    private _poll;
    private _startPolling;
}

declare class Onelo {
    readonly auth: OneloAuth;
    readonly features: OneloFeatures;
    private authUnsubscribe;
    constructor(config: OneloConfig);
    /** Only needed when NOT using Onelo Auth (own auth system). */
    identify(userId: string): Promise<void>;
    /** Release background timers. Call when the SDK instance is no longer needed. */
    destroy(): void;
}

export { FeatureState, type FeatureStatus, Onelo, OneloFeatures };
