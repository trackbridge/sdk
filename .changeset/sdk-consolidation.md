---
'@trackbridge/sdk': minor
---

Consolidate `@trackbridge/core`, `@trackbridge/browser`, and `@trackbridge/server` into a single `@trackbridge/sdk` package with subpath exports. Public API surface, behavior, and tests are unchanged — only import paths change.

Migration:

- `pnpm add @trackbridge/sdk` instead of the three separate packages.
- `import { createBrowserTracker } from '@trackbridge/sdk/browser'`
- `import { createServerTracker } from '@trackbridge/sdk/server'`

The package's reserved `@trackbridge/sdk/next` subpath is staged for an upcoming framework-helpers module; nothing ships at that subpath in this release.
