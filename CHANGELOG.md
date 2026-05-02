# @trackbridge/sdk

## 0.2.0

### Minor Changes

- 878a7bb: Consolidate `@trackbridge/core`, `@trackbridge/browser`, and `@trackbridge/server` into a single `@trackbridge/sdk` package with subpath exports. Public API surface, behavior, and tests are unchanged — only import paths change.

  Migration:
  - `pnpm add @trackbridge/sdk` instead of the three separate packages.
  - `import { createBrowserTracker } from '@trackbridge/sdk/browser'`
  - `import { createServerTracker } from '@trackbridge/sdk/server'`

  The package's reserved `@trackbridge/sdk/next` subpath is staged for an upcoming framework-helpers module; nothing ships at that subpath in this release.

- 242e050: feat(helpers): add semantic event helpers — trackPurchase, trackBeginCheckout, trackAddToCart, trackSignUp, trackRefund

  Five typed methods on browser and server trackers that fan out to Ads conversions (when a label is configured via the new `conversionLabels` config) and GA4 events in a single call, sharing one `transactionId` for dedup. New `TrackbridgeItem` type in `@trackbridge/core` lifts the GA4 items[] array out of untyped `params`. Server returns a structured `ServerHelperResult` with per-destination success/error/skipped status. Bound tracker (`fromContext`) exposes the same five helpers with envelope-derived field merging. Existing `trackConversion` and `trackEvent` are unchanged.

  Refund Ads adjustments (`uploadConversionAdjustments`) are intentionally out of scope; `trackRefund` is GA4-only in this release.
