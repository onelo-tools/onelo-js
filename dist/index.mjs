// src/auth/auth.ts
import { generateCodeVerifier, generateCodeChallenge } from "@onelo/core";
import { httpGet, httpPost, checkHostedFlowRequired } from "@onelo/core";
import { mapSession } from "@onelo/core";

// src/core/storage.ts
import { TOKEN_KEYS } from "@onelo/core";
var TokenStorage = class {
  constructor() {
    this.memory = /* @__PURE__ */ new Map();
    this.useLocalStorage = typeof window !== "undefined" && typeof window.localStorage !== "undefined";
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
    } else {
      this.memory.set(key, value);
    }
  }
  async delete(key) {
    if (this.useLocalStorage) {
      localStorage.removeItem(key);
    } else {
      this.memory.delete(key);
    }
  }
  async clear() {
    if (this.useLocalStorage) {
      for (const key of Object.values(TOKEN_KEYS)) {
        localStorage.removeItem(key);
      }
    } else {
      this.memory.clear();
    }
  }
};

// src/auth/auth-modal.ts
var AuthModal = class {
  constructor(apiUrl) {
    this.overlay = null;
    this.messageHandler = null;
    this.allowedOrigin = new URL(apiUrl).origin;
  }
  open(hostedUrl) {
    return new Promise((resolve) => {
      this.overlay = this.buildOverlay(hostedUrl);
      document.body.appendChild(this.overlay);
      this.messageHandler = (e) => {
        if (e.origin !== this.allowedOrigin) return;
        const data = e.data;
        if (data?.type === "onelo:code" && typeof data.code === "string") {
          this.close();
          resolve({ type: "code", code: data.code });
        } else if (data?.type === "onelo:cancel") {
          this.close();
          resolve({ type: "cancelled" });
        } else if (data?.type === "onelo:error") {
          this.close();
          resolve({ type: "error", message: String(data.message ?? "Auth error") });
        }
      };
      window.addEventListener("message", this.messageHandler);
      const cancelBtn = this.overlay.querySelector("[data-onelo-cancel]");
      cancelBtn?.addEventListener("click", () => {
        this.close();
        resolve({ type: "cancelled" });
      });
    });
  }
  close() {
    if (this.messageHandler) {
      window.removeEventListener("message", this.messageHandler);
      this.messageHandler = null;
    }
    this.overlay?.remove();
    this.overlay = null;
  }
  buildOverlay(hostedUrl) {
    const overlay = document.createElement("div");
    overlay.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:2147483647",
      "background:rgba(0,0,0,0.75)",
      "display:flex",
      "align-items:center",
      "justify-content:center"
    ].join(";");
    const container = document.createElement("div");
    container.style.cssText = [
      "position:relative",
      "width:480px",
      "height:640px",
      "border-radius:12px",
      "overflow:hidden",
      "background:#111"
    ].join(";");
    const iframe = document.createElement("iframe");
    iframe.src = hostedUrl;
    iframe.style.cssText = "width:100%;height:100%;border:none;";
    iframe.setAttribute("sandbox", "allow-scripts allow-forms allow-same-origin allow-popups");
    const cancelBtn = document.createElement("button");
    cancelBtn.setAttribute("data-onelo-cancel", "");
    cancelBtn.textContent = "\u2715";
    cancelBtn.style.cssText = [
      "position:absolute",
      "top:10px",
      "right:12px",
      "background:transparent",
      "border:none",
      "color:rgba(255,255,255,0.5)",
      "font-size:18px",
      "cursor:pointer",
      "line-height:1",
      "padding:4px"
    ].join(";");
    container.appendChild(iframe);
    container.appendChild(cancelBtn);
    overlay.appendChild(container);
    return overlay;
  }
};

// src/auth/auth.ts
import {
  OneloError
} from "@onelo/core";

// package.json
var version = "0.2.0-staging";

