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
  {
    // /next — React-side. bundle: false transforms each source file
    // individually so 'use client' directives at the top of context.tsx
    // and page-views.tsx survive into the output. Cross-file imports
    // become relative imports between output files.
    entry: [
      'src/next/index.ts',
      'src/next/provider.tsx',
      'src/next/context.tsx',
      'src/next/page-views.tsx',
    ],
    tsconfig: 'src/next/tsconfig.json',
    outDir: 'dist/next',
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: false,
    target: 'es2022',
    platform: 'browser',
    bundle: false,
    external: ['react', 'react-dom', 'next', 'next/script', 'next/navigation', 'node:crypto'],
  },
  {
    // /next/server — Node-side. Standard bundling.
    entry: { 'server/index': 'src/next/server/index.ts' },
    tsconfig: 'src/next/server/tsconfig.json',
    outDir: 'dist/next',
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: false,
    target: 'node18',
    platform: 'node',
    treeshake: true,
    external: ['next', 'next/headers', 'node:crypto'],
  },
]);
