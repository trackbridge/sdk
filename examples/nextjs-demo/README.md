# Trackbridge Next.js demo

End-to-end dual-send dogfooding for `@trackbridge/browser` + `@trackbridge/server`.

## What it shows

A single button click fires the same conversion on both sides with the same `transactionId`:

1. **Browser** — `tracker.trackConversion(...)` pushes `gtag('set', 'user_data', …)` and `gtag('event', 'conversion', …)` onto `window.dataLayer`.
2. **Server** — the page POSTs the order data + captured click identifiers to `POST /api/conversion`, which calls `serverTracker.trackConversion(...)` with the same `transactionId`. That call refreshes an OAuth access token, normalizes + hashes the user data, and uploads to the Google Ads API.

If the client fires successfully, Google sees the server event as a duplicate and ignores it. If the client is blocked (ad blocker, ITP, network failure, denied consent), the server event becomes the conversion of record.

## Running locally

```bash
# From the repo root
pnpm install
pnpm --filter @trackbridge-examples/nextjs-demo build  # builds the workspace deps too

# In examples/nextjs-demo:
cp .env.local.example .env.local
# Fill in real values — see below for what each one is

pnpm dev
# → open http://localhost:3000?gclid=demo-click-id
```

## Env vars

The demo splits credentials by audience:

| Var | Audience | Where to find it |
|---|---|---|
| `NEXT_PUBLIC_ADS_CONVERSION_ID` | Browser | Google Ads UI → Tools → Conversions → your conversion → Tag setup. Format: `AW-XXXXXXXXXX`. |
| `NEXT_PUBLIC_GA4_MEASUREMENT_ID` | Both | GA4 Admin → Data Streams → Stream details. Format: `G-XXXXXXXXXX`. |
| `NEXT_PUBLIC_ADS_CONVERSION_LABEL` | Both | The gtag conversion label, e.g. `AbCdEfGhIjK`. Same string the browser uses in `send_to`. |
| `GA4_API_SECRET` | Server | GA4 Admin → Data Streams → your stream → Measurement Protocol API secrets. |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Server | Google Ads → Tools → API Center. |
| `GOOGLE_ADS_CUSTOMER_ID` | Server | Top-right of the Ads UI. Numeric, no dashes. |
| `GOOGLE_ADS_REFRESH_TOKEN` | Server | OAuth playground or your own OAuth flow with the `https://www.googleapis.com/auth/adwords` scope. |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | Server | Google Cloud Console → Credentials → OAuth 2.0 Client IDs. |
| `GOOGLE_ADS_CONVERSION_ACTION` | Server | The Ads-API resource name `customers/{customerId}/conversionActions/{actionId}`. The browser-friendly label maps to this. |

If the Ads block (everything except GA4) isn't fully populated, `trackConversion` will throw at request time with a clear message — the GA4 half still works.

## Verifying the dual-send

After clicking **Simulate purchase**:

1. **DevTools → Console** — debug-mode logs from both sides if `NODE_ENV !== 'production'`. Auto-generated `transactionId` warnings always log regardless.
2. **DevTools → Application → Cookies** — `_tb_gclid` set after landing with `?gclid=…`.
3. **DevTools → Network → /api/conversion** — the request body has the same `orderId` you'll see hashed-and-uploaded server-side.
4. `console.log(window.dataLayer)` — see the `set user_data` and `event conversion` entries pushed by the browser tracker.
5. **Google Ads UI → Conversions → diagnostic table** — within ~24h, the conversion shows up with both browser + server attribution merged via the shared `transactionId`.

## What this demo does NOT cover

- A real product catalog / checkout flow — it's just a button.
- Persisting click identifiers across the browser → server hop. In real apps you'd save them on the order record, not pass them through the same request that creates the order.
- Consent Mode v2 wiring — the demo defaults to `consentMode: 'off'` so cookies write immediately. Production sites with GDPR / CCPA exposure should pass `consentMode: 'v2'` and call `tracker.updateConsent(...)` from their CMP callbacks.
