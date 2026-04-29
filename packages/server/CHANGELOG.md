# @trackbridge/server

## 0.2.0

### Minor Changes

- 55c2e94: Add `TrackbridgeContext` envelope and `serverTracker.fromContext(envelope)` for delayed/webhook conversions. Browser gets `tracker.exportContext()` and `tracker.getSessionId()`. Server gains a `userId?` field on `ServerEventInput` (maps to GA4 MP `user_id`) and a `ContextBoundServerTracker` returned by `fromContext`. Consent types (`ConsentValue`, `ConsentUpdate`, `ConsentState`) relocated from `@trackbridge/browser` to `@trackbridge/core` — browser re-exports preserve existing import paths. `ServerConsent` value union widened to include `'unknown'` (strict superset; existing callers typecheck unchanged).

### Patch Changes

- Updated dependencies [55c2e94]
  - @trackbridge/core@0.2.0

## 0.1.0

### Minor Changes

- c364dbe: Add `BrowserTracker` DX methods: `getClientId`, `getConsent`, `identifyUser`, `clearUser`, `trackPageView`, `setDebug`, plus a `debugUrlParam` config flag for `?tb_debug=1` URL toggling. Internal consent state refactored from two booleans to a four-key record exposed by `getConsent`. Pure additive change to the public API; no behavioral changes to existing methods.
- 1392180: feat(server)!: return structured `SendResult` from `trackEvent` and `trackConversion`

  The server tracker's two methods no longer resolve to `void`. `trackEvent` resolves to `{ ga4: SendResult }` and `trackConversion` to `{ ads: SendResult }`, where `SendResult` is `{ ok: true } | { ok: false; error: Error }`. Runtime API failures — network errors, OAuth refresh failures, non-2xx responses — are now captured into the result instead of swallowed silently. Callers can surface, log, or ignore the failure without a try/catch; production checkout flows can keep responding 200 to the client and still observe what happened. Configuration errors (missing required config, unknown conversion label) still throw, so misuse fails loud.

  This is a breaking change to the public API of `@trackbridge/server`. Per the linked-package rule the three packages bump together; `@trackbridge/core` and `@trackbridge/browser` have no behavioral changes in this release.

  Also includes test-only hardening of the dual-send invariant in `@trackbridge/core`: a runtime-parity test that pins `globalThis.crypto.subtle` and the `node:crypto` fallback to byte-identical output, locale-independent lowercasing pins (`AYDIN`, `İSTANBUL`) so a future swap to `.toLocaleLowerCase()` would fail loudly, NFC and NFD composite goldens proving the dual-send invariant end-to-end with non-Latin input, edge-case raw-input pins for phone/email canonicalization, and conversion of literal multibyte glyphs in test sources to `\u` escapes so the codepoint sequences are unambiguous regardless of editor settings.

### Patch Changes

- Updated dependencies [c364dbe]
- Updated dependencies [1392180]
  - @trackbridge/core@0.1.0

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
