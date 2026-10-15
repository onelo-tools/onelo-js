# @onelo/js

The Onelo SDK for the web — works with plain JavaScript, React, Vue, or anything else that runs in a browser.

Part of [Onelo](https://onelo.tools): hosted sign-in, a paywall on **your own Stripe** account, plan-gated feature flags, uptime monitoring, in-app feedback, a public roadmap and a waitlist — one SDK, wired together.

## Install

```bash
npm install github:onelo-tools/onelo-js
```

## Quick start

```ts
import { Onelo } from '@onelo/js'

// Initialize once (e.g. in a module-level singleton)
const onelo = new Onelo({
  publishableKey: 'onelo_pk_live_YOUR_KEY',
  apiUrl: 'https://api.onelo.tools',
})
```

Both `publishableKey` and `apiUrl` are required — your Onelo dashboard shows the exact snippet with your values already filled in.

Then open sign-in and read the session:

```ts
// Opens the hosted sign-in flow. Onelo decides what to show —
// sign-in, the store, or a waitlist — based on your app's configuration.
const session = await onelo.loadAuthView()

// Already signed in?
const existing = await onelo.auth.getSession()

// React to sign-in / sign-out
onelo.auth.onAuthStateChange((session) => {
  console.log(session ? `signed in as ${session.user.email}` : 'signed out')
})

// Is this user allowed into the app (paid / entitled)?
if (await onelo.auth.isAllowedIn()) {
  showApp()
}

await onelo.auth.signOut()
```

## Connect an existing sign-in (Supabase, Clerk, Firebase)

Onelo Auth is the default. An app that already signs its users in with Supabase, Clerk or Firebase can connect that sign-in instead: set the app's **Sign-in Mode** to the provider in the Onelo dashboard, then hand the SDK a function that returns the provider's current token.

```ts
await onelo.auth.useExternalToken(async () => providerToken /* string, or null when signed out */)
```

- The SDK exchanges the token for an Onelo session at once and keeps it where every module reads it, so Paywall, Features, Consent and the rest work unchanged.
- The session lasts 30 minutes. After about 80% of that time the SDK calls your function again and exchanges a fresh token.
- When your function returns no token, the session ends and `onAuthStateChange` reports signed out.
- Onelo sign-in screens are never shown: `loadAuthView()` only returns the current session.
- Call it on start and whenever the provider's user changes. Each provider's listener below does both.

**Supabase**

```ts
// `supabase` is your existing Supabase client, `onelo` the instance above.
// The project must sign its tokens with an asymmetric key (ES256 or RS256);
// the legacy shared-secret (HS256) tokens are refused.

// getSession() refreshes the Supabase session when needed. null = signed out.
const supabaseToken = async () =>
  (await supabase.auth.getSession()).data.session?.access_token ?? null

// Fires once on start (INITIAL_SESSION), then on every sign-in and sign-out.
let supabaseUser: string | null | undefined
supabase.auth.onAuthStateChange((_event, session) => {
  const user = session?.user.id ?? null
  if (user === supabaseUser) return // a token refresh, not another user
  supabaseUser = user
  // Outside the callback: Supabase calls must not run inside it.
  setTimeout(() => {
    onelo.auth.useExternalToken(supabaseToken).catch((e) => console.error('[Onelo]', e))
  }, 0)
})
```

**Clerk**

```ts
// `clerk` is your loaded Clerk instance (window.Clerk, or useClerk() in
// React), `onelo` the instance above.

// getToken() answers from Clerk's cache and fetches a new token when the
// one-minute token has expired. null = signed out.
const clerkToken = async () => (await clerk.session?.getToken()) ?? null

// Fires once on start, then whenever the Clerk session changes.
let clerkUser: string | null | undefined
clerk.addListener(({ session }) => {
  if (session === undefined) return // Clerk is still loading
  const user = session?.user?.id ?? null
  if (user === clerkUser) return
  clerkUser = user
  onelo.auth.useExternalToken(clerkToken).catch((e) => console.error('[Onelo]', e))
})

// Clerk's session token carries no e-mail by default. To give Onelo the
// address, add `email` and `email_verified` to the session token in the Clerk
// dashboard (Sessions → Customize session token).
```

**Firebase**

```ts
import { getAuth, onAuthStateChanged } from 'firebase/auth'

// `onelo` is the instance above.
const firebaseAuth = getAuth()

// getIdToken() returns the current ID token and refreshes one that expires
// within five minutes. No current user = signed out.
const firebaseToken = async () => (await firebaseAuth.currentUser?.getIdToken()) ?? null

// Fires once on start, then on every sign-in and sign-out.
onAuthStateChanged(firebaseAuth, () => {
  onelo.auth.useExternalToken(firebaseToken).catch((e) => console.error('[Onelo]', e))
})
```

Then, with any provider:

```ts
// From here every module works as with Onelo Auth.
const session = await onelo.auth.getSession() // null = signed out at the provider
onelo.auth.onAuthStateChange((s) => {
  console.log(s ? `signed in as ${s.user.email}` : 'signed out')
})
if (await onelo.auth.isAllowedIn()) showApp()
```

`useExternalToken()` resolves to the session, or `null` when the provider has no user. It rejects in two cases:

- Onelo refuses the token: an `OneloError` such as `session_ended` (the server's code is in the message) or `user_revoked` for a banned user. The session is over.
- The exchange could not be made right now (offline, a rate limit, a provider token that is not valid yet or any more): the call rejects too, but the session is kept and the SDK retries in the background. `onAuthStateChange` fires when a retry succeeds. If the provider keeps returning an expired token until the Onelo session itself has expired, the user is signed out (`getSession()` answers `null` and `onAuthStateChange(null)` fires) instead of being retried forever.

`onelo.auth.signOut()` with your own sign-in ends the Onelo session in every open tab of your App at once. No tab renews it until you call `useExternalToken()` again (your provider's sign-in listener does this when the user signs in) — then every open tab is signed in again.

Gate a feature by the plan the user is on:

```ts
onelo.features.declare(['export-button'])

// Reveal gated UI only after the snapshot for the restored/current identity
// is confirmed. Await this again after every sign-in or user switch; the
// timeout keeps startup bounded while the persisted snapshot remains usable.
await onelo.auth.getSession()
await onelo.features.ready(1500)

if (onelo.features.feature('export-button').isEnabled) {
  showExportButton()
}

// Re-render when a flag changes (flags are pushed live, not polled)
const unsubscribe = onelo.features.subscribe(() => rerender())
```

## Modules

Everything below is reachable from the one `onelo` instance.

| Accessor | What it does | Key methods |
|---|---|---|
| `onelo.auth` | Hosted sign-in, sessions, magic links, password reset | `getSession()`, `onAuthStateChange()`, `isAllowedIn()`, `useExternalToken()`, `sendMagicLink()`, `resendVerificationEmail()`, `confirmEmail()`, `getSignupMarketingConsent()`, `signOut()` |
| `onelo.features` | Plan-gated feature flags, pushed live | `declare()`, `feature()`, `subscribe()`, `ready()` |
| `onelo.monitor` | Error and event reporting | `track()`, `capture()`, `event()`, `breadcrumb()` |
| `onelo.paywall` | Your hosted store, on your own Stripe | `openStore()`, `openManage()` |
| `onelo.customerPortal` | Cancel, change plan, refunds, invoices | `open()` |
| `onelo.feedback` | In-app bug reports and feature requests | `open()` |
| `onelo.forms` | Form submissions | `submit()` |
| `onelo.waitlist` | Pre-launch signups | `join()` |
| `onelo.consent` | Versioned terms / privacy consent gate | `requiredConsents()`, `acceptConsent()`, `onConsentRequired()` |

Top-level helpers on the instance:

| Method | What it does |
|---|---|
| `loadAuthView(options?)` | Opens the hosted flow. `{ mode: 'popup' }` if an embedded iframe doesn't suit your page. |
| `openUpgrade(plan?)` | Sends an active subscriber to the customer portal, everyone else to the store. |
| `destroy()` | Releases timers, listeners and the live event stream. |

`identify()` and its `userIdHash` argument are deprecated: the signed-in Onelo user is used automatically, and Features calls prove that user with their access token.

## React, Vue and other frameworks

The SDK is framework-agnostic — there are no framework-specific builds or hooks. Reactivity goes through `features.subscribe()`, which returns an unsubscribe function:

```ts
// React
const flags = useSyncExternalStore(
  (cb) => onelo.features.subscribe(cb),
  () => onelo.features.feature('export-button').isEnabled,
)

// Vue — trigger a ref from the same callback
onMounted(() => onelo.features.subscribe(() => (enabled.value = onelo.features.feature('export-button').isEnabled)))
```

## Requirements

The SDK runs in the browser and uses `fetch`, `localStorage` and iframe messaging. It has **zero runtime dependencies** and ships its own TypeScript types. Server-side rendering is handled defensively — the SDK checks `typeof window` before touching browser-only APIs.

## Links

- **Docs:** [onelo.tools/docs](https://onelo.tools/docs)
- **Dashboard:** [onelo.tools](https://onelo.tools) — your app's snippet comes pre-filled with your keys
- **Issues:** please report them on this repository

## License

MIT
