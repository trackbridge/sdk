# @trackbridge/browser

## 0.0.4

### Patch Changes

- 76e4448: docs: add per-package README files

  Each package now has a focused landing page on npmjs.com explaining what that specific package does, how to install it, and a minimal example. Without these, the npm package pages were bare placeholders.

- Updated dependencies [76e4448]
  - @trackbridge/core@0.0.4

## 0.0.3

### Patch Changes

- 6be78e4: chore: smoke-test OIDC trusted publishing pipeline (no functional change)
- Updated dependencies [6be78e4]
  - @trackbridge/core@0.0.3

## 0.0.2

### Patch Changes

- 7e4938f: Initial early-access release of Trackbridge.

  **`@trackbridge/core`** — shared types (`UserData`, `Address`,
  `HashedUserData`), normalization (`normalizeEmail`, `normalizePhone`,
  `normalizeName`, `normalizeAddress`), `hashSha256` with cross-runtime
  support (browser Web Crypto + Node 18 `node:crypto` fallback), and
  `hashUserData` composing the two. Pinned golden hashes guard the
  dual-send invariant.

  **`@trackbridge/server`** — `createServerTracker` with `trackEvent`
  (GA4 Measurement Protocol) and `trackConversion` (Google Ads API
  `uploadClickConversions` with OAuth refresh-token flow,
  60-second-margin token caching, concurrent-call coalescing,
  `partialFailure: true` batched uploads). GA4 user_data and Ads
  userIdentifiers shapes are built from core's normalized values.

  **`@trackbridge/browser`** — `createBrowserTracker` with click-
  identifier auto-capture from URL (`gclid` / `gbraid` / `wbraid`),
  consent-gated cookie persistence, Consent Mode v2 state machine
  (`updateConsent` flips `ad_storage` and triggers deferred writes),
  `trackEvent` (gtag → dataLayer), and `trackConversion` (gtag enhanced
  conversions with `set user_data` + `event conversion`). `transactionId`
  auto-generated as `tb_${uuid}` with a loud always-on warning when
  missing.

- Updated dependencies [7e4938f]
  - @trackbridge/core@0.0.2
