# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.80.0] — 2026-10-07

### Changed

- With your own sign-in (`useExternalToken()`), `signOut()` now ends the Onelo
  session in every open tab of the App, not only the one that called it, and
  no tab renews it until `useExternalToken()` is called again (#836). A new
  sign-in at the provider then signs the user in again in every tab.
- A provider that keeps returning an expired token now leads to signed out
  once the Onelo access token has expired, instead of an endless retry with
  `getSession()` answering a lapsed session (#836). Outages keep retrying as
  before. Onelo Auth sessions are unchanged.

## [0.79.2-staging] — 2026-10-07

### Fixed

- A banned or deleted user is now reported as `OneloError` `user_revoked` by
  the sign-in flow, the store, the manage page, the customer portal and consent
  acceptance (#831). Onelo refuses such a user on every endpoint with
  `403 user_revoked`; the SDK reports it once and does not retry.

## [0.79.1-staging] — 2026-10-06

### Fixed

- Feature snapshots are now bound to the active user and load generation. Late
  resolves, anonymous token fallbacks and anonymous streams cannot replace a
  signed-in user's state; readiness resets on identity changes and stream
  cursors use only versions confirmed for that identity. Startup waits for auth
  session restoration before the first Features load. The JS and React snippets
  now await identity-bound readiness before revealing gated UI.

## [0.79.0-staging] — 2026-10-04

### Added

- Connect an existing sign-in (#798). For an App whose Sign-in Mode is set to Supabase, Clerk, Firebase or another OpenID Connect issuer, `onelo.auth.useExternalToken(getToken)` takes a function that returns the provider's current token. The SDK exchanges it for an Onelo session (`POST /api/sdk/auth/exchange`) on the call, keeps it in the same session store every module reads, and asks the function again to renew after about 80% of the 30-minute session (72–80%, jittered). Concurrent callers and other tabs share one exchange. When the function returns nothing the session ends and `onAuthStateChange(null)` fires; a function that throws, a rate limit, an unreachable issuer or a token outside its validity window (`token_expired`, `token_not_yet_valid`) keeps the session and retries with backoff; a refused token ends it with an `OneloError` naming the server's code. In this mode `loadAuthView()` opens nothing and returns the current session, no presence heartbeat is sent, and `session.refreshToken` is an empty string (there is no refresh token). New exported type `ExternalTokenGetter`. Apps on Onelo Auth are unchanged.

## [0.78.0-staging] — 2026-10-03

### Added

- Marketing Consent for your own screens (#818). `auth.getSignupMarketingConsent()` (`asked`, `text`, `language`) tells a custom sign-up screen whether to show the optional checkbox and with what text, from `/api/sdk/config` asked in the browser language. `signUp(email, password, { marketingConsent })` sends the consent (and its language) only when ticked. `waitlist.join(slug, email, { consent: { marketing, custom } })`.

## [0.77.0-staging] — 2026-10-03

### Added

- Email Verification (#819). `OneloUser` carries `emailVerified` and, when the app is withheld for it, `accessReason: 'email_unverified'` (both from the server; undefined on an older backend). When the parent App requires Email Verification, `isAllowedIn()` is false until the user opens the link — Onelo's hosted flow shows "check your inbox", resends and hands the session back by itself. Apps with their own screen get `onelo.auth.resendVerificationEmail({ redirectTo? })` and `onelo.auth.confirmEmail(token)` (the `onelo_verify_token` from their landing URL); new error codes `verification_rate_limited`, `email_verification_off`, `invalid_verification_token`, `invalid_verify_redirect`. `confirmEmail()` refreshes the signed-in session so the app opens at once; `revalidateEntitlement()` now refreshes `allowedIn`, `emailVerified` and `accessReason` together.

## [0.76.0-staging] — 2026-10-03

### Added

- A signed-in user's feedback report names a verified reporter (#820). With an Onelo Auth session, `feedback.open()` sends the user's access token (`Authorization: Bearer`) on `/api/sdk/feedback/initiate`; Onelo stores the report with that user and `reporter_verified=true`, so no `userId` is needed. A refused token is refreshed and retried once; refused again, the form still opens without it. Signed out, the report stays anonymous; an explicit `userId` without a session is still an unverified label. `new OneloFeedback(...)` without the new optional token argument is unchanged.

## [0.75.0-staging] — 2026-10-01

### Changed

- Back from the embedded store's checkout in the app window, the "Signing you in…" cover looks like the steps before it (#728): it is painted from the first frame in the app's Branding and the store's language (remembered for this tab, in `sessionStorage`, when `openStore()` starts a store that can return to the page), with the hosted pages' spinner and a `role=status` text, and it goes away once the session is in. Without the remembered look (storage blocked, a different tab) it uses the neutral look as before, in the browser's language. English, Polish, German, French, Spanish and Portuguese.

## [0.74.0-staging] — 2026-10-01

### Changed

- A magic link asked for from the embedded store can be confirmed in the tab the e-mail opens, in one click (#727). The browser partitions the store iframe's storage under the app's site, so the link's tab could never read the store's same-browser proof: it always showed the pairing code screen. `openStore()` now keeps a PKCE verifier in the app page's own storage (the same one-per-browser slot as hosted sign-in) and sends only its challenge to `/store-initiate` as `code_challenge`, alongside `return_url`. The link then comes back through that page as `onelo_link`; initialisation proves "same browser" with the verifier and follows the `resume_url` that `/magic-link/consume` answers with (http(s) only). Since #757 that address is Onelo's hosted "Signed in" page: the link's tab only confirms the sign-in and never shows a checkout, even when the original store tab is closed. The original store tab picks up the sign-in from the backend and continues the purchase there, with the chosen plan. Another browser or device still gets the code screen (#535). Without durable storage no challenge is sent and the store keeps the code screen. New `auth.storeLinkChallenge()` (internal wiring for the paywall).

## [0.73.0-staging] — 2026-10-01

### Changed

- The embedded store signs in with Google, GitHub or Apple, and pays, in the app's own window (#726). Providers refuse to be framed and the checkout's payment form must not run inside an iframe, so the store used a small popup — and the checkout then continued inside that popup. The store now sends the page's window to the provider and on to the checkout; afterwards the buyer returns to the page they started from, signed in. The auth / store and Customer Portal iframes gain `allow-top-navigation-by-user-activation` (only a click inside the frame can move the page). `openStore()` sends the current page as `return_url` to `/store-initiate`; the backend keeps it only for the page's own, allowed origin. On return, initialisation exchanges `onelo_store_code` for the session and reports the purchase like an in-frame one. An older SDK without the sandbox flag gets a clear "try again" message instead of a working provider button: upgrade to use social sign-in in the embedded store.

## [0.72.1-staging] — 2026-10-01

### Fixed

- `waitlist.join()` reports a successful signup as `success: true` (#697). It read a `success` field the backend never sends, so every join — new or already on the list — came back as `success: false`. It now follows the endpoint's real response: HTTP 2xx with `ok: true` is success, carrying `position` and `alreadyJoined`; a non-2xx response or a body without `ok: true` is a failure.

## [0.72.0-staging] — 2026-09-29

### Changed

- SDK chrome is painted from the app's Branding (#681). The SDK parses `brand_tokens` from `/api/sdk/config` and the store / portal / manage / upgrade initiate responses into one in-memory model (`BrandSource` in the shared core) and draws every piece of its own UI from it: the auth / store modal container and its skeleton, the ✕ chip, the portal "Opening plans…" spinner and skeleton, the manage and feedback modals, the consent card (card, text, Accept button, radius) and the magic-link hand-off notice. An older backend without `brand_tokens` seeds the same shape from `primary_color` + `checkout_bg_color`; before config the chrome is neutral (`#a1a1aa` accent on `#111111`), never Onelo orange. New exported type `BrandTokens`.

## [0.71.0-staging] — 2026-09-29

### Fixed

- `openUpgrade()` for an entitled user reaches the plan picker without the Customer Portal page in front of it (#670). It used to open the portal and let the portal page ask `/portal-upgrade` where to go — a whole hosted page (server render and hydration) before the store, about 13 s of "Opening plans…" on staging. The SDK now asks `GET /api/sdk/paywall/upgrade-initiate` (Bearer, `callback_scheme=web`, no `plan`: the buyer picks in the store) and opens the answer — the plan-switch picker, the store for a first purchase, or the portal's "plan changes unavailable" explanation — in the portal's modal. Hand-back (#615, #659), the checkout's portal renewal (#642) and the fail-safe ✕ work as before; a dead store link is replaced by a fresh one in the same modal (#619). A subscriber of a "Sign in only" app still gets the portal. New internal `customerPortal.openUpgrade()`.

## [0.70.0-staging] — 2026-09-29

### Fixed

- After a purchase or a plan switch in the hosted store or Customer Portal, the app shows the new plan at once instead of about a minute later (#659). Every successful hand-back (`onelo:code`, `onelo:done` with any reason) from `openStore()`, `loadAuthView()` and `customerPortal.open()` / `openUpgrade()` forces a features re-resolve (past the 1 s debounce) and re-reads the entitlement. A `plan_switch_pending` switch is re-checked after 1, 2, 4, 8 and 15 s and stops as soon as the features change. One refresher (`core/plan-change.ts`) serves all three containers; new internal `setPlanChangeHandler()` on `OneloAuth`, `OneloPaywall` and `OneloCustomerPortal`, wired by `Onelo`.
- The entitlement now follows a plan change live (#635): the SDK listens for the Event Stream's per-user `paywall.access_changed` frame, which the backend sends right after the fresh `features_updated`, and calls `auth.revalidateEntitlement()`.

## [0.69.0-staging] — 2026-09-28

### Added

- A checkout opened from a store that `openStore()`, the access gate or `loadAuthView()` presented now keeps working past its pre-auth ceiling while the user is signed in (#642). The hosted store relays the checkout's `onelo:renew_request` (kind `portal`); the store modal answers it with a fresh portal token from `customerPortal` (the user's own access token), only to its own iframe or popup at the hosted origin. Signed out → `renew_failed` / `not_authenticated`, and a stand-alone checkout keeps its ceiling. New `setPortalRenewer()` on `OneloPaywall` and `OneloAuth`, wired by `Onelo`.

## [0.68.0-staging] — 2026-09-28

### Added

- The manage modal (`openManage()`) now keeps working when it is left open longer than its 15-minute manage token (#621). The hosted page asks the SDK for a fresh page (`onelo:renew_request`, kind `manage`); the SDK calls `manage-initiate` again with the user's access token and the same `lang`, and answers only its own iframe at the hosted origin. The page carries on (on load it replaces itself, mid-session it repeats the action once). Signed out → `renew_failed` with `not_authenticated`, and the page shows its branded "signed out" screen, whose "Back to app" closes the modal (resolves `null`, as before).

## [0.67.0-staging] — 2026-09-28

### Fixed

- A store whose link died (#619) — its two-hour renewal chain ended, or the device slept past it — now continues instead of closing. The hosted page hands the dead link back (`onelo:cancel` with reason `expired`, unchanged on the wire) and `openStore()` mints a fresh link through `store-initiate` and loads it in the same modal or popup. The access-gate store inside `loadAuthView()` restarts through `/flow/init` and keeps the user signed in (only `invalid_token`, the user's own exit, signs out). `classifyHandBack` reports this as `{ kind: 'expired' }`.
## [0.66.0-staging] — 2026-09-28

### Added

- The feedback modal (`feedback.open()`) now keeps the reporter when the form was left open longer than its 30-minute reporter token (#622). On submit the hosted form asks the SDK for a fresh token (`onelo:renew_request`, kind `feedback`); the SDK calls `/api/sdk/feedback/initiate` again with the same options and hands the new form URL back, and the report is sent with its reporter. Before, such a report was stored without a reporter and nobody was told.

## [0.65.1-staging] — 2026-09-28

### Fixed

- Sign-in in popup mode (`loadAuthView({ mode: 'popup' })`) now continues when the popup was left open past the life of its sign-in link (#625). The hosted page reports the dead link with `onelo:error token_expired`; the SDK starts a new flow as before, but now loads it into the popup that is already open instead of opening a new one. A new `window.open` at that moment has no click behind it, so browsers blocked it and `loadAuthView()` threw "Popup was blocked". Embedded mode was not affected.

## [0.65.0-staging] — 2026-09-28

### Changed

- One decoder for every "hosted page is finished" message (#615): the store modal (`openStore()`, `loadAuthView()`) and the Customer Portal modal now both classify `onelo:code` / `onelo:done` / `onelo:portal_done` / `onelo:cancel` / `onelo:error` through the same function, so a new terminal reaches both. A paid plan switch whose plan is still being updated after the store's wait now closes the modal as a success too (`onelo:done` with reason `plan_switch_pending`); the new plan arrives over the Event Stream.

## [0.64.0-staging] — 2026-09-28

### Added

- The Customer Portal no longer shows "Link expired" to a signed-in user who kept it open (#613 / #614). When the portal page's ten-minute token has died, the page sends `onelo:renew_request`; `customerPortal.open()`'s modal answers with a fresh portal minted from the current session (`onelo:renewed`), only to the portal iframe at the portal's origin, and the page repeats the action it was doing. Signed out → `onelo:renew_failed` and the page shows its branded "signed out" screen. A 401 from `portal-initiate` now throws `not_authenticated`.

## [0.63.0-staging] — 2026-09-28

### Fixed

- After a month↔year plan switch or a scheduled downgrade in the in-app store or Customer Portal, the modal now closes by itself (#599). The hosted store reports these code-less finishes with `onelo:done`; `openStore()` resolves with the current session (not `null`), and `customerPortal.open()` closes. The new plan arrives over the Event Stream.

## [0.62.1-staging] — 2026-09-28

### Fixed

- The customer portal's loading screens ("Opening plans…" after an upsell tap, and the portal skeleton) now use your app's brand colour and page background from Branding, instead of Onelo orange on `#111111` (#601). When the brand is unknown (an older backend) the spinner is neutral grey, never Onelo orange.

## [0.62.0-staging] — 2026-09-26

### Changed

- A refused session refresh now says what happened (#548). `session_compromised`, `session_expired` and `session_invalid` end the session with the neutral `OneloError` code `session_ended` ("Your session ended — please sign in again"). Only `banned` says "This user account has been suspended" and sets `isUserRevoked`. `no_plan_available` stays `no_active_plan`.
- `refreshSession()` now throws `session_ended` for an expired or invalid session instead of resolving `null`. `getSession()` still answers `null` for every ended session and never throws for it, including from the heartbeat and the background refresh timer, so these no longer reach Monitor as `unhandled` errors.
- Two tabs refreshing at once send the refresh token once. A tab that waited for another tab's refresh uses that tab's result. When the 5 s lock wait times out while the other tab is still refreshing, the waiting tab no longer resends the same token: it keeps the session and reports a transient `timeout`.
- Uncaught errors captured by Monitor carry `meta.origin` (`onelo_sdk` or `app`), so errors raised by the SDK itself can be kept out of your Monitor data.
- A transient refresh failure — offline, a lost response, `429`, or a `5xx` including the new `503 refresh_unavailable` — no longer signs the user out. The session is kept, `refreshSession()` throws `server_error` / `network_error`, and the refresh is retried after 5 s, 10 s, 20 s, 40 s, then every 60 s. The first retry lands inside the server's 30 s grace window. During the backoff `getSession()` does not start extra refreshes.

## [0.61.0-staging] — 2026-09-25

### Added

- Magic link opened in another browser or on another device (#535). The tab that asked for the link now signs in by itself once the person types, on the device that opened the link, the short code shown in that tab. The device that opened the link gets no session. In the same browser, the link still signs you in with one click.
- A paired magic link returns to your page as `?onelo_link=`. The SDK completes it during `init()`, just like `?onelo_code=`. No code change is needed.

### Changed

- `loadAuthView()` now binds the hosted flow to the SDK's PKCE verifier (`code_challenge` on `/api/sdk/flow/init`). Codes from the hosted page, including magic links, can only be exchanged by the tab that started the flow.
- The tab a magic link opens says "continue in the tab you started from" only when a waiting tab confirmed it received the sign-in. Otherwise it says the app can be opened again.

## [0.60.0-staging] — 2026-09-25

### Changed

- Features calls now prove the signed-in user with the Onelo access token (#518). Resolve, batch-ping, module-token and the Event Stream token mint send `Authorization: Bearer <access token>`, read fresh for every call and every reconnect. A refused token (`401 invalid_user_token`) is refreshed and retried once; if it is refused again, that call is made without a user and a warning is logged.
- `userIdHash` is no longer sent. `identify()` and its `userIdHash` argument still compile but are deprecated: the signed-in Onelo user is used automatically.
