"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// ../onelo-core/dist/types.js
var require_types = __commonJS({
  "../onelo-core/dist/types.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.OneloError = void 0;
    var OneloError4 = class _OneloError extends Error {
      constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "OneloError";
      }
      static notAuthenticated() {
        return new _OneloError("not_authenticated", "User is not authenticated");
      }
      static hostedFlowRequired() {
        return new _OneloError("hosted_flow_required", "This app requires the hosted sign-in flow. Use loadAuthView().");
      }
      static planRequired() {
        return new _OneloError("plan_required", "[plan_required] Custom UI requires a paid Onelo plan. Use loadAuthView() instead.");
      }
      static invalidKey(msg) {
        return new _OneloError("invalid_publishable_key", `Invalid publishable key: ${msg}`);
      }
      static network(msg) {
        return new _OneloError("network_error", `Network error: ${msg}`);
      }
      static server(msg) {
        return new _OneloError("server_error", msg);
      }
      static cancelled() {
        return new _OneloError("cancelled", "Sign in was cancelled");
      }
      static revoked() {
        return new _OneloError("revoked", "This application has been revoked");
      }
      static userRevoked() {
        return new _OneloError("user_revoked", "This user account has been suspended");
      }
    };
    exports2.OneloError = OneloError4;
  }
});

// ../onelo-core/dist/pkce.js
var require_pkce = __commonJS({
  "../onelo-core/dist/pkce.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.generateCodeVerifier = generateCodeVerifier2;
    exports2.generateCodeChallenge = generateCodeChallenge2;
    function generateCodeVerifier2() {
      const array = new Uint8Array(32);
      crypto.getRandomValues(array);
      return base64urlEncode(array);
    }
    async function generateCodeChallenge2(verifier) {
      const encoder = new TextEncoder();
      const data = encoder.encode(verifier);
      const digest = await crypto.subtle.digest("SHA-256", data);
      return base64urlEncode(new Uint8Array(digest));
    }
    function base64urlEncode(bytes) {
      let str = "";
      for (const byte of bytes) {
        str += String.fromCharCode(byte);
      }
      return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
    }
  }
});

// ../onelo-core/dist/http.js
var require_http = __commonJS({
  "../onelo-core/dist/http.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.httpGet = httpGet3;
    exports2.httpPost = httpPost4;
    exports2.checkHostedFlowRequired = checkHostedFlowRequired2;
    var types_1 = require_types();
    async function httpGet3(url, headers) {
      let res;
      try {
        res = await fetch(url, { headers });
      } catch (e) {
        throw types_1.OneloError.network(e instanceof Error ? e.message : "fetch failed");
      }
      const json = await parseJson(res);
      return { status: res.status, json };
    }
    async function httpPost4(url, body, headers) {
      let res;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify(body)
        });
      } catch (e) {
        throw types_1.OneloError.network(e instanceof Error ? e.message : "fetch failed");
      }
      const json = await parseJson(res);
      return { status: res.status, json };
    }
    async function parseJson(res) {
      try {
        return await res.json();
      } catch {
        throw types_1.OneloError.network("Invalid JSON response");
      }
    }
    function checkHostedFlowRequired2(json) {
      const j = json;
      const errorCode = j["error"] ?? j["detail"]?.["error"];
      if (errorCode === "hosted_flow_required") {
        const hint = j["hint"] ?? j["detail"]?.["hint"] ?? "Use loadAuthView() in your web app.";
        console.warn("[Onelo] \u26A0\uFE0F  hosted_flow_required:", hint);
        console.info("[Onelo] \u{1F4A1} Fix: call onelo.auth.loadAuthView() or upgrade your Onelo plan.");
        throw types_1.OneloError.hostedFlowRequired();
      }
    }
  }
});

// ../onelo-core/dist/session.js
var require_session = __commonJS({
  "../onelo-core/dist/session.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.TOKEN_KEYS = void 0;
    exports2.mapSession = mapSession3;
    function mapSession3(j) {
      const user = j["user"];
      const appMeta = user?.["app_metadata"] ?? {};
      return {
        accessToken: j["access_token"],
        refreshToken: j["refresh_token"],
        expiresAt: j["expires_at"] ?? 0,
        user: {
          id: user["id"],
          email: user["email"],
          role: appMeta["user_role"] ?? user["role"] ?? "member",
          tenantId: appMeta["tenant_id"] ?? user["tenant_id"] ?? null
        }
      };
    }
    exports2.TOKEN_KEYS = {
      ACCESS_TOKEN: "onelo_access_token",
      REFRESH_TOKEN: "onelo_refresh_token",
      EXPIRES_AT: "onelo_expires_at",
      USER_JSON: "onelo_user"
    };
  }
});

// ../onelo-core/dist/index.js
var require_dist = __commonJS({
  "../onelo-core/dist/index.js"(exports2) {
    "use strict";
    var __createBinding = exports2 && exports2.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __exportStar = exports2 && exports2.__exportStar || function(m, exports3) {
      for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports3, p)) __createBinding(exports3, m, p);
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    __exportStar(require_types(), exports2);
    __exportStar(require_pkce(), exports2);
    __exportStar(require_http(), exports2);
    __exportStar(require_session(), exports2);
  }
});

