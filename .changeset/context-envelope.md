---
'@trackbridge/browser': minor
'@trackbridge/server': minor
'@trackbridge/core': minor
---

Add `TrackbridgeContext` envelope and `serverTracker.fromContext(envelope)` for delayed/webhook conversions. Browser gets `tracker.exportContext()` and `tracker.getSessionId()`. Server gains a `userId?` field on `ServerEventInput` (maps to GA4 MP `user_id`) and a `ContextBoundServerTracker` returned by `fromContext`. Consent types (`ConsentValue`, `ConsentUpdate`, `ConsentState`) relocated from `@trackbridge/browser` to `@trackbridge/core` — browser re-exports preserve existing import paths. `ServerConsent` value union widened to include `'unknown'` (strict superset; existing callers typecheck unchanged).
