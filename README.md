# Trackbridge

[![CI](https://github.com/trackbridge/sdk/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/trackbridge/sdk/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/trackbridge/sdk/blob/main/LICENSE)

**Stop losing Google Ads conversions to client-side failures.**

Trackbridge is a TypeScript SDK that fires conversion events from both the browser **and** your server, dedupes them automatically, and tells you exactly what happened. One install, two-sided tracking, zero guesswork.

```bash
pnpm add @trackbridge/sdk
```

---

## Why Trackbridge?

If you're running Google Ads, you're probably losing 20–40% of your conversions and you don't know it. Ad blockers, ITP, consent denials, network failures during checkout redirects — they all silently eat client-side `gtag` events. The fix is to fire conversions from your server too, dedupe them so Google doesn't double-count, and hash user data identically on both sides.

Google documents how to do this. Doing it correctly is another story.

Trackbridge handles:

- **Dual-send** — fires the same conversion from browser and server, automatically
- **Deduplication** — shared transaction IDs so Google merges the events instead of double-counting
- **Enhanced conversions** — normalizes and SHA-256 hashes user data the way Google actually expects (the part everyone gets subtly wrong)
- **Consent Mode v2** — respects consent signals on both sides without you wiring it up twice
- **Debug mode** — surfaces failures from gtag, GA4 MP, and the Ads API via `console.warn` so silent failures stop being silent

It does **not** try to be a universal analytics platform. It does Google Ads + GA4 conversions, and it does them well.

---

## Quick start

### 1. Initialize on the client

```ts
// app/layout.tsx (or wherever your root is)
import { createBrowserTracker } from '@trackbridge/sdk/browser';

export const tracker = createBrowserTracker({
  adsConversionId: 'AW-123456789',
  ga4MeasurementId: 'G-XXXXXXXXXX',
  consentMode: 'v2',
  debug: process.env.NODE_ENV !== 'production',
});
```

### 2. Initialize on the server

```ts
// lib/tracker.ts
import { createServerTracker } from '@trackbridge/sdk/server';

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
      // Map your friendly label to the Ads API conversion-action resource name.
      // Find the resource name in the Ads UI under Tools → Conversions.
      purchase: 'customers/1234567890/conversionActions/9876543210',
    },
  },
  debug: process.env.NODE_ENV !== 'production',
});
```

`ga4MeasurementId` + `ga4ApiSecret` are required (they gate `trackEvent`). The `ads` block is optional but required to use `trackConversion`. `clientId` + `clientSecret` are your Google Cloud OAuth client — the SDK uses them to refresh access tokens automatically.

The `conversionActions` map is the one bit of plumbing the dual-send pattern can't avoid: the browser uses the gtag conversion label in `send_to`, while the Ads API uses a different resource name. You map between them once, here.

### 3. Fire a conversion

The same call works on both sides. Trackbridge handles the rest.

```ts
await tracker.trackConversion({
  label: 'purchase',
  value: 99.0,
  currency: 'USD',
  transactionId: 'order_8a91bf', // dedup key — must match across client + server
  userData: {
    email: 'jane@example.com',
    phone: '+1 (555) 123-4567',
    firstName: 'Jane',
    lastName: 'Doe',
    address: {
      street: '123 Main St',
      city: 'Austin',
      region: 'TX',
      postalCode: '78701',
      country: 'US',
    },
  },
});
```

Trackbridge will:

1. Normalize `email` to lowercase, trim whitespace, NFC unicode form
2. Convert phone to digits-only with leading `+` (`+15551234567`); no country-code inference
3. Trim and lowercase name fields, preserving diacritics in NFC form
4. Normalize address fields per Google's spec (lowercase street/city/region, uppercase country, preserve UK postal-code internal spaces)
5. SHA-256 hash everything that needs hashing — same bytes on both sides
6. Send via `gtag` → `dataLayer` (browser) or the Google Ads API + GA4 Measurement Protocol (server)
7. Use `transactionId` as the dedup key so Google merges them

---

## The dual-send pattern

The whole point of Trackbridge. You fire the conversion in **both** places using the **same transaction ID**:

```ts
// On the client, right after checkout success
await tracker.trackConversion({
  label: 'purchase',
  value: order.total,
  currency: 'USD',
  transactionId: order.id,
  userData: {
    email: user.email,
    phone: user.phone,
    address: user.billingAddress,
  },
});

// On the server, in your webhook or success handler
await serverTracker.trackConversion({
  label: 'purchase',
  value: order.total,
  currency: 'USD',
  transactionId: order.id, // same ID — this is what dedupes
  userData: {
    email: user.email,
    phone: user.phone,
    address: user.billingAddress,
  },
});
```

If the client fired successfully, Google sees the server event as a duplicate and ignores it. If the client was blocked (ad blocker, ITP, consent denial, network fail), the server event becomes the conversion of record. You never lose a conversion, you never double-count.

---

## Debug mode

Pass `debug: true` and Trackbridge logs failures via `console.warn` so you can see what's going wrong:

- Non-2xx responses from gtag, GA4 Measurement Protocol, or the Ads API
- Network errors during a request
- gtag exceptions on the browser side

In production (`debug: false`), all of these resolve silently — your checkout flow never crashes because Google's API rate-limited you.

Two warnings always fire regardless of debug mode, because they signal a problem only the developer can fix:

```
[trackbridge] ⚠️ trackConversion called without transactionId
  → Auto-generated: tb_a8f3c1d2-...
  → Dual-send disabled for this call. Pass a transactionId you control
    to enable cross-side dedup.
  → See: https://docs.trackbridge.dev/sdk/concepts/deduplication/
```

Verbose pre-hash / post-hash tracing and a structured event log are planned for the Trackbridge Dashboard companion product.

---

## Semantic event helpers

Five typed helpers cover the GA4 ecommerce events most apps need. Each one fans out: an Ads conversion (when a label is configured) and the matching GA4 event share one `transactionId` for dedup. Items are first-class — no untyped `params.items: [...]` anymore.

```ts
const tracker = createBrowserTracker({
  adsConversionId: 'AW-XXXXXXX',
  ga4MeasurementId: 'G-XXXXXXX',
  conversionLabels: {
    purchase: 'abc123',          // configured → trackPurchase fires Ads + GA4
    signUp: 'def456',            // configured → trackSignUp fires Ads + GA4
    // beginCheckout, addToCart left unconfigured → fire GA4 only
  },
});

await tracker.trackPurchase({
  transactionId: 'order-42',
  value: 99.99,
  currency: 'USD',
  items: [
    { itemId: 'SKU-1', itemName: 'Widget', price: 99.99, quantity: 1 },
  ],
});
```

The same five methods are on the server tracker (with required `clientId`) and on the bound tracker returned by `fromContext`. The server flavor returns a `ServerHelperResult`:

```ts
const result = await serverTracker.trackPurchase({ /* ... */ });
// result.ads: { ok: true } | { ok: false; error } | { skipped: true; reason: 'no_label_configured' | 'refund_ads_unsupported' }
// result.ga4: { ok: true } | { ok: false; error }
```

`trackRefund` always skips Ads in v1 — refund Ads adjustments require the `uploadConversionAdjustments` API and are out of scope for this release. The GA4 `refund` event fires normally.

The existing `trackConversion` and `trackEvent` methods remain available as escape hatches for events without a typed helper.

---

## Consent Mode v2

Pass `consentMode: 'v2'` on the browser tracker and Trackbridge respects two consent signals from your CMP:

- **`ad_storage`** — gates click-identifier cookie writes. If consent is unknown at init, the SDK holds captured values in memory and writes the cookies later if (and only if) consent is granted via `updateConsent`.
- **`ad_user_data`** — gates whether `userData` (the hashed PII used for enhanced conversions) is attached to outbound `gtag` calls. Until granted, the conversion event still fires, but without `user_data` — so Google can still attribute the click but cannot use enhanced-conversion matching.

```ts
tracker.updateConsent({
  ad_storage: 'granted',         // gates _tb_* cookie writes
  ad_user_data: 'granted',       // gates outbound user_data on gtag
  ad_personalization: 'denied',  // stored, not yet acted on
  analytics_storage: 'granted',  // stored, not yet acted on
});
```

Call this from your CMP's grant/deny callbacks. Default is `consentMode: 'off'`, which treats both signals as granted — appropriate when you don't operate under GDPR / CCPA-style consent rules.

### Server-side consent

The server tracker has no session of its own — pass consent through from your request handler on each call:

```ts
await serverTracker.trackConversion({
  label: 'purchase',
  transactionId: order.id,
  userData: { email: user.email },
  consent: { ad_user_data: order.consent.adUserData }, // 'granted' | 'denied'
});
```

When `consent.ad_user_data` is anything other than `'granted'`, `userData` is dropped from the outbound payload. Omitting `consent` entirely is treated as "the caller doesn't track consent here" — the request is sent in full.

---

## Click identifiers & dedup

Trackbridge handles two different identifiers, doing two different jobs:

- **`transactionId`** — the **dedup key**. Same value on client and server tells Google "this is one conversion, not two."
- **`gclid` / `gbraid` / `wbraid`** — the **attribution key**. Tells Google which ad click led to the conversion.

You almost always want both.

### transactionId — auto-generated if missing

If you pass `transactionId`, Trackbridge uses it verbatim. If you don't, Trackbridge generates a UUID prefixed with `tb_` and uses it for that call.

**Important:** when `transactionId` is auto-generated, dual-send is effectively disabled. The SDK still fires the call, but if you also call `trackConversion` on the other side without a `transactionId`, the two auto-generated UUIDs won't match and Google will count the conversion twice. The SDK warns loudly (always — not gated by debug mode):

```
[trackbridge] ⚠️ trackConversion called without transactionId
  → Auto-generated: tb_a8f3c1d2-...
  → Dual-send disabled for this call. Pass a transactionId you control
    to enable cross-side dedup.
```

If you want dual-send, pass a `transactionId` you control on both sides — usually your order ID.

```ts
// ✅ Will dual-send. Same ID on both sides → Google dedupes.
tracker.trackConversion({ transactionId: order.id, ... });
serverTracker.trackConversion({ transactionId: order.id, ... });

// ⚠️ Will not dual-send. SDK warns. The call still fires.
tracker.trackConversion({ /* no transactionId */ ... });
```

### gclid / gbraid / wbraid — captured automatically

When a user lands on your site from a Google ad, the URL contains `?gclid=...` (or `gbraid` / `wbraid` for iOS/ATT-restricted environments). `@trackbridge/sdk/browser` reads these on init, stores them in first-party cookies, and attaches them to every conversion automatically.

You do nothing on the browser side. It just works.

On the server side, you have to pass them explicitly — your server doesn't see the user's URL. The pattern:

```ts
// 1. Browser captures click ID on landing (automatic)
const tracker = createBrowserTracker({ adsConversionId: 'AW-...' });

// 2. When the user signs up / checks out, send the click ID to your backend
const clickIds = tracker.getClickIdentifiers();
// → { gclid: 'EAIaIQ...', gbraid: undefined, wbraid: undefined }
await fetch('/api/checkout', {
  method: 'POST',
  body: JSON.stringify({ ...orderData, clickIds }),
});

// 3. Your server stores them with the order, then passes them to the server tracker
await serverTracker.trackConversion({
  label: 'purchase',
  transactionId: order.id,
  gclid: order.gclid,
  userData: { ... },
});
```

### Cookie behavior

By default Trackbridge stores click identifiers in three first-party cookies:

| Cookie | Contents | Expiry |
|---|---|---|
| `_tb_gclid` | Google Ads click ID (web) | 90 days |
| `_tb_gbraid` | iOS app campaign click ID | 90 days |
| `_tb_wbraid` | Web click ID for ATT-restricted environments | 90 days |

All cookies are `Secure`, `SameSite=Lax`, `Path=/`, host-only by default. Configure via init:

```ts
createBrowserTracker({
  adsConversionId: 'AW-...',
  clickIdentifierStorage: 'cookie',   // 'cookie' | 'memory' | 'none'
  cookieDomain: '.example.com',       // for cross-subdomain tracking
  cookieExpiryDays: 90,
});
```

- **`'cookie'`** (default) — persist across sessions, 90-day window matches Google's attribution default
- **`'memory'`** — capture from URL but don't persist; useful if you manage storage yourself
- **`'none'`** — no automatic capture or storage; pass click IDs explicitly to every call

### Consent Mode interaction

Trackbridge will not write click identifier cookies when `ad_storage` consent is `denied`. If consent is unknown at init, the SDK holds the values in memory and writes the cookies later if `updateConsent` grants `ad_storage`. If consent is denied for the whole session, click IDs live in memory only and disappear when the user closes the tab — which is the correct behavior under GDPR/Consent Mode v2.

---

## Delayed conversions with the context envelope

When the conversion fires hours or days after the user leaves the page (Stripe webhook, async job, batch payment), the browser is gone — but you can still send a faithful server-side conversion if you captured the right context at checkout. Trackbridge has a built-in helper:

```ts
// On the browser, at checkout success:
const envelope = tracker.exportContext({
  userData: {
    email: order.email,
    phone: order.phone,
  },
});

await fetch('/api/checkout-complete', {
  method: 'POST',
  body: JSON.stringify({ orderId: order.id, envelope }),
});
```

```ts
// On the server, when the webhook fires (hours later):
const order = await db.orders.findById(orderId);
const bound = serverTracker.fromContext(order.envelope);

await bound.trackConversion({
  label: 'purchase',
  value: order.total,
  currency: 'USD',
  transactionId: order.id,
});
```

The envelope is plain JSON — persist it on the order/payment row in your database. `fromContext` validates the envelope structure and returns a tracker pre-bound to its `clientId`, `clickIds`, `consent`, `userId`, and `userData`. Per-call inputs override envelope values on conflict (no deep merge), so you can still pass per-call `userData` overrides if your DB has fresher data.

---

## GA4 events

Conversions are the headline feature, but you'll also want to fire regular GA4 events. Same dual-send pattern, same API shape — browser fires via `gtag`, server fires via the GA4 Measurement Protocol.

```ts
// Browser
await tracker.trackEvent({
  name: 'add_to_cart',
  params: {
    value: 49.0,
    currency: 'USD',
    items: [{ item_id: 'sku_123', item_name: 'Notebook', quantity: 1 }],
  },
});

// Server (requires ga4ApiSecret in createServerTracker config)
await serverTracker.trackEvent({
  name: 'add_to_cart',
  clientId: req.cookies['_ga'], // pass through from the browser to keep the session
  params: {
    value: 49.0,
    currency: 'USD',
    items: [{ item_id: 'sku_123', item_name: 'Notebook', quantity: 1 }],
  },
});
```

Server-side GA4 needs an API secret. Generate one in GA4 Admin → Data Streams → your stream → Measurement Protocol API secrets, then pass it to `createServerTracker` (it's already in the Quick Start config above as `ga4ApiSecret`).

The `clientId` is the bit most server-side GA4 implementations get wrong — without it, server events show up as a separate user from the browser session. Trackbridge documents the pattern; you still have to pass the cookie value through from your request handler.

---

## Browser API quick reference

The `BrowserTracker` returned by `createBrowserTracker` exposes these methods. All are safe to call repeatedly; methods that target GA4 are silent no-ops when `ga4MeasurementId` is not configured (debug mode logs a warning).

| Method | Purpose |
|---|---|
| `getClickIdentifiers()` | Returns `{ gclid?, gbraid?, wbraid? }` from cookies / memory. |
| `getClientId()` | Reads the GA4 `_ga` cookie and returns the canonical clientId. Use to stamp the clientId on a fetch payload to your server for GA4 Measurement Protocol calls. |
| `getConsent()` | Returns the SDK's view of all four consent signals. Useful for rendering banner toggle states on mount. |
| `updateConsent(update)` | Updates one or more consent signals. Drives `_tb_*` cookie writes (via `ad_storage`) and PII gating (via `ad_user_data`). |
| `identifyUser(userId)` | Sets `user_id` for subsequent GA4 events via `gtag('config', …, { user_id, send_page_view: false })`. |
| `clearUser()` | Clears `user_id`. Same gtag config push with `user_id: undefined`. |
| `trackEvent(input)` | Fires a GA4 event via gtag. |
| `trackConversion(input)` | Fires a Google Ads conversion via gtag. |
| `trackPageView(input?)` | Fires a `page_view` event. Defaults `path` to `window.location.pathname + window.location.search`, `title` to `document.title`. Dedupes consecutive identical paths. |
| `setDebug(enabled)` | Runtime debug toggle. Overrides whatever was set at init or by the URL param. |

The init flag `debugUrlParam: true` enables an in-URL `?tb_debug=1` (or `?tb_debug=0`) override for the same setting. Memory-only — does not persist across full page reloads.

Note: `identifyUser` and `clearUser` push `gtag('config', …)` with `send_page_view: false` so a login/logout does not auto-fire an unintended page view. If you want a page view fire after login, call `trackPageView()` explicitly.

---

## What's in the box

One package, two subpath entry points:

| Import | What it does |
|---|---|
| `@trackbridge/sdk/browser` | Client-side tracker. Wraps `gtag`, handles consent, fires conversions. |
| `@trackbridge/sdk/server` | Server-side tracker. Talks to Google Ads API, fires conversions with hashed user data. |

Shared types, normalization, and hashing live inside the package and are used by both subpaths — you don't import them directly. The `@trackbridge/sdk/next` subpath is reserved for a future framework-helpers module.

---

## Roadmap

- ✅ Google Ads enhanced conversions — browser via gtag, server via the Google Ads API with OAuth refresh-token flow
- ✅ GA4 events — browser via gtag, server via the Measurement Protocol
- ✅ Consent Mode v2 — `ad_storage`-gated cookie writes (browser) + `ad_user_data`-gated `userData` sending (browser via `updateConsent`, server via per-call `consent`)
- ✅ Click identifier auto-capture — `gclid` / `gbraid` / `wbraid` from URL, persisted to `_tb_*` first-party cookies
- ✅ Debug mode
- ✅ Browser tracker DX additions — `getClientId()`, `getConsent()`, `identifyUser()` / `clearUser()`, `trackPageView()`, `setDebug()`, plus the `?tb_debug=1` URL toggle (opt-in via `debugUrlParam: true`)
- 🔜 Cross-domain `_gl` linker (v1.1+)
- 🔜 Meta CAPI adapter (v1.1+)
- 🔜 TikTok Events API adapter (v1.1+)
- 🔜 Trackbridge Dashboard — see every event, every match, every failure across your stack (post-v1, separate product)

---

## Status

Early access. API may change before 1.0. If you want to use it in production, [reach out](mailto:hi@trackbridge.dev) — happy to help you wire it up.

## License

MIT
