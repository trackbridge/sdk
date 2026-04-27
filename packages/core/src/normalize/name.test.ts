import { describe, expect, test } from 'vitest';

import { normalizeName } from './name.js';

describe('normalizeName', () => {
  test('trims and lowercases a simple name', () => {
    expect(normalizeName('  Jane ')).toBe('jane');
  });

  test('is idempotent on an already-normalized name', () => {
    expect(normalizeName('jane')).toBe('jane');
  });

  test('lowercases an all-caps name', () => {
    expect(normalizeName('JANE')).toBe('jane');
  });

  test('strips tabs and newlines from the edges', () => {
    expect(normalizeName('\tJane\n')).toBe('jane');
  });

  test('preserves hyphens in compound names', () => {
    expect(normalizeName('Mary-Jane')).toBe('mary-jane');
  });

  test("preserves apostrophes in names like O'Brien", () => {
    expect(normalizeName("O'Brien")).toBe("o'brien");
  });

  test('preserves internal spaces in multi-part names', () => {
    expect(normalizeName('Van Der Berg')).toBe('van der berg');
  });

  test('returns an empty string for empty input', () => {
    expect(normalizeName('')).toBe('');
  });

  test('returns an empty string for whitespace-only input', () => {
    expect(normalizeName('   \t\n')).toBe('');
  });

  // Diacritics are letters and Google's enhanced conversions spec only asks
  // for trim + lowercase. Stripping them would be data loss and would still
  // need to match across browser/server — keeping NFC-composed letters is
  // both correct and the lower-risk dual-send choice. Use \u escapes so the
  // composed/decomposed forms are unambiguous regardless of editor settings.
  describe('unicode NFC normalization', () => {
    const composed = 'José'; // é as single code point (U+00E9)
    const decomposed = 'José'; // e + combining acute (U+0065 U+0301)

    test('the test inputs really are different strings before normalization', () => {
      expect(composed).not.toBe(decomposed);
    });

    test('preserves diacritics in lowercase form', () => {
      expect(normalizeName('José')).toBe('josé');
    });

    test('produces the same output for composed and decomposed forms', () => {
      expect(normalizeName(composed)).toBe(normalizeName(decomposed));
    });

    test('outputs the NFC (composed) form', () => {
      expect(normalizeName(decomposed)).toBe('josé');
    });

    test('outputs are byte-identical when UTF-8 encoded', () => {
      const encoder = new TextEncoder();
      const a = encoder.encode(normalizeName(composed));
      const b = encoder.encode(normalizeName(decomposed));
      expect(Array.from(a)).toEqual(Array.from(b));
    });
  });
});