// src/index.ts
var index_exports = {};
__export(index_exports, {
  FeatureState: () => FeatureState,
  Onelo: () => Onelo,
  OneloError: () => import_core8.OneloError,
  OneloFeatures: () => OneloFeatures,
  OneloFeedback: () => OneloFeedback,
  OneloForms: () => OneloForms,
  OneloMonitor: () => OneloMonitor,
  OneloPaywall: () => OneloPaywall,
  OneloWaitlist: () => OneloWaitlist
});
module.exports = __toCommonJS(index_exports);

// src/auth/auth.ts
var import_core2 = __toESM(require_dist());
var import_core3 = __toESM(require_dist());
var import_core4 = __toESM(require_dist());

// src/core/storage.ts
var import_core = __toESM(require_dist());
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
      for (const key of Object.values(import_core.TOKEN_KEYS)) {
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
var import_core5 = __toESM(require_dist());

// package.json
var version = "0.13.0-staging";

// src/auth/auth.ts
var _OneloAuth = class _OneloAuth {
  constructor(config) {
    this.pkceVerifier = null;
    this.resolvedConfig = null;
    this.heartbeatTimer = null;
    this.refreshTimer = null;
    this.authStateListeners = [];
    this.isReady = false;
    this.isRevoked = false;
    this.allowCustomBranding = false;
    this.appName = "App";
    this.appLogoUrl = null;
    this.paywallEnabled = false;
    this.waitlistMode = false;
    this.sdkRedirectUrl = null;
    this.storeUrl = null;
    this.manageUrl = null;
    if (!config.apiUrl) throw new Error("[Onelo] apiUrl is required");
    if (!config.publishableKey) throw new Error("[Onelo] publishableKey is required");
    this.apiUrl = config.apiUrl;
    this.publishableKey = config.publishableKey;
    this.storage = new TokenStorage();
    this.initPromise = this.initialize();
  }
  async initialize() {
    try {
      const verifier = (0, import_core2.generateCodeVerifier)();
      this.pkceVerifier = verifier;
      const challenge = await (0, import_core2.generateCodeChallenge)(verifier);
      const url = `${this.apiUrl}/api/sdk/config?key=${encodeURIComponent(this.publishableKey)}&code_challenge=${encodeURIComponent(challenge)}`;
      const { status, json } = await (0, import_core3.httpGet)(url, { "X-SDK-Version": version });
      if (status === 401 || status === 404) throw import_core5.OneloError.invalidKey("Server rejected the key");
      if (status !== 200) throw import_core5.OneloError.server(`Config request failed: HTTP ${status}`);
      const j = json;
      this.resolvedConfig = {
        supabaseUrl: j["supabase_url"],
        supabaseAnonKey: j["supabase_anon_key"],
        tenantId: j["tenant_id"],
        allowCustomBranding: j["allow_custom_branding"] ?? false,
        appName: j["app_name"] ?? null,
        appLogoUrl: j["app_logo_url"] ?? null,
        paywallEnabled: j["paywall_enabled"] ?? false,
        waitlistMode: j["waitlist_mode"] ?? false,
        sdkRedirectUrl: j["sdk_redirect_url"] ?? null,
        storeUrl: j["store_url"] ?? null,
        manageUrl: j["manage_url"] ?? null
      };
      this.allowCustomBranding = this.resolvedConfig.allowCustomBranding;
      if (this.resolvedConfig.appName) this.appName = this.resolvedConfig.appName;
      this.appLogoUrl = this.resolvedConfig.appLogoUrl;
      this.paywallEnabled = this.resolvedConfig.paywallEnabled;
      this.waitlistMode = this.resolvedConfig.waitlistMode;
      this.sdkRedirectUrl = this.resolvedConfig.sdkRedirectUrl;
      this.storeUrl = this.resolvedConfig.storeUrl;
      this.manageUrl = this.resolvedConfig.manageUrl;
      this.isReady = true;
    } catch (e) {
      if (e instanceof import_core5.OneloError && e.code === "invalid_publishable_key") {
        this.isRevoked = true;
      }
    }
  }
  async whenReady() {
    await this.initPromise;
  }
  // ── Hosted flow ─────────────────────────────────────────────────────────────
  async loadAuthView(openStore) {
    await this.initPromise;
    if (this.isRevoked) throw import_core5.OneloError.invalidKey("Application key has been revoked");
    if (this.waitlistMode && this.sdkRedirectUrl) {
      window.open(this.sdkRedirectUrl, "_blank");
      return null;
    }
    if (this.paywallEnabled && openStore) {
      return openStore();
    }
    const hostedUrl = await this.getHostedUrl();
    const modal = new AuthModal(this.apiUrl);
    const result = await modal.open(hostedUrl);
    if (result.type === "cancelled") return null;
    if (result.type === "error") throw import_core5.OneloError.server(result.message);
    const { status, json } = await (0, import_core3.httpPost)(
      `${this.apiUrl}/api/sdk/auth/hosted-callback`,
      { publishableKey: this.publishableKey, code: result.code, code_verifier: this.pkceVerifier },
      { "X-SDK-Version": version }
    );
    if (status !== 200) throw import_core5.OneloError.server("Hosted callback failed");
    const session = (0, import_core4.mapSession)(json);
    await this.saveSession(session);
    return session;
  }
  async getHostedUrl() {
    const { status, json } = await (0, import_core3.httpGet)(
      `${this.apiUrl}/api/sdk/auth/initiate?key=${encodeURIComponent(this.publishableKey)}&callback_scheme=onelo-callback`,
      { "X-SDK-Version": version }
    );
    if (status !== 200) throw import_core5.OneloError.server("Failed to initiate hosted auth flow");
    const j = json;
    const hostedUrl = j["hosted_url"];
    if (!hostedUrl) throw import_core5.OneloError.server("Invalid initiate response");
    if (j["app_name"]) this.appName = j["app_name"];
    if (j["app_logo_url"]) this.appLogoUrl = j["app_logo_url"];
    return hostedUrl;
  }
  // ── Custom UI (paid plans only) ─────────────────────────────────────────────
  async signIn(email, password) {
    await this.initPromise;
    if (!this.allowCustomBranding) throw import_core5.OneloError.planRequired();
    if (!this.pkceVerifier) this.pkceVerifier = (0, import_core2.generateCodeVerifier)();
    const { status, json } = await (0, import_core3.httpPost)(
      `${this.apiUrl}/api/sdk/auth/signin`,
      { email, password, publishableKey: this.publishableKey, code_verifier: this.pkceVerifier },
      { "X-SDK-Version": version }
    );
    (0, import_core3.checkHostedFlowRequired)(json);
    const j = json;
    if (status === 403) {
      const detail = j["detail"];
      if (detail?.["error"] === "user_revoked") throw import_core5.OneloError.userRevoked();
      throw import_core5.OneloError.server(detail?.["message"] ?? j["error"]);
    }
    if (status !== 200) throw import_core5.OneloError.server(`Sign in failed: HTTP ${status}`);
    this.pkceVerifier = null;
    const session = (0, import_core4.mapSession)(j);
    await this.saveSession(session);
    return session;
  }
  async signUp(email, password) {
    await this.initPromise;
    if (!this.allowCustomBranding) throw import_core5.OneloError.planRequired();
    if (!this.pkceVerifier) this.pkceVerifier = (0, import_core2.generateCodeVerifier)();
    const { status, json } = await (0, import_core3.httpPost)(
      `${this.apiUrl}/api/sdk/auth/signup`,
      { email, password, publishableKey: this.publishableKey, code_verifier: this.pkceVerifier },
      { "X-SDK-Version": version }
    );
    (0, import_core3.checkHostedFlowRequired)(json);
    const j = json;
    if (status !== 200) throw import_core5.OneloError.server(`Sign up failed: HTTP ${status}`);
    this.pkceVerifier = null;
    const session = (0, import_core4.mapSession)(j);
    await this.saveSession(session);
    return session;
  }
  // ── Session management ──────────────────────────────────────────────────────
  async signOut() {
    this.stopHeartbeat();
    this.clearRefreshTimer();
    await this.storage.clear();
    this.notifyListeners(null);
  }
  async getSession() {
    const [accessToken, refreshToken, expiresAtStr, userJson] = await Promise.all([
      this.storage.get(import_core.TOKEN_KEYS.ACCESS_TOKEN),
      this.storage.get(import_core.TOKEN_KEYS.REFRESH_TOKEN),
      this.storage.get(import_core.TOKEN_KEYS.EXPIRES_AT),
      this.storage.get(import_core.TOKEN_KEYS.USER_JSON)
    ]);
    if (!accessToken || !refreshToken || !userJson) return null;
    const expiresAt = parseInt(expiresAtStr ?? "0", 10);
    if (Date.now() / 1e3 > expiresAt - 60) {
      return this.refreshSession();
    }
    const session = { accessToken, refreshToken, expiresAt, user: JSON.parse(userJson) };
    this.scheduleRefresh(session);
    return session;
  }
  async refreshSession() {
    const refreshToken = await this.storage.get(import_core.TOKEN_KEYS.REFRESH_TOKEN);
    if (!refreshToken) return null;
    const { status, json } = await (0, import_core3.httpPost)(
      `${this.apiUrl}/api/sdk/auth/refresh`,
      { publishableKey: this.publishableKey, refreshToken },
      { "X-SDK-Version": version }
    );
    (0, import_core3.checkHostedFlowRequired)(json);
    const j = json;
    if (j["error"] === "user_revoked") {
      this.clearRefreshTimer();
      await this.storage.clear();
      this.notifyListeners(null);
      throw import_core5.OneloError.userRevoked();
    }
    if (j["error"] === "app_revoked") {
      this.clearRefreshTimer();
      await this.storage.clear();
      this.notifyListeners(null);
      throw import_core5.OneloError.revoked();
    }
    if (status !== 200) {
      this.clearRefreshTimer();
      await this.storage.clear();
      this.notifyListeners(null);
      return null;
    }
    const session = (0, import_core4.mapSession)(j);
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
  startHeartbeat(accessToken) {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(async () => {
      const session = await this.getSession();
      if (!session) {
        this.stopHeartbeat();
        return;
      }
      try {
        await fetch(`${this.apiUrl}/api/sdk/presence/heartbeat`, {
          method: "POST",
          headers: { Authorization: `Bearer ${session.accessToken}` }
        });
      } catch {
      }
    }, _OneloAuth.HEARTBEAT_MS);
  }
  stopHeartbeat() {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
  /**
   * Schedule a background refresh of the access token to fire `REFRESH_LEAD_SECONDS`
   * before it expires. Idempotent — cancels any pending refresh first. Without this,
   * an idle app would carry a stale token past its TTL and the next request would 401.
   */
  scheduleRefresh(session) {
    this.clearRefreshTimer();
    const nowSec = Date.now() / 1e3;
    const delaySec = session.expiresAt - nowSec - _OneloAuth.REFRESH_LEAD_SECONDS;
    const delayMs = delaySec > 0 ? delaySec * 1e3 : 0;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.refreshSession().catch(() => {
      });
    }, delayMs);
  }
  clearRefreshTimer() {
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }
  async saveSession(session) {
    await Promise.all([
      this.storage.set(import_core.TOKEN_KEYS.ACCESS_TOKEN, session.accessToken),
      this.storage.set(import_core.TOKEN_KEYS.REFRESH_TOKEN, session.refreshToken),
      this.storage.set(import_core.TOKEN_KEYS.EXPIRES_AT, String(session.expiresAt)),
      this.storage.set(import_core.TOKEN_KEYS.USER_JSON, JSON.stringify(session.user))
    ]);
    this.notifyListeners(session);
    this.startHeartbeat(session.accessToken);
    this.scheduleRefresh(session);
  }
  notifyListeners(session) {
    for (const cb of this.authStateListeners) cb(session);
  }
  /** Import a session obtained outside of OneloAuth (e.g. from paywall flow). Saves tokens and notifies listeners. */
  async importSession(session) {
    await this.saveSession(session);
  }
  async sendMagicLink(email, redirectTo) {
    await this.initPromise;
    const body = { publishableKey: this.publishableKey, email };
    if (redirectTo) body.redirectTo = redirectTo;
    const { status: mlStatus } = await (0, import_core3.httpPost)(`${this.apiUrl}/api/sdk/auth/magic-link`, body, { "X-SDK-Version": version });
    if (mlStatus >= 400) throw import_core5.OneloError.server(`Magic link request failed: HTTP ${mlStatus}`);
  }
  async sendPasswordReset(email, redirectTo) {
    await this.initPromise;
    const body = { publishableKey: this.publishableKey, email };
    if (redirectTo) body.redirectTo = redirectTo;
    const { status: prStatus } = await (0, import_core3.httpPost)(`${this.apiUrl}/api/sdk/auth/reset-password/request`, body, { "X-SDK-Version": version });
    if (prStatus >= 400) throw import_core5.OneloError.server(`Password reset request failed: HTTP ${prStatus}`);
  }
};
_OneloAuth.HEARTBEAT_MS = 13 * 60 * 1e3;
/** Refresh this many seconds before the access token expires. */
_OneloAuth.REFRESH_LEAD_SECONDS = 60;
var OneloAuth = _OneloAuth;

// src/features/features.ts
var import_core6 = __toESM(require_dist());
var FeatureState = class {
  constructor(name, status) {
    this.name = name;
    this.status = status;
  }
  get isEnabled() {
    return this.status === "enabled" || this.status === "new" || this.status === "beta";
  }
  get isDisabled() {
    return this.status === "disabled";
  }
  get isVisible() {
    return this.status !== "hidden";
  }
  get isGreyed() {
    return this.status === "greyed";
  }
  get isUpsell() {
    return this.status === "upsell";
  }
  get isNew() {
    return this.status === "new";
  }
  get isBeta() {
    return this.status === "beta";
  }
  get isComingSoon() {
    return this.status === "coming_soon";
  }
  get badgeLabel() {
    if (this.status === "new") return "New";
    if (this.status === "beta") return "Beta";
    if (this.status === "coming_soon") return "Coming Soon";
    return null;
  }
};
var RECONNECT_DELAYS_MS = [1e3, 2e3, 5e3, 1e4, 3e4];
var CACHE_KEY_PREFIX = "onelo_features_";
var OneloFeatures = class {
  constructor(apiUrl, publishableKey, monitor, options) {
    this.cache = /* @__PURE__ */ new Map();
    this.discoveredNames = /* @__PURE__ */ new Set();
    this.configVersion = 0;
    this.pingDebounce = null;
    this.currentUserId = null;
    this.monitor = null;
    this.anonymousWarningLogged = false;
    // SSE — primary channel for live deploys. Replaces the legacy 60s poll.
    this.sseSource = null;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.destroyed = false;
    this.apiUrl = apiUrl;
    this.publishableKey = publishableKey;
    if (monitor) this.monitor = monitor;
    this.suppressIdentifyWarning = options?.suppressIdentifyWarning ?? false;
  }
  /** Declare feature names upfront — triggers a batch-ping immediately. */
  declare(names) {
    for (const name of names) this.discoveredNames.add(name);
    this._scheduleBatchPing();
  }
  /** Returns the current state for a feature. Auto-registers on first call. */
  feature(name) {
    const isNew = !this.discoveredNames.has(name);
    this.discoveredNames.add(name);
    if (isNew) this._scheduleBatchPing();
    if (isNew) this.monitor?._trackFeatureCall(name);
    const status = this.cache.get(name) ?? "hidden";
    return new FeatureState(name, status);
  }
  /** Load features for a user (or anonymous). Called by Onelo orchestrator.
   * Restores cache for instant UI, then opens an SSE channel that delivers
   * live updates whenever an admin clicks Deploy in the dashboard. */
  async load(userId) {
    this.currentUserId = userId;
    this._loadCache(userId);
    await this._batchPing();
    if (this._supportsSse()) {
      this._connectSSE(userId);
    } else {
      await this._resolve(userId);
    }
  }
  /** Returns names of all features with an active status (enabled, new, or beta). */
  getActiveFeatures() {
    const active = [];
    for (const [name, status] of this.cache) {
      if (status === "enabled" || status === "new" || status === "beta") {
        active.push(name);
      }
    }
    return active;
  }
  /** Tear down the SSE connection. Call when the SDK instance is no longer needed
   * (e.g. on app shutdown). Kept named `stopPolling` for back-compat with the
   * old polling-based API. */
  stopPolling() {
    this.destroyed = true;
    this._closeSse();
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pingDebounce !== null) {
      clearTimeout(this.pingDebounce);
      this.pingDebounce = null;
    }
  }
  /** Clears the local feature cache and resets the config version. The next feature() call will re-fetch. */
  invalidateCache() {
    this.cache.clear();
    this.configVersion = 0;
    this._writeCache();
  }
  // ── Private ──────────────────────────────────────────────────────────────────
  _scheduleBatchPing() {
    if (this.pingDebounce !== null) clearTimeout(this.pingDebounce);
    this.pingDebounce = setTimeout(() => {
      this.pingDebounce = null;
      void this._batchPing();
    }, 1e3);
  }
  async _batchPing() {
    const names = Array.from(this.discoveredNames);
    if (names.length === 0) return;
    try {
      await (0, import_core6.httpPost)(`${this.apiUrl}/api/sdk/features/batch-ping`, {
        publishableKey: this.publishableKey,
        features: names
      });
    } catch {
    }
  }
  async _resolve(userId) {
    try {
      const body = { publishableKey: this.publishableKey };
      if (userId) body["userId"] = userId;
      const { status, json } = await (0, import_core6.httpPost)(`${this.apiUrl}/api/sdk/features/resolve`, body);
      if (status !== 200) return;
      const j = json;
      const features = j["features"];
      if (features) {
        this._applySnapshot(typeof j["config_version"] === "number" ? j["config_version"] : this.configVersion, features);
      }
      this._maybeWarnAnonymous(j);
    } catch {
    }
  }
  /**
   * Logs a one-time warning when the backend reports anonymous mode (no userId)
   * AND at least one targeted feature was hidden purely because of it. Helps
   * developers using their own auth system catch missing identify() calls.
   * Suppressed via OneloConfig.suppressIdentifyWarning.
   */
  _maybeWarnAnonymous(response) {
    if (this.suppressIdentifyWarning || this.anonymousWarningLogged) return;
    if (response["anonymous"] !== true) return;
    const misses = typeof response["targeting_misses"] === "number" ? response["targeting_misses"] : 0;
    if (misses <= 0) return;
    this.anonymousWarningLogged = true;
    console.warn(
      `[Onelo] ${misses} feature(s) hidden because no user is identified.
If you handle auth yourself, call onelo.identify(userId) after login so per-user/per-plan targeting can apply.
If your app is intentionally anonymous, pass suppressIdentifyWarning: true in OneloConfig to silence this.`
    );
  }
  // ── SSE ──────────────────────────────────────────────────────────────────────
  _supportsSse() {
    return typeof EventSource !== "undefined";
  }
  _connectSSE(userId) {
    if (this.destroyed) return;
    this._closeSse();
    const params = new URLSearchParams({
      key: this.publishableKey,
      since_version: String(this.configVersion)
    });
    if (userId) params.set("userId", userId);
    const url = `${this.apiUrl}/api/sdk/features/stream?${params.toString()}`;
    let sse;
    try {
      sse = new EventSource(url);
    } catch {
      this._scheduleReconnect(userId);
      return;
    }
    this.sseSource = sse;
    sse.addEventListener("connected", (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.features) {
          this._applySnapshot(data.config_version ?? this.configVersion, data.features);
        }
        this.reconnectAttempts = 0;
      } catch {
      }
    });
    sse.addEventListener("up_to_date", (e) => {
      try {
        const data = JSON.parse(e.data);
        if (typeof data.config_version === "number") this.configVersion = data.config_version;
        this.reconnectAttempts = 0;
      } catch {
      }
    });
    sse.addEventListener("features_updated", (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.features) {
          this._applySnapshot(data.config_version ?? this.configVersion, data.features);
        }
      } catch {
      }
    });
    sse.onerror = () => {
      this._closeSse();
      if (this.destroyed) return;
      this._scheduleReconnect(userId);
    };
  }
  _scheduleReconnect(userId) {
    if (this.destroyed) return;
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    const delay = RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempts, RECONNECT_DELAYS_MS.length - 1)];
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._connectSSE(userId);
    }, delay);
  }
  _closeSse() {
    if (this.sseSource !== null) {
      this.sseSource.close();
      this.sseSource = null;
    }
  }
  // ── Cache ───────────────────────────────────────────────────────────────────
  _cacheKey(userId) {
    return `${CACHE_KEY_PREFIX}${this.publishableKey}_${userId ?? "anon"}`;
  }
  _loadCache(userId) {
    if (typeof localStorage === "undefined") return;
    try {
      const raw = localStorage.getItem(this._cacheKey(userId));
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (typeof parsed.configVersion !== "number" || !parsed.features) return;
      this.configVersion = parsed.configVersion;
      this.cache.clear();
      for (const [name, status] of Object.entries(parsed.features)) {
        this.cache.set(name, status);
      }
    } catch {
    }
  }
  _writeCache() {
    if (typeof localStorage === "undefined") return;
    try {
      const features = {};
      for (const [name, status] of this.cache) features[name] = status;
      const snapshot = { configVersion: this.configVersion, features };
      localStorage.setItem(this._cacheKey(this.currentUserId), JSON.stringify(snapshot));
    } catch {
    }
  }
  _applySnapshot(version2, features) {
    this.configVersion = version2;
    this.cache.clear();
    for (const [name, state] of Object.entries(features)) {
      this.cache.set(name, state.status);
    }
    this._writeCache();
  }
};

