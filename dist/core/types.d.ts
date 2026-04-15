export type UserRole = 'platform_owner' | 'creator' | 'member';
export interface OneloUser {
    id: string;
    email: string | undefined;
    role: UserRole;
    tenantId: string | null;
}
export interface OneloSession {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    user: OneloUser;
}
export interface OneloConfig {
    /** Publishable key from Onelo dashboard (onelo_pk_live_...) */
    publishableKey: string;
    /** Onelo API base URL — required. Get this from your Onelo dashboard snippet. */
    apiUrl: string;
}
export interface ResolvedSDKConfig {
    supabaseUrl: string;
    supabaseAnonKey: string;
    tenantId: string;
    allowCustomBranding: boolean;
    appName: string | null;
    appLogoUrl: string | null;
}
export declare class OneloError extends Error {
    readonly code: 'not_authenticated' | 'hosted_flow_required' | 'invalid_publishable_key' | 'network_error' | 'server_error' | 'cancelled' | 'revoked' | 'user_revoked' | 'plan_required';
    constructor(code: 'not_authenticated' | 'hosted_flow_required' | 'invalid_publishable_key' | 'network_error' | 'server_error' | 'cancelled' | 'revoked' | 'user_revoked' | 'plan_required', message: string);
    static notAuthenticated(): OneloError;
    static hostedFlowRequired(): OneloError;
    static planRequired(): OneloError;
    static invalidKey(msg: string): OneloError;
    static network(msg: string): OneloError;
    static server(msg: string): OneloError;
    static cancelled(): OneloError;
    static revoked(): OneloError;
    static userRevoked(): OneloError;
}
//# sourceMappingURL=types.d.ts.map