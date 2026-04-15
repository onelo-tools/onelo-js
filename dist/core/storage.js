"use strict";
/**
 * Token storage using localStorage with in-memory fallback
 * (for environments where localStorage is unavailable, e.g. SSR).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TokenStorage = exports.TOKEN_KEYS = void 0;
exports.TOKEN_KEYS = {
    ACCESS_TOKEN: 'onelo_access_token',
    REFRESH_TOKEN: 'onelo_refresh_token',
    EXPIRES_AT: 'onelo_expires_at',
    USER_JSON: 'onelo_user',
};
class TokenStorage {
    constructor() {
        this.memory = new Map();
        this.useLocalStorage = typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
    }
    async get(key) {
        if (this.useLocalStorage) {
            return localStorage.getItem(key);
        }
        return this.memory.get(key) ?? null;
    }
    async set(key, value) {
        if (this.useLocalStorage) {
            localStorage.setItem(key, value);
        }
        else {
            this.memory.set(key, value);
        }
    }
    async delete(key) {
        if (this.useLocalStorage) {
            localStorage.removeItem(key);
        }
        else {
            this.memory.delete(key);
        }
    }
    async clear() {
        if (this.useLocalStorage) {
            for (const key of Object.values(exports.TOKEN_KEYS)) {
                localStorage.removeItem(key);
            }
        }
        else {
            this.memory.clear();
        }
    }
}
exports.TokenStorage = TokenStorage;
//# sourceMappingURL=storage.js.map