// src/auth/auth.ts
var OneloAuth = class {
  constructor(config) {
    this.pkceVerifier = null;
    this.resolvedConfig = null;
    this.authStateListeners = [];
    this.isReady = false;
    this.isRevoked = false;
    this.allowCustomBranding = false;
    this.appName = "App";
    this.appLogoUrl = null;
    if (!config.apiUrl) throw new Error("[Onelo] apiUrl is required");
    if (!config.publishableKey) throw new Error("[Onelo] publishableKey is required");
    this.apiUrl = config.apiUrl;
    this.publishableKey = config.publishableKey;
    this.storage = new TokenStorage();
    this.initPromise = this.initialize();
  }
  async initialize() {
    try {
      const verifier = generateCodeVerifier();
      this.pkceVerifier = verifier;
      const challenge = await generateCodeChallenge(verifier);
      const url = `${this.apiUrl}/api/sdk/config?key=${encodeURIComponent(this.publishableKey)}&code_challenge=${encodeURIComponent(challenge)}`;
      const { status, json } = await httpGet(url, { "X-SDK-Version": version });
      if (status === 401 || status === 404) throw OneloError.invalidKey("Server rejected the key");
      if (status !== 200) throw OneloError.server(`Config request failed: HTTP ${status}`);
      const j = json;
      this.resolvedConfig = {
        supabaseUrl: j["supabase_url"],
        supabaseAnonKey: j["supabase_anon_key"],
        tenantId: j["tenant_id"],
        allowCustomBranding: j["allow_custom_branding"] ?? false,
        appName: j["app_name"] ?? null,
        appLogoUrl: j["app_logo_url"] ?? null
      };
      this.allowCustomBranding = this.resolvedConfig.allowCustomBranding;
      if (this.resolvedConfig.appName) this.appName = this.resolvedConfig.appName;
      this.appLogoUrl = this.resolvedConfig.appLogoUrl;
      this.isReady = true;
    } catch (e) {
      if (e instanceof OneloError && e.code === "invalid_publishable_key") {
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
    if (this.isRevoked) throw OneloError.invalidKey("Application key has been revoked");
    const hostedUrl = await this.getHostedUrl();
    const modal = new AuthModal(this.apiUrl);
    const result = await modal.open(hostedUrl);
    if (result.type === "cancelled") return null;
    if (result.type === "error") throw OneloError.server(result.message);
    const { status, json } = await httpPost(
      `${this.apiUrl}/api/sdk/auth/hosted-callback`,
      { publishableKey: this.publishableKey, code: result.code },
      { "X-SDK-Version": version }
    );
    if (status !== 200) throw OneloError.server("Hosted callback failed");
    const session = mapSession(json);
    await this.saveSession(session);
    return session;
  }
  async getHostedUrl() {
    const { status, json } = await httpGet(
      `${this.apiUrl}/api/sdk/auth/initiate?key=${encodeURIComponent(this.publishableKey)}&callback_scheme=onelo-callback`,
      { "X-SDK-Version": version }
    );
    if (status !== 200) throw OneloError.server("Failed to initiate hosted auth flow");
    const j = json;
    const hostedUrl = j["hosted_url"];
    if (!hostedUrl) throw OneloError.server("Invalid initiate response");
    if (j["app_name"]) this.appName = j["app_name"];
    if (j["app_logo_url"]) this.appLogoUrl = j["app_logo_url"];
    return hostedUrl;
  }
  // ── Custom UI (paid plans only) ─────────────────────────────────────────────
  async signIn(email, password) {
    await this.initPromise;
    if (!this.allowCustomBranding) throw OneloError.planRequired();
    if (!this.pkceVerifier) this.pkceVerifier = generateCodeVerifier();
    const { status, json } = await httpPost(
      `${this.apiUrl}/api/sdk/auth/signin`,
      { email, password, publishableKey: this.publishableKey, code_verifier: this.pkceVerifier },
      { "X-SDK-Version": version }
    );
    checkHostedFlowRequired(json);
    const j = json;
    if (status === 403) {
      const detail = j["detail"];
      if (detail?.["error"] === "user_revoked") throw OneloError.userRevoked();
      throw OneloError.server(detail?.["message"] ?? j["error"]);
    }
    if (status !== 200) throw OneloError.server(`Sign in failed: HTTP ${status}`);
    this.pkceVerifier = null;
    const session = mapSession(j);
    await this.saveSession(session);
    return session;
  }
  async signUp(email, password) {
    await this.initPromise;
    if (!this.allowCustomBranding) throw OneloError.planRequired();
    if (!this.pkceVerifier) this.pkceVerifier = generateCodeVerifier();
    const { status, json } = await httpPost(
      `${this.apiUrl}/api/sdk/auth/signup`,
      { email, password, publishableKey: this.publishableKey, code_verifier: this.pkceVerifier },
      { "X-SDK-Version": version }
    );
    checkHostedFlowRequired(json);
    const j = json;
    if (status !== 200) throw OneloError.server(`Sign up failed: HTTP ${status}`);
    this.pkceVerifier = null;
    const session = mapSession(j);
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
      this.storage.get(TOKEN_KEYS.ACCESS_TOKEN),
      this.storage.get(TOKEN_KEYS.REFRESH_TOKEN),
      this.storage.get(TOKEN_KEYS.EXPIRES_AT),
      this.storage.get(TOKEN_KEYS.USER_JSON)
    ]);
    if (!accessToken || !refreshToken || !userJson) return null;
    const expiresAt = parseInt(expiresAtStr ?? "0", 10);
    if (Date.now() / 1e3 > expiresAt - 60) {
      return this.refreshSession();
    }
    return { accessToken, refreshToken, expiresAt, user: JSON.parse(userJson) };
  }
  async refreshSession() {
    const refreshToken = await this.storage.get(TOKEN_KEYS.REFRESH_TOKEN);
    if (!refreshToken) return null;
    const { status, json } = await httpPost(
      `${this.apiUrl}/api/sdk/auth/refresh`,
      { publishableKey: this.publishableKey, refreshToken },
      { "X-SDK-Version": version }
    );
    checkHostedFlowRequired(json);
    const j = json;
    if (j["error"] === "user_revoked") {
      await this.storage.clear();
      this.notifyListeners(null);
      throw OneloError.userRevoked();
    }
    if (j["error"] === "app_revoked") {
      await this.storage.clear();
      this.notifyListeners(null);
      throw OneloError.revoked();
    }
    if (status !== 200) {
      await this.storage.clear();
      this.notifyListeners(null);
      return null;
    }
    const session = mapSession(j);
    await this.saveSession(session);
    return session;
  }
  onAuthStateChange(callback) {
    this.authStateListeners.push(callback);
    return () => {
      this.authStateListeners = this.authStateListeners.filter((l) => l !== callback);
    };
  }
  // ── Helpers ─────────────────────────────────────────────────────────────────
  async saveSession(session) {
    await Promise.all([
      this.storage.set(TOKEN_KEYS.ACCESS_TOKEN, session.accessToken),
      this.storage.set(TOKEN_KEYS.REFRESH_TOKEN, session.refreshToken),
      this.storage.set(TOKEN_KEYS.EXPIRES_AT, String(session.expiresAt)),
      this.storage.set(TOKEN_KEYS.USER_JSON, JSON.stringify(session.user))
    ]);
    this.notifyListeners(session);
  }
  notifyListeners(session) {
    for (const cb of this.authStateListeners) cb(session);
  }
};

// src/onelo.ts
var Onelo = class {
  constructor(config) {
    this.auth = new OneloAuth(config);
  }
};

// src/index.ts
import { OneloError as OneloError2 } from "@onelo/core";
export {
  Onelo,
  OneloError2 as OneloError
};
