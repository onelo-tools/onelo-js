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

Gate a feature by the plan the user is on:

```ts
onelo.features.declare(['export-button'])

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
| `onelo.auth` | Hosted sign-in, sessions, magic links, password reset | `getSession()`, `onAuthStateChange()`, `isAllowedIn()`, `sendMagicLink()`, `signOut()` |
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
| `identify(userId, userIdHash?)` | Only when you are **not** using Onelo Auth — tells Onelo who the current user is so flags can target them. |
| `openUpgrade(plan?)` | Sends an active subscriber to the customer portal, everyone else to the store. |
| `destroy()` | Releases timers, listeners and the live event stream. |

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
