---
'@trackbridge/core': minor
'@trackbridge/browser': minor
'@trackbridge/server': minor
---

feat(server)!: return structured `SendResult` from `trackEvent` and `trackConversion`

The server tracker's two methods no longer resolve to `void`. `trackEvent` resolves to `{ ga4: SendResult }` and `trackConversion` to `{ ads: SendResult }`, where `SendResult` is `{ ok: true } | { ok: false; error: Error }`. Runtime API failures — network errors, OAuth refresh failures, non-2xx responses — are now captured into the result instead of swallowed silently. Callers can surface, log, or ignore the failure without a try/catch; production checkout flows can keep responding 200 to the client and still observe what happened. Configuration errors (missing required config, unknown conversion label) still throw, so misuse fails loud.

This is a breaking change to the public API of `@trackbridge/server`. Per the linked-package rule the three packages bump together; `@trackbridge/core` and `@trackbridge/browser` have no behavioral changes in this release.

Also includes test-only hardening of the dual-send invariant in `@trackbridge/core`: a runtime-parity test that pins `globalThis.crypto.subtle` and the `node:crypto` fallback to byte-identical output, locale-independent lowercasing pins (`AYDIN`, `İSTANBUL`) so a future swap to `.toLocaleLowerCase()` would fail loudly, NFC and NFD composite goldens proving the dual-send invariant end-to-end with non-Latin input, edge-case raw-input pins for phone/email canonicalization, and conversion of literal multibyte glyphs in test sources to `\u` escapes so the codepoint sequences are unambiguous regardless of editor settings.
