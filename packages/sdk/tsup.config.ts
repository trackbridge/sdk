import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { 'browser/index': 'src/browser/index.ts' },
    tsconfig: 'src/browser/tsconfig.json',
    outDir: 'dist',
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'es2022',
    platform: 'browser',
    treeshake: true,
    // The Node 18 fallback in core/hash.ts dynamic-imports node:crypto.
    // Browsers always have global Web Crypto so the branch is dead at
    // runtime; externalizing keeps Vite/webpack quiet.
    external: ['node:crypto'],
  },
  {
    entry: { 'server/index': 'src/server/index.ts' },
    tsconfig: 'src/server/tsconfig.json',
    outDir: 'dist',
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    // First entry cleans dist/; do not flip without re-pairing.
    clean: false,
    target: 'node18',
    platform: 'node',
    treeshake: true,
    external: ['node:crypto'],
  },
]);
