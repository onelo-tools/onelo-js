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
    exports.isSessionEndError = isSessionEndError2;
    exports.extractErrorCode = extractErrorCode4;
    var OneloError7 = class _OneloError extends Error {
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
      /** The account was BANNED. Only a real ban may say "suspended" — never an
       *  ended or replaced session (see sessionEnded). */
      static userRevoked() {
        return new _OneloError("user_revoked", "This user account has been suspended");
      }
      /**
       * The session is over — it expired, was replaced (`session_compromised`:
       * the same refresh token was presented again outside the server's grace
       * window) or is not recognised (`session_invalid`). NOT an account action:
       * the user just signs in again. The SDK has already cleared the session and
       * fired `onAuthStateChange(null)`.
       */
      static sessionEnded() {
        return new _OneloError("session_ended", "Your session ended \u2014 please sign in again");
      }
      /** Email Verification (#819): at most 3 verification e-mails an hour. */
      static verificationRateLimited() {
        return new _OneloError("verification_rate_limited", "At most 3 verification emails an hour \u2014 try again later");
      }
      /** Email Verification is Off for this App (Auth → Sign-up on the parent App). */
      static emailVerificationOff() {
        return new _OneloError("email_verification_off", "Email verification is off for this app \u2014 turn it on in Auth \u2192 Sign-up");
      }
      /** The `redirectTo` given for the verification link is not one of the App's
       *  allowed web origins, nor `<registered-scheme>://…`. */
      static invalidVerifyRedirect() {
        return new _OneloError("invalid_verify_redirect", "redirectTo must be one of this app's allowed web origins or <your-scheme>://\u2026");
      }
      /** The verification link was used, replaced by a newer one, or expired. */
      static invalidVerificationToken() {
        return new _OneloError("invalid_verification_token", "This verification link is invalid, already used, replaced by a newer one, or expired");
      }
    };
    exports.OneloError = OneloError7;
    function isSessionEndError2(e) {
      return e instanceof OneloError7 && (e.code === "session_ended" || e.code === "user_revoked" || e.code === "no_active_plan");
    }
    function extractErrorCode4(json) {
      if (!json || typeof json !== "object")
        return void 0;
      const body = json;
      if (typeof body.error === "string" && body.error)
        return body.error;
      const detail = body.detail;
      if (typeof detail === "string" && detail)
        return detail;
      if (detail && typeof detail === "object") {
        const nested = detail.error;
        if (typeof nested === "string" && nested)
          return nested;
      }
      return void 0;
    }
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
    exports.httpPost = httpPost7;
    exports.checkHostedFlowRequired = checkHostedFlowRequired2;
    var types_1 = require_types();
    async function httpGet5(url, headers) {
      let res;
      try {
        res = await fetch(url, { headers });
      } catch (e) {
        throw types_1.OneloError.network(e instanceof Error ? e.message : "fetch failed");
      }
      return readBody(res);
    }
    async function httpPost7(url, body, headers, signal) {
      let res;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify(body),
          signal
        });
      } catch (e) {
        throw types_1.OneloError.network(e instanceof Error ? e.message : "fetch failed");
      }
      return readBody(res);
    }
    async function readBody(res) {
      const refusal = res.status === 401 || res.status === 403;
      try {
        return { status: res.status, json: await res.json() };
      } catch {
        if (refusal) {
          console.warn(`[Onelo] ${res.status} carried an unreadable (non-JSON) body \u2014 treating it as a refusal. This is usually an edge, proxy or WAF page rather than the API itself.`);
          return { status: res.status, json: {} };
        }
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
    exports.verificationFields = verificationFields;
    exports.mergeAccessAnswer = mergeAccessAnswer2;
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
          entitlement: user["entitlement"] === "active" ? "active" : "none",
          // Undefined (not false) when the backend did not send it: "the server did
          // not say" and "the server said no" are different, and only the first may
          // fall back to the old client-side derivation.
          allowedIn: typeof user["allowed_in"] === "boolean" ? user["allowed_in"] : void 0,
          ...verificationFields(user)
        }
      };
    }
    function verificationFields(user) {
      return {
        emailVerified: typeof user["email_verified"] === "boolean" ? user["email_verified"] : void 0,
        accessReason: typeof user["access_reason"] === "string" ? user["access_reason"] : void 0
      };
    }
    function mergeAccessAnswer2(previous, body) {
      const fresh = verificationFields(body);
      const answered = typeof body["allowed_in"] === "boolean";
      return {
        ...previous,
        allowedIn: answered ? body["allowed_in"] : previous.allowedIn,
        emailVerified: fresh.emailVerified ?? previous.emailVerified,
        accessReason: answered ? fresh.accessReason : previous.accessReason
      };
    }
    exports.TOKEN_KEYS = {
      ACCESS_TOKEN: "onelo_access_token",
      REFRESH_TOKEN: "onelo_refresh_token",
      EXPIRES_AT: "onelo_expires_at",
      USER_JSON: "onelo_user",
      /**
       * PKCE verifier for an OUTSTANDING magic link.
       *
       * Every other verifier this SDK uses lives in memory, which is correct for
       * flows that finish in the same page. A magic link does not: the email opens
       * a NEW tab (often after a relaunch), so an in-memory verifier is gone by the
       * time the code comes back and /hosted-callback would 401 on a link that is
       * already spent — locking the user out with no recovery. That is exactly why
       * magic links shipped WITHOUT a challenge.
       *
       * Persisting it is what makes the binding possible on the web: the new tab is
       * the same origin, so it can read this back. Deleted the moment the exchange
       * finishes or fails, and cleared with the rest on sign-out.
       */
      MAGIC_LINK_VERIFIER: "onelo_magic_link_verifier"
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

// ../onelo-core/dist/error-origin.js
var require_error_origin = __commonJS({
  "../onelo-core/dist/error-origin.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.classifyErrorOrigin = classifyErrorOrigin2;
    var SDK_FRAME = /@onelo[/_](?:js|electron|react-native|core)\b|\/onelo-(?:js|electron|react-native|core)\/(?:src|dist)\//;
    function topFrame(stack) {
      for (const raw of stack.split("\n")) {
        const line = raw.trim();
        if (line.startsWith("at "))
          return line;
        if (/@\S+:\d+/.test(line) || /^\S+:\d+:\d+$/.test(line))
          return line;
      }
      return void 0;
    }
    function classifyErrorOrigin2(error, stack) {
      if (error instanceof Error && error.name === "OneloError")
        return "onelo_sdk";
      const s = stack ?? (error instanceof Error ? error.stack : void 0);
      const frame = s ? topFrame(s) : void 0;
      return frame && SDK_FRAME.test(frame) ? "onelo_sdk" : "app";
    }
  }
});

// ../onelo-core/dist/brand-tokens.js
var require_brand_tokens = __commonJS({
  "../onelo-core/dist/brand-tokens.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.BrandSource = exports.NEUTRAL_BRAND_TOKENS = void 0;
    exports.brandColorValue = brandColorValue;
    exports.relativeLuminance = relativeLuminance;
    exports.brandTokensFromLegacy = brandTokensFromLegacy;
    exports.parseBrandTokens = parseBrandTokens;
    exports.brandTokensFromResponse = brandTokensFromResponse2;
    exports.withAlpha = withAlpha;
    exports.statusColor = statusColor2;
    exports.skeletonCss = skeletonCss2;
    exports.spinnerCss = spinnerCss3;
    exports.portalSkeletonHtml = portalSkeletonHtml2;
    exports.feedbackSkeletonHtml = feedbackSkeletonHtml;
    var SYSTEM_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    var DARK = {
      card_bg: "#1a1a1a",
      text: "#ffffff",
      text_muted: "rgba(255,255,255,0.6)",
      border: "#2a2a2a",
      spinner_track: "rgba(255,255,255,0.18)"
    };
    var LIGHT = {
      card_bg: "#ffffff",
      text: "#111111",
      text_muted: "rgba(17,17,17,0.65)",
      border: "#e4e4e7",
      spinner_track: "rgba(0,0,0,0.12)"
    };
    exports.NEUTRAL_BRAND_TOKENS = Object.freeze({
      version: 1,
      page_bg: "#111111",
      brand: "#a1a1aa",
      ...DARK,
      button_bg: "#a1a1aa",
      button_text: "#111111",
      button_radius: 14,
      field_radius: 14,
      card_radius: 14,
      body_font: SYSTEM_FONT,
      heading_font: SYSTEM_FONT,
      light_bg: false
    });
    var HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
    var RGBA = /^rgba?\(\s*[0-9.]+\s*,\s*[0-9.]+\s*,\s*[0-9.]+\s*(?:,\s*[0-9.]+\s*)?\)$/;
    var FONT = /^[A-Za-z0-9 ,'"_-]{1,200}$/;
    function brandColorValue(raw) {
      if (typeof raw !== "string")
        return null;
      const v = raw.trim();
      return HEX.test(v) || RGBA.test(v) ? v : null;
    }
    function hexOnly(raw) {
      const v = brandColorValue(raw);
      return v && v.startsWith("#") ? v : null;
    }
    function radius(raw) {
      return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 && raw <= 100 ? raw : null;
    }
    function font(raw) {
      if (typeof raw !== "string")
        return null;
      const v = raw.trim();
      return FONT.test(v) ? v : null;
    }
    function relativeLuminance(hex) {
      let h = hex.replace("#", "");
      if (h.length === 3)
        h = h.split("").map((c) => c + c).join("");
      if (h.length !== 6 && h.length !== 8)
        return null;
      const ch = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
      if (ch.some((c) => Number.isNaN(c)))
        return null;
      const lin = ch.map((c) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
      return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
    }
    function brandTokensFromLegacy(primaryColor, pageBg) {
      const bg = hexOnly(pageBg) ?? exports.NEUTRAL_BRAND_TOKENS.page_bg;
      const lightBg = (relativeLuminance(bg) ?? 0) > 0.5;
      const brand = hexOnly(primaryColor);
      return {
        ...exports.NEUTRAL_BRAND_TOKENS,
        ...lightBg ? LIGHT : DARK,
        page_bg: bg,
        light_bg: lightBg,
        brand: brand ?? exports.NEUTRAL_BRAND_TOKENS.brand,
        button_bg: brand ?? exports.NEUTRAL_BRAND_TOKENS.button_bg,
        // The registry's button text default is white; the neutral grey takes dark.
        button_text: brand ? "#ffffff" : exports.NEUTRAL_BRAND_TOKENS.button_text
      };
    }
    function parseBrandTokens(raw, fallback = exports.NEUTRAL_BRAND_TOKENS) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw))
        return null;
      const o = raw;
      const version2 = typeof o.version === "number" && Number.isFinite(o.version) ? o.version : 1;
      const c = (k) => brandColorValue(o[k]) ?? fallback[k];
      return {
        version: version2,
        page_bg: c("page_bg"),
        brand: c("brand"),
        card_bg: c("card_bg"),
        text: c("text"),
        text_muted: c("text_muted"),
        border: c("border"),
        button_bg: c("button_bg"),
        button_text: c("button_text"),
        button_radius: radius(o.button_radius) ?? fallback.button_radius,
        field_radius: radius(o.field_radius) ?? fallback.field_radius,
        card_radius: radius(o.card_radius) ?? fallback.card_radius,
        body_font: font(o.body_font) ?? fallback.body_font,
        heading_font: font(o.heading_font) ?? fallback.heading_font,
        spinner_track: c("spinner_track"),
        light_bg: typeof o.light_bg === "boolean" ? o.light_bg : fallback.light_bg
      };
    }
    function brandTokensFromResponse2(json) {
      if (!json || typeof json !== "object")
        return null;
      const j = json;
      const hasLegacy = hexOnly(j.primary_color) !== null || hexOnly(j.checkout_bg_color) !== null;
      const legacy = brandTokensFromLegacy(j.primary_color, j.checkout_bg_color);
      return parseBrandTokens(j.brand_tokens, legacy) ?? (hasLegacy ? legacy : null);
    }
    function withAlpha(color, alpha) {
      if (!color.startsWith("#"))
        return color;
      let h = color.slice(1);
      if (h.length === 3)
        h = h.split("").map((c) => c + c).join("");
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
      return `rgba(${r},${g},${b},${alpha})`;
    }
    function statusColor2(t, tone) {
      const STATUS = {
        success: { dark: "#22c55e", light: "#15803d" },
        danger: { dark: "#f87171", light: "#dc2626" },
        warning: { dark: "#fbbf24", light: "#b45309" }
      };
      return STATUS[tone][t.light_bg ? "light" : "dark"];
    }
    var BrandSource7 = class {
      constructor() {
        this.tokens = exports.NEUTRAL_BRAND_TOKENS;
      }
      current() {
        return this.tokens;
      }
      set(tokens) {
        if (tokens)
          this.tokens = tokens;
      }
      /** Adopt the branding a config / initiate response carries (if any) and
       *  return the tokens to paint with. */
      adopt(json) {
        this.set(brandTokensFromResponse2(json));
        return this.tokens;
      }
    };
    exports.BrandSource = BrandSource7;
    function skeletonCss2(t) {
      const sweep = `background-image:linear-gradient(90deg,transparent 0%,${t.spinner_track} 50%,transparent 100%);background-size:60vw 100%;background-repeat:no-repeat;background-attachment:fixed;animation:onelo-shimmer 2.4s linear infinite`;
      return [
        "@keyframes onelo-shimmer{0%{background-position:-60vw 0}100%{background-position:100vw 0}}",
        `.sk{background-color:${t.card_bg};${sweep};border-radius:${t.field_radius}px}`,
        `.strong{background-color:${t.border};${sweep};border-radius:${t.field_radius}px}`
      ].join("\n");
    }
    function spinnerCss3(t, cls = "sp") {
      return `@keyframes onelo-op-spin{to{transform:rotate(360deg)}}
.${cls}{width:28px;height:28px;border-radius:9999px;border:3px solid ${t.spinner_track};border-top-color:${t.brand};animation:onelo-op-spin 0.8s linear infinite}`;
    }
    function portalSkeletonHtml2(t = exports.NEUTRAL_BRAND_TOKENS) {
      return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:${t.page_bg};font-family:${t.body_font};overflow:hidden}
${skeletonCss2(t)}
.wrap{display:flex;flex-direction:column;align-items:center;width:100%;padding:48px 24px 0}
.col{width:100%;max-width:432px;display:flex;flex-direction:column;gap:14px}
.icon{width:64px;height:64px;border-radius:${t.card_radius}px;margin-bottom:14px;border:1.5px solid ${t.border}}
.title{width:200px;height:22px;margin-bottom:10px}
.sub{width:80px;height:13px;opacity:0.7;margin-bottom:32px}
.c1{height:240px;border-radius:${t.card_radius}px}
.c2{height:80px;border-radius:${t.card_radius}px}
.c3{height:140px;border-radius:${t.card_radius}px}
</style></head><body>
<div class="wrap">
<div class="sk icon"></div>
<div class="sk title"></div>
<div class="sk sub"></div>
<div class="col"><div class="strong c1"></div><div class="strong c2"></div><div class="strong c3"></div></div>
</div>
</body></html>`;
    }
    function feedbackSkeletonHtml(t = exports.NEUTRAL_BRAND_TOKENS) {
      return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:${t.page_bg};font-family:${t.body_font};padding:40px 36px 32px;overflow:hidden}
${skeletonCss2(t)}
.icon{width:64px;height:64px;border-radius:${t.card_radius}px;margin:0 auto 16px}
.title{width:220px;height:22px;margin:0 auto 40px}
.cards{display:flex;gap:12px;margin-bottom:32px}
.card{flex:1;height:76px;border-radius:${t.card_radius}px}
.label{width:60px;height:13px;margin-bottom:8px}
.input{width:100%;height:44px;margin-bottom:24px}
.textarea{width:100%;height:110px;margin-bottom:32px}
.btn{width:100%;height:48px;border-radius:${t.button_radius}px}
</style></head><body>
<div class="sk icon"></div>
<div class="sk title"></div>
<div class="cards"><div class="sk card"></div><div class="sk card"></div><div class="sk card"></div></div>
<div class="sk label"></div>
<div class="strong input"></div>
<div class="sk label"></div>
<div class="strong textarea"></div>
<div class="strong btn"></div>
</body></html>`;
    }
  }
});

// ../onelo-core/dist/verification.js
var require_verification = __commonJS({
  "../onelo-core/dist/verification.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.VERIFY_TOKEN_PARAM = void 0;
    exports.resendVerificationEmail = resendVerificationEmail;
    exports.confirmEmail = confirmEmail;
    var http_1 = require_http();
    var types_1 = require_types();
    async function resendVerificationEmail(opts) {
      const body = { publishableKey: opts.publishableKey };
      if (opts.redirectTo)
        body.verify_redirect_to = opts.redirectTo;
      const { status, json } = await (opts.post ?? http_1.httpPost)(`${opts.apiUrl}/api/sdk/auth/verify-email/resend`, body, { ...opts.headers, Authorization: `Bearer ${opts.accessToken}` });
      if (status === 200) {
        const j = json;
        return { sent: j["sent"] === true, emailVerified: j["email_verified"] === true };
      }
      const code = (0, types_1.extractErrorCode)(json);
      if (status === 429 || code === "verification_rate_limited")
        throw types_1.OneloError.verificationRateLimited();
      if (status === 409 || code === "email_verification_off")
        throw types_1.OneloError.emailVerificationOff();
      if (status === 400 && code === "invalid_verify_redirect_to")
        throw types_1.OneloError.invalidVerifyRedirect();
      if (status === 401)
        throw types_1.OneloError.notAuthenticated();
      throw types_1.OneloError.server(`Verification email request failed: HTTP ${status}`);
    }
    async function confirmEmail(opts) {
      const { status, json } = await (opts.post ?? http_1.httpPost)(`${opts.apiUrl}/api/sdk/auth/verify-email/confirm`, { publishableKey: opts.publishableKey, token: opts.token }, opts.headers);
      if (status === 200)
        return;
      if (status === 400 && (0, types_1.extractErrorCode)(json) === "invalid_token")
        throw types_1.OneloError.invalidVerificationToken();
      throw types_1.OneloError.server(`Email confirmation failed: HTTP ${status}`);
    }
    exports.VERIFY_TOKEN_PARAM = "onelo_verify_token";
  }
});

