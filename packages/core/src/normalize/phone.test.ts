import { describe, expect, test } from 'vitest';

import { normalizePhone } from './phone.js';

describe('normalizePhone', () => {
  test('strips formatting and preserves the leading plus', () => {
    expect(normalizePhone('+1 (555) 123-4567')).toBe('+15551234567');
  });

  test('is idempotent on an already-E.164 number', () => {
    expect(normalizePhone('+15551234567')).toBe('+15551234567');
  });

  test('handles international formatting', () => {
    expect(normalizePhone('+44 20 7946 0958')).toBe('+442079460958');
  });

  test('strips tabs and newlines from the edges', () => {
    expect(normalizePhone('\t+1 555-1234567\n')).toBe('+15551234567');
  });

  test('handles dot separators', () => {
    expect(normalizePhone('+1.555.123.4567')).toBe('+15551234567');
  });

  // The SDK does not infer a country code. If the user passes digits without
  // a leading +, we keep digits and let the downstream API surface the issue
  // — silent country-code guessing would be a correctness footgun.
  test('does not add a plus when the input has none', () => {
    expect(normalizePhone('15551234567')).toBe('15551234567');
  });

  test('returns empty string for empty input', () => {
    expect(normalizePhone('')).toBe('');
  });

  test('returns empty string for whitespace-only input', () => {
    expect(normalizePhone('   \t\n')).toBe('');
  });

  test('drops letters and other punctuation', () => {
    expect(normalizePhone('+1-555-CALL-NOW')).toBe('+1555');
  });

  test('collapses leading double plus to a single plus', () => {
    expect(normalizePhone('++15551234567')).toBe('+15551234567');
  });
});