// src/monitor/monitor.ts
var MAX_BUFFER_SIZE = 200;
var PLATFORM = "js";
var _globalHandlersRegistered = false;
var OneloMonitor = class {
  constructor(publishableKey, apiUrl) {
    this.sessionId = crypto.randomUUID();
    this.buffer = [];
    this.flushTimer = null;
    this.currentUserId = null;
    this.publishableKey = publishableKey;
    this.apiUrl = apiUrl;
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, 15e3);
    this._registerGlobalHandlers();
  }
  /** Sets the current user ID attached to all subsequent monitor events. Call after login/logout if not using Onelo Auth. */
  setUserId(userId) {
    this.currentUserId = userId;
  }
  _trackFeatureCall(featureName) {
    this._push(featureName, true, void 0, void 0, void 0, "feature_call");
  }
  async track(featureName, fn, options) {
    const start = Date.now();
    try {
      const result = await fn();
      this._push(featureName, true, Date.now() - start, void 0, options?.meta, "track");
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this._push(featureName, false, Date.now() - start, message, options?.meta, "track");
      throw err;
    }
  }
  event(featureName, opts) {
    this._push(featureName, opts.ok, opts.durationMs, opts.error, opts.meta, "event");
  }
  async flush() {
    if (this.buffer.length === 0) return;
    const events = this.buffer.splice(0);
    try {
      await fetch(`${this.apiUrl}/api/sdk/monitor/events/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publishableKey: this.publishableKey, events })
      });
    } catch {
    }
  }
  destroy() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    void this.flush();
  }
  _push(featureName, ok, durationMs, error, meta, source = "event") {
    if (this.buffer.length >= MAX_BUFFER_SIZE) this.buffer.shift();
    this.buffer.push({
      featureName,
      ok,
      durationMs,
      error,
      meta,
      source,
      userId: this.currentUserId ?? void 0,
      sessionId: this.sessionId,
      platform: PLATFORM
    });
    if (!ok || source === "global_error") {
      void this.flush();
    }
  }
  _registerGlobalHandlers() {
    if (_globalHandlersRegistered) return;
    _globalHandlersRegistered = true;
    const handler = (error) => {
      this._push("unhandled", false, void 0, error, void 0, "global_error");
      void this.flush();
    };
    if (typeof window !== "undefined") {
      window.addEventListener("unhandledrejection", (e) => {
        const msg = e.reason instanceof Error ? e.reason.message : String(e.reason);
        handler(msg);
      });
      window.addEventListener("error", (e) => {
        handler(e.message ?? "Unknown error");
      });
    }
  }
};

// src/feedback/feedback.ts
var OneloFeedback = class {
  constructor(apiUrl, publishableKey, getActiveFeatures) {
    this.apiUrl = apiUrl;
    this.publishableKey = publishableKey;
    this.getActiveFeatures = getActiveFeatures;
  }
  async open(options = {}) {
    const params = new URLSearchParams({ key: this.publishableKey });
    if (options.type) params.set("type", options.type);
    if (options.area) params.set("area", options.area);
    if (options.userId) params.set("userId", options.userId);
    const active = this.getActiveFeatures();
    if (active.length > 0) params.set("session", JSON.stringify(active));
    const res = await fetch(`${this.apiUrl}/api/sdk/feedback/initiate?${params}`);
    if (!res.ok) throw new Error(`Feedback initiate failed: ${res.status}`);
    const { hosted_url } = await res.json();
    this._openModal(hosted_url);
  }
  _openModal(url) {
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:2147483647;display:flex;align-items:center;justify-content:center";
    const container = document.createElement("div");
    container.style.cssText = "width:480px;max-width:95vw;height:680px;max-height:90vh;border-radius:14px;overflow:hidden;position:relative";
    const iframe = document.createElement("iframe");
    iframe.src = url;
    iframe.style.cssText = "width:100%;height:100%;border:none";
    container.appendChild(iframe);
    overlay.appendChild(container);
    document.body.appendChild(overlay);
    const close = () => {
      document.body.removeChild(overlay);
      window.removeEventListener("message", onMsg);
    };
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    const onMsg = (e) => {
      if (e.data?.type === "onelo:feedback_submitted") close();
    };
    window.addEventListener("message", onMsg);
  }
};

// src/paywall/paywall.ts
var import_core7 = __toESM(require_dist());
var TIER = { free: 0, pro: 1, business: 2, enterprise: 3 };
var OneloPaywall = class {
  constructor(apiUrl, publishableKey, getAccessToken, onSession) {
    this.apiUrl = apiUrl;
    this.publishableKey = publishableKey;
    this.getAccessToken = getAccessToken;
    this.onSession = onSession;
  }
  check(requiredPlan, userPlan = "free") {
    const req = TIER[requiredPlan];
    const usr = TIER[userPlan];
    if (req === void 0 || usr === void 0) return false;
    return usr >= req;
  }
  /**
   * Opens the hosted store page (plan selection + registration + payment).
   * Returns the session on success, or null if the user cancelled.
   */
  async openStore(lang) {
    let url = `${this.apiUrl}/api/sdk/paywall/store-initiate?key=${encodeURIComponent(this.publishableKey)}&callback_scheme=onelo-callback`;
    if (lang) url += `&lang=${encodeURIComponent(lang)}`;
    const { status, json } = await (0, import_core7.httpGet)(url, { "X-SDK-Version": version });
    if (status !== 200) throw import_core7.OneloError.server("Failed to initiate store flow");
    const j = json;
    const storeUrl = j["store_url"];
    if (!storeUrl) throw import_core7.OneloError.server("Invalid store-initiate response");
    const modal = new AuthModal(this.apiUrl);
    const result = await modal.open(storeUrl);
    if (result.type === "cancelled") return null;
    if (result.type === "error") throw import_core7.OneloError.server(result.message);
    const { status: cbStatus, json: cbJson } = await (0, import_core7.httpPost)(
      `${this.apiUrl}/api/sdk/auth/hosted-callback`,
      { publishableKey: this.publishableKey, code: result.code },
      { "X-SDK-Version": version }
    );
    if (cbStatus !== 200) throw import_core7.OneloError.server("Store hosted-callback failed");
    const session = (0, import_core7.mapSession)(cbJson);
    await this.onSession(session);
    return session;
  }
  /**
   * Opens the hosted manage page (upgrade, cancel, payment method).
   * Returns the new plan string if the user changed their plan, or null if closed without changes.
   */
  async openManage(lang) {
    const accessToken = await this.getAccessToken();
    if (!accessToken) throw import_core7.OneloError.server("No active session \u2014 sign in before opening the manage page");
    let url = `${this.apiUrl}/api/sdk/paywall/manage-initiate?key=${encodeURIComponent(this.publishableKey)}`;
    if (lang) url += `&lang=${encodeURIComponent(lang)}`;
    const { status, json } = await (0, import_core7.httpGet)(url, {
      "X-SDK-Version": version,
      Authorization: `Bearer ${accessToken}`
    });
    if (status !== 200) throw import_core7.OneloError.server("Failed to initiate manage flow");
    const j = json;
    const manageUrl = j["manage_url"];
    if (!manageUrl) throw import_core7.OneloError.server("Invalid manage-initiate response");
    return this.openManageModal(manageUrl);
  }
  // ── Private helpers ─────────────────────────────────────────────────────────
  openManageModal(manageUrl) {
    return new Promise((resolve) => {
      const allowedOrigin = new URL(this.apiUrl).origin;
      const overlay = document.createElement("div");
      overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;";
      const container = document.createElement("div");
      container.style.cssText = "position:relative;width:480px;height:640px;border-radius:12px;overflow:hidden;background:#111;";
      const iframe = document.createElement("iframe");
      iframe.src = manageUrl;
      iframe.style.cssText = "width:100%;height:100%;border:none;";
      iframe.setAttribute("sandbox", "allow-scripts allow-forms allow-same-origin allow-popups");
      const cancelBtn = document.createElement("button");
      cancelBtn.setAttribute("data-onelo-cancel", "");
      cancelBtn.textContent = "\u2715";
      cancelBtn.style.cssText = "position:absolute;top:10px;right:12px;background:transparent;border:none;color:rgba(255,255,255,0.5);font-size:18px;cursor:pointer;line-height:1;padding:4px;";
      container.appendChild(iframe);
      container.appendChild(cancelBtn);
      overlay.appendChild(container);
      document.body.appendChild(overlay);
      const close = () => {
        window.removeEventListener("message", messageHandler);
        overlay.remove();
      };
      const messageHandler = (e) => {
        if (e.origin !== allowedOrigin) return;
        const data = e.data;
        if (data?.type === "onelo:plan_changed" && typeof data.plan === "string") {
          close();
          resolve(data.plan);
        } else if (data?.type === "onelo:cancel" || data?.type === "onelo:error") {
          close();
          resolve(null);
        }
      };
      window.addEventListener("message", messageHandler);
      cancelBtn.addEventListener("click", () => {
        close();
        resolve(null);
      });
    });
  }
};

// src/forms/forms.ts
var OneloForms = class {
  constructor(apiUrl, publishableKey) {
    this.apiUrl = apiUrl;
    this.publishableKey = publishableKey;
  }
  async submit(formSlug, data, submitterEmail) {
    try {
      const body = { publishableKey: this.publishableKey, formSlug, data };
      if (submitterEmail) body.submitterEmail = submitterEmail;
      const res = await fetch(`${this.apiUrl}/api/sdk/forms/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const json = await res.json();
      return { success: json.success ?? false, message: json.message };
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : String(err) };
    }
  }
};

