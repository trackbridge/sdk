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
    const composed = 'Jos\u00e9'; // é as single code point (U+00E9)
    const decomposed = 'Jose\u0301'; // e + combining acute (U+0065 U+0301)

    test('the test inputs really are different strings before normalization', () => {
      expect(composed).not.toBe(decomposed);
    });

    test('preserves diacritics in lowercase form', () => {
      expect(normalizeName('Jos\u00e9')).toBe('jos\u00e9');
    });

    test('produces the same output for composed and decomposed forms', () => {
      expect(normalizeName(composed)).toBe(normalizeName(decomposed));
    });

    test('outputs the NFC (composed) form', () => {
      expect(normalizeName(decomposed)).toBe('jos\u00e9');
    });

    test('outputs are byte-identical when UTF-8 encoded', () => {
      const encoder = new TextEncoder();
      const a = encoder.encode(normalizeName(composed));
      const b = encoder.encode(normalizeName(decomposed));
      expect(Array.from(a)).toEqual(Array.from(b));
    });
  });

  // Locale-aware lowercasing is the canonical dual-send footgun: in a Turkish
  // locale, `'I'.toLocaleLowerCase('tr')` is `'ı'` (dotless) and
  // `'İ'.toLocaleLowerCase('tr')` is `'i'`. The normalizer must use the
  // locale-INDEPENDENT `.toLowerCase()` so browser-vs-server (and any future
  // server runtime) never diverge on names like AYDIN or İSTANBUL.
  describe('locale-independent lowercasing', () => {
    test('lowercases ASCII "I" to "i", not Turkish dotless "ı"', () => {
      expect(normalizeName('AYDIN')).toBe('aydin');
    });

    test('lowercases Turkish "İ" via Unicode default (i + combining dot above)', () => {
      // String.prototype.toLowerCase is required to be locale-independent;
      // U+0130 maps to U+0069 U+0307 under that mapping. Pinning the exact
      // codepoint sequence catches any future swap to .toLocaleLowerCase().
      expect(normalizeName('\u0130STANBUL')).toBe('i\u0307stanbul');
    });
  });
});
