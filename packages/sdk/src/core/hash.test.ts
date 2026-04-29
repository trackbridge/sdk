import { describe, expect, test } from 'vitest';

import { hashSha256 } from './hash.js';

// These pinned outputs are the dual-send invariant: if any of them ever
// change, every existing user's hashed PII diverges from what they sent
// before. That is a MAJOR version bump, not a patch.
//   See: docs/dual-send-invariant.md
describe('hashSha256', () => {
  test('hashes the empty string to the canonical SHA-256', async () => {
    expect(await hashSha256('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  test('pins the hash of jane@example.com', async () => {
    expect(await hashSha256('jane@example.com')).toBe(
      '8c87b489ce35cf2e2f39f80e282cb2e804932a56a213983eeeb428407d43b52d',
    );
  });

  test('pins the hash of a multi-byte UTF-8 string (café in NFC)', async () => {
    expect(await hashSha256('caf\u00e9')).toBe(
      '850f7dc43910ff890f8879c0ed26fe697c93a067ad93a7d50f466a7028a9bf4e',
    );
  });

  test('pins the hash of an E.164 phone number', async () => {
    expect(await hashSha256('+15551234567')).toBe(
      '8a59780bb8cd2ba022bfa5ba2ea3b6e07af17a7d8b30c1f9b3390e36f69019e4',
    );
  });

  test('is deterministic — same input twice produces the same hash', async () => {
    const a = await hashSha256('jane@example.com');
    const b = await hashSha256('jane@example.com');
    expect(a).toBe(b);
  });

  test('produces different hashes for different inputs', async () => {
    const a = await hashSha256('jane@example.com');
    const b = await hashSha256('john@example.com');
    expect(a).not.toBe(b);
  });

  test('returns 64 lowercase hex characters', async () => {
    const hash = await hashSha256('hello world');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  // The whole point of UTF-8 encoding inside the hasher is so that callers
  // do not have to think about it — and so that browser and server cannot
  // diverge on encoding. Composed (NFC) and decomposed (NFD) inputs are
  // *not* the same string, and they do not hash to the same value. Any
  // string that crosses runtimes must be NFC-normalized first. Use \u
  // escapes so the codepoints are unambiguous regardless of editor settings.
  test('hashes NFC and NFD forms differently (encoding is not the normalizer)', async () => {
    const composed = 'caf\u00e9'; // U+00E9
    const decomposed = 'cafe\u0301'; // e + U+0301
    expect(composed).not.toBe(decomposed);
    expect(await hashSha256(composed)).not.toBe(await hashSha256(decomposed));
  });
});
