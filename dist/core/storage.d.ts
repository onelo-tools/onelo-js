/**
 * Token storage using localStorage with in-memory fallback
 * (for environments where localStorage is unavailable, e.g. SSR).
 */
export declare const TOKEN_KEYS: {
    readonly ACCESS_TOKEN: "onelo_access_token";
    readonly REFRESH_TOKEN: "onelo_refresh_token";
    readonly EXPIRES_AT: "onelo_expires_at";
    readonly USER_JSON: "onelo_user";
};
export type TokenKey = typeof TOKEN_KEYS[keyof typeof TOKEN_KEYS];
export declare class TokenStorage {
    private memory;
    private useLocalStorage;
    constructor();
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
    clear(): Promise<void>;
}
//# sourceMappingURL=storage.d.ts.map