# @onelo/sdk

The official Onelo JavaScript / TypeScript SDK — one package for feature flags, paywalls, forms, and waitlists.

## Installation

```bash
npm install @onelo/sdk
```

## Quick start

```typescript
import { Onelo } from '@onelo/sdk'

const onelo = new Onelo({ publishableKey: 'pk_live_...' })

// Identify the current user before using any modules
await onelo.identify(userId)
// or with a subscription plan:
await onelo.identify(userId, { plan: 'pro' })
```

## Features

```typescript
onelo.features.isEnabled('export-button')   // boolean
onelo.features.status('export-button')       // "enabled" | "greyed" | "hidden" | "upsell"
```

## Paywall

```typescript
onelo.paywall.check('pro')   // true if user's plan >= 'pro'
```

Tier hierarchy (ascending): `free < starter < pro < enterprise`

## Forms

```typescript
const result = await onelo.forms.submit(
  'feedback',
  { message: 'Great product!' },
  { submitterEmail: 'user@example.com' }
)
// result: { success: boolean, message: string }
```

## Waitlist

```typescript
const result = await onelo.waitlist.join('beta', 'user@example.com')
// result: { success: boolean, position?: number, alreadyJoined: boolean }
```

## TypeScript

Full TypeScript support included. All public types are exported from `@onelo/sdk`.

```typescript
import type { FeatureStatus, FormResult, WaitlistResult } from '@onelo/sdk'
```

## License

MIT
