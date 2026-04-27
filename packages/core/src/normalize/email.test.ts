import { describe, expect, test } from 'vitest';

import { normalizeEmail } from './email.js';

describe('normalizeEmail', () => {
  test('lowercases and trims the canonical input', () => {
    expect(normalizeEmail('  Jane@Example.COM ')).toBe('jane@example.com');
  });

  test('is idempotent on already-normalized input', () => {
    expect(normalizeEmail('jane@example.com')).toBe('jane@example.com');
  });

  test('lowercases without trimming when no surrounding whitespace', () => {
    expect(normalizeEmail('JANE@EXAMPLE.COM')).toBe('jane@example.com');
  });

  test('strips tabs, newlines, and carriage returns from the edges', () => {
    expect(normalizeEmail('\t\njane@example.com\r\n')).toBe('jane@example.com');
  });

  test('preserves dots and plus-addressing in the local part', () => {
    expect(normalizeEmail('Jane.Doe+promo@example.com')).toBe('jane.doe+promo@example.com');
  });

  test('returns an empty string for empty input', () => {
    expect(normalizeEmail('')).toBe('');
  });

  test('returns an empty string for whitespace-only input', () => {
    expect(normalizeEmail('   \t\n')).toBe('');
  });

  // Unicode NFC normalization is the dual-send-invariant case: the composed
  // (U+00E9) and decomposed (e + U+0301) forms of café must produce the
  // *same string*, or browser-vs-server hashes diverge silently.
  describe('unicode NFC normalization', () => {
    const composed = 'café@example.com'; // é as single code point
    const decomposed = 'café@example.com'; // e + combining acute

    test('the test inputs really are different strings before normalization', () => {
      expect(composed).not.toBe(decomposed);
    });

    test('produces the same output for composed and decomposed forms', () => {
      expect(normalizeEmail(composed)).toBe(normalizeEmail(decomposed));
    });

    test('outputs the NFC (composed) form', () => {
      expect(normalizeEmail(decomposed)).toBe('café@example.com');
    });

    test('outputs are byte-identical when UTF-8 encoded', () => {
      const encoder = new TextEncoder();
      const a = encoder.encode(normalizeEmail(composed));
      const b = encoder.encode(normalizeEmail(decomposed));
      expect(Array.from(a)).toEqual(Array.from(b));
    });
  });
});
