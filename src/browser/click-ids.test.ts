import { describe, expect, test } from 'vitest';

import {
  buildClickIdentifierCookieStrings,
  parseClickIdentifiersFromCookies,
  parseClickIdentifiersFromUrl,
} from './click-ids.js';

describe('parseClickIdentifiersFromUrl', () => {
  test('returns nothing for an empty search string', () => {
    expect(parseClickIdentifiersFromUrl('')).toEqual({});
  });

  test('extracts gclid', () => {
    expect(parseClickIdentifiersFromUrl('?gclid=abc123')).toEqual({ gclid: 'abc123' });
  });

  test('extracts gbraid', () => {
    expect(parseClickIdentifiersFromUrl('?gbraid=abc123')).toEqual({ gbraid: 'abc123' });
  });

  test('extracts wbraid', () => {
    expect(parseClickIdentifiersFromUrl('?wbraid=abc123')).toEqual({ wbraid: 'abc123' });
  });

  test('extracts all three when present', () => {
    expect(parseClickIdentifiersFromUrl('?gclid=a&gbraid=b&wbraid=c')).toEqual({
      gclid: 'a',
      gbraid: 'b',
      wbraid: 'c',
    });
  });

  test('ignores unrelated query params', () => {
    expect(parseClickIdentifiersFromUrl('?utm_source=google&gclid=abc&utm_campaign=spring')).toEqual({
      gclid: 'abc',
    });
  });

  test('decodes URL-encoded values', () => {
    expect(parseClickIdentifiersFromUrl('?gclid=abc%20def')).toEqual({ gclid: 'abc def' });
  });

  test('treats empty values as missing', () => {
    expect(parseClickIdentifiersFromUrl('?gclid=&gbraid=xyz')).toEqual({ gbraid: 'xyz' });
  });

  test('accepts a search string without a leading question mark', () => {
    expect(parseClickIdentifiersFromUrl('gclid=abc')).toEqual({ gclid: 'abc' });
  });
});

describe('parseClickIdentifiersFromCookies', () => {
  test('returns nothing for an empty cookie header', () => {
    expect(parseClickIdentifiersFromCookies('')).toEqual({});
  });

  test('extracts _tb_gclid', () => {
    expect(parseClickIdentifiersFromCookies('_tb_gclid=abc123')).toEqual({ gclid: 'abc123' });
  });

  test('extracts _tb_gbraid', () => {
    expect(parseClickIdentifiersFromCookies('_tb_gbraid=abc123')).toEqual({ gbraid: 'abc123' });
  });

  test('extracts _tb_wbraid', () => {
    expect(parseClickIdentifiersFromCookies('_tb_wbraid=abc123')).toEqual({ wbraid: 'abc123' });
  });

  test('extracts multiple click-id cookies in one header', () => {
    expect(parseClickIdentifiersFromCookies('_tb_gclid=a; _tb_gbraid=b')).toEqual({
      gclid: 'a',
      gbraid: 'b',
    });
  });

  test('ignores unrelated cookies', () => {
    expect(parseClickIdentifiersFromCookies('_ga=GA1.2.x; _tb_gclid=abc; foo=bar')).toEqual({
      gclid: 'abc',
    });
  });

  test('decodes URL-encoded cookie values', () => {
    expect(parseClickIdentifiersFromCookies('_tb_gclid=abc%20def')).toEqual({ gclid: 'abc def' });
  });

  test('tolerates whitespace between cookie pairs', () => {
    expect(parseClickIdentifiersFromCookies('_tb_gclid=a;_tb_gbraid=b ;  _tb_wbraid=c')).toEqual({
      gclid: 'a',
      gbraid: 'b',
      wbraid: 'c',
    });
  });

  test('treats empty values as missing', () => {
    expect(parseClickIdentifiersFromCookies('_tb_gclid=; _tb_gbraid=xyz')).toEqual({
      gbraid: 'xyz',
    });
  });

  test('skips malformed percent-encoded values without throwing', () => {
    // A third-party tool wrote a bogus value to the same cookie name.
    // Tracker init must not crash; the offending entry is dropped.
    expect(parseClickIdentifiersFromCookies('_tb_gclid=%ZZ; _tb_gbraid=ok')).toEqual({
      gbraid: 'ok',
    });
  });
});

describe('buildClickIdentifierCookieStrings', () => {
  const FIXED_NOW = new Date('2026-04-25T00:00:00Z');

  test('returns no cookies when no click identifiers are supplied', () => {
    expect(
      buildClickIdentifierCookieStrings({}, { expiryDays: 90, now: FIXED_NOW }),
    ).toEqual([]);
  });

  test('produces a single canonical cookie string for gclid', () => {
    expect(
      buildClickIdentifierCookieStrings({ gclid: 'abc' }, { expiryDays: 90, now: FIXED_NOW }),
    ).toEqual([
      '_tb_gclid=abc; Expires=Fri, 24 Jul 2026 00:00:00 GMT; Path=/; Secure; SameSite=Lax',
    ]);
  });

  test('produces one cookie per identifier in stable gclid → gbraid → wbraid order', () => {
    const result = buildClickIdentifierCookieStrings(
      { wbraid: 'w', gclid: 'g', gbraid: 'b' },
      { expiryDays: 90, now: FIXED_NOW },
    );
    expect(result.map((s) => s.split('=')[0])).toEqual(['_tb_gclid', '_tb_gbraid', '_tb_wbraid']);
  });

  test('includes a Domain attribute when configured', () => {
    const [cookie] = buildClickIdentifierCookieStrings(
      { gclid: 'abc' },
      { expiryDays: 90, now: FIXED_NOW, domain: '.example.com' },
    );
    expect(cookie).toContain('; Domain=.example.com');
  });

  test('omits Domain attribute when not configured', () => {
    const [cookie] = buildClickIdentifierCookieStrings(
      { gclid: 'abc' },
      { expiryDays: 90, now: FIXED_NOW },
    );
    expect(cookie).not.toContain('Domain');
  });

  test('respects a custom expiryDays', () => {
    const [cookie] = buildClickIdentifierCookieStrings(
      { gclid: 'abc' },
      { expiryDays: 1, now: FIXED_NOW },
    );
    expect(cookie).toContain('Expires=Sun, 26 Apr 2026 00:00:00 GMT');
  });

  test('URL-encodes values that would otherwise break the cookie string', () => {
    const [cookie] = buildClickIdentifierCookieStrings(
      { gclid: 'a;b c' },
      { expiryDays: 90, now: FIXED_NOW },
    );
    expect(cookie?.split(';')[0]).toBe('_tb_gclid=a%3Bb%20c');
  });

  test('round-trips through the cookie parser', () => {
    const ids = { gclid: 'abc', gbraid: 'xyz' };
    const cookies = buildClickIdentifierCookieStrings(ids, { expiryDays: 90, now: FIXED_NOW });
    // Concatenate name=value pairs the way a browser would echo them in document.cookie
    const cookieHeader = cookies.map((c) => c.split(';')[0]!).join('; ');
    expect(parseClickIdentifiersFromCookies(cookieHeader)).toEqual(ids);
  });
});
