# @trackbridge/core

Shared types, normalization, and SHA-256 hashing for the Trackbridge SDK.

You probably don't import this package directly — `@trackbridge/browser` and `@trackbridge/server` re-export everything you need. It's published as a peer so the dual-send invariant holds: the same input is normalized + hashed identically on both sides, byte-for-byte.

## Install

```bash
pnpm add @trackbridge/core
```

## What's in here

- **Normalizers** — `normalizeEmail`, `normalizePhone`, `normalizeName`, `normalizeAddress`. Pure, locale-independent string transforms that match Google's enhanced-conversions spec.
- **Hashing** — `hashSha256` returns lowercase hex; uses Web Crypto in browsers and Node 19+, falls back to `node:crypto` on Node 18.
- **`hashUserData`** — orchestrator that normalizes + hashes a `UserData` object end-to-end. Empty fields are dropped.
- **Types** — `UserData`, `HashedUserData`, `Address`, `HashedAddress`.

## Why it's its own package

The dual-send pattern only works if the browser and server produce the same hashes for the same input. Putting the normalization + hashing in a single shared package — with golden tests pinning the output of canonical inputs across all three packages — makes hash drift a build-time failure instead of a silent dedup miss in production.

See [the project README](https://github.com/trackbridge/sdk#readme) for the full SDK story.

## License

MIT
