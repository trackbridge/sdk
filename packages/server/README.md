# @trackbridge/server

Server-side conversion tracking for Google Ads + GA4. Talks to the Google Ads API for conversion uploads and the GA4 Measurement Protocol for events, with hashed user data that matches its [`@trackbridge/browser`](https://www.npmjs.com/package/@trackbridge/browser) counterpart byte-for-byte.

## Install

```bash
pnpm add @trackbridge/server
```

## Quick start

```ts
import { createServerTracker } from '@trackbridge/server';

export const serverTracker = createServerTracker({
  ga4MeasurementId: 'G-XXXXXXXXXX',
  ga4ApiSecret: process.env.GA4_API_SECRET!,
  ads: {
    developerToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
    customerId: process.env.GOOGLE_ADS_CUSTOMER_ID!,
    refreshToken: process.env.GOOGLE_ADS_REFRESH_TOKEN!,
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
    conversionActions: {
      // Map your friendly label to the Ads API resource name
      // (Tools → Conversions → click into a conversion → resource name).
      purchase: 'customers/1234567890/conversionActions/9876543210',
    },
  },
  debug: process.env.NODE_ENV !== 'production',
});

await serverTracker.trackConversion({
  label: 'purchase',
  value: 99,
  currency: 'USD',
  transactionId: order.id, // same value as the browser-side call → dedup
  gclid: order.gclid,      // captured browser-side, persisted with the order
  userData: {
    email: 'jane@example.com',
    phone: '+1 (555) 123-4567',
    firstName: 'Jane',
    lastName: 'Doe',
    address: { street: '123 Main St', city: 'Austin', region: 'TX', postalCode: '78701', country: 'US' },
  },
});
```

## What it does

- **Refreshes Google Ads OAuth tokens** automatically using your refresh token + OAuth client; coalesces concurrent refreshes; cached with a 60-second safety margin.
- **Uploads click conversions** via the Ads API (`uploadClickConversions`) with `partialFailure: true` so a single bad row doesn't sink the batch.
- **Posts events to GA4 MP** (`/mp/collect`) with hashed `user_data` matching the browser tracker's shape.
- **Per-call consent gate** — pass `consent: { ad_user_data: '…' }` and `userData` is dropped from outbound payloads when consent is denied.
- **Fails soft** — network errors and non-2xx responses resolve normally; in `debug: true` they `console.warn`.

## See also

- [`@trackbridge/browser`](https://www.npmjs.com/package/@trackbridge/browser) — client-side counterpart for the dual-send pattern
- [Project README](https://github.com/trackbridge/sdk#readme) — the full SDK story, OAuth setup, and conversion-action mapping

## License

MIT