// ../onelo-core/dist/marketing-consent.js
var require_marketing_consent = __commonJS({
  "../onelo-core/dist/marketing-consent.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.NO_SIGNUP_MARKETING_CONSENT = void 0;
    exports.signupMarketingConsentFromConfig = signupMarketingConsentFromConfig2;
    exports.deviceLanguage = deviceLanguage;
    exports.configLanguageParam = configLanguageParam2;
    exports.signUpConsentFields = signUpConsentFields2;
    exports.waitlistConsentField = waitlistConsentField2;
    exports.NO_SIGNUP_MARKETING_CONSENT = { asked: false, text: null, language: null };
    function signupMarketingConsentFromConfig2(json) {
      const raw = json["signup_marketing_consent"];
      if (!raw || typeof raw !== "object")
        return exports.NO_SIGNUP_MARKETING_CONSENT;
      return {
        asked: raw["asked"] === true,
        text: typeof raw["text"] === "string" ? raw["text"] : null,
        language: typeof raw["language"] === "string" ? raw["language"] : null
      };
    }
    function deviceLanguage() {
      try {
        const nav = globalThis.navigator;
        if (nav?.language)
          return nav.language;
        const locale = Intl.DateTimeFormat().resolvedOptions().locale;
        if (locale)
          return locale;
      } catch {
      }
      return "en";
    }
    function configLanguageParam2(language = deviceLanguage()) {
      return `&lang=${encodeURIComponent(language)}`;
    }
    function signUpConsentFields2(options, question) {
      if (options?.marketingConsent !== true)
        return {};
      return { marketing_consent: true, lang: question.language ?? deviceLanguage() };
    }
    function waitlistConsentField2(options) {
      const consent = options?.consent;
      if (!consent)
        return {};
      const out = {};
      if (consent.marketing !== void 0)
        out.marketing = consent.marketing === true;
      if (consent.custom !== void 0)
        out.custom = consent.custom === true;
      return Object.keys(out).length > 0 ? { consent: out } : {};
    }
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
    __exportStar(require_error_origin(), exports);
    __exportStar(require_brand_tokens(), exports);
    __exportStar(require_verification(), exports);
    __exportStar(require_marketing_consent(), exports);
  }
});

// src/auth/auth.ts
var import_core7 = __toESM(require_dist());

// src/core/host-os.ts
function hostOS() {
  if (typeof window === "undefined") return "web";
  const w = window;
  const cap = w.Capacitor;
  if (cap) {
    const p = (typeof cap.getPlatform === "function" ? cap.getPlatform() : cap.platform) ?? "";
    if (p === "ios") return "ios";
    if (p === "android") return "android";
  }
  const cordovaPlatform = w.cordova?.platformId;
  if (cordovaPlatform === "ios") return "ios";
  if (cordovaPlatform === "android") return "android";
  return "web";
}

// src/auth/auth.ts
var import_core8 = __toESM(require_dist());
var import_core9 = __toESM(require_dist());

// src/core/storage.ts
var import_core = __toESM(require_dist());
var TokenStorage = class {
  constructor() {
    this.memory = /* @__PURE__ */ new Map();
    this.useLocalStorage = typeof window !== "undefined" && typeof window.localStorage !== "undefined";
  }
  async get(key) {
    if (this.useLocalStorage) {
      try {
        return localStorage.getItem(key) ?? this.memory.get(key) ?? null;
      } catch {
        this.useLocalStorage = false;
      }
    }
    return this.memory.get(key) ?? null;
  }
  async set(key, value) {
    this.memory.set(key, value);
    if (!this.useLocalStorage) return;
    try {
      localStorage.setItem(key, value);
    } catch (err) {
      this.useLocalStorage = false;
      console.warn(
        "[Onelo] localStorage is unavailable (private browsing, disabled storage, or quota) \u2014 the session will live for this tab only and a reload will sign the user out. Original error:",
        err
      );
    }
  }
  async delete(key) {
    this.memory.delete(key);
    if (!this.useLocalStorage) return;
    try {
      localStorage.removeItem(key);
    } catch (err) {
      console.warn("[Onelo] could not remove a stored value:", err);
    }
  }
  async clear() {
    this.memory.clear();
    if (!this.useLocalStorage) return;
    for (const key of Object.values(import_core.TOKEN_KEYS)) {
      try {
        localStorage.removeItem(key);
      } catch (err) {
        console.warn("[Onelo] could not clear stored session:", err);
      }
    }
  }
};

// src/core/session-channel.ts
var CHANNEL = "onelo_auth";
var SESSION_CREATED = "onelo:session-created";
var SESSION_RECEIVED = "onelo:session-received";
var ACK_WAIT_MS = 1500;
function open() {
  if (typeof BroadcastChannel === "undefined") return null;
  try {
    return new BroadcastChannel(CHANNEL);
  } catch {
    return null;
  }
}
function publishSessionCreated(surfaceUrl, waitMs = ACK_WAIT_MS) {
  const ch = open();
  if (!ch) return Promise.resolve(false);
  return new Promise((resolve) => {
    let done = false;
    const finish = (heard) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      ch.removeEventListener("message", onMessage);
      try {
        ch.close();
      } catch {
      }
      resolve(heard);
    };
    const onMessage = (e) => {
      if (e.data?.type === SESSION_RECEIVED) finish(true);
    };
    ch.addEventListener("message", onMessage);
    const timer = setTimeout(() => finish(false), waitMs);
    try {
      ch.postMessage({ type: SESSION_CREATED, surfaceUrl });
    } catch {
      finish(false);
    }
  });
}
function subscribeSessionCreated(onSession) {
  const ch = open();
  if (!ch) return () => {
  };
  const handler = (e) => {
    if (e.data?.type !== SESSION_CREATED) return;
    try {
      ch.postMessage({ type: SESSION_RECEIVED });
    } catch {
    }
    onSession(e.data?.surfaceUrl);
  };
  ch.addEventListener("message", handler);
  return () => {
    ch.removeEventListener("message", handler);
    try {
      ch.close();
    } catch {
    }
  };
}

// src/core/handed-over-notice.ts
var import_core2 = __toESM(require_dist());
var ID = "onelo-handed-over";
var WATCH_MS = 1e4;
var watcher = null;
function stopWatching() {
  watcher?.disconnect();
  watcher = null;
}
function coverPage(t = import_core2.NEUTRAL_BRAND_TOKENS, heading = "Signing you in\u2026") {
  render(heading, null, t, { watch: true, pending: true });
}
function removeCover() {
  if (typeof document === "undefined") return;
  stopWatching();
  document.getElementById(ID)?.remove();
}
function showHandedOverNotice(appName, waitingTab = true, t = import_core2.NEUTRAL_BRAND_TOKENS) {
  render("You're signed in", appName ?? null, t, { watch: true, pending: waitingTab === null, waitingTab: waitingTab !== false });
}
function render(heading, appName, t, { watch = false, pending = false, waitingTab = true } = {}) {
  if (typeof document === "undefined" || !document.body) return;
  const existing = document.getElementById(ID);
  if (existing) {
    const h = existing.querySelector("h1");
    const p = existing.querySelector("p");
    if (h) h.textContent = heading;
    if (p) p.textContent = bodyText(appName, pending, waitingTab);
    existing.style.background = t.page_bg;
    existing.style.color = t.text;
    if (!pending) existing.querySelector("[data-onelo-spinner]")?.remove();
    if (watch) keepAttached(existing);
    return;
  }
  const root = document.createElement("div");
  root.id = ID;
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");
  Object.assign(root.style, {
    position: "fixed",
    inset: "0",
    // Opaque, not a translucent scrim: the app underneath has already booted
    // and must not be readable or clickable through this.
    background: t.page_bg,
    color: t.text,
    zIndex: "2147483647",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    padding: "24px",
    font: `400 15px/1.5 ${t.body_font}`
  });
  const title = document.createElement("h1");
  title.textContent = heading;
  Object.assign(title.style, {
    margin: "0 0 8px",
    font: "600 18px/1.3 inherit"
  });
  const body = document.createElement("p");
  body.textContent = bodyText(appName, pending, waitingTab);
  Object.assign(body.style, {
    margin: "0",
    maxWidth: "320px",
    color: t.text_muted
  });
  if (pending) {
    const spin = document.createElement("div");
    spin.setAttribute("data-onelo-spinner", "");
    spin.setAttribute("aria-hidden", "true");
    const css = document.createElement("style");
    css.textContent = (0, import_core2.spinnerCss)(t, "onelo-handed-over-spin");
    const ring = document.createElement("div");
    ring.className = "onelo-handed-over-spin";
    ring.style.margin = "0 auto 16px";
    spin.append(css, ring);
    root.append(spin);
  }
  root.append(title, body);
  document.body.appendChild(root);
  if (watch) keepAttached(root);
}
function bodyText(appName, pending, waitingTab = true) {
  if (pending) return "";
  if (!waitingTab) {
    return appName ? `You can close this tab and open ${appName} again.` : "You can close this tab and open the app again.";
  }
  return appName ? `Continue in the ${appName} tab you started from \u2014 you can close this one.` : "Continue in the tab you started from \u2014 you can close this one.";
}
function keepAttached(root) {
  if (typeof MutationObserver === "undefined") return;
  stopWatching();
  watcher = new MutationObserver(() => {
    if (!document.getElementById(ID) && document.body) document.body.appendChild(root);
  });
  watcher.observe(document.body, { childList: true });
  setTimeout(stopWatching, WATCH_MS);
}

// src/core/store-return-look.ts
var KEY = "onelo:store-return-look";
var MAX_AGE_MS = 2 * 60 * 60 * 1e3;
function storage() {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}
function rememberStoreReturnLook(publishableKey, tokens, lang) {
  try {
    storage()?.setItem(KEY, JSON.stringify({ pk: publishableKey, tokens, lang, at: Date.now() }));
  } catch {
  }
}
function recallStoreReturnLook(publishableKey, now = Date.now()) {
  try {
    const raw = storage()?.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (v.pk !== publishableKey || typeof v.at !== "number" || now - v.at > MAX_AGE_MS) return null;
    const t = v.tokens;
    if (!t || typeof t.page_bg !== "string" || typeof t.text !== "string" || typeof t.brand !== "string") return null;
    return { tokens: t, lang: typeof v.lang === "string" ? v.lang : null };
  } catch {
    return null;
  }
}
function forgetStoreReturnLook() {
  try {
    storage()?.removeItem(KEY);
  } catch {
  }
}
var SIGNING_IN = {
  en: "Signing you in\u2026",
  pl: "Logujemy Ci\u0119\u2026",
  de: "Sie werden angemeldet\u2026",
  fr: "Connexion en cours\u2026",
  es: "Iniciando sesi\xF3n\u2026",
  pt: "A iniciar sess\xE3o\u2026"
};
function signingInText(lang) {
  const base = (lang ?? "").split("-")[0].toLowerCase();
  return SIGNING_IN[base] ?? SIGNING_IN.en;
}

// src/core/user-revoked.ts
var import_core3 = __toESM(require_dist());
var USER_REVOKED = "user_revoked";
function isUserRevokedRefusal(json) {
  return (0, import_core3.extractErrorCode)(json) === USER_REVOKED;
}

// src/core/hand-back.ts
function classifyHandBack(data) {
  if (!data || typeof data !== "object") return null;
  const d = data;
  switch (d.type) {
    case "onelo:code":
      return typeof d.code === "string" ? { kind: "purchase", code: d.code } : null;
    case "onelo:done":
      return { kind: "switched", reason: String(d.reason ?? "") };
    case "onelo:portal_done":
      return { kind: "portal_closed", event: typeof d.event === "string" ? d.event : null };
    case "onelo:cancel":
      return d.reason === "expired" ? { kind: "expired" } : { kind: "cancelled" };
    case "onelo:error":
      return { kind: "error", message: String(d.message ?? "Auth error") };
    default:
      return null;
  }
}