// src/waitlist/waitlist.ts
var OneloWaitlist = class {
  constructor(apiUrl, publishableKey) {
    this.apiUrl = apiUrl;
    this.publishableKey = publishableKey;
  }
  async join(slug, email) {
    try {
      const body = { publishableKey: this.publishableKey, email };
      if (slug !== void 0) body.slug = slug;
      const res = await fetch(`${this.apiUrl}/api/sdk/waitlist/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const json = await res.json();
      return { success: json.success ?? false, position: json.position, alreadyJoined: json.alreadyJoined ?? false };
    } catch (err) {
      return { success: false, alreadyJoined: false };
    }
  }
};

// src/onelo.ts
var Onelo = class {
  constructor(config) {
    this.authUnsubscribe = null;
    this.auth = new OneloAuth(config);
    this.paywall = new OneloPaywall(
      config.apiUrl,
      config.publishableKey,
      () => this.auth.getSession().then((s) => s?.accessToken ?? null),
      (session) => this.auth.importSession(session)
    );
    this.forms = new OneloForms(config.apiUrl, config.publishableKey);
    this.waitlist = new OneloWaitlist(config.apiUrl, config.publishableKey);
    this.monitor = new OneloMonitor(config.publishableKey, config.apiUrl);
    this.features = new OneloFeatures(config.apiUrl, config.publishableKey, this.monitor, {
      suppressIdentifyWarning: config.suppressIdentifyWarning ?? false
    });
    this.feedback = new OneloFeedback(config.apiUrl, config.publishableKey, () => this.features.getActiveFeatures());
    this.authUnsubscribe = this.auth.onAuthStateChange((session) => {
      this.monitor.setUserId(session?.user.id ?? null);
      void this.features.load(session?.user.id ?? null);
    });
    void this.features.load(null);
  }
  /**
   * Open the sign-in flow. Automatically routes based on app config:
   * - waitlist_mode + sdk_redirect_url → opens developer's waitlist/store page
   * - paywall_enabled → opens hosted store (plan selection + registration)
   * - otherwise → opens hosted sign-in
   */
  async loadAuthView() {
    return this.auth.loadAuthView(() => this.paywall.openStore());
  }
  /** Only needed when NOT using Onelo Auth (own auth system). */
  async identify(userId) {
    await this.features.load(userId);
  }
  /** Release background timers. Call when the SDK instance is no longer needed. */
  destroy() {
    this.authUnsubscribe?.();
    this.features.stopPolling();
    this.monitor.destroy();
  }
};

// src/index.ts
var import_core8 = __toESM(require_dist());
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  FeatureState,
  Onelo,
  OneloError,
  OneloFeatures,
  OneloFeedback,
  OneloForms,
  OneloMonitor,
  OneloPaywall,
  OneloWaitlist
});
