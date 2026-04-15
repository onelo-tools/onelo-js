"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TokenStorage = exports.TOKEN_KEYS = void 0;
const core_1 = require("@onelo/core");
Object.defineProperty(exports, "TOKEN_KEYS", { enumerable: true, get: function () { return core_1.TOKEN_KEYS; } });
/**
 * Token storage using localStorage with in-memory fallback
 * (for environments where localStorage is unavailable, e.g. SSR).
 */
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
            for (const key of Object.values(core_1.TOKEN_KEYS)) {
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