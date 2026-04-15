"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OneloAuth = void 0;
const pkce_1 = require("../core/pkce");
const http_1 = require("../core/http");
const storage_1 = require("../core/storage");
const auth_modal_1 = require("./auth-modal");
const types_1 = require("../core/types");
const package_json_1 = require("../../package.json");
class OneloAuth {
    constructor(config) {
        this.pkceVerifier = null;
        this.resolvedConfig = null;
        this.authStateListeners = [];
        this.isReady = false;
        this.isRevoked = false;
        this.allowCustomBranding = false;
        this.appName = 'App';
        this.appLogoUrl = null;
        if (!config.apiUrl)
            throw new Error('[Onelo] apiUrl is required');
        if (!config.publishableKey)
            throw new Error('[Onelo] publishableKey is required');
        this.apiUrl = config.apiUrl;
        this.publishableKey = config.publishableKey;
        this.storage = new storage_1.TokenStorage();
        this.initPromise = this.initialize();
    }
    async initialize() {
        try {
            const verifier = (0, pkce_1.generateCodeVerifier)();
            this.pkceVerifier = verifier;
            const challenge = await (0, pkce_1.generateCodeChallenge)(verifier);
            const url = `${this.apiUrl}/api/sdk/config?key=${encodeURIComponent(this.publishableKey)}&code_challenge=${encodeURIComponent(challenge)}`;
            const { status, json } = await (0, http_1.httpGet)(url, { 'X-SDK-Version': package_json_1.version });
            if (status === 401 || status === 404)
                throw types_1.OneloError.invalidKey('Server rejected the key');
            if (status !== 200)
                throw types_1.OneloError.server(`Config request failed: HTTP ${status}`);
            const j = json;
            this.resolvedConfig = {
                supabaseUrl: j['supabase_url'],
                supabaseAnonKey: j['supabase_anon_key'],
                tenantId: j['tenant_id'],
                allowCustomBranding: j['allow_custom_branding'] ?? false,
                appName: j['app_name'] ?? null,
                appLogoUrl: j['app_logo_url'] ?? null,
            };
            this.allowCustomBranding = this.resolvedConfig.allowCustomBranding;
            if (this.resolvedConfig.appName)
                this.appName = this.resolvedConfig.appName;
            this.appLogoUrl = this.resolvedConfig.appLogoUrl;
            this.isReady = true;
        }
        catch (e) {
            if (e instanceof types_1.OneloError && e.code === 'invalid_publishable_key') {
                this.isRevoked = true;
            }
        }
    }
    async whenReady() {
        await this.initPromise;
    }
    // ── Hosted flow ─────────────────────────────────────────────────────────────
    async loadAuthView() {
        await this.initPromise;
        if (this.isRevoked)
            throw types_1.OneloError.invalidKey('Application key has been revoked');
        const hostedUrl = await this.getHostedUrl();
        const modal = new auth_modal_1.AuthModal(this.apiUrl);
        const result = await modal.open(hostedUrl);
        if (result.type === 'cancelled')
            return null;
        if (result.type === 'error')
            throw types_1.OneloError.server(result.message);
        const { status, json } = await (0, http_1.httpPost)(`${this.apiUrl}/api/sdk/auth/hosted-callback`, { publishableKey: this.publishableKey, code: result.code }, { 'X-SDK-Version': package_json_1.version });
        if (status !== 200)
            throw types_1.OneloError.server('Hosted callback failed');
        const session = this.mapSession(json);
        await this.saveSession(session);
        return session;
    }
    async getHostedUrl() {
        const { status, json } = await (0, http_1.httpGet)(`${this.apiUrl}/api/sdk/auth/initiate?key=${encodeURIComponent(this.publishableKey)}&callback_scheme=onelo-callback`, { 'X-SDK-Version': package_json_1.version });
        if (status !== 200)
            throw types_1.OneloError.server('Failed to initiate hosted auth flow');
        const j = json;
        const hostedUrl = j['hosted_url'];
        if (!hostedUrl)
            throw types_1.OneloError.server('Invalid initiate response');
        if (j['app_name'])
            this.appName = j['app_name'];
        if (j['app_logo_url'])
            this.appLogoUrl = j['app_logo_url'];
        return hostedUrl;
    }
    // ── Custom UI (paid plans only) ─────────────────────────────────────────────
    async signIn(email, password) {
        await this.initPromise;
        if (!this.allowCustomBranding)
            throw types_1.OneloError.planRequired();
        if (!this.pkceVerifier)
            this.pkceVerifier = (0, pkce_1.generateCodeVerifier)();
        const { status, json } = await (0, http_1.httpPost)(`${this.apiUrl}/api/sdk/auth/signin`, { email, password, publishableKey: this.publishableKey, code_verifier: this.pkceVerifier }, { 'X-SDK-Version': package_json_1.version });
        (0, http_1.checkHostedFlowRequired)(json);
        const j = json;
        if (status === 403) {
            const detail = j['detail'];
            if (detail?.['error'] === 'user_revoked')
                throw types_1.OneloError.userRevoked();
            throw types_1.OneloError.server((detail?.['message'] ?? j['error']));
        }
        if (status !== 200)
            throw types_1.OneloError.server(`Sign in failed: HTTP ${status}`);
        this.pkceVerifier = null;
        const session = this.mapSession(j);
        await this.saveSession(session);
        return session;
    }
    async signUp(email, password) {
        await this.initPromise;
        if (!this.allowCustomBranding)
            throw types_1.OneloError.planRequired();
        if (!this.pkceVerifier)
            this.pkceVerifier = (0, pkce_1.generateCodeVerifier)();
        const { status, json } = await (0, http_1.httpPost)(`${this.apiUrl}/api/sdk/auth/signup`, { email, password, publishableKey: this.publishableKey, code_verifier: this.pkceVerifier }, { 'X-SDK-Version': package_json_1.version });
        (0, http_1.checkHostedFlowRequired)(json);
        const j = json;
        if (status !== 200)
            throw types_1.OneloError.server(`Sign up failed: HTTP ${status}`);
        this.pkceVerifier = null;
        const session = this.mapSession(j);
        await this.saveSession(session);
        return session;
    }
    // ── Session management ──────────────────────────────────────────────────────
    async signOut() {
        await this.storage.clear();
        this.notifyListeners(null);
    }
    async getSession() {
        const [accessToken, refreshToken, expiresAtStr, userJson] = await Promise.all([
            this.storage.get(storage_1.TOKEN_KEYS.ACCESS_TOKEN),
            this.storage.get(storage_1.TOKEN_KEYS.REFRESH_TOKEN),
            this.storage.get(storage_1.TOKEN_KEYS.EXPIRES_AT),
            this.storage.get(storage_1.TOKEN_KEYS.USER_JSON),
        ]);
        if (!accessToken || !refreshToken || !userJson)
            return null;
        const expiresAt = parseInt(expiresAtStr ?? '0', 10);
        if (Date.now() / 1000 > expiresAt - 60) {
            return this.refreshSession();
        }
        return { accessToken, refreshToken, expiresAt, user: JSON.parse(userJson) };
    }
    async refreshSession() {
        const refreshToken = await this.storage.get(storage_1.TOKEN_KEYS.REFRESH_TOKEN);
        if (!refreshToken)
            return null;
        const { status, json } = await (0, http_1.httpPost)(`${this.apiUrl}/api/sdk/auth/refresh`, { publishableKey: this.publishableKey, refreshToken }, { 'X-SDK-Version': package_json_1.version });
        (0, http_1.checkHostedFlowRequired)(json);
        const j = json;
        if (j['error'] === 'user_revoked') {
            await this.storage.clear();
            this.notifyListeners(null);
            throw types_1.OneloError.userRevoked();
        }
        if (j['error'] === 'app_revoked') {
            await this.storage.clear();
            this.notifyListeners(null);
            throw types_1.OneloError.revoked();
        }
        if (status !== 200) {
            await this.storage.clear();
            this.notifyListeners(null);
            return null;
        }
        const session = this.mapSession(j);
        await this.saveSession(session);
        return session;
    }
    onAuthStateChange(callback) {
        this.authStateListeners.push(callback);
        return () => {
            this.authStateListeners = this.authStateListeners.filter(l => l !== callback);
        };
    }
    // ── Helpers ─────────────────────────────────────────────────────────────────
    mapSession(j) {
        const user = j['user'];
        const appMeta = user?.['app_metadata'] ?? {};
        return {
            accessToken: j['access_token'],
            refreshToken: j['refresh_token'],
            expiresAt: j['expires_at'] ?? 0,
            user: {
                id: user['id'],
                email: user['email'],
                role: (appMeta['user_role'] ?? user['role'] ?? 'member'),
                tenantId: (appMeta['tenant_id'] ?? user['tenant_id']) ?? null,
            },
        };
    }
    async saveSession(session) {
        await Promise.all([
            this.storage.set(storage_1.TOKEN_KEYS.ACCESS_TOKEN, session.accessToken),
            this.storage.set(storage_1.TOKEN_KEYS.REFRESH_TOKEN, session.refreshToken),
            this.storage.set(storage_1.TOKEN_KEYS.EXPIRES_AT, String(session.expiresAt)),
            this.storage.set(storage_1.TOKEN_KEYS.USER_JSON, JSON.stringify(session.user)),
        ]);
        this.notifyListeners(session);
    }
    notifyListeners(session) {
        for (const cb of this.authStateListeners)
            cb(session);
    }
}
exports.OneloAuth = OneloAuth;
//# sourceMappingURL=auth.js.map