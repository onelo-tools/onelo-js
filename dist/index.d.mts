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

declare class Onelo {
    readonly auth: OneloAuth;
    constructor(config: OneloConfig);
}

export { Onelo };
