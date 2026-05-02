import { webcrypto } from 'node:crypto';
import { describe, expect, test } from 'vitest';

import { hashSha256 } from './hash.js';

// hash.ts picks between globalThis.crypto.subtle (browsers, Node 19+) and
// node:crypto.webcrypto.subtle (Node 18 fallback). The dual-send invariant
// only holds if every WebCrypto-compatible runtime hashes the same bytes to
// the same digest. This file exercises the SDK's pipeline against an
// independent path (node:crypto.webcrypto.subtle, used directly here) so any
// drift between the two is caught.
const PARITY_INPUTS = [
  '',
  'jane@example.com',
  'café', // NFC, single codepoint U+00E9
  '+15551234567',
  'i̇stanbul', // canonical lowercase of "İSTANBUL"; see locale tests
];

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

async function digestDirect(input: string): Promise<string> {
  const buffer = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return bytesToHex(new Uint8Array(buffer));
}

describe('hashSha256 runtime parity', () => {
  for (const input of PARITY_INPUTS) {
    test(`SDK output matches node:crypto.webcrypto.subtle for ${JSON.stringify(input)}`, async () => {
      expect(await hashSha256(input)).toBe(await digestDirect(input));
    });
  }

  // Belt-and-suspenders: also exercise the explicit node:crypto fallback path
  // by stubbing globalThis.crypto. If a future Node release ships a subtle
  // implementation that diverges from webcrypto.subtle (extremely unlikely,
  // but the whole point of pinning), this catches it.
  test('falls back to node:crypto when globalThis.crypto.subtle is absent, with identical output', async () => {
    const original = (globalThis as { crypto?: unknown }).crypto;
    try {
      Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
      const fallback = await hashSha256('jane@example.com');
      expect(fallback).toBe('8c87b489ce35cf2e2f39f80e282cb2e804932a56a213983eeeb428407d43b52d');
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true });
    }
  });
});
