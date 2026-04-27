# @trackbridge/browser

Client-side conversion tracking for Google Ads + GA4. Wraps `gtag`, captures click identifiers, respects Consent Mode v2, and shares its hashing pipeline with [`@trackbridge/server`](https://www.npmjs.com/package/@trackbridge/server) so dual-send dedup just works.

## Install

```bash
pnpm add @trackbridge/browser
```

You also need `gtag.js` loaded on the page (directly or via Google Tag Manager) — Trackbridge does not inject it.

## Quick start

```ts
import { createBrowserTracker } from '@trackbridge/browser';

const tracker = createBrowserTracker({
  adsConversionId: 'AW-123456789',
  ga4MeasurementId: 'G-XXXXXXXXXX',
  consentMode: 'v2',
  debug: process.env.NODE_ENV !== 'production',
});

await tracker.trackConversion({
  label: 'purchase',
  value: 99,
  currency: 'USD',
  transactionId: order.id, // dedup key — same value on the server side
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

- **Captures click identifiers** (`gclid` / `gbraid` / `wbraid`) from the URL on init and persists them to first-party cookies (`_tb_gclid`, etc.) — `Secure`, `SameSite=Lax`, 90-day default expiry.
- **Fires conversions via `gtag`** with `send_to`, `transaction_id`, `value`, `currency`, and the captured click ID, plus a `set` call for `user_data` enhanced conversions.
- **Respects Consent Mode v2** — `ad_storage` gates cookie writes; `ad_user_data` gates whether `userData` is attached to outbound calls. Both are unblocked when `consentMode: 'off'`.
- **Auto-generates `transactionId` when missing** with a loud warning, because dual-send dedup silently breaks otherwise.

## See also

- [`@trackbridge/server`](https://www.npmjs.com/package/@trackbridge/server) — server-side counterpart for the dual-send pattern
- [Project README](https://github.com/trackbridge/sdk#readme) — the full SDK story, dual-send pattern, and consent details

## License

MIT
