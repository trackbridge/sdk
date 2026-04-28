---
'@trackbridge/browser': minor
'@trackbridge/server': minor
'@trackbridge/core': minor
---

Add `BrowserTracker` DX methods: `getClientId`, `getConsent`, `identifyUser`, `clearUser`, `trackPageView`, `setDebug`, plus a `debugUrlParam` config flag for `?tb_debug=1` URL toggling. Internal consent state refactored from two booleans to a four-key record exposed by `getConsent`. Pure additive change to the public API; no behavioral changes to existing methods.
