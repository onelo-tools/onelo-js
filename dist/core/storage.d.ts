import { TOKEN_KEYS, type TokenKey } from '@onelo/core';
export { TOKEN_KEYS, type TokenKey };
/**
 * Token storage using localStorage with in-memory fallback
 * (for environments where localStorage is unavailable, e.g. SSR).
 */
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