// src/core/modal-close-button.ts
var import_core4 = __toESM(require_dist());
function createModalCloseButton(t = import_core4.NEUTRAL_BRAND_TOKENS) {
  const btn = document.createElement("button");
  btn.setAttribute("data-onelo-cancel", "");
  btn.setAttribute("aria-label", "Close");
  btn.setAttribute("title", "Close");
  btn.textContent = "\u2715";
  const bg = t.card_bg;
  const border = t.border;
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
    `color:${t.text}`,
    "font-size:15px",
    "line-height:1",
    "cursor:pointer",
    "padding:0",
    "z-index:2",
    "transition:background 120ms ease,border-color 120ms ease,transform 120ms ease"
  ].join(";");
  btn.addEventListener("mouseenter", () => {
    btn.style.background = border;
    btn.style.borderColor = t.text_muted;
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
var import_core5 = __toESM(require_dist());
var AUTH_COLUMN_WIDTH_PX = 300;
function authSkeletonHtml(t) {
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box;margin:0;padding:0}
/* Centred exactly like the hosted page's own Suspense fallback
   (frontend/app/auth/hosted/page.tsx): flex centre + min-height:100vh on a
   page-background ground. Top-aligning here would make the placeholder jump to the
   middle the moment the real form paints. */
body{background:${t.page_bg};font-family:${t.body_font};overflow:hidden;
  display:flex;align-items:center;justify-content:center;min-height:100vh}
${(0, import_core5.skeletonCss)(t)}
.wrap{display:flex;flex-direction:column;align-items:center;width:100%;padding:24px}
/* Width comes from AUTH_COLUMN_WIDTH_PX above \u2014 never type a number here.
   Keep it identical to HostedAuthForm.tsx
   and OAuthButtons.tsx \u2014 four files render the same column and any drift shows
   up as a width jump when the hosted page replaces this placeholder. */
.col{width:100%;max-width:${AUTH_COLUMN_WIDTH_PX}px;display:flex;flex-direction:column;gap:10px}
.logo{width:64px;height:64px;border-radius:${t.card_radius}px;margin-bottom:14px;border:1.5px solid ${t.border}}
.head{width:200px;height:22px;margin-bottom:10px}
.sub{width:140px;height:13px;opacity:0.7;margin-bottom:28px}
.lbl{width:38px;height:11px}
.lbl2{width:58px;height:11px}
.forgot{width:90px;height:11px;opacity:0.7}
.input{height:44px}
.cta{height:48px;margin-top:6px;border-radius:${t.button_radius}px}
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
}
function isExpiredAuthError(err) {
  return err === "invalid_token" || err === "expired_token" || err === "token_expired";
}
var _AuthModal = class _AuthModal {
  /** @param brand The SDK's brand-token model (#681); neutral until config. */
  constructor(brand = new import_core5.BrandSource()) {
    this.brand = brand;
    this.overlay = null;
    this.container = null;
    this.popup = null;
    /** The hosted page's iframe (embedded mode), for answering its renew requests. */
    this.frame = null;
    this.popupPoll = null;
    this.messageHandler = null;
    this.unsubscribeSession = null;
    this.loadWatchdog = null;
    /** Fail-safe ✕ controller for the embedded overlay (see failsafe-close.ts). */
    this.failsafe = null;
    /** The skeleton iframe shown behind the hosted page until it paints. */
    this.skeleton = null;
  }
  /** Close a parked popup nothing adopted. Safe to call at any time. */
  static discardParkedPopup() {
    const p = _AuthModal.parkedPopup;
    _AuthModal.parkedPopup = null;
    try {
      if (p && !p.closed) p.close();
    } catch {
    }
  }
  /** Take the parked popup and point it at `url`; null when there is none. */
  static adoptParkedPopup(url) {
    const p = _AuthModal.parkedPopup;
    _AuthModal.parkedPopup = null;
    if (!p || p.closed) return null;
    try {
      p.location.replace(url);
      p.focus?.();
      return p;
    } catch {
      try {
        p.close();
      } catch {
      }
      return null;
    }
  }
  clearLoadWatchdog() {
    if (this.loadWatchdog) {
      clearTimeout(this.loadWatchdog);
      this.loadWatchdog = null;
    }
  }
  /**
   * @param watchCrossTabSession Settle with `{type:'session'}` if ANOTHER tab
   *   signs this user in while the modal is open. Opt-in, and only the auth
   *   flow asks for it: the STORE is also presented through this modal, and a
   *   sign-in happening elsewhere is no reason to close a checkout the buyer is
   *   part-way through.
   */
  open(hostedUrl, mode = "popup", { watchCrossTabSession = false, renewPortal } = {}) {
    return new Promise((resolve) => {
      const allowedOrigin = new URL(hostedUrl).origin;
      let settled = false;
      const settle = (r) => {
        if (settled) return;
        settled = true;
        if (this.popup && !this.popup.closed && r.type === "error" && isExpiredAuthError(r.message)) {
          _AuthModal.discardParkedPopup();
          _AuthModal.parkedPopup = this.popup;
          this.popup = null;
        }
        this.close();
        resolve(r);
      };
      this.messageHandler = (e) => {
        if (e.origin !== allowedOrigin) return;
        this.clearLoadWatchdog();
        const data = e.data;
        if (data?.type === "onelo:renew_request") {
          const src = e.source;
          const fromOurs = !!src && (this.frame && src === this.frame.contentWindow || this.popup && src === this.popup);
          if (renewPortal && fromOurs && data.kind === "portal" && typeof data.request_id === "string") {
            void renewPortal(data.request_id).then((reply) => {
              try {
                src.postMessage(reply, allowedOrigin);
              } catch {
              }
            });
          }
          return;
        }
        if (data?.type === "onelo:ready" && this.frame && e.source === this.frame.contentWindow) {
          this.failsafe?.markReady();
          this.frame.style.opacity = "1";
          this.skeleton?.remove();
          this.skeleton = null;
        }
        const hb = classifyHandBack(data);
        if (hb?.kind === "purchase") settle({ type: "code", code: hb.code });
        else if (hb?.kind === "switched") settle({ type: "done", reason: hb.reason });
        else if (hb?.kind === "cancelled") settle({ type: "cancelled" });
        else if (hb?.kind === "expired") settle({ type: "error", message: "token_expired" });
        else if (hb?.kind === "error") settle({ type: "error", message: hb.message });
      };
      window.addEventListener("message", this.messageHandler);
      if (watchCrossTabSession) {
        this.unsubscribeSession = subscribeSessionCreated(
          (surfaceUrl) => settle({ type: "session", surfaceUrl })
        );
      }
      if (mode === "popup") {
        this.popup = _AuthModal.adoptParkedPopup(hostedUrl) ?? window.open(
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
          let hint = `check this origin is in the app's allowed origins, or use loadAuthView({ mode: "popup" })`;
          try {
            const pageProtocol = window.location.protocol;
            const hostedProtocol = new URL(hostedUrl).protocol;
            if (pageProtocol === "http:" && hostedProtocol === "https:") {
              hint = `this page is served over ${pageProtocol}// while the hosted page is ${hostedProtocol}// \u2014 browsers block frame access across protocols. Serve your dev server over https, or use loadAuthView({ mode: "popup" }). This is NOT an allowed-origins problem`;
            }
          } catch {
          }
          settle({
            type: "error",
            message: `The hosted page could not be loaded inline \u2014 ${hint}.`
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
    if (this.unsubscribeSession) {
      this.unsubscribeSession();
      this.unsubscribeSession = null;
    }
    if (this.popupPoll) {
      clearInterval(this.popupPoll);
      this.popupPoll = null;
    }
    if (this.popup && !this.popup.closed) this.popup.close();
    this.popup = null;
    this.frame = null;
    this.overlay?.remove();
    this.overlay = null;
    this.container = null;
  }
  buildOverlay(hostedUrl) {
    const t = this.brand.current();
    const overlay = document.createElement("div");
    overlay.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:2147483647",
      `background:${t.page_bg}`
    ].join(";");
    const container = document.createElement("div");
    container.style.cssText = [
      "position:absolute",
      "inset:0",
      "overflow:hidden",
      `background:${t.page_bg}`
    ].join(";");
    this.container = container;
    const skeleton = document.createElement("iframe");
    skeleton.setAttribute("aria-hidden", "true");
    skeleton.setAttribute("sandbox", "");
    skeleton.srcdoc = authSkeletonHtml(t);
    skeleton.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:none;pointer-events:none;";
    this.skeleton = skeleton;
    const iframe = document.createElement("iframe");
    this.frame = iframe;
    iframe.src = hostedUrl;
    iframe.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:none;opacity:0;";
    iframe.setAttribute(
      "sandbox",
      "allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
    );
    const cancelBtn = createModalCloseButton(t);
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
/**
 * A sign-in popup kept open across a flow restart (#625).
 *
 * When the hosted page hands back an expired flow token, the SDK starts a
 * NEW flow. That restart runs from a `message` event, minutes after the last
 * click, so a fresh `window.open` has no user activation and browsers block
 * it. The popup is therefore parked instead of closed, and the next popup
 * `open()` navigates it to the new hosted URL. Whoever restarts must call
 * `discardParkedPopup()` once the restart is done, so a popup that nothing
 * adopted (the restart answered "authorized", or failed) does not linger.
 */
_AuthModal.parkedPopup = null;
var AuthModal = _AuthModal;

// src/auth/external-token.ts
var import_core6 = __toESM(require_dist());

// package.json
var version = "0.80.0";

// src/core/sdk-headers.ts
var SDK_NAME = "onelo-js";
var SDK_HEADERS = Object.freeze({
  "X-SDK-Version": version,
  "X-Onelo-Sdk-Name": SDK_NAME
});

// src/auth/external-token.ts
var RENEW_AT = 0.8;
var RENEW_JITTER = 0.1;
function renewalLeadSeconds(expiresIn, random = Math.random) {
  const renewAfter = expiresIn * RENEW_AT * (1 - RENEW_JITTER * random());
  return expiresIn - renewAfter;
}
var DEFAULT_EXTERNAL_LEAD_SECONDS = renewalLeadSeconds(1800, () => 0);
var RETRY_WITH_A_FRESH_TOKEN = /* @__PURE__ */ new Set(["token_expired", "token_not_yet_valid"]);
function refusalOf(json) {
  const detail = json !== null && typeof json === "object" ? json.detail : void 0;
  if (typeof detail === "string") return { code: void 0, message: detail };
  if (detail === null || typeof detail !== "object") return { code: void 0, message: void 0 };
  const d = detail;
  const code = d["error"] ?? d["error_code"];
  return {
    code: typeof code === "string" ? code : void 0,
    message: typeof d["message"] === "string" ? d["message"] : void 0
  };
}
async function exchangeExternalToken(apiUrl, publishableKey, token) {
  const { status, json } = await (0, import_core6.httpPost)(
    `${apiUrl}/api/sdk/auth/exchange`,
    { publishableKey, token },
    { ...SDK_HEADERS }
  );
  if (status === 200 && json !== null && typeof json === "object") {
    return { kind: "session", json };
  }
  const { code, message } = refusalOf(json);
  const named = code ? `${code}, HTTP ${status}` : `HTTP ${status}`;
  if (status === 429 || status >= 500 || status === 200 || code !== void 0 && RETRY_WITH_A_FRESH_TOKEN.has(code)) {
    return {
      kind: "transient",
      staleToken: code !== void 0 && RETRY_WITH_A_FRESH_TOKEN.has(code),
      error: import_core6.OneloError.server(`The sign-in token could not be exchanged right now (${named})`)
    };
  }
  if (code === "banned") return { kind: "ended", error: import_core6.OneloError.userRevoked() };
  if (code === "no_plan_available") return { kind: "ended", error: import_core6.OneloError.noActivePlan() };
  if (code === "sign_in_mode_onelo") {
    return {
      kind: "ended",
      error: new import_core6.OneloError(
        "session_ended",
        "Onelo refused the sign-in token (sign_in_mode_onelo): this App's Sign-in Mode is Onelo Auth. Set the Sign-in Mode to your provider in the Onelo dashboard before calling useExternalToken()."
      )
    };
  }
  return {
    kind: "ended",
    error: new import_core6.OneloError(
      "session_ended",
      `Onelo refused the sign-in token (${named})${message ? `: ${message}` : ""}`
    )
  };
}

// src/auth/auth.ts
var import_core10 = __toESM(require_dist());
var import_core11 = __toESM(require_dist());
var import_core12 = __toESM(require_dist());
function closingMeansSignOut(url) {
  try {
    return new URL(url).searchParams.get("exit") === "signout";
  } catch {
    return false;
  }
}
var EXTERNAL_SIGNED_OUT_KEY = "onelo_external_signed_out";
function signOutBeforeRestart(message, url) {
  return message === "invalid_token" && closingMeansSignOut(url);
}
var _OneloAuth = class _OneloAuth {
  constructor(config, brand = new import_core11.BrandSource()) {
    /** Lets the auth/store modal answer a checkout's portal renewal (#642).
     *  Set by `Onelo` to the customer portal's `renewReply`. */
    this.renewPortal = null;
    /** Told when a hosted flow this class presented ended in a purchase or a
     *  plan switch (#659). Set by `Onelo` to its plan-change refresher. */
    this.onPlanChange = null;
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
    this.refreshRetryAttempt = 0;
    /** Until this time (ms) getSession() does not start another refresh on its
     *  own — the scheduled retry owns it. Stops an app that reads the session
     *  often from hammering /auth/refresh during an outage. */
    this.refreshBackoffUntil = 0;
    // ── External sign-in (#798, ADR-0032) ──────────────────────────────────────
    /** The App's own sign-in provider, once handed over with useExternalToken().
     *  While set, the session is renewed by exchanging a fresh provider token
     *  (there is no refresh token) and no Onelo sign-in screen is ever shown. */
    this.externalToken = null;
    /** True while the `storage` listener that keeps external sign-out in step
     *  across tabs is attached (#836). */
    this.externalStorageListener = null;
    /** The last exchange was refused because the provider's token was outside
     *  its validity window (#836). Once the Onelo access token has expired too,
     *  the session ends instead of being retried forever. */
    this.externalTokenStale = false;
    /** This tab has already told its listeners about the external sign-out, so
     *  a later renewal attempt that finds the mark stays silent (#836). */
    this.externalSignOutHeard = false;
    /** Seconds before expiry at which the external session is renewed: set with
     *  jitter by each exchange this tab makes. */
    this.externalLeadSeconds = DEFAULT_EXTERNAL_LEAD_SECONDS;
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
    /** True once this tab has handed a magic-link sign-in to another tab.
     *
     *  It is then DONE: it shows "continue in the other tab" and must present
     *  nothing else. Without this the host app's own startup call to
     *  loadAuthView() opened a sign-in form on top of that notice, so the tab the
     *  user was told to leave asked them to log in again (reported 2026-08-19). */
    this.handedOverToAnotherTab = false;
    this.allowCustomBranding = false;
    this.appName = "App";
    this.appLogoUrl = null;
    this.paywallEnabled = false;
    /** False when Paywall → Access Gate is "Sign in only": this app never sells
     *  in-app. Read it before offering ANY upgrade CTA — see isStoreAvailable(). */
    this.inAppStoreAllowed = true;
    /**
     * Which hosted surface `loadAuthView()` last opened: `sign_in`, `store`,
     * `no_plan`, or null when nothing was presented (the caller was already
     * authorized, or the flow never got that far).
     *
     * `/api/sdk/flow/init` decides this centrally and the SDK used to drop it, so
     * a host app that got `null` back could not tell "cancelled the sign-in" from
     * "declined to buy" from "was shown 'no active plan'". The return type stays
     * `OneloSession | null` — this is additive, and reading it is optional.
     */
    this.lastPresentedSurface = null;
    this.waitlistMode = false;
    this.sdkRedirectUrl = null;
    this.storeUrl = null;
    this.manageUrl = null;
    this.brand = brand;
    if (!config.apiUrl) throw new Error("[Onelo] apiUrl is required");
    if (!config.publishableKey) throw new Error("[Onelo] publishableKey is required");
    this.apiUrl = config.apiUrl;
    this.publishableKey = config.publishableKey;
    this.storage = new TokenStorage();
    this.initPromise = this.initialize();
  }
  setPortalRenewer(fn) {
    this.renewPortal = fn;
  }
  setPlanChangeHandler(fn) {
    this.onPlanChange = fn;
  }
  async initialize() {
    if (typeof window !== "undefined") {
      try {
        const q = new URL(window.location.href).searchParams;
        if (q.get("onelo_store_code")) this.coverStoreReturn();
        else if (q.get("onelo_code") || q.get("onelo_gate") || q.get("onelo_link")) coverPage(this.brand.current());
      } catch {
      }
    }
    try {
      const verifier = (0, import_core7.generateCodeVerifier)();
      this.pkceVerifier = verifier;
      const challenge = await (0, import_core7.generateCodeChallenge)(verifier);
      const url = `${this.apiUrl}/api/sdk/config?key=${encodeURIComponent(this.publishableKey)}&code_challenge=${encodeURIComponent(challenge)}${(0, import_core12.configLanguageParam)()}`;
      const { status, json } = await (0, import_core8.httpGet)(url, {
        ...SDK_HEADERS,
        "X-Onelo-OS": hostOS()
      });
      if (status === 401 || status === 404) throw import_core10.OneloError.invalidKey("Server rejected the key");
      if (status !== 200) throw import_core10.OneloError.server(`Config request failed: HTTP ${status}`);
      const j = json;
      const brandTokens = (0, import_core10.brandTokensFromResponse)(j) ?? import_core10.NEUTRAL_BRAND_TOKENS;
      this.brand.set(brandTokens);
      this.resolvedConfig = {
        supabaseUrl: j["supabase_url"],
        supabaseAnonKey: j["supabase_anon_key"],
        tenantId: j["tenant_id"],
        allowCustomBranding: j["allow_custom_branding"] ?? false,
        appName: j["app_name"] ?? null,
        appLogoUrl: j["app_logo_url"] ?? null,
        paywallEnabled: j["paywall_enabled"] ?? false,
        // Access Gate. The backend has always sent this; the parser dropped it,
        // so nothing downstream could tell "Sign in only" from "Show the store".
        // Defaults TRUE — an older backend that omits it behaves as before.
        inAppStoreAllowed: j["in_app_store_allowed"] ?? true,
        waitlistMode: j["waitlist_mode"] ?? false,
        sdkRedirectUrl: j["sdk_redirect_url"] ?? null,
        storeUrl: j["store_url"] ?? null,
        manageUrl: j["manage_url"] ?? null,
        // Branding page background — the token's page_bg (#681).
        pageBackgroundColor: brandTokens.page_bg,
        brandTokens,
        signupMarketingConsent: (0, import_core12.signupMarketingConsentFromConfig)(j)
      };
      this.allowCustomBranding = this.resolvedConfig.allowCustomBranding;
      if (this.resolvedConfig.appName) this.appName = this.resolvedConfig.appName;
      this.appLogoUrl = this.resolvedConfig.appLogoUrl;
      this.paywallEnabled = this.resolvedConfig.paywallEnabled;
      this.inAppStoreAllowed = this.resolvedConfig.inAppStoreAllowed ?? true;
      this.waitlistMode = this.resolvedConfig.waitlistMode;
      this.sdkRedirectUrl = this.resolvedConfig.sdkRedirectUrl;
      this.storeUrl = this.resolvedConfig.storeUrl;
      this.manageUrl = this.resolvedConfig.manageUrl;
      this.isReady = true;
      try {
        await this.exchangeCodeFromUrl();
      } catch (err) {
        console.warn("[Onelo] magic-link sign-in could not be completed:", err);
      }
    } catch (e) {
      if (e instanceof import_core10.OneloError && e.code === "invalid_publishable_key") {
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
    if (this.isRevoked) throw import_core10.OneloError.invalidKey("Application key has been revoked");
    if (this.handedOverToAnotherTab) return null;
    if (this.externalToken) return this.getSession();
    const mode = options?.mode ?? "embedded";
    if (this.waitlistMode && this.sdkRedirectUrl) {
      window.open(this.sdkRedirectUrl, "_blank");
      return null;
    }
    const existing = await this.getSession();
    const decision = await this.resolveFlow(existing?.accessToken ?? null);
    this.lastPresentedSurface = decision.action === "present" ? decision.surface || null : null;
    if (decision.action === "authorized") {
      if (this.paywallEnabled) await this.revalidateEntitlement().catch(() => {
      });
      return await this.getSession() ?? existing;
    }
    if (this.pkceVerifier) await this.persistMagicLinkVerifier(this.pkceVerifier);
    const modal = new AuthModal(this.brand);
    const result = await modal.open(this.withReturnTo(decision.url), mode, {
      watchCrossTabSession: true,
      renewPortal: this.renewPortal ?? void 0
    });
    if (result.type === "cancelled") {
      if (closingMeansSignOut(decision.url)) {
        await this.signOut();
        return this.loadAuthView(options);
      }
      return null;
    }
    if (result.type === "error") {
      if (isExpiredAuthError(result.message)) {
        return this.restartFlow(options, signOutBeforeRestart(result.message, decision.url));
      }
      throw import_core10.OneloError.server(result.message);
    }
    if (result.type === "session") {
      const restored = await this.getSession();
      if (restored) {
        this.notifyListeners(restored);
        return restored;
      }
      if (result.surfaceUrl) {
        const surface = result.surfaceUrl;
        const gate = await new AuthModal(this.brand).open(surface, mode, { renewPortal: this.renewPortal ?? void 0 });
        if (gate.type === "cancelled" && closingMeansSignOut(surface)) {
          await this.signOut();
          return this.loadAuthView(options);
        }
        if (gate.type === "error" && isExpiredAuthError(gate.message)) {
          return this.restartFlow(options, signOutBeforeRestart(gate.message, surface));
        }
        if (gate.type === "code") return this.exchangeStoreCode(gate.code);
        return null;
      }
      return this.loadAuthView(options);
    }
    if (result.type === "done") {
      this.onPlanChange?.({ kind: "switched", reason: result.reason });
      return this.getSession();
    }
    return this.exchangeStoreCode(result.code);
  }
  /** A code from a hosted flow that may have chained into the store: exchange
   *  it, then reconcile the plan at once (#659) instead of waiting for the
   *  stream — a sign-in without a purchase only costs one extra resolve. */
  async exchangeStoreCode(code) {
    const session = await this.exchangeHostedCode(code);
    this.onPlanChange?.({ kind: "purchase" });
    return session;
  }
  /**
   * Start the hosted flow over after the page reported its flow token spent.
   *
   * The popup the page ran in was parked by AuthModal rather than closed, so
   * the new flow reuses it instead of calling `window.open` without a user
   * gesture, which browsers block (#625). Whatever the new pass does, a popup
   * it did not adopt (it answered "authorized", or it failed) is closed here.
   */
  async restartFlow(options, signOutFirst) {
    try {
      if (signOutFirst) await this.signOut();
      return await this.loadAuthView(options);
    } finally {
      AuthModal.discardParkedPopup();
    }
  }
  /** Trade a one-time hosted code for a session. One implementation, because
   *  the hosted flow can hand a code back from more than one surface. */
  async exchangeHostedCode(code) {
    const { status, json } = await (0, import_core8.httpPost)(
      `${this.apiUrl}/api/sdk/auth/hosted-callback`,
      { publishableKey: this.publishableKey, code, code_verifier: this.pkceVerifier },
      { ...SDK_HEADERS }
    );
    if (status !== 200) throw import_core10.OneloError.server("Hosted callback failed");
    const session = (0, import_core9.mapSession)(json);
    await this.saveSession(session, { announce: true });
    return session;
  }
  /**
   * Resolve the next flow step from the backend. Sends the current access token
   * (if any) as a Bearer so the backend sees whether we're signed in + entitled,
   * then returns 'authorized' (no UI) or 'present' with the hosted URL to open.
   */
  async resolveFlow(accessToken) {
    const headers = { ...SDK_HEADERS };
    if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
    const challenge = this.pkceVerifier ? await (0, import_core7.generateCodeChallenge)(this.pkceVerifier) : null;
    const challengeParam = challenge ? `&code_challenge=${encodeURIComponent(challenge)}` : "";
    const { status, json } = await (0, import_core8.httpGet)(
      `${this.apiUrl}/api/sdk/flow/init?key=${encodeURIComponent(this.publishableKey)}&callback_scheme=onelo-callback${challengeParam}`,
      headers
    );
    if (status !== 200) {
      if (isUserRevokedRefusal(json)) {
        this.isUserRevoked = true;
        throw import_core10.OneloError.userRevoked();
      }
      const detail = json?.["detail"];
      const reason = typeof detail === "string" ? detail : `HTTP ${status}`;
      throw import_core10.OneloError.server(`Failed to resolve auth flow: ${reason}`);
    }
    const j = json;
    if (j["action"] === "authorized") return { action: "authorized" };
    if (j["action"] === "present" && typeof j["url"] === "string") {
      if (j["app_name"]) this.appName = j["app_name"];
      if (j["app_logo_url"]) this.appLogoUrl = j["app_logo_url"];
      return { action: "present", surface: String(j["surface"] ?? ""), url: j["url"] };
    }
    throw import_core10.OneloError.server("Invalid flow response");
  }
  // ── Custom UI (paid plans only) ─────────────────────────────────────────────
  async signIn(email, password) {
    await this.initPromise;
    if (!this.allowCustomBranding) throw import_core10.OneloError.planRequired();
    if (!this.pkceVerifier) this.pkceVerifier = (0, import_core7.generateCodeVerifier)();
    const { status, json } = await (0, import_core8.httpPost)(
      `${this.apiUrl}/api/sdk/auth/signin`,
      { email, password, publishableKey: this.publishableKey, code_verifier: this.pkceVerifier },
      { ...SDK_HEADERS }
    );
    (0, import_core8.checkHostedFlowRequired)(json);
    const j = json;
    if (status === 403) {
      const detail = j["detail"];
      if (detail?.["error"] === "user_revoked") throw import_core10.OneloError.userRevoked();
      throw import_core10.OneloError.server(detail?.["message"] ?? j["error"]);
    }
    if (status !== 200) throw import_core10.OneloError.server(`Sign in failed: HTTP ${status}`);
    this.pkceVerifier = null;
    const session = (0, import_core9.mapSession)(j);
    await this.saveSession(session);
    return session;
  }
  /**
   * #818 — should your own sign-up screen show the optional Marketing Consent
   * checkbox, and with what text? Set on the parent App in Auth → Sign-up; an
   * App that sells asks at Checkout instead (`asked` false). Show `text`
   * unticked and pass the person's choice to `signUp(..., { marketingConsent })`.
   * Accurate after `whenReady()`.
   */
  getSignupMarketingConsent() {
    return this.resolvedConfig?.signupMarketingConsent ?? import_core12.NO_SIGNUP_MARKETING_CONSENT;
  }
  async signUp(email, password, options) {
    await this.initPromise;
    if (!this.allowCustomBranding) throw import_core10.OneloError.planRequired();
    if (!this.pkceVerifier) this.pkceVerifier = (0, import_core7.generateCodeVerifier)();
    const { status, json } = await (0, import_core8.httpPost)(
      `${this.apiUrl}/api/sdk/auth/signup`,
      {
        email,
        password,
        publishableKey: this.publishableKey,
        code_verifier: this.pkceVerifier,
        // #818: only when the person ticked it, in the language of the text shown.
        ...(0, import_core12.signUpConsentFields)(options, this.getSignupMarketingConsent())
      },
      { ...SDK_HEADERS }
    );
    (0, import_core8.checkHostedFlowRequired)(json);
    const j = json;
    if (status !== 200) throw import_core10.OneloError.server(`Sign up failed: HTTP ${status}`);
    this.pkceVerifier = null;
    const session = (0, import_core9.mapSession)(j);
    await this.saveSession(session);
    return session;
  }
  // ── Session management ──────────────────────────────────────────────────────
  async signOut() {
    this.signOutEpoch++;
    const external = this.externalToken !== null;
    if (external) this.externalSignOutHeard = true;
    this.stopHeartbeat();
    this.clearRefreshTimer();
    const accessToken = await this.storage.get(import_core.TOKEN_KEYS.ACCESS_TOKEN);
    await this.storage.clear();
    if (external) await this.storage.set(EXTERNAL_SIGNED_OUT_KEY, String(Date.now()));
    this.notifyListeners(null);
    if (accessToken) {
      try {
        await (0, import_core8.httpPost)(
          `${this.apiUrl}/api/sdk/auth/signout`,
          {},
          {
            ...SDK_HEADERS,
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
    if (!accessToken || !this._hasRenewal(refreshToken) || !userJson) return null;
    if (this.externalToken && await this._externalSignedOut()) return null;
    const expiresAt = parseInt(expiresAtStr ?? "0", 10);
    if (Date.now() / 1e3 > expiresAt - this._refreshLeadSeconds()) {
      if (this.externalToken && this.externalTokenStale && Date.now() / 1e3 >= expiresAt) {
        await this._endSession();
        return null;
      }
      if (Date.now() < this.refreshBackoffUntil) return this._storedSession();
      return this.refreshSession().catch((e) => {
        if ((0, import_core10.isSessionEndError)(e)) return null;
        return this._storedSession();
      });
    }
    const session = { accessToken, refreshToken: refreshToken ?? "", expiresAt, user: JSON.parse(userJson) };
    if (this.externalToken) {
      this.externalSignOutHeard = false;
      this.scheduleRefresh(session);
      return session;
    }
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
   * True when this app has the paywall enabled (from `/api/sdk/config`).
   *
   * Parity with the Electron and React Native SDKs, which have had this since
   * the launch gates were written. It was MISSING here — and the JS auth snippet
   * shipped `onelo.auth.isPaywallEnabled()` anyway, so every developer who
   * followed our own web documentation called a function that did not exist.
   *
   * Accurate only after `whenReady()` resolves; false before config loads.
   */
  isPaywallEnabled() {
    return this.paywallEnabled;
  }
  /**
   * May this app open a store at all?
   *
   * False when the developer chose Paywall → Access Gate → "Sign in only":
   * buyers pay on their website, so nothing in the app may show plans, a
   * checkout, or an "upgrade" CTA that leads to one.
   *
   * Check it before rendering any upsell. The backend refuses store-initiate in
   * that state (409 `in_app_store_not_allowed`), so ignoring this only turns a
   * hidden button into a dead one — but a dead button is still a broken screen.
   *
   * Accurate after `whenReady()`; true before config loads, so an early call
   * cannot hide a store the developer does sell through.
   */
  isStoreAvailable() {
    return this.inAppStoreAllowed;
  }
  /**
   * **Should this user see your app?** The ONE signal to gate your UI on.
   *
   * `signed in && (no paywall || has paid access)`.
   *
   * Gating on a session alone is a paid-product giveaway: the session says WHO
   * someone is and nothing about whether they may be here. That is not
   * hypothetical — it is what happened when the gate had to be hand-assembled
   * from three separate reads, which is what this method replaces. Mirrors
   * Swift's `isAllowedIn` and the Flutter getter of the same name.
   *
   * Call it AFTER `whenReady()`: `isPaywallEnabled()` is false until config
   * loads, so an early call can answer true for an unentitled user. The Swift
   * property folds `isReady` in because it is observable; here readiness is
   * awaited, not observed, so awaiting is the caller's half of the contract.
   */
  async isAllowedIn() {
    await this.initPromise;
    if (!this.resolvedConfig) return false;
    const session = await this.getSession();
    if (!session) return false;
    if (typeof session.user.allowedIn === "boolean") return session.user.allowedIn;
    if (!this.paywallEnabled) return true;
    return session.user.entitlement === "active";
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
      const { status, json } = await (0, import_core8.httpGet)(
        `${this.apiUrl}/api/sdk/auth/user`,
        {
          ...SDK_HEADERS,
          Authorization: `Bearer ${session.accessToken}`,
          "X-Publishable-Key": this.publishableKey
        }
      );
      if (status !== 200) {
        if (isUserRevokedRefusal(json)) this.isUserRevoked = true;
        return session.user.entitlement;
      }
      const body = json;
      const next = body["entitlement"] === "active" ? "active" : "none";
      const nextUser = (0, import_core11.mergeAccessAnswer)({ ...session.user, entitlement: next }, body);
      const changed = next !== session.user.entitlement || nextUser.allowedIn !== session.user.allowedIn || nextUser.emailVerified !== session.user.emailVerified || nextUser.accessReason !== session.user.accessReason;
      if (changed && epoch === this.signOutEpoch) {
        await this.saveSession({ ...session, user: nextUser });
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
   *  Layer 2: a cross-tab Web Lock. Falls back to a plain refresh only where
   *  Web Locks are unavailable; a lock-wait timeout adopts the other tab's
   *  result or reports a transient `timeout` — it never resends the token. */
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
    const seen = await this.storage.get(this._renewalKey());
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), _OneloAuth.REFRESH_LOCK_TIMEOUT_MS);
    let started = false;
    try {
      return await locks.request(
        `${_OneloAuth.REFRESH_LOCK_PREFIX}:${this.publishableKey}`,
        { signal: controller.signal },
        async () => {
          started = true;
          const adopted = await this._adoptOtherTabRefresh(seen);
          if (adopted !== void 0) return adopted;
          return this._doRefresh(epoch);
        }
      );
    } catch (e) {
      if (!started && (controller.signal.aborted || e instanceof DOMException && e.name === "AbortError")) {
        const adopted = await this._adoptOtherTabRefresh(seen);
        if (adopted !== void 0) return adopted;
        if (epoch === this.signOutEpoch) this._scheduleRefreshRetry();
        throw import_core10.OneloError.timeout("Another tab is still refreshing the session");
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  /** If another tab changed the stored refresh token since `seen` was read,
   *  return the outcome it left in storage: its rotated session, or null when
   *  it ended the session. `undefined` = nothing changed, this tab must act. */
  async _adoptOtherTabRefresh(seen) {
    if (!seen) return void 0;
    const current = await this.storage.get(this._renewalKey());
    if (current === seen) return void 0;
    const session = current ? await this._storedSession() : null;
    if (!session) {
      this.clearRefreshTimer();
      this.notifyListeners(null);
      return null;
    }
    this.refreshRetryAttempt = 0;
    this.refreshBackoffUntil = 0;
    this.scheduleRefresh(session);
    if (this.externalToken) this.notifyListeners(session);
    return session;
  }
  /** The complete session in storage, or null. */
  async _storedSession() {
    const [accessToken, refreshToken, expiresAtStr, userJson] = await Promise.all([
      this.storage.get(import_core.TOKEN_KEYS.ACCESS_TOKEN),
      this.storage.get(import_core.TOKEN_KEYS.REFRESH_TOKEN),
      this.storage.get(import_core.TOKEN_KEYS.EXPIRES_AT),
      this.storage.get(import_core.TOKEN_KEYS.USER_JSON)
    ]);
    if (!accessToken || !this._hasRenewal(refreshToken) || !userJson) return null;
    try {
      const user = JSON.parse(userJson);
      return { accessToken, refreshToken: refreshToken ?? "", expiresAt: parseInt(expiresAtStr ?? "0", 10), user };
    } catch {
      return null;
    }
  }
  /** True when the stored session can be renewed: an Onelo Auth session by its
   *  refresh token, an external one (which has none) by the provider function. */
  _hasRenewal(refreshToken) {
    return this.externalToken ? true : !!refreshToken;
  }
  /** The stored value that changes whenever ANY tab renews the session: the
   *  refresh token rotates for Onelo Auth; an external session has only its
   *  access token. */
  _renewalKey() {
    return this.externalToken ? import_core.TOKEN_KEYS.ACCESS_TOKEN : import_core.TOKEN_KEYS.REFRESH_TOKEN;
  }
  /** How long before expiry the session is renewed. */
  _refreshLeadSeconds() {
    return this.externalToken ? this.externalLeadSeconds : _OneloAuth.REFRESH_LEAD_SECONDS;
  }
  /**
   * Use the App's own sign-in (Supabase, Clerk, Firebase or any OpenID Connect
   * issuer) instead of Onelo Auth (#798, ADR-0032). The App's Sign-in Mode must
   * be set to that provider in the Onelo dashboard.
   *
   * `getToken` returns the provider's CURRENT token, or nothing when no user is
   * signed in there. The SDK exchanges it for an Onelo session at once, keeps
   * that session where every Module reads it, and asks `getToken` again to
   * renew it before it lapses (the session lasts 30 minutes; renewal happens
   * after about 80% of that). When `getToken` returns nothing the session ends
   * and `onAuthStateChange(null)` fires. No Onelo sign-in screen is ever shown.
   *
   * Call it once on start, and again whenever the provider's user changes
   * (sign-in, sign-out, a different account).
   *
   * Resolves to the session, or null when the provider has no user. Rejects
   * with an `OneloError` when Onelo refuses the token (`session_ended`,
   * `user_revoked`, `no_active_plan`) or cannot be reached; a failure that can
   * pass (offline, a rate limit) is retried in the background.
   */
  async useExternalToken(getToken) {
    if (typeof getToken !== "function") {
      throw new TypeError("[Onelo] useExternalToken() needs a function that returns your provider's token");
    }
    await this.initPromise;
    if (this.refreshInFlight) await this.refreshInFlight.catch(() => {
    });
    this.stopHeartbeat();
    this.clearRefreshTimer();
    this.refreshRetryAttempt = 0;
    this.refreshBackoffUntil = 0;
    if (await this.storage.get(import_core.TOKEN_KEYS.REFRESH_TOKEN)) await this.storage.clear();
    this.externalToken = getToken;
    this.externalTokenStale = false;
    this.externalSignOutHeard = false;
    await this.storage.delete(EXTERNAL_SIGNED_OUT_KEY);
    this._listenForOtherTabs();
    return this.refreshSession();
  }
  /** Renew an external session: ask the provider for its current token and
   *  exchange it. The single-flight and the cross-tab lock above apply as for a
   *  refresh, so concurrent callers share one exchange. */
  async _doExternalExchange(getToken, epoch) {
    if (await this._externalSignedOut()) {
      if (epoch === this.signOutEpoch && !this.externalSignOutHeard) {
        this.externalSignOutHeard = true;
        await this._endSession();
      }
      return null;
    }
    let token;
    try {
      token = await getToken();
    } catch (e) {
      if (epoch === this.signOutEpoch) this._scheduleRefreshRetry();
      throw e;
    }
    if (epoch !== this.signOutEpoch) return null;
    if (typeof token !== "string" || token.length === 0) {
      await this._endSession();
      return null;
    }
    let outcome;
    try {
      outcome = await exchangeExternalToken(this.apiUrl, this.publishableKey, token);
    } catch (e) {
      if (epoch === this.signOutEpoch) this._scheduleRefreshRetry();
      throw e;
    }
    if (outcome.kind === "transient") {
      if (epoch !== this.signOutEpoch) throw outcome.error;
      this.externalTokenStale = outcome.staleToken;
      const stored = outcome.staleToken ? await this._storedSession() : null;
      if (outcome.staleToken && (!stored || Date.now() / 1e3 >= stored.expiresAt)) {
        await this._endSession();
        throw new import_core10.OneloError(
          "session_ended",
          "The sign-in provider only returned expired tokens and the Onelo session has expired"
        );
      }
      this._scheduleRefreshRetry();
      throw outcome.error;
    }
    if (epoch !== this.signOutEpoch) return null;
    if (outcome.kind === "ended") {
      await this._endSession();
      if (outcome.error.code === "user_revoked") this.isUserRevoked = true;
      throw outcome.error;
    }
    const tokens = outcome.json["session"];
    const expiresIn = tokens?.["expires_in"];
    const session = { ...(0, import_core9.mapSession)(outcome.json), refreshToken: "" };
    if (typeof expiresIn === "number" && expiresIn > 0) {
      this.externalLeadSeconds = renewalLeadSeconds(expiresIn);
    }
    this.isUserRevoked = false;
    this.externalTokenStale = false;
    await this.saveSession(session);
    return session;
  }
  /** True when an external session was signed out, in this tab or another one
   *  sharing the storage, and no new provider sign-in has happened since. */
  async _externalSignedOut() {
    return await this.storage.get(EXTERNAL_SIGNED_OUT_KEY) !== null;
  }
  /** Keep this tab in step with the others (#836). The browser fires `storage`
   *  in every OTHER tab of the origin when one writes localStorage: a sign-out
   *  there ends the session here at once, and a new session written there (a
   *  new provider sign-in) is adopted and renewed here. */
  _listenForOtherTabs() {
    if (this.externalStorageListener) return;
    if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;
    this.externalStorageListener = (e) => {
      if (!this.externalToken) return;
      if (e.key === EXTERNAL_SIGNED_OUT_KEY && e.newValue !== null) {
        this.signOutEpoch++;
        this.externalSignOutHeard = true;
        this.refreshRetryAttempt = 0;
        this.refreshBackoffUntil = 0;
        this.clearRefreshTimer();
        this.notifyListeners(null);
      } else if (e.key === EXTERNAL_SIGNED_OUT_KEY && e.newValue === null) {
        void this.storage.delete(EXTERNAL_SIGNED_OUT_KEY);
      } else if (e.key === import_core.TOKEN_KEYS.ACCESS_TOKEN && e.newValue) {
        void (async () => {
          await this.storage.delete(EXTERNAL_SIGNED_OUT_KEY);
          const session = await this._storedSession();
          if (!session || session.accessToken !== e.newValue) return;
          this.refreshRetryAttempt = 0;
          this.refreshBackoffUntil = 0;
          this.externalTokenStale = false;
          this.externalSignOutHeard = false;
          this.scheduleRefresh(session);
          this.notifyListeners(session);
        })();
      }
    };
    window.addEventListener("storage", this.externalStorageListener);
  }
  /** Clear the stored session and tell listeners. */
  async _endSession() {
    this.stopHeartbeat();
    this.clearRefreshTimer();
    const signedOut = await this.storage.get(EXTERNAL_SIGNED_OUT_KEY);
    await this.storage.clear();
    if (signedOut !== null) await this.storage.set(EXTERNAL_SIGNED_OUT_KEY, signedOut);
    this.notifyListeners(null);
  }
  async _doRefresh(epoch) {
    if (this.externalToken) return this._doExternalExchange(this.externalToken, epoch);
    const refreshToken = await this.storage.get(import_core.TOKEN_KEYS.REFRESH_TOKEN);
    if (!refreshToken) return null;
    let res;
    try {
      res = await (0, import_core8.httpPost)(
        `${this.apiUrl}/api/sdk/auth/refresh`,
        // Wire key MUST be snake_case `refresh_token`: the backend
        // RefreshRequest model (sdk_auth.py) requires it and rejects a
        // camelCase `refreshToken` with a hard 422 (the handler never runs).
        // Matches every response payload + the Swift SDK request.
        { publishableKey: this.publishableKey, refresh_token: refreshToken },
        { ...SDK_HEADERS }
      );
    } catch (e) {
      if (epoch === this.signOutEpoch) this._scheduleRefreshRetry();
      throw e;
    }
    const { status, json } = res;
    (0, import_core8.checkHostedFlowRequired)(json);
    const j = json;
    if (status === 429 || status >= 500) {
      if (epoch === this.signOutEpoch) this._scheduleRefreshRetry();
      throw import_core10.OneloError.server(`Session refresh is temporarily unavailable (HTTP ${status})`);
    }
    if (status !== 200) {
      this.clearRefreshTimer();
      await this.storage.clear();
      this.notifyListeners(null);
      const detail = j["detail"];
      const reason = detail?.["error"] ?? detail?.["error_code"];
      if (reason === "banned") {
        this.isUserRevoked = true;
        throw import_core10.OneloError.userRevoked();
      }
      if (reason === "no_plan_available") {
        throw import_core10.OneloError.noActivePlan();
      }
      throw import_core10.OneloError.sessionEnded();
    }
    if (epoch !== this.signOutEpoch) return null;
    const session = (0, import_core9.mapSession)(j);
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
    stream.on("paywall.access_changed", () => {
      void this.revalidateEntitlement();
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
      try {
        const session = await this.getSession();
        if (!session) {
          this.stopHeartbeat();
          return;
        }
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
    if (Date.now() < this.refreshBackoffUntil) return;
    this.clearRefreshTimer();
    const nowSec = Date.now() / 1e3;
    const delaySec = session.expiresAt - nowSec - this._refreshLeadSeconds();
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
  /** Re-arm the refresh after a transient failure, with backoff (see
   *  REFRESH_RETRY_BASE_MS). Reset by the next saved session. */
  _scheduleRefreshRetry() {
    const delay = Math.min(
      _OneloAuth.REFRESH_RETRY_BASE_MS * 2 ** this.refreshRetryAttempt,
      _OneloAuth.REFRESH_RETRY_MAX_MS
    );
    this.refreshRetryAttempt++;
    this.refreshBackoffUntil = Date.now() + delay;
    this.clearRefreshTimer();
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.refreshBackoffUntil = 0;
      void (async () => {
        const stored = await this._storedSession();
        if (stored && Date.now() / 1e3 < stored.expiresAt - this._refreshLeadSeconds()) {
          this.refreshRetryAttempt = 0;
          this.scheduleRefresh(stored);
          return;
        }
        await this.refreshSession();
      })().catch(() => {
      });
    }, delay);
  }
  /**
   * @param announce Tell OTHER TABS a sign-in just happened. Only a genuine
   *   sign-in announces. A token REFRESH must not: a tab sitting on the
   *   sign-in screen would settle its modal, look for the session, find none
   *   (the refresh happened in a different tab, not this one) and report a
   *   cancelled sign-in — worse than the waiting it replaced.
   */
  async saveSession(session, { announce = false } = {}) {
    this.refreshRetryAttempt = 0;
    this.refreshBackoffUntil = 0;
    await Promise.all([
      this.storage.set(import_core.TOKEN_KEYS.ACCESS_TOKEN, session.accessToken),
      this.storage.set(import_core.TOKEN_KEYS.REFRESH_TOKEN, session.refreshToken),
      this.storage.set(import_core.TOKEN_KEYS.EXPIRES_AT, String(session.expiresAt)),
      this.storage.set(import_core.TOKEN_KEYS.USER_JSON, JSON.stringify(session.user))
    ]);
    if (!this.externalToken) this.startHeartbeat(session.accessToken);
    this.scheduleRefresh(session);
    this.notifyListeners(session);
    if (announce) void publishSessionCreated();
  }
  notifyListeners(session) {
    for (const cb of this.authStateListeners) cb(session);
  }
  /** Import a session obtained outside of OneloAuth (e.g. from paywall flow). Saves tokens and notifies listeners. */
  async importSession(session) {
    await this.saveSession(session);
  }
  /**
   * Email a sign-in link. **Custom-UI path — paid plans only.**
   *
   * The plan gate matches `signIn()` / `signUp()` above. It was missing here, so
   * on a free plan the call succeeded, the mail went out, and the developer had
   * an API they could never finish: without `allowCustomBranding` they may not
   * build their own sign-in screen at all, which is the only place this method
   * makes sense. Either both are gated or neither; a half-working API is worse
   * than a refused one.
   *
   * On a free plan use the hosted sign-in page (`loadAuthView()`), where magic
   * link is available to everyone and the return trip is already wired.
   */
  async sendMagicLink(email, redirectTo) {
    await this.initPromise;
    if (!this.allowCustomBranding) throw import_core10.OneloError.planRequired();
    const body = { publishableKey: this.publishableKey, email };
    if (redirectTo) body.redirectTo = redirectTo;
    const verifier = (0, import_core7.generateCodeVerifier)();
    if (await this.persistMagicLinkVerifier(verifier)) {
      body.code_challenge = await (0, import_core7.generateCodeChallenge)(verifier);
    }
    const { status: mlStatus, json: mlJson } = await (0, import_core8.httpPost)(`${this.apiUrl}/api/sdk/auth/magic-link`, body, { ...SDK_HEADERS });
    if (mlStatus >= 400) throw import_core10.OneloError.server(`Magic link request failed: HTTP ${mlStatus}`);
    if (mlJson?.["success"] === false) {
      const reason = mlJson["error"];
      throw import_core10.OneloError.server(`Magic link refused${typeof reason === "string" ? `: ${reason}` : ""}`);
    }
  }
  /** End this tab's part in the flow: show the farewell notice and refuse to
   *  present anything afterwards — including the host app's own startup call to
   *  loadAuthView(), which otherwise opened a login form on top of the notice. */
  finishAsMessengerTab(heard) {
    this.handedOverToAnotherTab = true;
    showHandedOverNotice(this.appName, null, this.brand.current());
    void heard.then((waitingTab) => {
      if (this.handedOverToAnotherTab) showHandedOverNotice(this.appName, waitingTab, this.brand.current());
    });
  }
  /**
   * Tell the hosted page which page to send the browser back to.
   *
   * Only magic link needs this, and only on the web: every other hosted step
   * finishes inside the iframe and answers by postMessage, but a magic link is
   * opened LATER from an email, in a tab that has no way back to this one. The
   * hosted page passes this along when it requests the link, and the BACKEND
   * validates it against the app's allowed origins — so this value is a
   * suggestion, never a trusted input. A page that lies about its own URL only
   * gets a 400.
   */
  withReturnTo(url) {
    if (typeof window === "undefined") return url;
    try {
      const u = new URL(url);
      const here = new URL(window.location.href);
      here.searchParams.delete("onelo_code");
      u.searchParams.set("return_to", here.toString());
      return u.toString();
    } catch {
      return url;
    }
  }
  /**
   * The challenge a store magic link is paired to (#727), or null.
   *
   * The embedded store runs in an iframe whose storage the browser partitions
   * under this site, so the tab an e-mailed link opens can never read a
   * verifier the store kept. This page's own storage it can: the verifier stays
   * here (the same one-per-browser slot the hosted sign-in uses) and only its
   * challenge goes to `/store-initiate`. The link then returns through this
   * page, which proves "same browser" in `completePairedLink`. Null when the
   * verifier cannot be kept durably — the store then keeps the code screen.
   */
  async storeLinkChallenge() {
    await this.initPromise.catch(() => {
    });
    const verifier = this.pkceVerifier;
    if (!verifier) return null;
    if (!await this.persistMagicLinkVerifier(verifier)) return null;
    return (0, import_core7.generateCodeChallenge)(verifier);
  }
  /**
   * Write the magic-link verifier somewhere the NEXT tab can read it.
   *
   * Returns false when the value did not actually reach durable storage, which
   * is the only signal `sendMagicLink` needs: no durable verifier → no
   * challenge. `TokenStorage.set` degrades to an in-memory map rather than
   * throwing (Safari private mode, disabled storage), and that map is invisible
   * to the tab the email opens — so a successful `set` is NOT proof of
   * persistence. Reading it back through a fresh instance is.
   */
  async persistMagicLinkVerifier(verifier) {
    try {
      await this.storage.set(import_core.TOKEN_KEYS.MAGIC_LINK_VERIFIER, verifier);
      return typeof localStorage !== "undefined" && localStorage.getItem(import_core.TOKEN_KEYS.MAGIC_LINK_VERIFIER) === verifier;
    } catch {
      return false;
    }
  }
  /**
   * Finish a magic-link sign-in after the browser has returned to your page.
   *
   * The email opens a new tab on Onelo, which consumes the link and sends the
   * browser to the `redirectTo` you passed to `sendMagicLink`, with a one-time
   * code appended as `onelo_code`. This exchanges that code for a session.
   *
   * Called automatically during `init()`, so most apps never call it directly;
   * it is public for apps that route their own way and want to control when the
   * exchange happens.
   *
   * Resolves to the session, or null when the URL carries no code — the normal
   * case on every ordinary page load, and deliberately not an error.
   */
  async completeFromUrl() {
    await this.initPromise;
    return this.exchangeCodeFromUrl();
  }
  /** The body of `completeFromUrl` WITHOUT the `initPromise` await, so
   *  `initialize()` can run it without waiting on itself. */
  async exchangeCodeFromUrl() {
    if (typeof window === "undefined") return null;
    const url = new URL(window.location.href);
    const gateSurface = url.searchParams.get("onelo_gate");
    if (gateSurface) {
      url.searchParams.delete("onelo_gate");
      try {
        window.history.replaceState({}, "", url.toString());
      } catch {
      }
      this.finishAsMessengerTab(publishSessionCreated(gateSurface));
      return null;
    }
    const linkToken = url.searchParams.get("onelo_link");
    if (linkToken) return this.completePairedLink(url, linkToken);
    const storeCode = url.searchParams.get("onelo_store_code");
    if (storeCode) return this.completeStoreReturn(url, storeCode);
    const code = url.searchParams.get("onelo_code");
    if (!code) return null;
    coverPage(this.brand.current());
    url.searchParams.delete("onelo_code");
    try {
      window.history.replaceState({}, "", url.toString());
    } catch {
    }
    const codeVerifier = await this.storage.get(import_core.TOKEN_KEYS.MAGIC_LINK_VERIFIER);
    const { status, json } = await (0, import_core8.httpPost)(
      `${this.apiUrl}/api/sdk/auth/hosted-callback`,
      { publishableKey: this.publishableKey, code, code_verifier: codeVerifier },
      { ...SDK_HEADERS }
    );
    await this.storage.delete(import_core.TOKEN_KEYS.MAGIC_LINK_VERIFIER);
    if (status !== 200) {
      removeCover();
      throw import_core10.OneloError.server(`Magic link sign-in failed: HTTP ${status}`);
    }
    const session = (0, import_core9.mapSession)(json);
    await this.saveSession(session);
    this.finishAsMessengerTab(publishSessionCreated());
    return session;
  }
  /** #728: the store return's "Signing you in…" in the Branding and language
   *  of the store the buyer just left (remembered when it opened); the config
   *  is not in yet on the first tick. */
  coverStoreReturn() {
    const look = recallStoreReturnLook(this.publishableKey);
    const lang = look ? look.lang : typeof navigator !== "undefined" ? navigator.language : null;
    coverPage(look?.tokens ?? this.brand.current(), signingInText(lang));
  }
  /**
   * The store brought the buyer back to this page (#726).
   *
   * The embedded store sent this window to provider sign-in and the checkout;
   * when the purchase is done it returns here with the store's one-time code.
   * Unlike a magic-link tab this IS the app: exchange, sign in, report the
   * purchase, carry on. The code is single-use and was minted for the store
   * token this SDK opened; the backend's hosted-callback is the same exchange
   * the in-frame store uses.
   */
  async completeStoreReturn(url, code) {
    this.coverStoreReturn();
    url.searchParams.delete("onelo_store_code");
    try {
      window.history.replaceState({}, "", url.toString());
    } catch {
    }
    const { status, json } = await (0, import_core8.httpPost)(
      `${this.apiUrl}/api/sdk/auth/hosted-callback`,
      { publishableKey: this.publishableKey, code },
      { ...SDK_HEADERS }
    );
    forgetStoreReturnLook();
    if (status !== 200) {
      removeCover();
      throw import_core10.OneloError.server(`Store sign-in failed: HTTP ${status}`);
    }
    const session = (0, import_core9.mapSession)(json);
    await this.saveSession(session);
    removeCover();
    this.onPlanChange?.({ kind: "purchase" });
    return session;
  }
  /**
   * A paired magic link (#535) arrived on this page, UNSPENT.
   *
   * The link page cannot tell which browser it is in; this page can. If this
   * browser holds the verifier the requesting tab stored, it IS that browser:
   * the backend spends the link and answers with a code, and this finishes in
   * one click exactly like `onelo_code` below. If not — another browser, another
   * device, a mail scanner — the backend spends nothing and names the screen
   * where the person types the code the requesting tab shows. This tab then
   * leaves for it and signs nobody in.
   */
  async completePairedLink(url, token) {
    coverPage(this.brand.current());
    url.searchParams.delete("onelo_link");
    try {
      window.history.replaceState({}, "", url.toString());
    } catch {
    }
    const codeVerifier = await this.storage.get(import_core.TOKEN_KEYS.MAGIC_LINK_VERIFIER);
    const { status, json } = await (0, import_core8.httpPost)(
      `${this.apiUrl}/api/sdk/auth/magic-link/consume`,
      { publishableKey: this.publishableKey, token, code_verifier: codeVerifier },
      { ...SDK_HEADERS }
    );
    const j = json ?? {};
    const detail = j["detail"];
    if (status === 409 && detail?.["error"] === "confirm_required" && typeof detail["confirm_url"] === "string") {
      const confirmUrl = detail["confirm_url"];
      if (/^https?:\/\//i.test(confirmUrl)) {
        this.handedOverToAnotherTab = true;
        window.location.replace(confirmUrl);
        return null;
      }
    }
    if (status !== 200) {
      removeCover();
      throw import_core10.OneloError.server(`Magic link sign-in failed: HTTP ${status}`);
    }
    const resumeUrl = j["resume_url"];
    if (typeof resumeUrl === "string") {
      await this.storage.delete(import_core.TOKEN_KEYS.MAGIC_LINK_VERIFIER);
      if (/^https?:\/\//i.test(resumeUrl)) {
        this.handedOverToAnotherTab = true;
        window.location.replace(resumeUrl);
        return null;
      }
      removeCover();
      throw import_core10.OneloError.server("Magic link sign-in failed: invalid store address");
    }
    const gateUrl = j["gate_url"];
    if (typeof gateUrl === "string") {
      await this.storage.delete(import_core.TOKEN_KEYS.MAGIC_LINK_VERIFIER);
      this.finishAsMessengerTab(publishSessionCreated(gateUrl));
      return null;
    }
    const code = j["code"];
    if (typeof code !== "string") {
      removeCover();
      throw import_core10.OneloError.server("Magic link sign-in failed: no code");
    }
    const exchanged = await (0, import_core8.httpPost)(
      `${this.apiUrl}/api/sdk/auth/hosted-callback`,
      { publishableKey: this.publishableKey, code, code_verifier: codeVerifier },
      { ...SDK_HEADERS }
    );
    await this.storage.delete(import_core.TOKEN_KEYS.MAGIC_LINK_VERIFIER);
    if (exchanged.status !== 200) {
      removeCover();
      throw import_core10.OneloError.server(`Magic link sign-in failed: HTTP ${exchanged.status}`);
    }
    const session = (0, import_core9.mapSession)(exchanged.json);
    await this.saveSession(session);
    this.finishAsMessengerTab(publishSessionCreated());
    return session;
  }
  /**
   * Send the signed-in user a fresh Email Verification link (#819).
   *
   * Only for Apps with their own screen: when the parent App requires Email
   * Verification, Onelo's hosted flow already shows "check your inbox" with a
   * resend button and hands the session back by itself. The previous link
   * stops working; at most 3 e-mails an hour (`verification_rate_limited`).
   * Throws `email_verification_off` when the App has Email verification Off.
   *
   * `redirectTo` — your own landing page (an allowed web origin) or
   * `<your-scheme>://…`; the link then carries `onelo_verify_token` for
   * `confirmEmail`. Omitted, the link opens Onelo's hosted page.
   */
  async resendVerificationEmail(options = {}) {
    await this.initPromise;
    const session = await this.getSession();
    if (!session) throw import_core10.OneloError.notAuthenticated();
    return (0, import_core11.resendVerificationEmail)({
      apiUrl: this.apiUrl,
      publishableKey: this.publishableKey,
      post: import_core8.httpPost,
      accessToken: session.accessToken,
      headers: { ...SDK_HEADERS },
      redirectTo: options.redirectTo
    });
  }
  /**
   * Confirm the user's address with the `onelo_verify_token` your own landing
   * page received from the verification link (#819). Single use. When a
   * session is signed in on this device, it is refreshed so `isAllowedIn()`
   * opens the app without waiting for the next scheduled refresh.
   */
  async confirmEmail(token) {
    await this.initPromise;
    await (0, import_core11.confirmEmail)({
      apiUrl: this.apiUrl,
      publishableKey: this.publishableKey,
      post: import_core8.httpPost,
      token,
      headers: { ...SDK_HEADERS }
    });
    if (await this.getSession()) {
      try {
        await this.refreshSession();
      } catch (e) {
        console.warn("[onelo] confirmEmail: session refresh after confirming failed", e);
      }
    }
  }
  async sendPasswordReset(email, redirectTo) {
    await this.initPromise;
    const body = { publishableKey: this.publishableKey, email };
    if (redirectTo) body.redirectTo = redirectTo;
    const { status: prStatus } = await (0, import_core8.httpPost)(`${this.apiUrl}/api/sdk/auth/reset-password/request`, body, { ...SDK_HEADERS });
    if (prStatus >= 400) throw import_core10.OneloError.server(`Password reset request failed: HTTP ${prStatus}`);
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
 *  Locks issues #1594/#2111). On timeout this tab never refreshes on its own
 *  (that would resend the token the holder has in flight): it adopts the
 *  holder's result if it has landed, else keeps the session and retries. */
_OneloAuth.REFRESH_LOCK_TIMEOUT_MS = 5e3;
/** Retry a TRANSIENT refresh failure (offline, a lost response, 429, 5xx —
 *  incl. `503 refresh_unavailable`) with backoff: 5 s, 10 s, 20 s, 40 s,
 *  then every 60 s. The session is kept. The first retry lands inside the
 *  server's 30 s refresh-token grace window, so a request whose response was
 *  lost is retried while the server still accepts that token. */
_OneloAuth.REFRESH_RETRY_BASE_MS = 5e3;
_OneloAuth.REFRESH_RETRY_MAX_MS = 6e4;
var OneloAuth = _OneloAuth;

// src/features/features.ts
var import_core13 = __toESM(require_dist());

// src/core/user-token.ts
var INVALID_USER_TOKEN = "invalid_user_token";
function bearerHeader(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}
function isInvalidUserToken(status, json) {
  if (status !== 401 || json === null || typeof json !== "object") return false;
  const j = json;
  const detail = j.detail;
  const code = detail !== null && typeof detail === "object" ? detail.error : j.error;
  return code === INVALID_USER_TOKEN;
}
async function readUserToken(fn) {
  if (!fn) return null;
  try {
    const token = await fn();
    return typeof token === "string" && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}
var refusalStates = /* @__PURE__ */ new WeakMap();
function refusalState(source) {
  let state = refusalStates.get(source);
  if (!state) {
    state = { spent: false, inFlight: null };
    refusalStates.set(source, state);
  }
  return state;
}
function refreshAfterRefusal(source) {
  if (!source) return Promise.resolve(null);
  const state = refusalState(source);
  if (state.inFlight) return state.inFlight;
  if (state.spent) return Promise.resolve(null);
  state.spent = true;
  const run = readUserToken(() => source.refresh());
  state.inFlight = run;
  void run.finally(() => {
    if (state.inFlight === run) state.inFlight = null;
  });
  return run;
}
function userTokenAccepted(source) {
  if (source) refusalState(source).spent = false;
}
function resetUserTokenRefusal(source) {
  if (source) refusalState(source).spent = false;
}
function accepted(status) {
  return status >= 200 && status < 300;
}
async function sendWithUserToken(source, send, onRefused, anonymousFallback = true, provesAcceptance = true) {
  const token = await readUserToken(source ? () => source.current() : void 0);
  const first = await send({ token, anonymous: false });
  if (token === null) return first;
  if (!isInvalidUserToken(first.status, first.json)) {
    if (provesAcceptance && accepted(first.status)) userTokenAccepted(source);
    return first;
  }
  let last = first;
  const fresh = await refreshAfterRefusal(source);
  if (fresh !== null) {
    last = await send({ token: fresh, anonymous: false });
    if (!isInvalidUserToken(last.status, last.json)) {
      if (provesAcceptance && accepted(last.status)) userTokenAccepted(source);
      return last;
    }
  }
  onRefused();
  if (!anonymousFallback) return last;
  return send({ token: null, anonymous: true });
}

// src/features/features.ts
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
    this.userTokenRefusedWarned = false;
    // Bumped by every load(): a load that resumes after a newer one started must
    // not point the shared stream back at its (stale) identity.
    this.loadGeneration = 0;
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
    // Identity-bound readiness. A persisted snapshot is useful for fast first
    // paint, but only a response confirmed for this load generation may release
    // ready().
    this.firstEventReceived = false;
    this.confirmedGeneration = -1;
    this.confirmedUserId = null;
    this.confirmedVersion = 0;
    this.snapshotConfirmed = false;
    this.readyWaiters = /* @__PURE__ */ new Set();
    // refresh() debounce cursor (parity with Swift lastRefreshAt).
    this.lastRefreshAt = 0;
    this.identityLoaded = false;
    this.streamConnection = null;
    this.streamConnectionGeneration = -1;
    this.apiUrl = apiUrl;
    this.publishableKey = publishableKey;
    if (monitor) this.monitor = monitor;
    this.suppressIdentifyWarning = options?.suppressIdentifyWarning ?? false;
    this.featureEnvironment = options?.featureEnvironment;
    this.defaultStatus = options?.featureDefaultStatus ?? "hidden";
    this.userToken = options?.userToken ?? null;
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
      const p = {
        since_version: String(this.snapshotConfirmed ? this.confirmedVersion : 0),
        instance_id: this.instanceId
      };
      if (this.featureEnvironment) p["environment"] = this.featureEnvironment;
      return p;
    });
    stream.onConnectionIdentity((identity) => {
      this.streamConnection = identity;
      this.streamConnectionGeneration = identity === null ? -1 : this.loadGeneration;
    });
    const currentStreamIsBound = () => {
      const connection = this.streamConnection;
      return connection !== null && this.streamConnectionGeneration === this.loadGeneration && connection.userId === this.currentUserId && !connection.anonymousFallback;
    };
    const applyIfSnapshot = (data) => {
      if (!currentStreamIsBound()) return;
      const features = data["features"];
      if (features) {
        const v = typeof data["config_version"] === "number" ? data["config_version"] : this.configVersion;
        this._applySnapshot(v, features, this.loadGeneration, this.currentUserId);
        this._signalFirstEvent(this.loadGeneration, this.currentUserId);
      }
    };
    stream.on("connected", applyIfSnapshot);
    stream.on("features_updated", applyIfSnapshot);
    stream.on("up_to_date", (data) => {
      if (!currentStreamIsBound()) return;
      if (typeof data["config_version"] === "number") this.configVersion = data["config_version"];
      if (typeof data["config_version"] !== "number") return;
      this.confirmedVersion = data["config_version"];
      this._signalFirstEvent(this.loadGeneration, this.currentUserId);
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
   * live updates whenever an admin clicks Deploy in the dashboard.
   *
   * @param _userIdHash Deprecated and ignored: Secure Mode is retired, and the
   *   signed-in Onelo user is proven with their access token automatically. */
  async load(userId, _userIdHash) {
    const generation = ++this.loadGeneration;
    this.identityLoaded = true;
    this.currentUserId = userId;
    this.streamConnection = null;
    this.streamConnectionGeneration = -1;
    this.firstEventReceived = false;
    this.snapshotConfirmed = false;
    this.confirmedGeneration = -1;
    this.confirmedUserId = null;
    this.confirmedVersion = 0;
    this._loadCache(userId);
    this._emitChange();
    await this._batchPing();
    if (generation !== this.loadGeneration) return;
    if (this.stream && typeof EventSource !== "undefined") {
      this.stream.start(userId);
    } else {
      await this._resolve(userId, generation);
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
    this.confirmedVersion = 0;
    this.snapshotConfirmed = false;
    this.firstEventReceived = false;
    this.confirmedGeneration = -1;
    this.confirmedUserId = null;
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
    if (this.firstEventReceived && this.snapshotConfirmed && this.confirmedGeneration === this.loadGeneration && this.confirmedUserId === this.currentUserId) return Promise.resolve();
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
    if (!this.identityLoaded) return;
    const now = Date.now();
    if (!force && now - this.lastRefreshAt < REFRESH_DEBOUNCE_MS) return;
    this.lastRefreshAt = now;
    await this._resolve(this.currentUserId, this.loadGeneration);
  }
  /** A comparable picture of the current snapshot — the plan-change refresher
   *  (#659) re-checks until it differs. @internal */
  snapshotKey() {
    return JSON.stringify([...this.cache.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  }
  /** Requests a short-lived (60s) per-feature JWT from
   * `POST /api/sdk/features/module-token` — proof the current user is entitled
   * to `slug`, which the host forwards to its OWN backend/CDN to gate code
   * download. The backend re-verifies entitlement on every request. Parity with
   * Swift `moduleToken(for:)`.
   *
   * Throws {@link OneloFeaturesError}:
   * - `not_authenticated` — no user identified yet (no network call is made), or
   *   the signed-in user's access token was refused even after a refresh
   * - `not_entitled` (403) — the user lacks access to `slug`
   * - `network_error` — transport failure or malformed response */
  async moduleToken(slug) {
    const userId = this.currentUserId;
    if (!userId) throw new OneloFeaturesError("not_authenticated");
    let status;
    let json;
    try {
      const res = await sendWithUserToken(
        this.userToken,
        ({ token }) => (0, import_core13.httpPost)(
          `${this.apiUrl}/api/sdk/features/module-token`,
          { publishableKey: this.publishableKey, userId, slug },
          bearerHeader(token)
        ),
        () => this._warnUserTokenRefused(),
        false
      );
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
  _signalFirstEvent(generation, userId) {
    if (generation !== this.loadGeneration || userId !== this.currentUserId || !this.identityLoaded) return;
    if (this.firstEventReceived && this.confirmedGeneration === generation) return;
    this.firstEventReceived = true;
    this.snapshotConfirmed = true;
    this.confirmedGeneration = generation;
    this.confirmedUserId = userId;
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
      await sendWithUserToken(this.userToken, ({ token }) => (0, import_core13.httpPost)(
        `${this.apiUrl}/api/sdk/features/batch-ping`,
        {
          publishableKey: this.publishableKey,
          features: names,
          ...this.featureEnvironment ? { environment: this.featureEnvironment } : {}
        },
        {
          ...bearerHeader(token),
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
      ), () => this._warnUserTokenRefused(), true, false);
    } catch {
    }
  }
  async _resolve(userId, generation = this.loadGeneration) {
    if (!this.identityLoaded) return;
    try {
      const { status, json } = await sendWithUserToken(this.userToken, ({ token, anonymous }) => {
        const body = { publishableKey: this.publishableKey };
        if (userId && !anonymous) body["userId"] = userId;
        if (this.featureEnvironment) body["environment"] = this.featureEnvironment;
        return (0, import_core13.httpPost)(`${this.apiUrl}/api/sdk/features/resolve`, body, bearerHeader(token));
      }, () => this._warnUserTokenRefused(), userId === null);
      if (status !== 200) return;
      if (generation !== this.loadGeneration || userId !== this.currentUserId) return;
      const j = json;
      if (userId !== null && j["anonymous"] === true) return;
      const features = j["features"];
      if (features) {
        this._applySnapshot(
          typeof j["config_version"] === "number" ? j["config_version"] : this.configVersion,
          features,
          generation,
          userId
        );
      }
      this._maybeWarnAnonymous(j);
      this._signalFirstEvent(generation, userId);
    } catch {
    }
  }
  /** The server refused the signed-in user's access token even after a refresh,
   *  so the call went out anonymous. Features has no error callback; this
   *  one-time warning is its error channel (like the anonymous-mode warning). */
  _warnUserTokenRefused() {
    if (this.userTokenRefusedWarned) return;
    this.userTokenRefusedWarned = true;
    console.warn(
      "[Onelo] The signed-in user's access token was refused by Features (invalid_user_token) even after a refresh, so the request was made without a user. Check that the publishableKey belongs to the app the user signed in to."
    );
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
    this.cache.clear();
    this.configVersion = 0;
    this.confirmedVersion = 0;
    if (typeof localStorage === "undefined") return;
    try {
      const raw = localStorage.getItem(this._cacheKey(userId));
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (typeof parsed.configVersion !== "number" || !parsed.features) return;
      this.configVersion = parsed.configVersion;
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
  _applySnapshot(version2, features, generation = this.loadGeneration, userId = this.currentUserId) {
    const directSnapshot = arguments.length < 3;
    if (!directSnapshot && (!this.identityLoaded || generation !== this.loadGeneration || userId !== this.currentUserId)) return;
    this.configVersion = version2;
    this.confirmedVersion = version2;
    this.snapshotConfirmed = true;
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
var import_core14 = __toESM(require_dist());
var SDK_NAME2 = "@onelo/js";
var MAX_BUFFER_SIZE = 200;
var MAX_FLAGS = 100;
var MAX_BREADCRUMBS = 100;
var MAX_RETRY_AFTER_MS = 36e5;
var _warn = (...args) => console.warn("[onelo.monitor]", ...args);
function _parseRetryAfter(res) {
  let raw = null;
  try {
    raw = res.headers?.get?.("Retry-After") ?? null;
  } catch {
  }
  if (!raw) return 0;
  const seconds = Number(raw.trim());
  if (!Number.isFinite(seconds)) return 0;
  return Math.max(0, Math.min(seconds * 1e3, MAX_RETRY_AFTER_MS));
}
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
        e.reason instanceof Error ? e.reason.stack : void 0,
        (0, import_core14.classifyErrorOrigin)(e.reason)
      );
    });
    window.addEventListener("error", (e) => {
      const stack = e.error instanceof Error ? e.error.stack : void 0;
      _activeMonitor?._onGlobalError(e.message ?? "Unknown error", stack, (0, import_core14.classifyErrorOrigin)(e.error, stack));
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
      _activeMonitor?._onGlobalError(message, stack, (0, import_core14.classifyErrorOrigin)(err));
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
    /** Serialises all drains so a timer flush and an error flush can't overlap. */
    this.flushChain = Promise.resolve();
    /** Epoch ms until which we hold off sending (set from a 429 `Retry-After`). */
    this.retryAfterUntil = 0;
    this.publishableKey = publishableKey;
    this.apiUrl = apiUrl;
    const app = {};
    if (context?.appVersion) app.version = context.appVersion;
    if (context?.appBuild) app.build = context.appBuild;
    if (context?.bundleId) app.bundleId = context.bundleId;
    this.staticMeta = {
      sdk: { name: SDK_NAME2, version },
      ...Object.keys(app).length > 0 ? { app } : {}
    };
    this.environment = context?.environment;
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, 15e3);
    _activeMonitor = this;
    _installGlobalHandlers();
    this._push("session_opened", true, void 0, void 0, void 0, "event");
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
   *
   * Drains are SERIALISED through one promise chain: the 15s timer, an error
   * auto-flush and an explicit `flush()` must never drain concurrently, because
   * a retried send now spans seconds and two overlapping drains would interleave
   * batches (and the second would observe an empty buffer and report "sent").
   */
  async flush(useBeacon = false) {
    this.flushChain = this.flushChain.then(() => this._drain(useBeacon)).catch(() => {
    });
    return this.flushChain;
  }
  async _drain(useBeacon) {
    if (this.buffer.length === 0) return;
    const url = `${this.apiUrl}/api/sdk/monitor/events/batch`;
    if (useBeacon) {
      this._sendBeacon(url, this.buffer.splice(0));
      return;
    }
    if (Date.now() < this.retryAfterUntil) return;
    const events = this.buffer.splice(0);
    const body = JSON.stringify({ publishableKey: this.publishableKey, events });
    if (await this._sendOnce(url, body) === "requeue") this._requeue(events);
  }
  /**
   * Unload/crash path. This is genuinely BEST-EFFORT and CANNOT be retried: the
   * document is going away, so there is no later tick in which to try again and
   * no way to observe the result — `sendBeacon` only reports that the request was
   * queued, never that the server accepted it, and a `keepalive` fetch outlives
   * the JS context that would handle its response. Treat these events as
   * "handed to the browser", NOT as delivered.
   *
   * Uses CORS-safelisted `text/plain`: `application/json` forces an OPTIONS
   * preflight that browsers routinely drop during unload, discarding the very
   * batch we're trying to save. The backend parses the JSON body regardless.
   */
  _sendBeacon(url, events) {
    const body = JSON.stringify({ publishableKey: this.publishableKey, events });
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      try {
        if (navigator.sendBeacon(url, new Blob([body], { type: "text/plain" }))) return;
      } catch {
      }
    }
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body,
      keepalive: true
      // best-effort survival past unload; result is unobservable
    }).catch(() => {
    });
  }
  /**
   * Deliver one batch, retrying network failures and 5xx with bounded
   * exponential backoff. Returns true when the batch is settled (accepted, or
   * rejected in a way retrying cannot fix); false when retries were exhausted
   * and the caller should re-queue.
   */
  /** One POST. Never throws — classifies the result instead. */
  async _sendOnce(url, body) {
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body
      });
    } catch {
      return "requeue";
    }
    const status = res?.status ?? 0;
    if (status >= 200 && status < 300) return "done";
    if (status === 429) {
      const waitMs = _parseRetryAfter(res);
      if (waitMs > 0) this.retryAfterUntil = Math.max(this.retryAfterUntil, Date.now() + waitMs);
      return "requeue";
    }
    if (status >= 400 && status < 500) {
      _warn(`batch rejected with HTTP ${status} \u2014 dropping it (retrying would fail identically)`);
      return "drop";
    }
    return "requeue";
  }
  /**
   * Put an undelivered batch back at the FRONT of the buffer so the next flush
   * retries it, then re-apply the cap.
   *
   * Priority policy under a sustained outage: NEWEST EVENTS WIN. The buffer is
   * trimmed from the front, so the oldest re-queued events are the first to go.
   * This matches `_push`'s newest-wins eviction, keeps memory bounded at
   * MAX_BUFFER_SIZE regardless of how long the backend is down, and prevents a
   * stuck batch from starving live telemetry. Drops are reported, never silent.
   */
  _requeue(events) {
    this.buffer.unshift(...events);
    let dropped = 0;
    while (this.buffer.length > MAX_BUFFER_SIZE) {
      this.buffer.shift();
      dropped++;
    }
    _warn(
      `batch not delivered \u2014 ${events.length} event(s) re-queued` + (dropped > 0 ? `, ${dropped} oldest dropped (buffer cap ${MAX_BUFFER_SIZE})` : "")
    );
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
      ts: (/* @__PURE__ */ new Date()).toISOString(),
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
  _onGlobalError(message, stack, origin = "app") {
    this._push("unhandled", false, void 0, message, { ...this._withError(void 0, stack), origin }, "global_error");
  }
};

// src/feedback/feedback.ts
var import_core15 = __toESM(require_dist());
var OneloFeedback = class {
  constructor(apiUrl, publishableKey, getActiveFeatures, userToken) {
    this.apiUrl = apiUrl;
    this.publishableKey = publishableKey;
    this.getActiveFeatures = getActiveFeatures;
    this.userToken = userToken;
    /** The SDK's brand-token model (#681). `Onelo` shares its own. */
    this.brand = new import_core15.BrandSource();
  }
  setBrandSource(brand) {
    this.brand = brand;
  }
  async open(options = {}) {
    const hostedUrl = await this.initiate(options);
    this._openModal(hostedUrl, options);
  }
  /** Mint a hosted feedback URL (and with it a fresh reporter token `ft`). */
  async initiate(options) {
    const params = new URLSearchParams({ key: this.publishableKey });
    if (options.type) params.set("type", options.type);
    if (options.area) params.set("area", options.area);
    const active = this.getActiveFeatures();
    if (active.length > 0) params.set("session", JSON.stringify(active));
    const url = `${this.apiUrl}/api/sdk/feedback/initiate?${params}`;
    const { status, json } = await sendWithUserToken(this.userToken, async ({ token }) => {
      const headers = {
        ...bearerHeader(token),
        ...options.userId ? { "X-Onelo-User-Id": options.userId } : {}
      };
      const res = await fetch(url, Object.keys(headers).length > 0 ? { headers } : void 0);
      let body = null;
      try {
        body = await res.json();
      } catch {
      }
      return { status: res.status, json: body };
    }, () => {
    });
    if (status < 200 || status >= 300) throw new Error(`Feedback initiate failed: ${status}`);
    const hosted_url = json?.hosted_url;
    if (!hosted_url) throw new Error("Feedback initiate returned no hosted_url");
    return hosted_url;
  }
  /**
   * Answer the hosted form's `onelo:renew_request` (kind `feedback`, #622). The
   * form's reporter token `ft` lives 30 minutes; a form left open longer asks
   * for a fresh one on submit. The same options are initiated again, so the
   * report keeps its reporter, type, area and session.
   */
  async renewReply(requestId, options) {
    try {
      const hostedUrl = await this.initiate(options);
      return { type: "onelo:renewed", request_id: requestId, hosted_url: hostedUrl };
    } catch {
      return { type: "onelo:renew_failed", request_id: requestId, reason: "renew_failed" };
    }
  }
  _openModal(url, options = {}) {
    let hostedOrigin = null;
    try {
      hostedOrigin = new URL(url).origin;
    } catch {
    }
    const t = this.brand.current();
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:2147483647;display:flex;align-items:center;justify-content:center";
    const container = document.createElement("div");
    container.style.cssText = `width:480px;max-width:95vw;height:680px;max-height:90vh;border-radius:${t.card_radius}px;overflow:hidden;position:relative;background:${t.page_bg}`;
    const iframe = document.createElement("iframe");
    iframe.src = url;
    iframe.style.cssText = "width:100%;height:100%;border:none";
    const cancelBtn = createModalCloseButton(t);
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
      if (type === "onelo:renew_request") {
        const requestId = e.data?.request_id;
        if (e.data?.kind !== "feedback" || typeof requestId !== "string") return;
        if (!hostedOrigin || e.origin !== hostedOrigin || e.source !== iframe.contentWindow) return;
        void this.renewReply(requestId, options).then((reply) => {
          try {
            iframe.contentWindow?.postMessage(reply, hostedOrigin);
          } catch {
          }
        });
        return;
      }
      if (type === "onelo:ready") failsafe.markReady();
      else if (type === "onelo:feedback_close" || type === "onelo:feedback_submitted") close();
    };
    window.addEventListener("message", onMsg);
  }
};

// src/paywall/paywall.ts
var import_core16 = __toESM(require_dist());
var RESTART = /* @__PURE__ */ Symbol("restart");
var OneloPaywall = class {
  constructor(apiUrl, publishableKey, getAccessToken, onSession, getSession = async () => null, storeLinkChallenge = async () => null) {
    this.renewPortal = null;
    /** The SDK's brand-token model (#681). `Onelo` shares its own. */
    this.brand = new import_core16.BrandSource();
    /** Told when the store ended in a purchase or a plan switch (#659). Set by
     *  `Onelo` to its plan-change refresher. */
    this.onPlanChange = null;
    this.apiUrl = apiUrl;
    this.publishableKey = publishableKey;
    this.getAccessToken = getAccessToken;
    this.onSession = onSession;
    this.getSession = getSession;
    this.storeLinkChallenge = storeLinkChallenge;
  }
  setBrandSource(brand) {
    this.brand = brand;
  }
  /** Lets the store modal answer a checkout's portal renewal (#642). Set by
   *  `Onelo` to the customer portal's `renewReply`. */
  setPortalRenewer(fn) {
    this.renewPortal = fn;
  }
  setPlanChangeHandler(fn) {
    this.onPlanChange = fn;
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
    for (let pass = 0; ; pass++) {
      let storeUrl;
      try {
        storeUrl = await this.initiateStore(lang);
      } catch (e) {
        if (pass > 0) AuthModal.discardParkedPopup();
        throw e;
      }
      const outcome = await this._completeHostedCheckout(storeUrl, mode);
      if (outcome !== RESTART) return outcome;
    }
  }
  async initiateStore(lang) {
    let url = `${this.apiUrl}/api/sdk/paywall/store-initiate?key=${encodeURIComponent(this.publishableKey)}&callback_scheme=onelo-callback`;
    if (lang) url += `&lang=${encodeURIComponent(lang)}`;
    const returnUrl = storeReturnUrl();
    if (returnUrl) {
      url += `&return_url=${encodeURIComponent(returnUrl)}`;
      const challenge = await this.storeLinkChallenge().catch(() => null);
      if (challenge) url += `&code_challenge=${encodeURIComponent(challenge)}`;
    }
    const { status, json } = await (0, import_core16.httpGet)(url, { ...SDK_HEADERS });
    if (status !== 200) {
      if (isUserRevokedRefusal(json)) throw import_core16.OneloError.userRevoked();
      const code = (0, import_core16.extractErrorCode)(json);
      throw import_core16.OneloError.server(`Failed to initiate store flow: HTTP ${status}${code ? ` (${code})` : ""}`);
    }
    const j = json;
    this.brand.adopt(j);
    if (returnUrl) rememberStoreReturnLook(this.publishableKey, this.brand.current(), lang ?? null);
    const storeUrl = j["store_url"];
    if (!storeUrl) throw import_core16.OneloError.server("Invalid store-initiate response");
    return storeUrl;
  }
  // NOTE: there is deliberately NO `openUpgrade` here. An entitled user's
  // upgrade (`Onelo.openUpgrade()`) is `customerPortal.openUpgrade()`: it asks
  // `/upgrade-initiate` — the destination every SDK gets — and shows the answer
  // in the portal's modal, which already handles every store hand-back (#615),
  // answers the checkout's portal renewal (#642) and reloads a dead link (#619).
  // It used to open the portal page and let it ask `/portal-upgrade`; that hop
  // cost ~13 s (#670). A plan-less user still buys through `openStore()`.
  /** Shared tail for store-initiate: present the hosted /store/hosted page (which
   *  postMessages `onelo:code`), exchange the code for a session via
   *  hosted-callback, and hand it to auth. */
  async _completeHostedCheckout(url, mode) {
    const modal = new AuthModal(this.brand);
    const result = await modal.open(url, mode, { renewPortal: this.renewPortal ?? void 0 });
    if (result.type === "cancelled") return null;
    if (result.type === "error") {
      if (isExpiredAuthError(result.message)) return RESTART;
      throw import_core16.OneloError.server(result.message);
    }
    if (result.type === "done") {
      this.onPlanChange?.({ kind: "switched", reason: result.reason });
      return this.getSession();
    }
    if (result.type !== "code") return null;
    const { status: cbStatus, json: cbJson } = await (0, import_core16.httpPost)(
      `${this.apiUrl}/api/sdk/auth/hosted-callback`,
      { publishableKey: this.publishableKey, code: result.code },
      { ...SDK_HEADERS }
    );
    if (cbStatus !== 200) throw import_core16.OneloError.server("Hosted-callback failed");
    const session = (0, import_core16.mapSession)(cbJson);
    await this.onSession(session);
    this.onPlanChange?.({ kind: "purchase" });
    return session;
  }
  /**
   * Opens the hosted manage page (upgrade, cancel, payment method).
   * Returns the new plan string if the user changed their plan, or null if closed without changes.
   */
  async openManage(lang) {
    const manageUrl = await this.initiateManage(lang);
    return this.openManageModal(manageUrl, lang);
  }
  async initiateManage(lang) {
    const accessToken = await this.getAccessToken();
    if (!accessToken) throw import_core16.OneloError.server("No active session \u2014 sign in before opening the manage page");
    let url = `${this.apiUrl}/api/sdk/paywall/manage-initiate?key=${encodeURIComponent(this.publishableKey)}`;
    if (lang) url += `&lang=${encodeURIComponent(lang)}`;
    const { status, json } = await (0, import_core16.httpGet)(url, {
      ...SDK_HEADERS,
      Authorization: `Bearer ${accessToken}`
    });
    if (isUserRevokedRefusal(json)) throw import_core16.OneloError.userRevoked();
    if (status !== 200) throw import_core16.OneloError.server("Failed to initiate manage flow");
    const j = json;
    this.brand.adopt(j);
    const manageUrl = j["manage_url"];
    if (!manageUrl) throw import_core16.OneloError.server("Invalid manage-initiate response");
    return manageUrl;
  }
  /**
   * Answer the hosted manage page's `onelo:renew_request` (kind `manage`,
   * #621). The manage token lives 15 minutes; a page left open past that asks
   * this SDK for a fresh manage URL. The user is still signed in here, so a new
   * one is minted through manage-initiate with their own access token —
   * nothing revives the dead token. Signed out → `not_authenticated`, and the
   * page shows its branded "signed out" screen.
   */
  async manageRenewReply(requestId, lang) {
    if (!await this.getAccessToken()) {
      return { type: "onelo:renew_failed", request_id: requestId, reason: "not_authenticated" };
    }
    try {
      const hostedUrl = await this.initiateManage(lang);
      return { type: "onelo:renewed", request_id: requestId, hosted_url: hostedUrl };
    } catch {
      return { type: "onelo:renew_failed", request_id: requestId, reason: "renew_failed" };
    }
  }
  // ── Private helpers ─────────────────────────────────────────────────────────
  openManageModal(manageUrl, lang) {
    return new Promise((resolve) => {
      const allowedOrigin = new URL(manageUrl).origin;
      const t = this.brand.current();
      const overlay = document.createElement("div");
      overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;";
      const container = document.createElement("div");
      container.style.cssText = `position:relative;width:480px;height:640px;border-radius:${t.card_radius}px;overflow:hidden;background:${t.page_bg};`;
      const iframe = document.createElement("iframe");
      iframe.src = manageUrl;
      iframe.style.cssText = "width:100%;height:100%;border:none;";
      iframe.setAttribute("sandbox", "allow-scripts allow-forms allow-same-origin allow-popups");
      const cancelBtn = createModalCloseButton(t);
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
        if (data?.type === "onelo:renew_request" && data.kind === "manage" && typeof data.request_id === "string") {
          if (e.source !== iframe.contentWindow) return;
          const requestId = data.request_id;
          void this.manageRenewReply(requestId, lang).then((reply) => {
            try {
              iframe.contentWindow?.postMessage(reply, allowedOrigin);
            } catch {
            }
          });
          return;
        }
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
function storeReturnUrl() {
  if (typeof window === "undefined" || !window.location) return null;
  try {
    const u = new URL(window.location.href);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    for (const k of ["onelo_code", "onelo_store_code", "onelo_gate", "onelo_link"]) u.searchParams.delete(k);
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

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
var import_core17 = __toESM(require_dist());
var OneloWaitlist = class {
  constructor(apiUrl, publishableKey) {
    this.apiUrl = apiUrl;
    this.publishableKey = publishableKey;
  }
  async join(slug, email, options) {
    try {
      const body = {
        publishableKey: this.publishableKey,
        email,
        ...(0, import_core17.waitlistConsentField)(options)
      };
      if (slug !== void 0) body.slug = slug;
      const res = await fetch(`${this.apiUrl}/api/sdk/waitlist/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const json = await res.json().catch(() => ({}));
      const success = res.ok && json.ok === true;
      return { success, position: json.position, alreadyJoined: success && json.alreadyJoined === true };
    } catch (err) {
      return { success: false, alreadyJoined: false };
    }
  }
};

// src/customer-portal/customer-portal.ts
var import_core18 = __toESM(require_dist());
var PORTAL_REVOKE_EVENTS = /* @__PURE__ */ new Set([
  "account_deletion_scheduled",
  "account_revoked",
  "session_compromised"
]);
function openingPlansHtml(t = import_core18.NEUTRAL_BRAND_TOKENS) {
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{background:${t.page_bg};font-family:${t.body_font};display:flex;align-items:center;justify-content:center;color:${t.text_muted}}
${(0, import_core18.spinnerCss)(t)}
.box{display:flex;flex-direction:column;align-items:center;gap:12px}
.t{font-size:13px}
</style></head><body>
<div class="box"><div class="sp"></div><div class="t">Opening plans\u2026</div></div>
</body></html>`;
}
var OneloCustomerPortal = class {
  constructor(apiUrl, publishableKey, getAccessToken, onSessionInvalidated) {
    /** The SDK's brand-token model (#681). `Onelo` shares its own. */
    this.brand = new import_core18.BrandSource();
    /** Told when the store opened from the portal ended in a purchase or a plan
     *  switch (#659). Set by `Onelo` to its plan-change refresher. */
    this.onPlanChange = null;
    this.apiUrl = apiUrl;
    this.publishableKey = publishableKey;
    this.getAccessToken = getAccessToken;
    this.onSessionInvalidated = onSessionInvalidated;
  }
  setBrandSource(brand) {
    this.brand = brand;
  }
  setPlanChangeHandler(fn) {
    this.onPlanChange = fn;
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
    const { hostedUrl, json: j } = await this.initiate();
    let finalUrl = hostedUrl;
    if (opts?.intent) {
      try {
        const u = new URL(hostedUrl);
        u.searchParams.set("intent", opts.intent);
        finalUrl = u.toString();
      } catch {
      }
    }
    const t = this.brand.adopt(j);
    const loadingHtml = opts?.intent === "change_plan" ? openingPlansHtml(t) : (0, import_core18.portalSkeletonHtml)(t);
    return this.openPortalModal(finalUrl, loadingHtml, t);
  }
  /**
   * The upsell tap of an entitled user (#670): ask the backend where the
   * upgrade goes — `/upgrade-initiate`, the same `resolve_upgrade_destination`
   * the hosted portal's `/portal-upgrade` asks — and open that answer directly:
   * the plan-switch picker, the store for a first real purchase, or the portal's
   * explanation when plan changes are unavailable. It used to open the Customer
   * Portal page and let THAT page ask, which put a whole hosted page (server
   * render + hydrate) in front of the store: about 13 s of "Opening plans…".
   *
   * Shown in the portal's own modal, so everything the portal flow had holds:
   * the store's hand-back closes it and reconciles the plan (#615, #659), its
   * checkout's portal renewal is answered (#642), and a dead store link is
   * replaced by a fresh one in the same modal (#619). No `plan` is sent: on web
   * the buyer picks in the store (browse mode), as before.
   *
   * @internal Used by {@link Onelo.openUpgrade}.
   * @throws OneloError `not_authenticated` when signed out or the access token
   *   is refused; `server_error` carrying the backend's code on any other refusal
   *   (e.g. `in_app_store_not_allowed`). Nothing is opened in either case.
   */
  async openUpgrade() {
    const { upgradeUrl, json } = await this.initiateUpgrade();
    const t = this.brand.adopt(json);
    return this.openPortalModal(upgradeUrl, openingPlansHtml(t), t, {
      reinitiate: async () => (await this.initiateUpgrade()).upgradeUrl
    });
  }
  /** GET upgrade-initiate with the user's access token → the resolved URL. */
  async initiateUpgrade() {
    const token = await this.getAccessToken();
    if (!token) throw new import_core18.OneloError("not_authenticated", "Sign in before opening an upgrade");
    const url = `${this.apiUrl}/api/sdk/paywall/upgrade-initiate?key=${encodeURIComponent(this.publishableKey)}&callback_scheme=web`;
    const { status, json } = await (0, import_core18.httpGet)(url, {
      ...SDK_HEADERS,
      Authorization: `Bearer ${token}`
    });
    if (isUserRevokedRefusal(json)) throw import_core18.OneloError.userRevoked();
    if (status === 401) throw new import_core18.OneloError("not_authenticated", "The session can no longer open an upgrade");
    if (status !== 200) {
      const code = (0, import_core18.extractErrorCode)(json);
      throw import_core18.OneloError.server(`Failed to initiate upgrade: HTTP ${status}${code ? ` (${code})` : ""}`);
    }
    const j = json;
    const upgradeUrl = j["upgrade_url"];
    if (!upgradeUrl) throw import_core18.OneloError.server("Invalid upgrade-initiate response: missing upgrade_url");
    return { upgradeUrl, json: j };
  }
  /** GET portal-initiate with the user's access token → the hosted URL. */
  async initiate() {
    const token = await this.getAccessToken();
    if (!token) throw new import_core18.OneloError("not_authenticated", "Sign in before opening the customer portal");
    const url = `${this.apiUrl}/api/sdk/paywall/portal-initiate?key=${encodeURIComponent(this.publishableKey)}&callback_scheme=web`;
    const { status, json } = await (0, import_core18.httpGet)(url, {
      ...SDK_HEADERS,
      Authorization: `Bearer ${token}`
    });
    if (isUserRevokedRefusal(json)) throw import_core18.OneloError.userRevoked();
    if (status === 401) throw new import_core18.OneloError("not_authenticated", "The session can no longer open the customer portal");
    if (status !== 200) throw import_core18.OneloError.server("Failed to initiate customer portal");
    const j = json;
    const hostedUrl = j["hosted_url"];
    if (!hostedUrl) throw import_core18.OneloError.server("Invalid portal-initiate response");
    return { hostedUrl, json: j };
  }
  /**
   * Answer the hosted portal's `onelo:renew_request` (#613 / #614). The portal
   * page's token lives ten minutes; when an action meets a dead one, the page
   * asks this SDK for a fresh portal and repeats the action. The user is still
   * signed in here, so a new portal is minted with their own access token —
   * nothing revives the dead token. Signed out → `renew_failed`, and the page
   * shows its branded "signed out" screen.
   */
  async renewReply(requestId) {
    try {
      const { hostedUrl } = await this.initiate();
      return { type: "onelo:renewed", request_id: requestId, hosted_url: hostedUrl };
    } catch (e) {
      const reason = e instanceof import_core18.OneloError && e.code === "not_authenticated" ? "not_authenticated" : "renew_failed";
      return { type: "onelo:renew_failed", request_id: requestId, reason };
    }
  }
  /**
   * @param opts.reinitiate  Mints a fresh URL for this surface. When given, a
   *   dead link handed back by the page (`onelo:cancel` reason `expired`, #619)
   *   is replaced in the same iframe instead of closing the modal. A portal
   *   needs none: its store re-enters through the portal renewal (#614).
   */
  openPortalModal(hostedUrl, loadingHtml, t, opts) {
    return new Promise((resolve) => {
      let resolved = false;
      const expectedOrigin = new URL(hostedUrl).origin;
      const overlay = document.createElement("div");
      overlay.style.cssText = `position:fixed;inset:0;z-index:2147483647;background:${t.page_bg};`;
      const container = document.createElement("div");
      container.style.cssText = `position:absolute;inset:0;background:${t.page_bg};`;
      const iframe = document.createElement("iframe");
      iframe.src = hostedUrl;
      iframe.style.cssText = "width:100%;height:100%;border:none;";
      iframe.setAttribute("sandbox", "allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation");
      const cancelBtn = createModalCloseButton(t);
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
        if (data?.type === "onelo:renew_request" && data.kind === "portal" && typeof data.request_id === "string") {
          const requestId = data.request_id;
          void this.renewReply(requestId).then((reply) => {
            try {
              iframe.contentWindow?.postMessage(reply, expectedOrigin);
            } catch {
            }
          });
          return;
        }
        const hb = classifyHandBack(data);
        if (!hb) return;
        if (hb.kind === "expired" && opts?.reinitiate) {
          const reinitiate = opts.reinitiate;
          void reinitiate().then(
            (fresh) => {
              if (resolved) return;
              let freshOrigin = null;
              try {
                freshOrigin = new URL(fresh).origin;
              } catch {
              }
              if (freshOrigin !== expectedOrigin) {
                done();
                return;
              }
              failsafe.rearm();
              iframe.src = fresh;
            },
            () => done()
          );
          return;
        }
        if (hb.kind === "portal_closed" && hb.event && PORTAL_REVOKE_EVENTS.has(hb.event)) {
          this.onSessionInvalidated?.();
        }
        done();
        if (hb.kind === "purchase") this.onPlanChange?.({ kind: "purchase" });
        else if (hb.kind === "switched") this.onPlanChange?.({ kind: "switched", reason: hb.reason });
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
var import_core19 = __toESM(require_dist());
var SDK_PLATFORM = "js";
function consentCardStyles(t) {
  return {
    overlay: [
      "position:fixed",
      "inset:0",
      "z-index:2147483647",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "padding:20px",
      "background:rgba(0,0,0,0.6)",
      `font-family:${t.body_font}`
    ].join(";"),
    card: [
      "width:100%",
      "max-width:440px",
      "box-sizing:border-box",
      `background:${t.card_bg}`,
      `color:${t.text}`,
      `border-radius:${t.card_radius}px`,
      "padding:28px",
      `border:1px solid ${t.border}`,
      "box-shadow:0 20px 60px rgba(0,0,0,0.35)"
    ].join(";"),
    heading: `margin:0 0 10px;font-size:19px;font-weight:600;line-height:1.25;font-family:${t.heading_font};`,
    body: `margin:0 0 16px;font-size:14px;line-height:1.5;color:${t.text_muted};`,
    link: `display:inline-block;margin:0 0 20px;font-size:13.5px;color:${t.brand};text-decoration:none;`,
    error: `display:none;margin:0 0 14px;font-size:13px;line-height:1.4;color:${(0, import_core19.statusColor)(t, "danger")};`,
    decline: [
      "flex:0 0 auto",
      "padding:11px 16px",
      `border-radius:${t.button_radius}px`,
      "cursor:pointer",
      "font-size:14px",
      "font-weight:500",
      "background:transparent",
      `border:1px solid ${t.border}`,
      `color:${t.text}`
    ].join(";"),
    accept: [
      "flex:1",
      "padding:11px 16px",
      `border-radius:${t.button_radius}px`,
      "cursor:pointer",
      "font-size:14px",
      "font-weight:600",
      `background:${t.button_bg}`,
      `border:1px solid ${t.button_bg}`,
      `color:${t.button_text}`
    ].join(";")
  };
}
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
      const { status, json } = await (0, import_core19.httpGet)(`${this.apiUrl}/v1/sdk/consent/required`, {
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
    if (!session) throw import_core19.OneloError.notAuthenticated();
    const { status, json } = await (0, import_core19.httpPost)(
      `${this.apiUrl}/v1/sdk/consent/accept`,
      { document_version_id: versionId },
      {
        Authorization: `Bearer ${session.accessToken}`,
        "X-Publishable-Key": this.publishableKey,
        "X-Onelo-Sdk-Platform": SDK_PLATFORM
      }
    );
    if (isUserRevokedRefusal(json)) throw import_core19.OneloError.userRevoked();
    if (status === 401) throw import_core19.OneloError.notAuthenticated();
    if (status < 200 || status >= 300) throw import_core19.OneloError.server(`Failed to record consent: HTTP ${status}`);
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
    const st = consentCardStyles(this.auth.brand.current());
    overlay.style.cssText = st.overlay;
    const card = document.createElement("div");
    card.style.cssText = st.card;
    const h = document.createElement("h2");
    h.textContent = `${docTitle} \u2014 updated`;
    h.style.cssText = st.heading;
    const p = document.createElement("p");
    p.textContent = `Please review and accept our updated ${docTitle} to keep using the app.`;
    p.style.cssText = st.body;
    card.appendChild(h);
    card.appendChild(p);
    if (requirement.url && /^https?:\/\//i.test(requirement.url)) {
      const link = document.createElement("a");
      link.href = requirement.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = `Review full ${docTitle} \u2197`;
      link.style.cssText = st.link;
      card.appendChild(link);
    }
    const error = document.createElement("p");
    error.style.cssText = st.error;
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:10px;margin-top:4px;";
    const decline = document.createElement("button");
    decline.type = "button";
    decline.textContent = "Sign out";
    decline.style.cssText = st.decline;
    const accept = document.createElement("button");
    accept.type = "button";
    accept.textContent = "Accept & Continue";
    accept.style.cssText = st.accept;
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
var import_core20 = __toESM(require_dist());
var RECONNECT_DELAYS_MS = [1e3, 2e3, 5e3, 1e4, 3e4];
var MINT_TIMEOUT_MS = 15e3;
var StreamCredentialRefused = class extends Error {
  constructor(status) {
    super(`stream-token refused (${status})`);
    this.status = status;
  }
};
var OneloEventStream = class {
  constructor(apiUrl, publishableKey, sdkVersion, userToken) {
    this.apiUrl = apiUrl;
    this.publishableKey = publishableKey;
    this.sdkVersion = sdkVersion;
    this.userToken = userToken;
    this.source = null;
    this.handlers = /* @__PURE__ */ new Map();
    this.paramProviders = [];
    this.connectionListeners = [];
    this.userId = null;
    this.started = false;
    this.destroyed = false;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    // Connect is async (it mints a Stream Token first). `connectGeneration`
    // invalidates a mint whose connect has been superseded; `minting` tells the
    // lifecycle reconnect that a connect is already under way, so a `null` socket
    // during the mint is not mistaken for a dropped one.
    this.connectGeneration = 0;
    this.minting = false;
    // Set once the mint refuses the credential (401/403). Permanent for the life
    // of this stream — nothing but a new Onelo instance clears it.
    this.refused = false;
    this.lifecycleBound = false;
    this.userTokenRefusedWarned = false;
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
  /**
   * Observe which identity the current socket actually authenticated. This is
   * distinct from the requested user: a refused user token opens an anonymous
   * fallback stream while retaining the requested userId for the next retry.
   */
  onConnectionIdentity(fn) {
    this.connectionListeners.push(fn);
  }
  _setConnectionIdentity(identity) {
    for (const listener of this.connectionListeners) {
      try {
        listener(identity);
      } catch {
      }
    }
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
    this._setConnectionIdentity(null);
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
    if (this.destroyed || !this.started || !this._supported() || this.refused) return;
    if (this.minting) return;
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
    return typeof EventSource !== "undefined" && typeof fetch !== "undefined";
  }
  /**
   * Mint one Stream Token. The Publishable Key travels here — in a header, on a
   * POST — and never anywhere near the stream URL.
   *
   * Throws `StreamCredentialRefused` on 401/403 (a dead key: permanent) and a
   * plain Error on anything else (offline, 5xx, a token-less body: transient).
   * A 503 from an unreachable key lookup therefore retries rather than killing
   * the stream, which is the Reachability invariant the backend upholds.
   *
   * The status branch below sees a 401/403 whatever content-type it arrives in.
   * `httpPost` used to parse the body BEFORE anyone could read the status
   * (`onelo-core/src/http.ts`), so a WAF or proxy rendering a GENUINE refusal as
   * an HTML page threw a network error, landed in the transient branch, and was
   * retried forever — straight past this brake. It now reads the status first
   * and hands a refusal back with an empty `json`, so the check below catches it
   * (#97; `event-stream.test.ts` proves the brake stops on an HTML 403).
   *
   * The inverse still holds, and is what keeps this honest: an HTML 5xx is an
   * unreachable intermediary, not a verdict on the key, and stays transient —
   * so does any other unparseable answer. Only 401 and 403 brake.
   *
   * The mint is bounded by `MINT_TIMEOUT_MS` via an `AbortController`; see that
   * constant for the hang it exists to end.
   *
   * `X-Publishable-Key` and, when a user is signed in, `Authorization: Bearer
   * <access token>` are the only headers sent. Platform and version stay on the
   * stream URL, where the connection they describe actually is.
   *
   * Resolves to the token plus whether it had to be minted anonymous because
   * the user's access token was refused even after a refresh.
   *
   * The environment is deliberately NOT sent: `?environment=` on the stream URL
   * (supplied by the features param provider) overrides the token's pinned env
   * server-side, so pinning it twice would just be a second place to drift.
   */
  async _mintStreamToken() {
    const controller = new AbortController();
    const ceiling = setTimeout(() => controller.abort(), MINT_TIMEOUT_MS);
    try {
      let anonymous = false;
      const { status, json } = await sendWithUserToken(
        this.userToken,
        (attempt) => {
          anonymous = attempt.anonymous;
          return (0, import_core20.httpPost)(
            `${this.apiUrl}/api/sdk/features/stream-token`,
            {},
            { "X-Publishable-Key": this.publishableKey, ...bearerHeader(attempt.token) },
            controller.signal
          );
        },
        () => this._warnUserTokenRefused()
      );
      if (status === 401 || status === 403) throw new StreamCredentialRefused(status);
      if (status < 200 || status >= 300) throw new Error(`stream-token ${status}`);
      const token = json?.token;
      if (typeof token !== "string" || token.length === 0) {
        throw new Error("stream-token: response carried no token");
      }
      return { token, anonymous };
    } finally {
      clearTimeout(ceiling);
    }
  }
  _connect() {
    if (this.destroyed || !this.started || !this._supported() || this.refused) return;
    this._clearReconnect();
    this._setConnectionIdentity(null);
    this._close();
    const generation = ++this.connectGeneration;
    this.minting = true;
    void this._openWithToken(generation);
  }
  async _openWithToken(generation) {
    try {
      await this._mintAndOpen(generation);
    } finally {
      if (generation === this.connectGeneration) this.minting = false;
    }
  }
  _warnUserTokenRefused() {
    if (this.userTokenRefusedWarned) return;
    this.userTokenRefusedWarned = true;
    console.warn(
      "[Onelo] The signed-in user's access token was refused by the Event Stream (invalid_user_token) even after a refresh, so the stream was opened without a user."
    );
  }
  async _mintAndOpen(generation) {
    let token;
    let anonymous;
    try {
      ({ token, anonymous } = await this._mintStreamToken());
    } catch (err) {
      if (generation !== this.connectGeneration) return;
      if (err instanceof StreamCredentialRefused) {
        this.refused = true;
        console.warn(
          `[Onelo] Event Stream credential refused (HTTP ${err.status}) \u2014 stream stopped. Check the publishableKey and apiUrl passed to Onelo.`
        );
        return;
      }
      this._scheduleReconnect();
      return;
    }
    if (generation !== this.connectGeneration || this.destroyed || !this.started) return;
    const params = new URLSearchParams({ token, sdk_platform: "js" });
    if (this.sdkVersion) params.set("sdk_version", this.sdkVersion);
    if (this.userId && !anonymous) params.set("userId", this.userId);
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
    this._setConnectionIdentity({ userId: this.userId, anonymousFallback: anonymous });
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

// src/core/plan-change.ts
var PLAN_SWITCH_PENDING = "plan_switch_pending";
var PENDING_RECHECK_DELAYS_MS = [1e3, 2e3, 4e3, 8e3, 15e3];
var PlanChangeRefresher = class {
  constructor(targets, delaysMs = PENDING_RECHECK_DELAYS_MS) {
    this.targets = targets;
    this.delaysMs = delaysMs;
    this.generation = 0;
    this.timer = null;
  }
  /** React to a finished hosted page. Resolves once the immediate refresh is
   *  done; pending re-checks continue in the background. */
  async handBack(change) {
    if (change.kind !== "purchase" && change.kind !== "switched") return;
    const generation = ++this.generation;
    this.clearTimer();
    const before = this.targets.snapshot();
    await Promise.all([
      this.targets.refreshFeatures().catch(() => {
      }),
      this.targets.revalidateEntitlement().catch(() => {
      })
    ]);
    if (change.kind === "switched" && change.reason === PLAN_SWITCH_PENDING) {
      this.scheduleRecheck(generation, before, 0);
    }
  }
  /** Stop any pending re-checks (SDK teardown). */
  cancel() {
    this.generation++;
    this.clearTimer();
  }
  scheduleRecheck(generation, before, step) {
    if (generation !== this.generation || step >= this.delaysMs.length) return;
    if (this.targets.snapshot() !== before) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.recheck(generation, before, step);
    }, this.delaysMs[step]);
  }
  async recheck(generation, before, step) {
    if (generation !== this.generation) return;
    await this.targets.refreshFeatures().catch(() => {
    });
    if (generation !== this.generation) return;
    if (this.targets.snapshot() !== before) {
      await this.targets.revalidateEntitlement().catch(() => {
      });
      return;
    }
    this.scheduleRecheck(generation, before, step + 1);
  }
  clearTimer() {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
};

// src/onelo.ts
var import_core21 = __toESM(require_dist());
var Onelo = class {
  constructor(config) {
    this.authUnsubscribe = null;
    const userToken = {
      current: () => this.auth.getSession().then((s) => s?.accessToken ?? null),
      refresh: () => this.auth.refreshSession().then((s) => s?.accessToken ?? null)
    };
    this.eventStream = new OneloEventStream(config.apiUrl, config.publishableKey, version, userToken);
    const brand = new import_core21.BrandSource();
    this.auth = new OneloAuth(config, brand);
    this.auth.attachEventStream(this.eventStream);
    this.paywall = new OneloPaywall(
      config.apiUrl,
      config.publishableKey,
      () => this.auth.getSession().then((s) => s?.accessToken ?? null),
      (session) => this.auth.importSession(session),
      () => this.auth.getSession(),
      () => this.auth.storeLinkChallenge()
    );
    this.customerPortal = new OneloCustomerPortal(
      config.apiUrl,
      config.publishableKey,
      () => this.auth.getSession().then((s) => s?.accessToken ?? null),
      () => {
        void this.auth.signOut();
      }
    );
    const renewPortal = (requestId) => this.customerPortal.renewReply(requestId);
    this.paywall.setPortalRenewer(renewPortal);
    this.paywall.setBrandSource(brand);
    this.customerPortal.setBrandSource(brand);
    this.auth.setPortalRenewer(renewPortal);
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
      featureDefaultStatus: config.featureDefaultStatus,
      userToken
    });
    this.features.attachStream(this.eventStream);
    this.planChange = new PlanChangeRefresher({
      refreshFeatures: () => this.features.refresh(true),
      revalidateEntitlement: () => this.auth.revalidateEntitlement(),
      snapshot: () => this.features.snapshotKey()
    });
    const onPlanChange = (change) => {
      void this.planChange.handBack(change);
    };
    this.auth.setPlanChangeHandler(onPlanChange);
    this.paywall.setPlanChangeHandler(onPlanChange);
    this.customerPortal.setPlanChangeHandler(onPlanChange);
    this.feedback = new OneloFeedback(config.apiUrl, config.publishableKey, () => this.features.getActiveFeatures(), userToken);
    this.feedback.setBrandSource(brand);
    const autoPresentConsent = config.autoPresentConsentGate ?? true;
    this.consent = new OneloConsent(config.apiUrl, config.publishableKey, this.auth, autoPresentConsent);
    this.consent.attachEventStream(this.eventStream);
    let boundUserId = null;
    this.authUnsubscribe = this.auth.onAuthStateChange((session) => {
      const userId = session?.user.id ?? null;
      if (userId !== boundUserId) resetUserTokenRefusal(userToken);
      boundUserId = userId;
      this.monitor.setUserId(session?.user.id ?? null);
      void this.features.load(session?.user.id ?? null);
      if (session?.user.id && autoPresentConsent) void this.consent.presentGateIfNeeded();
    });
    void this.auth.getSession().then((session) => {
      if (!session) void this.features.load(null);
    }).catch(() => {
      void this.features.load(null);
    });
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
   * @deprecated The signed-in Onelo user is used automatically: Features calls
   * prove them with their access token. `userIdHash` is ignored (Secure Mode is
   * retired). Kept so existing code compiles.
   */
  async identify(userId, userIdHash) {
    await this.features.load(userId, userIdHash);
  }
  /**
   * Open the upgrade flow for a plan-blocked feature — call it when the user taps
   * a gated tile whose `feature.upgradeCta` is set. Routes by billing state:
   *   - entitled user → straight to where the backend resolves the upgrade
   *     (`/upgrade-initiate`, the same decision as every other SDK): the plan
   *     picker for a subscriber, the store for a free-tier user's first
   *     purchase, or the portal's explanation when plan changes are off. Opened
   *     in the Customer Portal's modal; no portal page in front of it (#670).
   *   - otherwise → `paywall.openStore()` (pick + buy a plan).
   *
   * `plan` is accepted for cross-platform call-site parity (Swift/Electron/RN pass
   * `feature.requiredPlan`); on web the buyer picks in the store, so it is
   * advisory only. The resulting plan change is reconciled the moment the page
   * hands back (#659) and fires `features.subscribe()`. Requires a signed-in
   * Onelo Auth user.
   */
  async openUpgrade(_plan) {
    await this.auth.whenReady();
    if (await this.auth.hasActiveAccess()) {
      if (!this.auth.isStoreAvailable()) {
        await this.customerPortal.open({ intent: "change_plan" });
        return;
      }
      await this.customerPortal.openUpgrade();
    } else {
      if (!this.auth.isStoreAvailable()) return;
      await this.paywall.openStore();
    }
  }
  /** Release background timers. Call when the SDK instance is no longer needed. */
  destroy() {
    this.authUnsubscribe?.();
    this.planChange.cancel();
    this.eventStream.destroy();
    this.features.stopPolling();
    this.monitor.destroy();
    this.consent.dispose();
  }
};

// src/index.ts
var import_core22 = __toESM(require_dist());
var export_OneloError = import_core22.OneloError;
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
