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
    var OneloError6 = class _OneloError extends Error {
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
      /**
       * The DEVELOPER's app is on a plan that doesn't allow custom auth UI. This is
       * a build-time configuration error — the fix is to use the hosted flow
       * (loadAuthView) or upgrade the Onelo plan. NOT for an end-user's lapsed
       * subscription — see noActivePlan().
       */
      static planRequired() {
        return new _OneloError("plan_required", "[plan_required] Custom UI requires a paid Onelo plan. Use loadAuthView() instead.");
      }
      /**
       * The END USER has no active subscription (it lapsed or was cancelled) — the
       * backend cleared the session. This is NOT a config error and NOT an account
       * revocation: route the user to your store / upgrade flow to re-subscribe.
       */
      static noActivePlan() {
        return new _OneloError("no_active_plan", "[no_active_plan] No active subscription \u2014 the plan has expired or was cancelled. Route the user to your store / upgrade flow to re-subscribe.");
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
      static timeout(msg) {
        return new _OneloError("timeout", msg);
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
    exports.OneloError = OneloError6;
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
    exports.httpGet = httpGet5;
    exports.httpPost = httpPost5;
    exports.checkHostedFlowRequired = checkHostedFlowRequired2;
    var types_1 = require_types();
    async function httpGet5(url, headers) {
      let res;
      try {
        res = await fetch(url, { headers });
      } catch (e) {
        throw types_1.OneloError.network(e instanceof Error ? e.message : "fetch failed");
      }
      const json = await parseJson(res);
      return { status: res.status, json };
    }
    async function httpPost5(url, body, headers) {
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
    exports.mapSession = mapSession3;
    function mapSession3(j) {
      const tokens = j["session"] ?? j;
      const user = j["user"];
      const appMeta = user?.["app_metadata"] ?? {};
      const expiresIn = tokens["expires_in"];
      const expiresAt = typeof expiresIn === "number" ? Math.floor(Date.now() / 1e3) + expiresIn : 0;
      return {
        accessToken: tokens["access_token"],
        refreshToken: tokens["refresh_token"],
        expiresAt,
        user: {
          id: user["id"],
          email: user["email"],
          role: appMeta["user_role"] ?? user["role"] ?? "member",
          tenantId: appMeta["tenant_id"] ?? user["tenant_id"] ?? null,
          // Backend sends "active" | "none"; absent MUST decode to 'none' (never
          // treat a missing entitlement as active). Round-trips via USER_JSON.
          entitlement: user["entitlement"] === "active" ? "active" : "none"
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

// ../onelo-core/dist/reason-enum.js
var require_reason_enum = __commonJS({
  "../onelo-core/dist/reason-enum.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.REASON_LABELS = exports.RESPONSE_REASON_CODES = void 0;
    exports.RESPONSE_REASON_CODES = [
      "too_expensive",
      "missing_features",
      "not_working",
      "not_using_anymore",
      "found_alternative",
      "bought_by_mistake",
      "duplicate_charge",
      "unauthorized",
      "prefer_not_to_say",
      "other",
      "skipped"
    ];
    exports.REASON_LABELS = {
      too_expensive: "Too expensive",
      missing_features: "Missing features",
      not_working: "Doesn't work as expected",
      not_using_anymore: "Not using anymore",
      found_alternative: "Found alternative",
      bought_by_mistake: "Bought by mistake",
      duplicate_charge: "Duplicate charge",
      unauthorized: "I didn't authorise this",
      prefer_not_to_say: "Prefer not to say",
      other: "Other",
      skipped: "(skipped survey)"
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
    __exportStar(require_reason_enum(), exports);
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

// src/core/modal-close-button.ts
function createModalCloseButton() {
  const btn = document.createElement("button");
  btn.setAttribute("data-onelo-cancel", "");
  btn.setAttribute("aria-label", "Close");
  btn.setAttribute("title", "Close");
  btn.textContent = "\u2715";
  const bg = "rgba(255,255,255,0.12)";
  const border = "rgba(255,255,255,0.22)";
  btn.style.cssText = [
    "position:absolute",
    "top:16px",
    "right:16px",
    "width:36px",
    "height:36px",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    `background:${bg}`,
    `border:1px solid ${border}`,
    "border-radius:9999px",
    "color:rgba(255,255,255,0.92)",
    "font-size:15px",
    "line-height:1",
    "cursor:pointer",
    "padding:0",
    "z-index:2",
    "transition:background 120ms ease,border-color 120ms ease,transform 120ms ease"
  ].join(";");
  btn.addEventListener("mouseenter", () => {
    btn.style.background = "rgba(255,255,255,0.22)";
    btn.style.borderColor = "rgba(255,255,255,0.4)";
    btn.style.transform = "scale(1.06)";
  });
  btn.addEventListener("mouseleave", () => {
    btn.style.background = bg;
    btn.style.borderColor = border;
    btn.style.transform = "scale(1)";
  });
  return btn;
}

// src/core/failsafe-close.ts
function installFailsafeClose(btn, graceMs = 3500) {
  const shownDisplay = btn.style.display || "";
  let ready = false;
  let timer;
  const arm = () => {
    ready = false;
    btn.style.display = "none";
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!ready) btn.style.display = shownDisplay;
    }, graceMs);
  };
  arm();
  return {
    markReady() {
      if (ready) return;
      ready = true;
      clearTimeout(timer);
      btn.style.display = "none";
    },
    // Re-arm after the iframe navigates to a NEW document — e.g. the portal
    // auto-advancing to /store/hosted, which carries NO canonical hosted ✕. A
    // prior markReady() latched the button hidden; without re-arming, the user
    // lands on a page with no ✕ and no way out. Re-arming hides it again and
    // restarts the grace, so the fail-safe ✕ returns unless the new page also
    // signals ready.
    rearm: arm,
    dispose() {
      clearTimeout(timer);
    }
  };
}

// src/auth/auth-modal.ts
var AUTH_SKELETON_HTML = `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box;margin:0;padding:0}
/* Centred exactly like the hosted page's own Suspense fallback
   (frontend/app/auth/hosted/page.tsx): flex centre + min-height:100vh on a
   #111111 ground. Top-aligning here would make the placeholder jump to the
   middle the moment the real form paints. */
body{background:#111111;font-family:-apple-system,sans-serif;overflow:hidden;
  display:flex;align-items:center;justify-content:center;min-height:100vh}
@keyframes onelo-shimmer{0%{background-position:-60vw 0}100%{background-position:100vw 0}}
.wrap{display:flex;flex-direction:column;align-items:center;width:100%;padding:24px}
/* Keep this clamp() byte-identical to HostedAuthForm.tsx / HostedAuthSkeleton.tsx
   \u2014 three files render the same column and any drift shows up as a width jump
   when the hosted page replaces this placeholder. */
.col{width:100%;max-width:clamp(300px, 60vw, 420px);display:flex;flex-direction:column;gap:10px}
.sk{background-color:rgba(255,255,255,0.04);background-image:linear-gradient(90deg,rgba(255,255,255,0) 0%,rgba(255,255,255,0.14) 50%,rgba(255,255,255,0) 100%);background-size:60vw 100%;background-repeat:no-repeat;background-attachment:fixed;animation:onelo-shimmer 2.4s linear infinite;border-radius:8px}
.strong{background-color:rgba(255,255,255,0.08);background-image:linear-gradient(90deg,rgba(255,255,255,0) 0%,rgba(255,255,255,0.20) 50%,rgba(255,255,255,0) 100%);background-size:60vw 100%;background-repeat:no-repeat;background-attachment:fixed;animation:onelo-shimmer 2.4s linear infinite;border-radius:9px}
.logo{width:64px;height:64px;border-radius:14px;margin-bottom:14px;background:rgba(255,255,255,0.06);border:1.5px solid rgba(255,255,255,0.1)}
.head{width:200px;height:22px;margin-bottom:10px;border-radius:6px}
.sub{width:140px;height:13px;opacity:0.7;margin-bottom:28px;border-radius:4px}
.lbl{width:38px;height:11px}
.lbl2{width:58px;height:11px}
.forgot{width:90px;height:11px;opacity:0.7}
.input{height:44px}
.cta{height:48px;margin-top:6px;border-radius:10px}
.row{display:flex;justify-content:space-between;align-items:center}
.link{width:200px;height:12px;opacity:0.6;margin-top:6px;align-self:center}
</style></head><body>
<div class="wrap">
<div class="sk logo"></div>
<div class="sk head"></div>
<div class="sk sub"></div>
<div class="col">
<div class="sk lbl"></div>
<div class="strong input" style="margin-bottom:2px"></div>
<div class="row"><div class="sk lbl2"></div><div class="sk forgot"></div></div>
<div class="strong input"></div>
<div class="strong cta"></div>
<div class="sk link"></div>
</div>
</div>
</body></html>`;
var _AuthModal = class _AuthModal {
  constructor() {
    this.overlay = null;
    this.container = null;
    this.popup = null;
    this.popupPoll = null;
    this.messageHandler = null;
    this.loadWatchdog = null;
    /** Fail-safe ✕ controller for the embedded overlay (see failsafe-close.ts). */
    this.failsafe = null;
    /** The skeleton iframe shown behind the hosted page until it paints. */
    this.skeleton = null;
  }
  clearLoadWatchdog() {
    if (this.loadWatchdog) {
      clearTimeout(this.loadWatchdog);
      this.loadWatchdog = null;
    }
  }
  open(hostedUrl, mode = "popup") {
    return new Promise((resolve) => {
      const allowedOrigin = new URL(hostedUrl).origin;
      let settled = false;
      const settle = (r) => {
        if (settled) return;
        settled = true;
        this.close();
        resolve(r);
      };
      this.messageHandler = (e) => {
        if (e.origin !== allowedOrigin) return;
        this.clearLoadWatchdog();
        const data = e.data;
        if (data?.type === "onelo:ready") {
          this.failsafe?.markReady();
          this.skeleton?.remove();
          this.skeleton = null;
        }
        if (data?.type === "onelo:code" && typeof data.code === "string") settle({ type: "code", code: data.code });
        else if (data?.type === "onelo:cancel") settle({ type: "cancelled" });
        else if (data?.type === "onelo:error") settle({ type: "error", message: String(data.message ?? "Auth error") });
      };
      window.addEventListener("message", this.messageHandler);
      if (mode === "popup") {
        this.popup = window.open(
          hostedUrl,
          "onelo-auth",
          "width=480,height=680,menubar=no,toolbar=no,location=no,status=no"
        );
        if (!this.popup) {
          settle({ type: "error", message: 'Popup was blocked. Allow popups for sign-in, or use loadAuthView({ mode: "embedded" }).' });
          return;
        }
        this.popupPoll = setInterval(() => {
          if (this.popup && this.popup.closed) settle({ type: "cancelled" });
        }, 400);
      } else {
        this.overlay = this.buildOverlay(hostedUrl);
        document.body.appendChild(this.overlay);
        const cancelBtn = this.overlay.querySelector("[data-onelo-cancel]");
        cancelBtn?.addEventListener("click", () => settle({ type: "cancelled" }));
        this.loadWatchdog = setTimeout(() => {
          settle({
            type: "error",
            message: `The hosted page could not be loaded inline \u2014 check this origin is in the app's allowed origins, or use loadAuthView({ mode: "popup" }).`
          });
        }, _AuthModal.EMBED_LOAD_TIMEOUT_MS);
      }
    });
  }
  close() {
    this.clearLoadWatchdog();
    this.failsafe?.dispose();
    this.failsafe = null;
    this.skeleton = null;
    if (this.messageHandler) {
      window.removeEventListener("message", this.messageHandler);
      this.messageHandler = null;
    }
    if (this.popupPoll) {
      clearInterval(this.popupPoll);
      this.popupPoll = null;
    }
    if (this.popup && !this.popup.closed) this.popup.close();
    this.popup = null;
    this.overlay?.remove();
    this.overlay = null;
    this.container = null;
  }
  buildOverlay(hostedUrl) {
    const overlay = document.createElement("div");
    overlay.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:2147483647",
      "background:#111"
    ].join(";");
    const container = document.createElement("div");
    container.style.cssText = [
      "position:absolute",
      "inset:0",
      "overflow:hidden",
      "background:#111"
    ].join(";");
    this.container = container;
    const skeleton = document.createElement("iframe");
    skeleton.setAttribute("aria-hidden", "true");
    skeleton.setAttribute("sandbox", "");
    skeleton.srcdoc = AUTH_SKELETON_HTML;
    skeleton.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:none;pointer-events:none;";
    this.skeleton = skeleton;
    const iframe = document.createElement("iframe");
    iframe.src = hostedUrl;
    iframe.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:none;";
    iframe.setAttribute("sandbox", "allow-scripts allow-forms allow-same-origin allow-popups");
    const cancelBtn = createModalCloseButton();
    this.failsafe = installFailsafeClose(cancelBtn);
    container.appendChild(skeleton);
    container.appendChild(iframe);
    container.appendChild(cancelBtn);
    overlay.appendChild(container);
    return overlay;
  }
};
/** How long to wait for the embedded hosted page to prove it loaded (it posts
 *  an early `onelo:resize` on render). If the iframe is refused by the page's
 *  frame-ancestors CSP — or fails to load — it renders and posts NOTHING, so
 *  silence past this window means "blocked"; we then surface an actionable
 *  error (suggest popup) instead of leaving a silent blank overlay. Generous
 *  so a slow first paint on a poor connection never false-positives — a real
 *  block posts nothing regardless of how long we wait. */
_AuthModal.EMBED_LOAD_TIMEOUT_MS = 12e3;
var AuthModal = _AuthModal;

// src/auth/auth.ts
var import_core5 = __toESM(require_dist());

// package.json
var version = "0.36.2-staging";

// src/auth/auth.ts
var _OneloAuth = class _OneloAuth {
  constructor(config) {
    this.pkceVerifier = null;
    this.resolvedConfig = null;
    this.heartbeatTimer = null;
    this.refreshTimer = null;
    // ── Refresh coordination (fixes multi-tab / concurrent forced-logout) ──────
    // The backend rotates the refresh token on every refresh and HARD-revokes the
    // whole session family if an already-rotated token is reused (sdk_auth.py
    // reuse detection). So two refreshes with the SAME token — two tabs sharing
    // one localStorage token, or a reload racing the background refresh timer, or
    // concurrent getSession() calls — make the second look like a stolen-token
    // replay and log the user out. Two layers stop that:
    //  1. `refreshInFlight` — single-flight WITHIN this tab: concurrent callers
    //     collapse onto one in-progress refresh instead of each firing their own.
    //  2. a cross-tab Web Lock (see _refreshCoordinated) so only one tab refreshes
    //     at a time, and each reads the freshest token INSIDE the lock.
    this.refreshInFlight = null;
    this.authStateListeners = [];
    this.isReady = false;
    this.isRevoked = false;
    /** True once the backend reports this USER's session is no longer valid
     *  (revoked / banned / all sessions server-revoked) — surfaced via the
     *  heartbeat 401 or a refresh user_revoked. Parity with Swift isUserRevoked. */
    this.isUserRevoked = false;
    // Monotonic sign-out counter. signOut() bumps it; any in-flight refresh /
    // revalidate captures it before its network await and bails BEFORE writing
    // tokens back if it moved — prevents the "logged out but bounced right back"
    // race (a proactive refresh completing just after sign-out). Parity with
    // Swift's _signOutEpoch.
    this.signOutEpoch = 0;
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
        manageUrl: j["manage_url"] ?? null,
        // Branding page background (--onelo-page-bg / checkout_bg_color). Required
        // by the shared ResolvedSDKConfig; parity with RN's resolver. Default dark.
        pageBackgroundColor: j["checkout_bg_color"] || "#111111"
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
  /**
   * Open the Onelo hosted flow (sign-in → store → content).
   *
   * The routing decision is CENTRALISED on the backend (`/api/sdk/flow/init`)
   * so every SDK behaves identically — there is no per-SDK paywall / sign-in-vs-
   * store logic left to drift (the class of bug that let JS jump straight to the
   * store and skip sign-in). We send our current session (if any); the backend
   * decides ONCE:
   *   - authorized      → we already have access → return the session (content).
   *   - present sign-in → open /auth/hosted (it chains sign-in → store → done
   *                       itself when a paywall applies).
   *   - present store   → signed-in, no plan → open /store/hosted (bound to us).
   * Either "present" surface ends by postMessaging ONE final code, which we
   * exchange for a session. Waitlist redirect stays here — it's a plain
   * redirect, not a routing decision the backend flow owns.
   *
   * @param options.mode  'embedded' (default) renders the hosted page inline in
   *   an iframe — the web equivalent of Swift's WKWebView, never popup-blocked
   *   (requires the app origin in allowed origins; localhost works on a test
   *   key). 'popup' opens a top-level window.
   */
  async loadAuthView(options) {
    await this.initPromise;
    if (this.isRevoked) throw import_core5.OneloError.invalidKey("Application key has been revoked");
    const mode = options?.mode ?? "embedded";
    if (this.waitlistMode && this.sdkRedirectUrl) {
      window.open(this.sdkRedirectUrl, "_blank");
      return null;
    }
    const existing = await this.getSession();
    const decision = await this.resolveFlow(existing?.accessToken ?? null);
    if (decision.action === "authorized") {
      if (this.paywallEnabled) await this.revalidateEntitlement().catch(() => {
      });
      return await this.getSession() ?? existing;
    }
    const modal = new AuthModal();
    const result = await modal.open(decision.url, mode);
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
  /**
   * Resolve the next flow step from the backend. Sends the current access token
   * (if any) as a Bearer so the backend sees whether we're signed in + entitled,
   * then returns 'authorized' (no UI) or 'present' with the hosted URL to open.
   */
  async resolveFlow(accessToken) {
    const headers = { "X-SDK-Version": version };
    if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
    const { status, json } = await (0, import_core3.httpGet)(
      `${this.apiUrl}/api/sdk/flow/init?key=${encodeURIComponent(this.publishableKey)}&callback_scheme=onelo-callback`,
      headers
    );
    if (status !== 200) {
      const detail = json?.["detail"];
      const reason = typeof detail === "string" ? detail : `HTTP ${status}`;
      throw import_core5.OneloError.server(`Failed to resolve auth flow: ${reason}`);
    }
    const j = json;
    if (j["action"] === "authorized") return { action: "authorized" };
    if (j["action"] === "present" && typeof j["url"] === "string") {
      if (j["app_name"]) this.appName = j["app_name"];
      if (j["app_logo_url"]) this.appLogoUrl = j["app_logo_url"];
      return { action: "present", surface: String(j["surface"] ?? ""), url: j["url"] };
    }
    throw import_core5.OneloError.server("Invalid flow response");
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
    this.signOutEpoch++;
    this.stopHeartbeat();
    this.clearRefreshTimer();
    const accessToken = await this.storage.get(import_core.TOKEN_KEYS.ACCESS_TOKEN);
    await this.storage.clear();
    this.notifyListeners(null);
    if (accessToken) {
      try {
        await (0, import_core3.httpPost)(
          `${this.apiUrl}/api/sdk/auth/signout`,
          {},
          {
            "X-SDK-Version": version,
            Authorization: `Bearer ${accessToken}`,
            "X-Publishable-Key": this.publishableKey
          }
        );
      } catch {
      }
    }
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
    if (this.heartbeatTimer === null) {
      this.startHeartbeat(session.accessToken);
      this.notifyListeners(session);
      if (this.paywallEnabled) void this.revalidateEntitlement();
    }
    return session;
  }
  /**
   * True when the current session's user has an active paid entitlement.
   * Snapshot read of the persisted session (no network) — mirrors Swift's
   * `hasActiveAccess`. Returns false when there is no session.
   */
  async hasActiveAccess() {
    const session = await this.getSession();
    return session?.user.entitlement === "active";
  }
  /**
   * Re-fetch the user's entitlement from the backend and, if it changed,
   * rebuild + persist the session so `hasActiveAccess()` and auth-state
   * listeners see the new value. Call after an external checkout or on app
   * resume. Best-effort: returns the currently-cached entitlement on any
   * non-200/network failure and never throws (mirrors Swift
   * `revalidateEntitlement`).
   */
  async revalidateEntitlement() {
    const epoch = this.signOutEpoch;
    const session = await this.getSession();
    if (!session) return "none";
    try {
      const { status, json } = await (0, import_core3.httpGet)(
        `${this.apiUrl}/api/sdk/auth/user`,
        {
          "X-SDK-Version": version,
          Authorization: `Bearer ${session.accessToken}`,
          "X-Publishable-Key": this.publishableKey
        }
      );
      if (status !== 200) return session.user.entitlement;
      const next = json["entitlement"] === "active" ? "active" : "none";
      if (next !== session.user.entitlement && epoch === this.signOutEpoch) {
        await this.saveSession({ ...session, user: { ...session.user, entitlement: next } });
      }
      return next;
    } catch {
      return session.user.entitlement;
    }
  }
  /** Refresh the access token, rotating the refresh token. Coordinated so the
   *  SAME refresh token is never sent twice (which the backend treats as a
   *  stolen-token replay and hard-revokes the whole session — the multi-tab /
   *  reload-race forced-logout bug). Layer 1: single-flight within this tab.
   *  Layer 2: a cross-tab Web Lock. Falls back to a plain refresh where Web
   *  Locks are unavailable or the lock wait times out. */
  async refreshSession() {
    if (this.refreshInFlight) return this.refreshInFlight;
    const epoch = this.signOutEpoch;
    this.refreshInFlight = this._refreshCoordinated(epoch);
    try {
      return await this.refreshInFlight;
    } finally {
      this.refreshInFlight = null;
    }
  }
  /** Layer 2 — cross-tab exclusivity via the Web Locks API. Only one tab holds
   *  the lock at a time; the winner's `_doRefresh` reads the refresh token
   *  INSIDE the lock, so a tab that waited reads the already-rotated token (or a
   *  still-fresh one) rather than the stale token another tab just used. */
  async _refreshCoordinated(epoch) {
    const locks = typeof navigator !== "undefined" ? navigator.locks : void 0;
    if (!locks || typeof locks.request !== "function") {
      return this._doRefresh(epoch);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), _OneloAuth.REFRESH_LOCK_TIMEOUT_MS);
    let started = false;
    try {
      return await locks.request(
        `${_OneloAuth.REFRESH_LOCK_PREFIX}:${this.publishableKey}`,
        { signal: controller.signal },
        () => {
          started = true;
          return this._doRefresh(epoch);
        }
      );
    } catch (e) {
      if (!started && (controller.signal.aborted || e instanceof DOMException && e.name === "AbortError")) {
        return this._doRefresh(epoch);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  async _doRefresh(epoch) {
    const refreshToken = await this.storage.get(import_core.TOKEN_KEYS.REFRESH_TOKEN);
    if (!refreshToken) return null;
    const { status, json } = await (0, import_core3.httpPost)(
      `${this.apiUrl}/api/sdk/auth/refresh`,
      // Wire key MUST be snake_case `refresh_token`: the backend
      // RefreshRequest model (sdk_auth.py) requires it and rejects a
      // camelCase `refreshToken` with a hard 422 (the handler never runs).
      // Matches every response payload + the Swift SDK request.
      { publishableKey: this.publishableKey, refresh_token: refreshToken },
      { "X-SDK-Version": version }
    );
    (0, import_core3.checkHostedFlowRequired)(json);
    const j = json;
    if (status !== 200) {
      this.clearRefreshTimer();
      await this.storage.clear();
      this.notifyListeners(null);
      const detail = j["detail"];
      const reason = detail?.["error"] ?? detail?.["error_code"];
      if (reason === "banned" || reason === "session_compromised") {
        this.isUserRevoked = true;
        throw import_core5.OneloError.userRevoked();
      }
      if (reason === "no_plan_available") {
        throw import_core5.OneloError.noActivePlan();
      }
      return null;
    }
    if (epoch !== this.signOutEpoch) return null;
    const session = (0, import_core4.mapSession)(j);
    await this.saveSession(session);
    return session;
  }
  /**
   * Wire the shared event stream (called once by Onelo). Registers a
   * `session.revoked` listener so a server-side revoke (refund lapse, admin
   * force-logout, account deletion, ban) signs the user out in ~sub-second —
   * the real-time complement to the ≤13-min heartbeat fallback. Registered once
   * and survives sign-in/sign-out cycles, exactly like the Swift SDK.
   */
  attachEventStream(stream) {
    stream.on("session.revoked", (data) => {
      void this._handleSessionRevoked(data);
    });
  }
  /**
   * Handle a `session.revoked` push. Filters to the current user (one app can
   * have multiple buyers multiplexed on the shared stream); a missing
   * `app_user_id` is treated as "current user" (forward-compat). No session →
   * ignore. Teardown mirrors the heartbeat-401 path exactly.
   */
  async _handleSessionRevoked(data) {
    const userJson = await this.storage.get(import_core.TOKEN_KEYS.USER_JSON);
    if (!userJson) return;
    let currentUserId;
    try {
      currentUserId = JSON.parse(userJson).id;
    } catch {
    }
    const eventUserId = data["app_user_id"];
    if (typeof eventUserId === "string" && currentUserId && eventUserId !== currentUserId) {
      return;
    }
    this.stopHeartbeat();
    this.clearRefreshTimer();
    await this.storage.clear();
    this.isUserRevoked = true;
    this.notifyListeners(null);
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
        const res = await fetch(`${this.apiUrl}/api/sdk/presence/heartbeat`, {
          method: "POST",
          headers: { Authorization: `Bearer ${session.accessToken}` }
        });
        if (res.status === 401) {
          this.stopHeartbeat();
          this.clearRefreshTimer();
          await this.storage.clear();
          this.isUserRevoked = true;
          this.notifyListeners(null);
        }
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
    this.startHeartbeat(session.accessToken);
    this.scheduleRefresh(session);
    this.notifyListeners(session);
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
/** Web Lock name — scoped per publishable key so sibling apps don't serialise
 *  against each other. */
_OneloAuth.REFRESH_LOCK_PREFIX = "onelo_auth_refresh";
/** Bound the WAIT for the cross-tab lock. A stuck/orphaned holder must never
 *  hang refresh forever (the class of bug that froze supabase-js auth — Web
 *  Locks issues #1594/#2111); on timeout we fall back to an un-serialised
 *  refresh, which is strictly better than hanging or dropping the session. */
_OneloAuth.REFRESH_LOCK_TIMEOUT_MS = 5e3;
var OneloAuth = _OneloAuth;

// src/features/features.ts
var import_core6 = __toESM(require_dist());
var KNOWN_STATUSES = /* @__PURE__ */ new Set([
  "enabled",
  "disabled",
  "greyed",
  "hidden",
  "upsell",
  "new",
  "beta",
  "coming_soon"
]);
function normalizeStatus(status) {
  return KNOWN_STATUSES.has(status) ? status : "hidden";
}
var KNOWN_REASONS = /* @__PURE__ */ new Set([
  "user_override",
  "plan",
  "default",
  "static",
  "paywall_no_plan",
  "paywall_off",
  "suspended",
  "unknown"
]);
function normalizeReason(reason) {
  if (reason == null) return void 0;
  return KNOWN_REASONS.has(reason) ? reason : "unknown";
}
function wireToEntry(w) {
  return {
    status: normalizeStatus(w.status),
    reason: normalizeReason(w.reason),
    requiredPlan: w.required_plan,
    requiredPlanLabel: w.required_plan_label,
    upgradeCta: w.upgrade_cta ?? false
  };
}
var FeatureState = class {
  constructor(name, status, reason, requiredPlan, requiredPlanLabel, upgradeCta = false) {
    this.name = name;
    this.status = status;
    this.reason = reason;
    this.requiredPlan = requiredPlan;
    this.requiredPlanLabel = requiredPlanLabel;
    this.upgradeCta = upgradeCta;
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
  /** Promo/lock badge (parity with Swift): New/Beta/Coming Soon, 🔒 for greyed
   *  (locked — never hide it), and "Available in <plan>" for upsell. */
  get badgeLabel() {
    switch (this.status) {
      case "new":
        return "New";
      case "beta":
        return "Beta";
      case "coming_soon":
        return "Coming Soon";
      case "greyed":
        return "\u{1F512}";
      case "upsell":
        if (this.requiredPlanLabel) return `Available in ${this.requiredPlanLabel}`;
        if (this.requiredPlan) return `Available in ${this.requiredPlan}`;
        return "Upgrade";
      default:
        return null;
    }
  }
  /** Non-null when the feature is plan-blocked AND the backend named the
   *  unlocking plan — surface in upgrade-prompt UI. */
  get upgradeHint() {
    if (this.reason === "plan" && this.requiredPlan && (this.status === "greyed" || this.status === "hidden" || this.status === "upsell" || this.status === "coming_soon")) {
      return { requiredPlan: this.requiredPlan, currentStatus: this.status };
    }
    return null;
  }
};
var OneloFeaturesError = class _OneloFeaturesError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.code = code;
    this.name = "OneloFeaturesError";
    Object.setPrototypeOf(this, _OneloFeaturesError.prototype);
  }
};
var CACHE_KEY_PREFIX = "onelo_features_";
var INSTANCE_KEY = "onelo_feature_instance_id";
var REFRESH_DEBOUNCE_MS = 1e3;
var cachedInstanceId = null;
function resolveInstanceId() {
  if (cachedInstanceId) return cachedInstanceId;
  const gen = () => typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `js_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  try {
    if (typeof localStorage !== "undefined") {
      const existing = localStorage.getItem(INSTANCE_KEY);
      if (existing) {
        cachedInstanceId = existing;
        return existing;
      }
      const id = gen();
      localStorage.setItem(INSTANCE_KEY, id);
      cachedInstanceId = id;
      return id;
    }
  } catch {
  }
  cachedInstanceId = gen();
  return cachedInstanceId;
}
var OneloFeatures = class {
  constructor(apiUrl, publishableKey, monitor, options) {
    this.cache = /* @__PURE__ */ new Map();
    this.discoveredNames = /* @__PURE__ */ new Set();
    this.configVersion = 0;
    this.pingDebounce = null;
    this.currentUserId = null;
    // Secure-mode targeting hash (HMAC computed on the DEV's server, forwarded
    // here — the SDK never has the secret). Threaded into resolve/batch-ping/SSE.
    this.currentUserIdHash = null;
    this.instanceId = resolveInstanceId();
    this.monitor = null;
    // Change subscribers — fired whenever the resolved snapshot mutates (SSE Deploy,
    // identity swap, invalidateCache) so React/Vue hosts can re-render. Parity with
    // Electron/RN subscribe().
    this.changeListeners = /* @__PURE__ */ new Set();
    this.anonymousWarningLogged = false;
    // Live-update channel: the shared multiplexed event stream, owned by Onelo
    // and attached post-construction via attachStream(). Null in environments or
    // tests that never wire one — load() then falls back to a one-shot resolve.
    this.stream = null;
    // ready() cold-start sync — resolved on the first applied snapshot or timeout
    // (parity with Swift firstEventReceived + readyWaiters).
    this.firstEventReceived = false;
    this.readyWaiters = /* @__PURE__ */ new Set();
    // refresh() debounce cursor (parity with Swift lastRefreshAt).
    this.lastRefreshAt = 0;
    this.apiUrl = apiUrl;
    this.publishableKey = publishableKey;
    if (monitor) this.monitor = monitor;
    this.suppressIdentifyWarning = options?.suppressIdentifyWarning ?? false;
    this.featureEnvironment = options?.featureEnvironment;
    this.defaultStatus = options?.featureDefaultStatus ?? "hidden";
  }
  /** Subscribe to feature-state changes — fired on every snapshot mutation (an
   *  admin's Deploy over SSE, an identity swap, invalidateCache). Returns an
   *  unsubscribe function. Use it to re-read feature() and re-render (React: wrap
   *  in useSyncExternalStore; Vue: trigger a ref). Parity with Electron/RN. */
  subscribe(listener) {
    this.changeListeners.add(listener);
    return () => {
      this.changeListeners.delete(listener);
    };
  }
  _emitChange() {
    for (const l of this.changeListeners) {
      try {
        l();
      } catch {
      }
    }
  }
  /**
   * Wire the shared multiplexed event stream (called once by Onelo). Registers
   * features' listeners + the dynamic query params (`since_version` changes over
   * the connection's life; `environment` is optional). Handlers survive
   * reconnects and receive the already-parsed event `data`.
   */
  attachStream(stream) {
    this.stream = stream;
    stream.addParamProvider(() => {
      const p = { since_version: String(this.configVersion), instance_id: this.instanceId };
      if (this.featureEnvironment) p["environment"] = this.featureEnvironment;
      if (this.currentUserIdHash) p["userIdHash"] = this.currentUserIdHash;
      return p;
    });
    const applyIfSnapshot = (data) => {
      const features = data["features"];
      if (features) {
        const v = typeof data["config_version"] === "number" ? data["config_version"] : this.configVersion;
        this._applySnapshot(v, features);
      }
    };
    stream.on("connected", (data) => {
      applyIfSnapshot(data);
      this._signalFirstEvent();
    });
    stream.on("features_updated", applyIfSnapshot);
    stream.on("up_to_date", (data) => {
      if (typeof data["config_version"] === "number") this.configVersion = data["config_version"];
      this._signalFirstEvent();
    });
    stream.onLifecycleResume(() => {
      void this.refresh();
    });
    stream.on("discovery_requested", () => this._scheduleBatchPing());
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
    const entry = this.cache.get(name);
    const status = entry?.status ?? this.defaultStatus;
    this.monitor?.recordFlag?.(name, status);
    return new FeatureState(name, status, entry?.reason, entry?.requiredPlan, entry?.requiredPlanLabel, entry?.upgradeCta ?? false);
  }
  /** Load features for a user (or anonymous). Called by Onelo orchestrator.
   * Restores cache for instant UI, then opens an SSE channel that delivers
   * live updates whenever an admin clicks Deploy in the dashboard. */
  async load(userId, userIdHash) {
    this.currentUserId = userId;
    this.currentUserIdHash = userIdHash ?? null;
    this._loadCache(userId);
    this._emitChange();
    await this._batchPing();
    if (this.stream && typeof EventSource !== "undefined") {
      this.stream.start(userId);
    } else {
      await this._resolve(userId);
    }
  }
  /** Returns names of all features with an active status (enabled, new, or beta). */
  getActiveFeatures() {
    const active = [];
    for (const [name, entry] of this.cache) {
      if (entry.status === "enabled" || entry.status === "new" || entry.status === "beta") {
        active.push(name);
      }
    }
    return active;
  }
  /** Clear features' own background timer. The shared event stream is owned and
   * torn down by Onelo (see Onelo.destroy → stream.destroy), NOT here — closing
   * it from features would also drop auth's session.revoked subscription. Kept
   * named `stopPolling` for back-compat with the old polling-based API. */
  stopPolling() {
    if (this.pingDebounce !== null) {
      clearTimeout(this.pingDebounce);
      this.pingDebounce = null;
    }
  }
  /** Clears the local feature cache and resets the config version, then forces
   * the shared stream to reconnect so the server resends a full snapshot
   * (`since_version=0`). Without the reconnect a live connection stays silent
   * and the cache would only refill on the next admin Deploy. */
  invalidateCache() {
    this.cache.clear();
    this.configVersion = 0;
    this._writeCache();
    this._emitChange();
    this.stream?.reconnect();
  }
  /** Resolves once the first live snapshot has been applied (SSE `connected` /
   * `up_to_date`, or a REST resolve), or after `timeoutMs` — whichever first.
   * Never rejects. Lets a host await a settled state before first paint to avoid
   * a resolve→SSE flicker. Parity with Swift `ready(timeout:)`. Multiple callers
   * resolve together on the first event (or each on its own timeout). */
  ready(timeoutMs = 1500) {
    if (this.firstEventReceived) return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        this.readyWaiters.delete(finish);
        resolve();
      };
      this.readyWaiters.add(finish);
      setTimeout(finish, Math.max(0, timeoutMs));
    });
  }
  /** Force-reconcile the snapshot from the server via REST (does NOT touch the
   * SSE stream). Debounced to one call/sec unless `force` (use force from a
   * user-initiated "Refresh" action). Never throws — a network error leaves the
   * cached state intact and SSE catches up later. Parity with Swift
   * `refresh(force:)`. */
  async refresh(force = false) {
    const now = Date.now();
    if (!force && now - this.lastRefreshAt < REFRESH_DEBOUNCE_MS) return;
    this.lastRefreshAt = now;
    await this._resolve(this.currentUserId);
  }
  /** Requests a short-lived (60s) per-feature JWT from
   * `POST /api/sdk/features/module-token` — proof the current user is entitled
   * to `slug`, which the host forwards to its OWN backend/CDN to gate code
   * download. The backend re-verifies entitlement on every request. Parity with
   * Swift `moduleToken(for:)`.
   *
   * Throws {@link OneloFeaturesError}:
   * - `not_authenticated` — no user identified yet (no network call is made)
   * - `not_entitled` (403) — the user lacks access to `slug`
   * - `secure_mode_required` (401) — app requires `userIdHash`, none supplied
   * - `invalid_user_hash` (401) — supplied `userIdHash` failed backend HMAC
   * - `network_error` — transport failure or malformed response */
  async moduleToken(slug) {
    if (!this.currentUserId) throw new OneloFeaturesError("not_authenticated");
    const body = {
      publishableKey: this.publishableKey,
      userId: this.currentUserId,
      slug
    };
    if (this.currentUserIdHash) body["userIdHash"] = this.currentUserIdHash;
    let status;
    let json;
    try {
      const res = await (0, import_core6.httpPost)(`${this.apiUrl}/api/sdk/features/module-token`, body);
      status = res.status;
      json = res.json ?? {};
    } catch {
      throw new OneloFeaturesError("network_error");
    }
    if (status === 200) {
      const token = json["token"];
      if (typeof token === "string" && token.length > 0) return token;
      throw new OneloFeaturesError("network_error");
    }
    if (status === 401) {
      const detail = json["detail"];
      const errCode = detail?.["error"] ?? json["error"];
      if (errCode === "secure_mode_required") throw new OneloFeaturesError("secure_mode_required");
      if (errCode === "invalid_user_hash") throw new OneloFeaturesError("invalid_user_hash");
      throw new OneloFeaturesError("not_authenticated");
    }
    if (status === 403) throw new OneloFeaturesError("not_entitled");
    throw new OneloFeaturesError("network_error");
  }
  // ── Private ──────────────────────────────────────────────────────────────────
  /** Signals all pending ready() callers that the first snapshot arrived.
   * Idempotent — subsequent calls are no-ops. Parity with Swift
   * `_signalFirstEvent`. */
  _signalFirstEvent() {
    if (this.firstEventReceived) return;
    this.firstEventReceived = true;
    const waiters = Array.from(this.readyWaiters);
    this.readyWaiters.clear();
    for (const w of waiters) w();
  }
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
    const isTestEnv = this.featureEnvironment === "test" || this.publishableKey.includes("_test_");
    if (!isTestEnv && Math.random() > 0.01) return;
    try {
      await (0, import_core6.httpPost)(
        `${this.apiUrl}/api/sdk/features/batch-ping`,
        {
          publishableKey: this.publishableKey,
          features: names,
          ...this.currentUserIdHash ? { userIdHash: this.currentUserIdHash } : {},
          ...this.featureEnvironment ? { environment: this.featureEnvironment } : {}
        },
        {
          // Trust-on-first-use device id — REQUIRED or the backend 403s
          // test-env discovery with `missing_instance_id`.
          "X-Onelo-Instance-Id": this.instanceId,
          // Explicit SDK platform. A browser `fetch` CANNOT set User-Agent (it's
          // a forbidden header), so the backend's UA-based platform detection
          // sees "Mozilla/…" and stores sdk_platform = NULL for every web app.
          // Sending it explicitly lets the registry + Deploy Access show "JS"
          // (the SSE path already reports platform=js the same way).
          "X-Onelo-Sdk-Platform": "js"
        }
      );
    } catch {
    }
  }
  async _resolve(userId) {
    try {
      const body = { publishableKey: this.publishableKey };
      if (userId) body["userId"] = userId;
      if (this.currentUserIdHash) body["userIdHash"] = this.currentUserIdHash;
      if (this.featureEnvironment) body["environment"] = this.featureEnvironment;
      const { status, json } = await (0, import_core6.httpPost)(`${this.apiUrl}/api/sdk/features/resolve`, body);
      if (status !== 200) return;
      const j = json;
      const features = j["features"];
      if (features) {
        this._applySnapshot(typeof j["config_version"] === "number" ? j["config_version"] : this.configVersion, features);
      }
      this._maybeWarnAnonymous(j);
      this._signalFirstEvent();
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
      for (const [name, cached] of Object.entries(parsed.features)) {
        if (typeof cached === "string") {
          this.cache.set(name, { status: normalizeStatus(cached), upgradeCta: false });
        } else if (cached && typeof cached === "object") {
          this.cache.set(name, {
            status: normalizeStatus(cached.status),
            reason: normalizeReason(cached.reason),
            requiredPlan: cached.requiredPlan,
            requiredPlanLabel: cached.requiredPlanLabel,
            upgradeCta: cached.upgradeCta ?? false
          });
        }
      }
    } catch {
    }
  }
  _writeCache() {
    if (typeof localStorage === "undefined") return;
    try {
      const features = {};
      for (const [name, entry] of this.cache) features[name] = entry;
      const snapshot = { configVersion: this.configVersion, features };
      localStorage.setItem(this._cacheKey(this.currentUserId), JSON.stringify(snapshot));
    } catch {
    }
  }
  _applySnapshot(version2, features) {
    this.configVersion = version2;
    this.cache.clear();
    for (const [name, wire] of Object.entries(features)) {
      this.cache.set(name, wireToEntry(wire));
    }
    this._writeCache();
    this._emitChange();
  }
};

// src/monitor/scrubber.ts
var REDACTED = "[REDACTED]";
var MAX_DEPTH = 10;
var KEY_DENYLIST = [
  "password",
  "passwd",
  "secret",
  "token",
  "api_key",
  "apikey",
  "authorization",
  "cookie",
  "credential",
  "private_key",
  "client_secret",
  "cvv",
  "ssn"
];
var VALUE_PATTERNS = [
  /(^|[^A-Za-z0-9])Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /(^|[^A-Za-z0-9])eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+(?![A-Za-z0-9])/g,
  // JWT
  /(^|[^A-Za-z0-9])(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}(?![A-Za-z0-9])/g,
  // Stripe-style
  /(^|[^A-Za-z0-9])onelo_(?:pk|sk|rk)_(?:live|test)_[A-Za-z0-9]{8,}(?![A-Za-z0-9])/g,
  // Onelo keys
  /(^|[^A-Za-z0-9])(?:4[0-9]{3}|5[1-5][0-9]{2}|3[47][0-9]{2}|6(?:011|5[0-9]{2}))[\s-][0-9]{4}[\s-][0-9]{4}[\s-][0-9]{4}(?![A-Za-z0-9])/g,
  // CC separated
  /(^|[^A-Za-z0-9])(?:4|5[1-5]|6(?:011|5))[0-9]{14,}(?![0-9])/g,
  // CC unseparated
  /(^|[^A-Za-z0-9])3[47][0-9]{13,}(?![0-9])/g
  // Amex
];
function keyIsPii(key) {
  const k = key.toLowerCase();
  if (KEY_DENYLIST.some((p) => k.includes(p))) return true;
  return k.replace(/-/g, "_").split("_").includes("key");
}
function scrubText(text) {
  let out = text;
  for (const pat of VALUE_PATTERNS) out = out.replace(pat, (_m, boundary) => boundary + REDACTED);
  return out;
}
function scrubValue(value, redacted, depth) {
  if (depth >= MAX_DEPTH) return REDACTED;
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, redacted, depth + 1));
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "_onelo_redacted") {
        out[k] = v;
        continue;
      }
      if (keyIsPii(k)) {
        redacted.add(k);
        out[k] = REDACTED;
      } else out[k] = scrubValue(v, redacted, depth + 1);
    }
    return out;
  }
  if (typeof value === "string") return scrubText(value);
  return value;
}
function scrubMeta(meta) {
  if (meta == null) return meta;
  const redacted = /* @__PURE__ */ new Set();
  const cleaned = scrubValue(meta, redacted, 0);
  if (redacted.size > 0) cleaned["_onelo_redacted"] = Array.from(redacted).sort();
  return cleaned;
}

// src/monitor/monitor.ts
var SDK_NAME = "@onelo/js";
var MAX_BUFFER_SIZE = 200;
var MAX_FLAGS = 100;
var MAX_BREADCRUMBS = 100;
var PLATFORM = "js";
var SESSION_KEY = "onelo_monitor_session";
function _resolveSessionId() {
  try {
    if (typeof localStorage !== "undefined") {
      const existing = localStorage.getItem(SESSION_KEY);
      if (existing) return existing;
      const id = crypto.randomUUID();
      localStorage.setItem(SESSION_KEY, id);
      return id;
    }
  } catch {
  }
  return crypto.randomUUID();
}
function _deviceContext() {
  const d = {};
  if (typeof navigator !== "undefined") {
    if (navigator.userAgent) d["userAgent"] = navigator.userAgent;
    if (navigator.language) d["language"] = navigator.language;
    const conn = navigator.connection;
    if (conn?.effectiveType) d["connection"] = conn.effectiveType;
    const mem = navigator.deviceMemory;
    if (typeof mem === "number") d["deviceMemoryGb"] = mem;
  }
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) d["timezone"] = tz;
  } catch {
  }
  return d;
}
function _extractError(err) {
  if (err instanceof Error) return { message: err.message, stack: err.stack, errorType: err.name };
  return { message: String(err) };
}
var _activeMonitor = null;
var _handlersInstalled = false;
function _installGlobalHandlers() {
  if (_handlersInstalled) return;
  if (typeof window !== "undefined") {
    _handlersInstalled = true;
    window.addEventListener("unhandledrejection", (e) => {
      _activeMonitor?._onGlobalError(
        e.reason instanceof Error ? e.reason.message : String(e.reason),
        e.reason instanceof Error ? e.reason.stack : void 0
      );
    });
    window.addEventListener("error", (e) => {
      _activeMonitor?._onGlobalError(e.message ?? "Unknown error", e.error instanceof Error ? e.error.stack : void 0);
    });
    const beacon = () => {
      void _activeMonitor?.flush(true);
    };
    window.addEventListener("beforeunload", beacon);
    window.addEventListener("pagehide", beacon);
    return;
  }
  const proc = globalThis.process;
  if (proc && typeof proc.on === "function") {
    _handlersInstalled = true;
    proc.on("uncaughtExceptionMonitor", (err) => {
      const { message, stack } = _extractError(err);
      _activeMonitor?._onGlobalError(message, stack);
    });
  }
}
var OneloMonitor = class {
  constructor(publishableKey, apiUrl, context) {
    this.sessionId = _resolveSessionId();
    this.buffer = [];
    // Rolling snapshot of the most recently evaluated feature flags (name→status),
    // LRU-capped. Attached to ERROR events so a captured error carries the active
    // flag state — the flag↔error correlation feature (parity with Swift).
    this.flags = /* @__PURE__ */ new Map();
    // Ring buffer of breadcrumbs (the trail leading up to an error). Snapshotted
    // into meta.breadcrumbs on error events (parity with Swift).
    this.breadcrumbs = [];
    this.flushTimer = null;
    this.currentUserId = null;
    this.publishableKey = publishableKey;
    this.apiUrl = apiUrl;
    const app = {};
    if (context?.appVersion) app.version = context.appVersion;
    if (context?.appBuild) app.build = context.appBuild;
    if (context?.bundleId) app.bundleId = context.bundleId;
    this.staticMeta = {
      sdk: { name: SDK_NAME, version },
      ...Object.keys(app).length > 0 ? { app } : {}
    };
    this.environment = context?.environment;
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, 15e3);
    _activeMonitor = this;
    _installGlobalHandlers();
  }
  /**
   * Returns a new meta object with always-on context merged in. SDK-owned keys
   * (`sdk`, `app`) are authoritative and override any caller-supplied value;
   * `environment` is only filled when the caller did not set it per-event.
   * Never mutates the caller's meta.
   */
  _enrich(meta) {
    const out = { ...meta ?? {}, ...this.staticMeta };
    if (this.environment != null && out["environment"] == null) {
      out["environment"] = this.environment;
    }
    return out;
  }
  /** Sets the current user ID attached to all subsequent monitor events. Call after login/logout if not using Onelo Auth. */
  setUserId(userId) {
    this.currentUserId = userId;
  }
  _trackFeatureCall(featureName) {
    this._push(featureName, true, void 0, void 0, void 0, "feature_call");
  }
  /**
   * Record the current value of a feature flag for flag↔error correlation.
   * Called by OneloFeatures on every evaluation. LRU: re-recording a key moves
   * it to most-recent; the buffer is capped at MAX_FLAGS. Not an event — just
   * updates the snapshot attached to future error captures.
   */
  recordFlag(key, value) {
    if (this.flags.has(key)) this.flags.delete(key);
    this.flags.set(key, value);
    if (this.flags.size > MAX_FLAGS) {
      const oldest = this.flags.keys().next().value;
      if (oldest !== void 0) this.flags.delete(oldest);
    }
  }
  async track(featureName, fn, options) {
    const start = Date.now();
    try {
      const result = await fn();
      this._push(featureName, true, Date.now() - start, void 0, options?.meta, "track");
      return result;
    } catch (err) {
      const { message, stack, errorType } = _extractError(err);
      this._push(featureName, false, Date.now() - start, message, this._withError(options?.meta, stack, errorType), "track");
      throw err;
    }
  }
  event(featureName, opts) {
    this._push(featureName, opts.ok, opts.durationMs, opts.error, opts.meta, "event");
  }
  /**
   * Add a breadcrumb — a step in the trail leading to an error. Snapshotted into
   * `meta.breadcrumbs` on the next error capture. Ring-buffered (cap 100). The
   * message is scrubbed of secrets on the way in. Parity with Swift.
   */
  breadcrumb(message, opts) {
    this.breadcrumbs.push({
      category: opts?.category ?? "info",
      message: scrubText(message),
      ts: Date.now(),
      ...opts?.data ? { data: opts.data } : {}
    });
    if (this.breadcrumbs.length > MAX_BREADCRUMBS) this.breadcrumbs.shift();
  }
  /**
   * Manually capture an error/exception with its stack + the active breadcrumbs
   * and feature flags (parity with Swift's `capture`). Use for caught errors you
   * still want reported. Never throws.
   */
  capture(error, opts) {
    const { message, stack, errorType } = _extractError(error);
    this._push(opts?.featureName ?? "captured", false, void 0, message, this._withError(opts?.meta, stack, errorType), "event");
  }
  /** Fold stack/errorType into a caller's meta without mutating it. */
  _withError(meta, stack, errorType) {
    return {
      ...meta ?? {},
      ...stack ? { stack } : {},
      ...errorType ? { errorType } : {}
    };
  }
  /**
   * Flush the buffered events. `useBeacon` (set on the crash/unload path) prefers
   * `navigator.sendBeacon` + `keepalive` so the batch survives the page going
   * away — the browser analog of Swift's synchronous `_flushSync`.
   */
  async flush(useBeacon = false) {
    if (this.buffer.length === 0) return;
    const events = this.buffer.splice(0);
    const url = `${this.apiUrl}/api/sdk/monitor/events/batch`;
    const body = JSON.stringify({ publishableKey: this.publishableKey, events });
    if (useBeacon && typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      try {
        if (navigator.sendBeacon(url, new Blob([body], { type: "text/plain" }))) return;
      } catch {
      }
    }
    try {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": useBeacon ? "text/plain" : "application/json" },
        body,
        keepalive: useBeacon
        // best-effort survival past unload
      });
    } catch {
    }
  }
  destroy() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (_activeMonitor === this) _activeMonitor = null;
    void this.flush(true);
  }
  _push(featureName, ok, durationMs, error, meta, source = "event") {
    if (this.buffer.length >= MAX_BUFFER_SIZE) this.buffer.shift();
    const isError = !ok || source === "global_error";
    const enriched = this._enrich(meta);
    if (isError) {
      const device = _deviceContext();
      if (Object.keys(device).length > 0) enriched["device"] = device;
      if (this.breadcrumbs.length > 0) enriched["breadcrumbs"] = this.breadcrumbs.slice();
    }
    const scrubbed = scrubMeta(enriched);
    if (isError && this.flags.size > 0 && scrubbed) {
      scrubbed["flags"] = Object.fromEntries(this.flags);
    }
    this.buffer.push({
      featureName,
      ok,
      durationMs,
      error: error != null ? scrubText(error) : error,
      meta: scrubbed,
      source,
      userId: this.currentUserId ?? void 0,
      sessionId: this.sessionId,
      platform: PLATFORM
    });
    if (isError) {
      void this.flush(source === "global_error");
    }
  }
  /**
   * Internal: routed here by the module-level window-error handlers (see
   * `_installGlobalHandlers`). Only the current active monitor receives these.
   * `_push` already flushes on a `global_error` source.
   */
  _onGlobalError(message, stack) {
    this._push("unhandled", false, void 0, message, this._withError(void 0, stack), "global_error");
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
    const active = this.getActiveFeatures();
    if (active.length > 0) params.set("session", JSON.stringify(active));
    const res = await fetch(
      `${this.apiUrl}/api/sdk/feedback/initiate?${params}`,
      options.userId ? { headers: { "X-Onelo-User-Id": options.userId } } : void 0
    );
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
    const cancelBtn = document.createElement("button");
    cancelBtn.setAttribute("data-onelo-cancel", "");
    cancelBtn.setAttribute("aria-label", "Close");
    cancelBtn.textContent = "\u2715";
    cancelBtn.style.cssText = "position:absolute;top:10px;right:12px;background:transparent;border:none;color:rgba(255,255,255,0.5);font-size:18px;cursor:pointer;line-height:1;padding:4px;z-index:1";
    container.appendChild(iframe);
    container.appendChild(cancelBtn);
    overlay.appendChild(container);
    document.body.appendChild(overlay);
    const failsafe = installFailsafeClose(cancelBtn);
    const close = () => {
      failsafe.dispose();
      overlay.remove();
      window.removeEventListener("message", onMsg);
    };
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    cancelBtn.addEventListener("click", () => close());
    const onMsg = (e) => {
      const type = e.data?.type;
      if (type === "onelo:ready") failsafe.markReady();
      else if (type === "onelo:feedback_close" || type === "onelo:feedback_submitted") close();
    };
    window.addEventListener("message", onMsg);
  }
};

// src/paywall/paywall.ts
var import_core7 = __toESM(require_dist());
var OneloPaywall = class {
  constructor(apiUrl, publishableKey, getAccessToken, onSession) {
    this.apiUrl = apiUrl;
    this.publishableKey = publishableKey;
    this.getAccessToken = getAccessToken;
    this.onSession = onSession;
  }
  /**
   * Opens the hosted store page (plan selection + registration + payment).
   * Returns the session on success, or null if the user cancelled.
   *
   * @param mode  Presentation, default 'embedded' (inline iframe, matching
   *   Swift's inline flow and the auth view). loadAuthView threads its own mode
   *   through here so sign-in → store are presented consistently. Embedded works
   *   because /store/hosted is served with frame-ancestors '*' (next.config.ts,
   *   same as /auth/hosted and /manage/hosted); the store token is origin-gated
   *   at store-initiate and the code is postMessaged only to the validated
   *   origin, so the permissive framing is safe. Pass 'popup' for a top-level
   *   window if you prefer not to embed.
   */
  async openStore(lang, mode = "embedded") {
    let url = `${this.apiUrl}/api/sdk/paywall/store-initiate?key=${encodeURIComponent(this.publishableKey)}&callback_scheme=onelo-callback`;
    if (lang) url += `&lang=${encodeURIComponent(lang)}`;
    const { status, json } = await (0, import_core7.httpGet)(url, { "X-SDK-Version": version });
    if (status !== 200) throw import_core7.OneloError.server("Failed to initiate store flow");
    const j = json;
    const storeUrl = j["store_url"];
    if (!storeUrl) throw import_core7.OneloError.server("Invalid store-initiate response");
    return this._completeHostedCheckout(storeUrl, mode);
  }
  // NOTE: there is deliberately NO `openUpgrade` here. On native SDKs
  // (Swift/Electron/RN/Flutter/Android) `openUpgrade` hits `/upgrade-initiate` and
  // opens the `store_switch` checkout in the SYSTEM BROWSER (deep-link callback).
  // In `@onelo/js` a hosted page is shown in an IFRAME MODAL that resolves on a
  // `postMessage` — but the store's plan-switch terminals (scheduled downgrade,
  // month↔year) post nothing, so the modal would hang and a successful switch
  // would report as cancelled. So the web upgrade affordance routes through the
  // WORKING web surfaces instead: `Onelo.openUpgrade()` → `customerPortal.open()`
  // for a subscriber (the Portal's own "Change plan", which posts onelo:portal_done)
  // or `openStore()` for a non-subscriber. See onelo.ts.
  /** Shared tail for store-initiate: present the hosted /store/hosted page (which
   *  postMessages `onelo:code`), exchange the code for a session via
   *  hosted-callback, and hand it to auth. */
  async _completeHostedCheckout(url, mode) {
    const modal = new AuthModal();
    const result = await modal.open(url, mode);
    if (result.type === "cancelled") return null;
    if (result.type === "error") throw import_core7.OneloError.server(result.message);
    const { status: cbStatus, json: cbJson } = await (0, import_core7.httpPost)(
      `${this.apiUrl}/api/sdk/auth/hosted-callback`,
      { publishableKey: this.publishableKey, code: result.code },
      { "X-SDK-Version": version }
    );
    if (cbStatus !== 200) throw import_core7.OneloError.server("Hosted-callback failed");
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
      const allowedOrigin = new URL(manageUrl).origin;
      const overlay = document.createElement("div");
      overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;";
      const container = document.createElement("div");
      container.style.cssText = "position:relative;width:480px;height:640px;border-radius:12px;overflow:hidden;background:#111;";
      const iframe = document.createElement("iframe");
      iframe.src = manageUrl;
      iframe.style.cssText = "width:100%;height:100%;border:none;";
      iframe.setAttribute("sandbox", "allow-scripts allow-forms allow-same-origin allow-popups");
      const cancelBtn = createModalCloseButton();
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

// src/customer-portal/customer-portal.ts
var import_core8 = __toESM(require_dist());
var PORTAL_REVOKE_EVENTS = /* @__PURE__ */ new Set([
  "account_deletion_scheduled",
  "account_revoked",
  "session_compromised"
]);
var PORTAL_SKELETON_HTML = `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#111111;font-family:-apple-system,sans-serif;overflow:hidden}
@keyframes onelo-shimmer{0%{background-position:-60vw 0}100%{background-position:100vw 0}}
.wrap{display:flex;flex-direction:column;align-items:center;width:100%;padding:48px 24px 0}
.col{width:100%;max-width:432px;display:flex;flex-direction:column;gap:14px}
.sk{background-color:rgba(255,255,255,0.04);background-image:linear-gradient(90deg,rgba(255,255,255,0) 0%,rgba(255,255,255,0.12) 50%,rgba(255,255,255,0) 100%);background-size:60vw 100%;background-repeat:no-repeat;background-attachment:fixed;animation:onelo-shimmer 2.4s linear infinite;border-radius:8px}
.strong{background-color:rgba(255,255,255,0.08);background-image:linear-gradient(90deg,rgba(255,255,255,0) 0%,rgba(255,255,255,0.18) 50%,rgba(255,255,255,0) 100%);background-size:60vw 100%;background-repeat:no-repeat;background-attachment:fixed;animation:onelo-shimmer 2.4s linear infinite;border-radius:9px}
.icon{width:64px;height:64px;border-radius:14px;margin-bottom:14px;background:rgba(255,255,255,0.06);border:1.5px solid rgba(255,255,255,0.1)}
.title{width:200px;height:22px;margin-bottom:10px;border-radius:6px}
.sub{width:80px;height:13px;opacity:0.7;margin-bottom:32px;border-radius:4px}
.c1{height:240px;border-radius:14px}
.c2{height:80px;border-radius:14px}
.c3{height:140px;border-radius:14px}
</style></head><body>
<div class="wrap">
<div class="sk icon"></div>
<div class="sk title"></div>
<div class="sk sub"></div>
<div class="col"><div class="strong c1"></div><div class="strong c2"></div><div class="strong c3"></div></div>
</div>
</body></html>`;
var OPENING_PLANS_HTML = `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{background:#111111;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.7)}
@keyframes onelo-op-spin{to{transform:rotate(360deg)}}
.box{display:flex;flex-direction:column;align-items:center;gap:12px}
.sp{width:28px;height:28px;border-radius:9999px;border:3px solid rgba(255,255,255,0.18);border-top-color:#f97316;animation:onelo-op-spin 0.8s linear infinite}
.t{font-size:13px}
</style></head><body>
<div class="box"><div class="sp"></div><div class="t">Opening plans\u2026</div></div>
</body></html>`;
var OneloCustomerPortal = class {
  constructor(apiUrl, publishableKey, getAccessToken, onSessionInvalidated) {
    this.apiUrl = apiUrl;
    this.publishableKey = publishableKey;
    this.getAccessToken = getAccessToken;
    this.onSessionInvalidated = onSessionInvalidated;
  }
  /**
   * Open the hosted Customer Portal ("Manage your plan").
   *
   * @param opts.intent  `'change_plan'` opens the portal straight into the plan
   *   picker (the portal auto-runs its own "Change plan" on load) instead of the
   *   management home — so a subscriber tapping an upsell lands on the plans, not
   *   "in front of the door". Used by {@link Onelo.openUpgrade}. Falls back to the
   *   management home if a plan change isn't available for this subscription.
   */
  async open(opts) {
    const token = await this.getAccessToken();
    if (!token) throw new import_core8.OneloError("not_authenticated", "Sign in before opening the customer portal");
    const url = `${this.apiUrl}/api/sdk/paywall/portal-initiate?key=${encodeURIComponent(this.publishableKey)}&callback_scheme=web`;
    const { status, json } = await (0, import_core8.httpGet)(url, {
      "X-SDK-Version": version,
      Authorization: `Bearer ${token}`
    });
    if (status !== 200) throw import_core8.OneloError.server("Failed to initiate customer portal");
    const j = json;
    const hostedUrl = j["hosted_url"];
    if (!hostedUrl) throw import_core8.OneloError.server("Invalid portal-initiate response");
    let finalUrl = hostedUrl;
    if (opts?.intent) {
      try {
        const u = new URL(hostedUrl);
        u.searchParams.set("intent", opts.intent);
        finalUrl = u.toString();
      } catch {
      }
    }
    const loadingHtml = opts?.intent === "change_plan" ? OPENING_PLANS_HTML : PORTAL_SKELETON_HTML;
    return this.openPortalModal(finalUrl, loadingHtml);
  }
  openPortalModal(hostedUrl, loadingHtml = PORTAL_SKELETON_HTML) {
    return new Promise((resolve) => {
      let resolved = false;
      const expectedOrigin = new URL(hostedUrl).origin;
      const overlay = document.createElement("div");
      overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:#111;";
      const container = document.createElement("div");
      container.style.cssText = "position:absolute;inset:0;background:#111;";
      const iframe = document.createElement("iframe");
      iframe.src = hostedUrl;
      iframe.style.cssText = "width:100%;height:100%;border:none;";
      iframe.setAttribute("sandbox", "allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox");
      const cancelBtn = createModalCloseButton();
      const failsafe = installFailsafeClose(cancelBtn);
      const skeleton = document.createElement("iframe");
      skeleton.setAttribute("aria-hidden", "true");
      skeleton.setAttribute("sandbox", "");
      skeleton.srcdoc = loadingHtml;
      skeleton.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:none;pointer-events:none;";
      let firstLoad = true;
      iframe.addEventListener("load", () => {
        skeleton.remove();
        if (firstLoad) {
          firstLoad = false;
          return;
        }
        failsafe.rearm();
      });
      container.appendChild(iframe);
      container.appendChild(skeleton);
      container.appendChild(cancelBtn);
      overlay.appendChild(container);
      document.body.appendChild(overlay);
      const close = () => {
        failsafe.dispose();
        window.removeEventListener("message", messageHandler);
        overlay.remove();
      };
      const done = () => {
        if (resolved) return;
        resolved = true;
        close();
        resolve();
      };
      const messageHandler = (e) => {
        if (e.origin !== expectedOrigin) return;
        if (e.source !== iframe.contentWindow) return;
        const data = e.data;
        if (data?.type === "onelo:ready") {
          failsafe.markReady();
          return;
        }
        if (data?.type === "onelo:portal_done") {
          if (typeof data.event === "string" && PORTAL_REVOKE_EVENTS.has(data.event)) {
            this.onSessionInvalidated?.();
          }
          done();
          return;
        }
        if (data?.type === "onelo:code" || data?.type === "onelo:cancel" || data?.type === "onelo:error") {
          done();
        }
      };
      window.addEventListener("message", messageHandler);
      cancelBtn.addEventListener("click", () => done());
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) done();
      });
    });
  }
};

// src/consent/consent.ts
var import_core9 = __toESM(require_dist());
var SDK_PLATFORM = "js";
var DOC_TITLES = {
  terms: "Terms of Service",
  privacy: "Privacy Policy",
  dpa: "Data Processing Agreement",
  cookies: "Cookies Policy"
};
function titleFor(docType) {
  if (!docType) return "Legal agreement";
  return DOC_TITLES[docType] ?? docType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function mapRequirement(j) {
  const versionId = j["version_id"];
  if (typeof versionId !== "string") return null;
  const rawEnf = j["enforcement"];
  const enforcement = rawEnf === "block" || rawEnf === "notify" ? rawEnf : "unknown";
  return {
    docType: typeof j["doc_type"] === "string" ? j["doc_type"] : "",
    versionId,
    version: typeof j["version"] === "string" ? j["version"] : "",
    enforcement,
    blocking: j["blocking"] === true,
    url: typeof j["url"] === "string" ? j["url"] : null,
    consentUrl: typeof j["consent_url"] === "string" ? j["consent_url"] : null
  };
}
var OneloConsent = class {
  constructor(apiUrl, publishableKey, auth, autoPresent = true) {
    /** Bumped on each `legal.consent_required` push (parity with Swift's
     *  @Published consentRevision). Observe via `onConsentRequired`. */
    this._consentRevision = 0;
    this.revisionListeners = /* @__PURE__ */ new Set();
    /** Held from the top of presentGateIfNeeded across its `requiredConsents`
     *  round-trip, so two concurrent callers (sign-in + a buffered SSE push) can't
     *  both open a gate. Set synchronously before the first await. */
    this._presenting = false;
    /** The live gate overlay, if one is open — prevents a second. */
    this._gateOverlay = null;
    /** Saved `body.style.overflow` so the scroll lock is reversible. */
    this._prevBodyOverflow = null;
    /** Set once dispose() runs — blocks any late re-present (e.g. an in-flight
     *  accept's re-check firing after teardown, which would zombie a new overlay
     *  and re-lock scroll forever). */
    this._disposed = false;
    /** Sibling nodes we marked `inert` while the gate is up (ONLY the ones we
     *  changed) so restore never clears an inert the host app set itself. */
    this._inertedSiblings = [];
    /** Tab-trap keydown handler, removed on close. */
    this._trapHandler = null;
    this.apiUrl = apiUrl;
    this.publishableKey = publishableKey;
    this.auth = auth;
    this.autoPresent = autoPresent;
  }
  // ── Observable revision (mirrors Swift @Published consentRevision) ──────────
  get consentRevision() {
    return this._consentRevision;
  }
  /** Subscribe to `legal.consent_required` pushes (revision bumps). Returns an
   *  unsubscribe fn. Use when you build your own consent UI instead of the
   *  auto-presented gate. */
  onConsentRequired(listener) {
    this.revisionListeners.add(listener);
    return () => {
      this.revisionListeners.delete(listener);
    };
  }
  // ── Data API (mirrors Swift/Electron requiredConsents / acceptConsent) ───────
  /**
   * Fetch the signed-in user's outstanding legal documents. Requires a session;
   * returns `[]` when signed out. Fail-open: any network/non-200/parse failure
   * returns `[]` (never throws) — the gate surfaces real blocking updates, not
   * network blips.
   */
  async requiredConsents() {
    const session = await this.auth.getSession();
    if (!session) return [];
    try {
      const { status, json } = await (0, import_core9.httpGet)(`${this.apiUrl}/v1/sdk/consent/required`, {
        Authorization: `Bearer ${session.accessToken}`,
        "X-Publishable-Key": this.publishableKey,
        "X-Onelo-Sdk-Platform": SDK_PLATFORM
      });
      if (status !== 200) return [];
      const rows = json.required;
      if (!Array.isArray(rows)) return [];
      return rows.map((r) => mapRequirement(r)).filter((r) => r !== null);
    } catch {
      return [];
    }
  }
  /**
   * Record acceptance of a legal document version. Requires a session. Throws
   * `OneloError` on no-session or a non-2xx response. Server-side idempotent.
   */
  async acceptConsent(versionId) {
    const session = await this.auth.getSession();
    if (!session) throw import_core9.OneloError.notAuthenticated();
    const { status } = await (0, import_core9.httpPost)(
      `${this.apiUrl}/v1/sdk/consent/accept`,
      { document_version_id: versionId },
      {
        Authorization: `Bearer ${session.accessToken}`,
        "X-Publishable-Key": this.publishableKey,
        "X-Onelo-Sdk-Platform": SDK_PLATFORM
      }
    );
    if (status === 401) throw import_core9.OneloError.notAuthenticated();
    if (status < 200 || status >= 300) throw import_core9.OneloError.server(`Failed to record consent: HTTP ${status}`);
  }
  // ── SSE wiring ──────────────────────────────────────────────────────────────
  /**
   * Register the `legal.consent_required` listener on the shared stream. The
   * event is a signal only (payload ignored) — on receipt we bump the revision,
   * notify observers, and auto-present the gate if one is warranted.
   */
  attachEventStream(stream) {
    stream.on("legal.consent_required", () => {
      this._consentRevision++;
      for (const l of [...this.revisionListeners]) {
        try {
          l(this._consentRevision);
        } catch {
        }
      }
      if (this.autoPresent) void this.presentGateIfNeeded();
    });
  }
  // ── Gate presentation (web-native, non-dismissible) ──────────────────────────
  /**
   * Check for an outstanding BLOCKING consent and, if present, open the gate.
   * Returns true if a gate was shown. No-op when: not in a browser, no session,
   * no blocking document, or a gate is already open.
   */
  async presentGateIfNeeded() {
    if (this._disposed) return false;
    if (typeof document === "undefined") return false;
    if (this._presenting) return false;
    if (this._gateOverlay) return false;
    this._presenting = true;
    try {
      const items = await this.requiredConsents();
      const blocker = items.find((i) => i.blocking);
      if (!blocker) return false;
      this._presentGate(blocker);
      return true;
    } finally {
      this._presenting = false;
    }
  }
  _presentGate(requirement) {
    const overlay = this._buildOverlay(requirement);
    this._gateOverlay = overlay;
    this._prevBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.appendChild(overlay);
    for (const el of Array.from(document.body.children)) {
      if (el !== overlay && !el.hasAttribute("inert")) {
        el.setAttribute("inert", "");
        this._inertedSiblings.push(el);
      }
    }
    const focusables = Array.from(overlay.querySelectorAll("a[href],button"));
    focusables[focusables.length - 1]?.focus();
    this._trapHandler = (e) => {
      if (e.key !== "Tab" || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !overlay.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !overlay.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    overlay.addEventListener("keydown", this._trapHandler);
  }
  _closeGate() {
    if (this._trapHandler && this._gateOverlay) {
      this._gateOverlay.removeEventListener("keydown", this._trapHandler);
    }
    this._trapHandler = null;
    for (const el of this._inertedSiblings) el.removeAttribute("inert");
    this._inertedSiblings = [];
    if (this._gateOverlay) {
      this._gateOverlay.remove();
      this._gateOverlay = null;
    }
    if (this._prevBodyOverflow !== null) {
      document.body.style.overflow = this._prevBodyOverflow;
      this._prevBodyOverflow = null;
    }
  }
  /**
   * Accept → record, then RE-CHECK (documents stack — there may be another
   * blocking doc). Any non-accept → sign out. Mirrors Swift/Electron
   * `handleConsent`. On a transient accept failure the gate STAYS up so the user
   * can retry rather than being bounced out.
   */
  async _handleConsentAction(action, requirement, els) {
    if (action === "accept") {
      els.accept.disabled = true;
      els.decline.disabled = true;
      els.error.style.display = "none";
      els.accept.textContent = "Saving\u2026";
      try {
        await this.acceptConsent(requirement.versionId);
      } catch {
        els.accept.disabled = false;
        els.decline.disabled = false;
        els.accept.textContent = "Accept & Continue";
        els.error.textContent = "Could not save \u2014 check your connection and try again.";
        els.error.style.display = "block";
        return;
      }
      this._closeGate();
      await this.presentGateIfNeeded();
    } else {
      this._closeGate();
      await this.auth.signOut().catch(() => {
      });
    }
  }
  _buildOverlay(requirement) {
    const docTitle = titleFor(requirement.docType);
    const overlay = document.createElement("div");
    overlay.setAttribute("data-onelo-consent-gate", "");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:2147483647",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "padding:20px",
      "background:rgba(0,0,0,0.6)",
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif'
    ].join(";");
    const card = document.createElement("div");
    card.style.cssText = [
      "width:100%",
      "max-width:440px",
      "box-sizing:border-box",
      "background:#ffffff",
      "color:#18181b",
      "border-radius:16px",
      "padding:28px",
      "box-shadow:0 20px 60px rgba(0,0,0,0.35)"
    ].join(";");
    const h = document.createElement("h2");
    h.textContent = `${docTitle} \u2014 updated`;
    h.style.cssText = "margin:0 0 10px;font-size:19px;font-weight:600;line-height:1.25;";
    const p = document.createElement("p");
    p.textContent = `Please review and accept our updated ${docTitle} to keep using the app.`;
    p.style.cssText = "margin:0 0 16px;font-size:14px;line-height:1.5;color:#3f3f46;";
    card.appendChild(h);
    card.appendChild(p);
    if (requirement.url && /^https?:\/\//i.test(requirement.url)) {
      const link = document.createElement("a");
      link.href = requirement.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = `Review full ${docTitle} \u2197`;
      link.style.cssText = "display:inline-block;margin:0 0 20px;font-size:13.5px;color:#2563eb;text-decoration:none;";
      card.appendChild(link);
    }
    const error = document.createElement("p");
    error.style.cssText = "display:none;margin:0 0 14px;font-size:13px;line-height:1.4;color:#dc2626;";
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:10px;margin-top:4px;";
    const decline = document.createElement("button");
    decline.type = "button";
    decline.textContent = "Sign out";
    decline.style.cssText = [
      "flex:0 0 auto",
      "padding:11px 16px",
      "border-radius:10px",
      "cursor:pointer",
      "font-size:14px",
      "font-weight:500",
      "background:transparent",
      "border:1px solid #d4d4d8",
      "color:#3f3f46"
    ].join(";");
    const accept = document.createElement("button");
    accept.type = "button";
    accept.textContent = "Accept & Continue";
    accept.style.cssText = [
      "flex:1",
      "padding:11px 16px",
      "border-radius:10px",
      "cursor:pointer",
      "font-size:14px",
      "font-weight:600",
      "background:#18181b",
      "border:1px solid #18181b",
      "color:#ffffff"
    ].join(";");
    const els = { accept, decline, error };
    accept.addEventListener("click", () => {
      void this._handleConsentAction("accept", requirement, els);
    });
    decline.addEventListener("click", () => {
      void this._handleConsentAction("decline", requirement, els);
    });
    row.appendChild(decline);
    row.appendChild(accept);
    card.appendChild(error);
    card.appendChild(row);
    overlay.appendChild(card);
    return overlay;
  }
  /** Tear down any open gate + restore scroll. Called from `Onelo.destroy()`.
   *  Marks the instance disposed so a late accept re-check can't zombie a new
   *  gate (and re-lock scroll) after teardown. */
  dispose() {
    this._disposed = true;
    this._closeGate();
  }
};

// src/core/event-stream.ts
var RECONNECT_DELAYS_MS = [1e3, 2e3, 5e3, 1e4, 3e4];
var OneloEventStream = class {
  constructor(apiUrl, publishableKey, sdkVersion) {
    this.apiUrl = apiUrl;
    this.publishableKey = publishableKey;
    this.sdkVersion = sdkVersion;
    this.source = null;
    this.handlers = /* @__PURE__ */ new Map();
    this.paramProviders = [];
    this.userId = null;
    this.started = false;
    this.destroyed = false;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.lifecycleBound = false;
    this.lifecycleListeners = [];
    // Arrow fields so the same reference can be removed on destroy.
    this._onVisibility = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        this.reconnectIfStale();
        this._notifyLifecycle();
      }
    };
    this._onOnline = () => {
      this.reconnectIfStale();
      this._notifyLifecycle();
    };
  }
  /**
   * Register a handler for a named server event (`connected`, `features_updated`,
   * `session.revoked`, …). Survives reconnects. Register BEFORE `start()` (e.g.
   * in a module constructor) so no event is missed between connect and sign-in.
   */
  on(event, handler) {
    const arr = this.handlers.get(event) ?? [];
    arr.push(handler);
    this.handlers.set(event, arr);
  }
  /**
   * Extra query params, read fresh on EVERY (re)connect — used for values that
   * change over the connection's life (e.g. features' `since_version`), so a
   * reconnect always sends the current value.
   */
  addParamProvider(fn) {
    this.paramProviders.push(fn);
  }
  /**
   * Register a callback fired on a lifecycle resume — the tab becomes visible or
   * the network comes back online (the same signals that drive
   * reconnectIfStale). Consumers use this to reconcile state via REST in
   * parallel with the SSE catch-up (e.g. OneloFeatures.refresh()). Survives for
   * the stream's life; there is no unregister (listeners live as long as the
   * stream). A listener throwing never breaks the stream.
   */
  onLifecycleResume(fn) {
    this.lifecycleListeners.push(fn);
  }
  _notifyLifecycle() {
    for (const fn of this.lifecycleListeners) {
      try {
        fn();
      } catch {
      }
    }
  }
  /**
   * Open (or re-open) the connection for a user. Idempotent: a repeat call with
   * the same userId while already connected is a no-op (no needless reconnect).
   * A changed userId reconnects so per-user routing (features + session.revoked
   * targeting) is correct.
   */
  start(userId) {
    if (this.destroyed) return;
    const changed = userId !== this.userId || !this.started;
    this.userId = userId;
    this.started = true;
    this._bindLifecycle();
    if (changed) this._connect();
  }
  /** Close the connection and cancel any pending reconnect. */
  stop() {
    this.started = false;
    this._clearReconnect();
    this._close();
  }
  /** Permanent teardown — cannot be restarted. */
  destroy() {
    this.destroyed = true;
    this._unbindLifecycle();
    this.stop();
  }
  /**
   * Reconnect ONLY if the connection actually dropped — the browser throttled
   * or closed it while the tab was backgrounded, or the network changed.
   * `EventSource.readyState` (0 CONNECTING · 1 OPEN · 2 CLOSED) is authoritative
   * for a real drop.
   *
   * We deliberately do NOT run a silence-based watchdog timer (as the Swift SDK
   * does): the browser `EventSource` hides the server's `:keepalive` comments,
   * so "no named event in N seconds" does NOT imply a dead connection on a quiet
   * app — a periodic reconnect would false-positive and worsen connection-pool
   * pressure (the 2026-07 exhaustion outage). Lifecycle events (visibility /
   * online) are the correct, false-positive-free browser signal.
   */
  reconnectIfStale() {
    if (this.destroyed || !this.started || !this._supported()) return;
    if (this.source === null || this.source.readyState === 2) this._connect();
  }
  _bindLifecycle() {
    if (this.lifecycleBound) return;
    this.lifecycleBound = true;
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      document.addEventListener("visibilitychange", this._onVisibility);
    }
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("online", this._onOnline);
    }
  }
  _unbindLifecycle() {
    if (!this.lifecycleBound) return;
    this.lifecycleBound = false;
    if (typeof document !== "undefined" && typeof document.removeEventListener === "function") {
      document.removeEventListener("visibilitychange", this._onVisibility);
    }
    if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
      window.removeEventListener("online", this._onOnline);
    }
  }
  /**
   * Force a fresh connection NOW, re-reading all params (base + providers).
   * Used after a consumer resets a provider value — e.g. features'
   * `invalidateCache()` sets `since_version = 0`, and only a reconnect makes
   * the server resend a full snapshot (a live connection stays silent).
   * No-op when not started or destroyed.
   */
  reconnect() {
    if (this.destroyed || !this.started) return;
    this._connect();
  }
  _supported() {
    return typeof EventSource !== "undefined";
  }
  _connect() {
    if (this.destroyed || !this.started || !this._supported()) return;
    this._clearReconnect();
    this._close();
    const params = new URLSearchParams({ key: this.publishableKey, sdk_platform: "js" });
    if (this.sdkVersion) params.set("sdk_version", this.sdkVersion);
    if (this.userId) params.set("userId", this.userId);
    for (const provide of this.paramProviders) {
      for (const [k, v] of Object.entries(provide())) params.set(k, v);
    }
    const url = `${this.apiUrl}/api/sdk/features/stream?${params.toString()}`;
    let source;
    try {
      source = new EventSource(url);
    } catch {
      this._scheduleReconnect();
      return;
    }
    this.source = source;
    for (const [event, handlers] of this.handlers) {
      source.addEventListener(event, (e) => {
        this.reconnectAttempts = 0;
        let data = {};
        if (typeof e.data === "string" && e.data.length > 0) {
          try {
            data = JSON.parse(e.data);
          } catch {
          }
        }
        for (const handler of handlers) {
          try {
            handler(data);
          } catch {
          }
        }
      });
    }
    source.onerror = () => {
      this._close();
      if (!this.destroyed && this.started) this._scheduleReconnect();
    };
  }
  _scheduleReconnect() {
    if (this.destroyed || !this.started) return;
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    const base = RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempts, RECONNECT_DELAYS_MS.length - 1)];
    this.reconnectAttempts++;
    const delay = Math.floor(Math.random() * base);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._connect();
    }, delay);
  }
  _clearReconnect() {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
  _close() {
    if (this.source !== null) {
      this.source.close();
      this.source = null;
    }
  }
};

// src/onelo.ts
var Onelo = class {
  constructor(config) {
    this.authUnsubscribe = null;
    this.eventStream = new OneloEventStream(config.apiUrl, config.publishableKey, version);
    this.auth = new OneloAuth(config);
    this.auth.attachEventStream(this.eventStream);
    this.paywall = new OneloPaywall(
      config.apiUrl,
      config.publishableKey,
      () => this.auth.getSession().then((s) => s?.accessToken ?? null),
      (session) => this.auth.importSession(session)
    );
    this.customerPortal = new OneloCustomerPortal(
      config.apiUrl,
      config.publishableKey,
      () => this.auth.getSession().then((s) => s?.accessToken ?? null),
      () => {
        void this.auth.signOut();
      }
    );
    this.forms = new OneloForms(config.apiUrl, config.publishableKey);
    this.waitlist = new OneloWaitlist(config.apiUrl, config.publishableKey);
    this.monitor = new OneloMonitor(config.publishableKey, config.apiUrl, {
      appVersion: config.appVersion,
      appBuild: config.appBuild,
      bundleId: config.bundleId,
      environment: config.environment
    });
    let envFromProcess;
    if (typeof window === "undefined") {
      const proc = globalThis.process;
      envFromProcess = proc?.env?.["ONELO_FEATURE_ENVIRONMENT"];
    }
    const rawFeatureEnv = config.featureEnvironment ?? envFromProcess;
    const featureEnvironment = rawFeatureEnv === "test" || rawFeatureEnv === "live" ? rawFeatureEnv : void 0;
    this.features = new OneloFeatures(config.apiUrl, config.publishableKey, this.monitor, {
      suppressIdentifyWarning: config.suppressIdentifyWarning ?? false,
      featureEnvironment,
      featureDefaultStatus: config.featureDefaultStatus
    });
    this.features.attachStream(this.eventStream);
    this.feedback = new OneloFeedback(config.apiUrl, config.publishableKey, () => this.features.getActiveFeatures());
    const autoPresentConsent = config.autoPresentConsentGate ?? true;
    this.consent = new OneloConsent(config.apiUrl, config.publishableKey, this.auth, autoPresentConsent);
    this.consent.attachEventStream(this.eventStream);
    this.authUnsubscribe = this.auth.onAuthStateChange((session) => {
      this.monitor.setUserId(session?.user.id ?? null);
      void this.features.load(session?.user.id ?? null);
      if (session?.user.id && autoPresentConsent) void this.consent.presentGateIfNeeded();
    });
    void this.features.load(null);
  }
  /**
   * Open the sign-in flow. The routing (sign-in vs store vs "already have
   * access") is decided by the backend `/api/sdk/flow/init`, so behaviour is
   * identical across every SDK — no client logic to drift.
   * - waitlist_mode + sdk_redirect_url → opens developer's waitlist/store page
   * - otherwise → the backend flow picks sign-in or store and chains them; the
   *   hosted page returns once the user has access.
   * Presentation defaults to an inline iframe (`mode:'embedded'`), matching
   * Swift's inline WKWebView; pass `mode:'popup'` for a top-level window.
   */
  async loadAuthView(options) {
    return this.auth.loadAuthView({ mode: options?.mode });
  }
  /**
   * Only needed when NOT using Onelo Auth (own auth system). Pass `userIdHash`
   * (HMAC-SHA256 computed on YOUR server, `"user:"+userId`) to satisfy Secure
   * Mode targeting — the SDK forwards it and never computes it.
   */
  async identify(userId, userIdHash) {
    await this.features.load(userId, userIdHash);
  }
  /**
   * Open the upgrade flow for a plan-blocked feature — call it when the user taps
   * a gated tile whose `feature.upgradeCta` is set. Routes to the right WORKING
   * web surface by billing state:
   *   - active subscriber → `customerPortal.open()` (the Portal's "Change plan" —
   *     upgrade / downgrade / interval switch, all handled + confirmed there).
   *   - otherwise         → `paywall.openStore()` (pick + buy a plan).
   *
   * Unlike the native SDKs, `@onelo/js` does NOT drive `/upgrade-initiate`'s
   * `store_switch` checkout: that flow completes via a deep-link / postMessage the
   * in-iframe store-switch terminals don't emit, so it would hang the modal. The
   * Portal is the web-correct door for an existing subscriber's plan change.
   *
   * `plan` is accepted for cross-platform call-site parity (Swift/Electron/RN pass
   * `feature.requiredPlan`); on web the Portal/Store show the plans, so it is
   * advisory only. Fire-and-forget: the resulting plan change reaches the SDK via
   * SSE and fires `features.subscribe()`. Requires a signed-in Onelo Auth user.
   */
  async openUpgrade(_plan) {
    if (await this.auth.hasActiveAccess()) {
      await this.customerPortal.open({ intent: "change_plan" });
    } else {
      await this.paywall.openStore();
    }
  }
  /** Release background timers. Call when the SDK instance is no longer needed. */
  destroy() {
    this.authUnsubscribe?.();
    this.eventStream.destroy();
    this.features.stopPolling();
    this.monitor.destroy();
    this.consent.dispose();
  }
};

// src/index.ts
var import_core10 = __toESM(require_dist());
var export_OneloError = import_core10.OneloError;
export {
  FeatureState,
  Onelo,
  OneloConsent,
  OneloCustomerPortal,
  export_OneloError as OneloError,
  OneloFeatures,
  OneloFeaturesError,
  OneloFeedback,
  OneloForms,
  OneloMonitor,
  OneloPaywall,
  OneloWaitlist
};
