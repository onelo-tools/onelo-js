/**
 * PKCE helpers using Web Crypto API (browser-native, no dependencies).
 */
export declare function generateCodeVerifier(): string;
export declare function generateCodeChallenge(verifier: string): Promise<string>;
//# sourceMappingURL=pkce.d.ts.map