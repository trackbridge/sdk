# Contributing to Trackbridge

Trackbridge is in early development. The API may change before 1.0.

## Development setup

Trackbridge is a pnpm monorepo. You need:

- **Node.js 18.17+** (we test against 18.17 and 20 — the lower bound is the floor for `globalThis.crypto`-via-fallback support; see `packages/core/src/hash.ts`)
- **pnpm 9.12+**

```bash
git clone https://github.com/trackbridge/sdk.git
cd sdk
pnpm install
```

## Repository layout

```
trackbridge/
├── packages/
│   ├── core/          @trackbridge/core    — types, normalization, hashing
│   ├── browser/       @trackbridge/browser — client-side tracker
│   └── server/        @trackbridge/server  — server-side tracker
├── examples/
│   └── nextjs-demo/   end-to-end dual-send dogfooding app
└── .changeset/        version bump intents
```

The three published packages **release as a linked unit** — always at the same version. Never break this without explicit discussion: `@trackbridge/browser@0.3.1` paired with `@trackbridge/server@0.2.7` could ship subtly different normalization and silently break dual-send.

## Common commands

```bash
pnpm build          # Build all packages (esm + cjs + .d.ts via tsup)
pnpm dev            # Watch-mode build, all packages in parallel
pnpm test           # Run all tests
pnpm test:watch     # Watch-mode tests
pnpm typecheck      # tsc --noEmit across all packages
pnpm format         # Prettier across the repo
pnpm changeset      # Record a versioning intent (see "Versioning")
```

All four CI gates locally are `pnpm typecheck && pnpm test && pnpm build` — running them before pushing matches what `.github/workflows/ci.yml` does.

The Next.js demo lives outside `pnpm -r --filter './packages/*'`, so the workspace scripts above don't touch it. Run it with `pnpm --filter @trackbridge-examples/nextjs-demo dev` after copying `examples/nextjs-demo/.env.local.example` to `.env.local`.

## The dual-send invariant

The single most important rule in this codebase:

> Identical input to normalization + hashing must produce byte-identical output on browser and server.

If a phone number `+1 (555) 123-4567` hashes to one value in the browser and a different value on the server, Google can't dedupe and the SDK has silently failed.

How we keep this from breaking:

1. **All normalization lives in `@trackbridge/core`.** Browser and server import; they never inline their own normalization.
2. **Pinned golden hashes.** `packages/core/src/hash.test.ts` pins SHA-256 outputs for canonical inputs (`""`, `jane@example.com`, `café`, `+15551234567`). Same hashes are referenced by `packages/server/src/tracker.test.ts` and `packages/browser/src/tracker.test.ts` to verify the GA4-MP, gtag, and Ads-API adapters all hash the same bytes. Any change that alters a pinned hash is a breaking change requiring a major version bump.
3. **Cross-runtime CI matrix.** `.github/workflows/ci.yml` tests on Node 18.17 and Node 20. `hash.ts` has separate code paths for these (`globalThis.crypto.subtle` vs `node:crypto.webcrypto.subtle`); the matrix ensures both produce identical bytes.

## How we develop

We use **test-driven development** for `@trackbridge/core` and the tracker logic. Workflow:

1. **RED** — write the test first. Watch it fail (run `pnpm test` and confirm the failure is what you expected — typically a missing function or a wrong return value).
2. **GREEN** — write the minimal code to make the test pass. Don't generalize beyond what the test demands.
3. **REFACTOR** — clean up while keeping tests green.

For trackers (browser, server), prefer **fetch / I/O injection** over real network calls. Both `createServerTracker` and `createBrowserTracker` accept an `io` (or `fetch`) test seam in their config; tests use a stub that records calls and returns canned responses. No `nock`, no `msw`, no live HTTP in the test suite.

## Adding a new normalizer

1. **Add the function** to `packages/core/src/normalize/<field>.ts` — follow the shape of the existing ones (pure function, `string → string`).
2. **Write golden tests** in `packages/core/src/normalize/<field>.test.ts`. At minimum: 5 canonical inputs with pinned outputs, plus an idempotency test, plus an empty-input test.
3. **Add the field** to `UserData` in `packages/core/src/types.ts` if it's PII for enhanced conversions.
4. **Wire into the adapters** — `buildGa4UserData` (server `tracker.ts`), `buildGtagUserData` (browser `tracker.ts`), `buildAdsUserIdentifiers` (server `tracker.ts`). Each adapter has a different output shape, but they all consume `normalizeX` + `hashSha256` from core.
5. **Add pinned hashes** in `hash.test.ts` for the canonical normalized inputs, then reference them by name from the adapter tests. This is the cross-package golden-test pattern that catches the dual-send invariant breaking from any side.
6. **Verify locally** — `pnpm test && pnpm typecheck && pnpm build` all green.

## Unicode test gotcha

If a test needs to distinguish NFC and NFD forms of a Unicode string (e.g., composed `é` U+00E9 vs decomposed `e` + U+0301), **always use `\u` escape sequences** in the test source:

```ts
const composed = 'café';      // single code point
const decomposed = 'café';   // e + combining acute
```

Inline literals like `'café'` may get NFC-normalized by editors or write pipelines, silently making both "different" forms identical and turning your composed-vs-decomposed test into a tautology. The unicode tests in `email.test.ts`, `name.test.ts`, and `hash.test.ts` each include a sanity assertion (`expect(composed).not.toBe(decomposed)`) before testing the normalizer's behavior — keep that pattern when you add new ones.

## Code style

- **Strict TypeScript** with `noUncheckedIndexedAccess` and `verbatimModuleSyntax`. The compiler catches what matters; we don't run ESLint (see ADR-004).
- **Prettier** via `pnpm format`. Single quotes, trailing commas, 100-col print width.
- **No comments stating *what* code does** — well-named identifiers handle that. Comments should explain *why* — a hidden constraint, a workaround for a specific bug, behavior that would surprise a reader.
- **No abstractions beyond what the task requires.** Three similar lines is better than a premature helper.

## Versioning

We use [Changesets](https://github.com/changesets/changesets). When you make a change that should ship in a release:

```bash
pnpm changeset
```

Pick the affected packages, the bump type, and write a summary that will appear in the changelog. The release workflow handles publishing on merge to `main` — the action opens a "chore: version packages" PR on every push to `main` that has pending changesets; merging that PR triggers the actual `pnpm release` (build + `changeset publish` to npm).

The three packages are linked and always release at the same version. The Next.js demo (`@trackbridge-examples/nextjs-demo`) is `private: true` and never published.

## PR workflow

1. Branch off `main`. Name doesn't matter.
2. Make your change with tests. The CI gates above run on every push and pull request.
3. Run `pnpm changeset` if the change should ship in a release.
4. Open a PR against `main`.

CI runs `typecheck`, `test`, and `build` on Node 18.17 and Node 20. All must pass before merge.
