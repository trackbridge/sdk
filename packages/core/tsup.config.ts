import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  treeshake: true,
  // Keep node:crypto out of the bundle so downstream browser bundlers
  // (Vite, webpack 5) don't warn about an unresolved node: specifier.
  // The runtime guard in hash.ts hits Web Crypto first, so this branch
  // only loads when there's no globalThis.crypto.subtle (Node 18 path).
  external: ['node:crypto'],
});
