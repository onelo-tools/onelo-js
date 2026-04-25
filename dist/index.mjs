var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
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

// ../onelo-core/dist/types.js
var require_types = __commonJS({
  "../onelo-core/dist/types.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.OneloError = void 0;
    var OneloError3 = class _OneloError extends Error {
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
    exports.OneloError = OneloError3;
  }
});

// ../onelo-core/dist/pkce.js
var require_pkce = __commonJS({
  "../onelo-core/dist/pkce.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.generateCodeVerifier = generateCodeVerifier2;
    exports.generateCodeChallenge = generateCodeChallenge2;
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
  "../onelo-core/dist/http.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.httpGet = httpGet3;
    exports.httpPost = httpPost3;
    exports.checkHostedFlowRequired = checkHostedFlowRequired2;
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
    async function httpPost3(url, body, headers) {
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
  "../onelo-core/dist/session.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.TOKEN_KEYS = void 0;
    exports.mapSession = mapSession2;
    function mapSession2(j) {
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
    exports.TOKEN_KEYS = {
      ACCESS_TOKEN: "onelo_access_token",
      REFRESH_TOKEN: "onelo_refresh_token",
      EXPIRES_AT: "onelo_expires_at",
      USER_JSON: "onelo_user"
    };
  }
});

// ../onelo-core/dist/index.js
var require_dist = __commonJS({
  "../onelo-core/dist/index.js"(exports) {
    "use strict";
    var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
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
    var __exportStar = exports && exports.__exportStar || function(m, exports2) {
      for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports2, p)) __createBinding(exports2, m, p);
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    __exportStar(require_types(), exports);
    __exportStar(require_pkce(), exports);
    __exportStar(require_http(), exports);
    __exportStar(require_session(), exports);
  }
});

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
var version = "0.4.0-staging";

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
        appLogoUrl: j["app_logo_url"] ?? null
      };
      this.allowCustomBranding = this.resolvedConfig.allowCustomBranding;
      if (this.resolvedConfig.appName) this.appName = this.resolvedConfig.appName;
      this.appLogoUrl = this.resolvedConfig.appLogoUrl;
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
  async loadAuthView() {
    await this.initPromise;
    if (this.isRevoked) throw import_core5.OneloError.invalidKey("Application key has been revoked");
    const hostedUrl = await this.getHostedUrl();
    const modal = new AuthModal(this.apiUrl);
    const result = await modal.open(hostedUrl);
    if (result.type === "cancelled") return null;
    if (result.type === "error") throw import_core5.OneloError.server(result.message);
    const { status, json } = await (0, import_core3.httpPost)(
      `${this.apiUrl}/api/sdk/auth/hosted-callback`,
      { publishableKey: this.publishableKey, code: result.code },
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
    return { accessToken, refreshToken, expiresAt, user: JSON.parse(userJson) };
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
      await this.storage.clear();
      this.notifyListeners(null);
      throw import_core5.OneloError.userRevoked();
    }
    if (j["error"] === "app_revoked") {
      await this.storage.clear();
      this.notifyListeners(null);
      throw import_core5.OneloError.revoked();
    }
    if (status !== 200) {
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
  async saveSession(session) {
    await Promise.all([
      this.storage.set(import_core.TOKEN_KEYS.ACCESS_TOKEN, session.accessToken),
      this.storage.set(import_core.TOKEN_KEYS.REFRESH_TOKEN, session.refreshToken),
      this.storage.set(import_core.TOKEN_KEYS.EXPIRES_AT, String(session.expiresAt)),
      this.storage.set(import_core.TOKEN_KEYS.USER_JSON, JSON.stringify(session.user))
    ]);
    this.notifyListeners(session);
  }
  notifyListeners(session) {
    for (const cb of this.authStateListeners) cb(session);
  }
};

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
var POLL_INTERVAL_MS = 6e4;
var OneloFeatures = class {
  constructor(apiUrl, publishableKey) {
    this.cache = /* @__PURE__ */ new Map();
    this.discoveredNames = /* @__PURE__ */ new Set();
    this.configVersion = 0;
    this.pollTimer = null;
    this.pingDebounce = null;
    this.currentUserId = null;
    this.apiUrl = apiUrl;
    this.publishableKey = publishableKey;
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
    const status = this.cache.get(name) ?? "hidden";
    return new FeatureState(name, status);
  }
  /** Load features for a user (or anonymous). Called by Onelo orchestrator. */
  async load(userId) {
    this.currentUserId = userId;
    await this._batchPing();
    await this._resolve(userId);
    this._startPolling(userId);
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
  /** Stop background polling. Call when SDK is no longer needed. */
  stopPolling() {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.pingDebounce !== null) {
      clearTimeout(this.pingDebounce);
      this.pingDebounce = null;
    }
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
        this.cache.clear();
        for (const [name, state] of Object.entries(features)) {
          this.cache.set(name, state.status);
        }
      }
      if (typeof j["config_version"] === "number") {
        this.configVersion = j["config_version"];
      }
    } catch {
    }
  }
  async _poll(userId) {
    try {
      const params = new URLSearchParams({
        key: this.publishableKey,
        version: String(this.configVersion)
      });
      if (userId) params.set("userId", userId);
      const { status, json } = await (0, import_core6.httpGet)(
        `${this.apiUrl}/api/sdk/features/poll?${params.toString()}`
      );
      if (status !== 200) return;
      const j = json;
      if (j["changed"] === false) return;
      const features = j["features"];
      if (features) {
        this.cache.clear();
        for (const [name, state] of Object.entries(features)) {
          this.cache.set(name, state.status);
        }
      }
      if (typeof j["config_version"] === "number") {
        this.configVersion = j["config_version"];
      }
      if (j["discovery_requested"] === true) {
        await this._batchPing();
      }
    } catch {
    }
  }
  _startPolling(userId) {
    if (this.pollTimer !== null) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => {
      void this._poll(userId);
    }, POLL_INTERVAL_MS);
  }
};

// src/monitor/monitor.ts
var OneloMonitor = class {
  constructor(publishableKey, apiUrl) {
    this.buffer = [];
    this.flushTimer = null;
    this.publishableKey = publishableKey;
    this.apiUrl = apiUrl;
    this.flushTimer = setInterval(() => {
      this.flush();
    }, 5e3);
  }
  event(featureName, opts) {
    this.buffer.push({
      featureName,
      ok: opts.ok,
      durationMs: opts.durationMs,
      error: opts.error,
      meta: opts.meta
    });
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
    container.style.cssText = "width:480px;max-width:95vw;height:560px;max-height:90vh;border-radius:14px;overflow:hidden;position:relative";
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

// src/onelo.ts
var Onelo = class {
  constructor(config) {
    this.authUnsubscribe = null;
    this.auth = new OneloAuth(config);
    this.features = new OneloFeatures(config.apiUrl, config.publishableKey);
    this.monitor = new OneloMonitor(config.publishableKey, config.apiUrl);
    this.feedback = new OneloFeedback(config.apiUrl, config.publishableKey, () => this.features.getActiveFeatures());
    this.authUnsubscribe = this.auth.onAuthStateChange((session) => {
      void this.features.load(session?.user.id ?? null);
    });
    void this.features.load(null);
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
var import_core7 = __toESM(require_dist());
var export_OneloError = import_core7.OneloError;
export {
  FeatureState,
  Onelo,
  export_OneloError as OneloError,
  OneloFeatures,
  OneloFeedback,
  OneloMonitor
};
