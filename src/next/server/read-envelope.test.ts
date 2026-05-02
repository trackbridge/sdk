import { describe, expect, test } from 'vitest';

import { createServerTracker } from '../../server/index.js';
import { readEnvelopeFromRequest } from './read-envelope.js';

// Minimal stand-ins for Next's ReadonlyHeaders / ReadonlyRequestCookies.
function makeHeaders(entries: Record<string, string>): Headers {
  const h = new Headers();
  for (const [k, v] of Object.entries(entries)) h.set(k, v);
  return h;
}

type CookieMap = { get(name: string): { value: string } | undefined };
function makeCookies(entries: Record<string, string>): CookieMap {
  return {
    get(name: string) {
      const value = entries[name];
      return value !== undefined ? { value } : undefined;
    },
  };
}

describe('readEnvelopeFromRequest', () => {
  test('returns null when neither cookies nor headers carry usable data', () => {
    const env = readEnvelopeFromRequest({
      headers: makeHeaders({}),
      cookies: makeCookies({}),
    });
    expect(env).toBeNull();
  });

  test('reads click identifiers from _tb_* cookies', () => {
    const env = readEnvelopeFromRequest({
      headers: makeHeaders({}),
      cookies: makeCookies({
        _tb_gclid: 'gcl-abc',
        _tb_gbraid: 'gbr-xyz',
        _tb_wbraid: 'wbr-123',
      }),
    });
    expect(env).not.toBeNull();
    expect(env!.clickIds).toEqual({
      gclid: 'gcl-abc',
      gbraid: 'gbr-xyz',
      wbraid: 'wbr-123',
    });
  });

  test('parses clientId from the GA4 _ga cookie (GA1.{n}.{clientId} format)', () => {
    const env = readEnvelopeFromRequest({
      headers: makeHeaders({}),
      cookies: makeCookies({ _ga: 'GA1.2.123456789.987654321' }),
    });
    expect(env).not.toBeNull();
    expect(env!.clientId).toBe('123456789.987654321');
  });

  test('returns null when _ga cookie is malformed', () => {
    const env = readEnvelopeFromRequest({
      headers: makeHeaders({}),
      cookies: makeCookies({ _ga: 'not-a-real-ga-cookie' }),
    });
    expect(env).toBeNull();
  });

  test('uses x-trackbridge-context header when present, parsed as JSON', () => {
    const headerPayload = {
      v: 1,
      clientId: 'header-client',
      sessionId: 'sess-1',
      createdAt: 1700000000000,
    };
    const env = readEnvelopeFromRequest({
      headers: makeHeaders({ 'x-trackbridge-context': JSON.stringify(headerPayload) }),
      cookies: makeCookies({}),
    });
    expect(env).not.toBeNull();
    expect(env!.clientId).toBe('header-client');
    expect(env!.sessionId).toBe('sess-1');
  });

  test('header overrides cookie values per field — cookie keeps fields header omits', () => {
    const headerPayload = { clientId: 'header-client' };
    const env = readEnvelopeFromRequest({
      headers: makeHeaders({ 'x-trackbridge-context': JSON.stringify(headerPayload) }),
      cookies: makeCookies({
        _ga: 'GA1.2.cookie.client',
        _tb_gclid: 'gcl-from-cookie',
      }),
    });
    expect(env).not.toBeNull();
    expect(env!.clientId).toBe('header-client');
    expect(env!.clickIds?.gclid).toBe('gcl-from-cookie');
  });

  test('malformed JSON in x-trackbridge-context is silently treated as absent', () => {
    const env = readEnvelopeFromRequest({
      headers: makeHeaders({ 'x-trackbridge-context': '{not valid json' }),
      cookies: makeCookies({ _tb_gclid: 'gcl-abc' }),
    });
    expect(env).not.toBeNull();
    expect(env!.clickIds?.gclid).toBe('gcl-abc');
  });

  test('cookie-only envelope has required clickIds and consent fields populated', () => {
    const env = readEnvelopeFromRequest({
      headers: makeHeaders({}),
      cookies: makeCookies({ _ga: 'GA1.2.111.222' }),
    });
    expect(env).not.toBeNull();
    expect(env!.clickIds).toBeDefined();
    expect(env!.consent).toBeDefined();
    expect(env!.consent).toEqual({
      ad_storage: 'unknown',
      ad_user_data: 'unknown',
      ad_personalization: 'unknown',
      analytics_storage: 'unknown',
    });
  });

  test('header-only envelope without clickIds/consent gets defaults synthesized', () => {
    const env = readEnvelopeFromRequest({
      headers: makeHeaders({
        'x-trackbridge-context': JSON.stringify({ v: 1, clientId: 'c', createdAt: 1 }),
      }),
      cookies: makeCookies({}),
    });
    expect(env).not.toBeNull();
    expect(env!.clickIds).toEqual({});
    expect(env!.consent).toEqual({
      ad_storage: 'unknown',
      ad_user_data: 'unknown',
      ad_personalization: 'unknown',
      analytics_storage: 'unknown',
    });
  });

  test('produces an envelope that serverTracker.fromContext() accepts', () => {
    // Smoke test: the helper's output must round-trip through fromContext
    // without throwing. This was the actual bug — required fields missing.
    const tracker = createServerTracker({
      ga4MeasurementId: 'G-TEST',
      ga4ApiSecret: 'secret',
    });

    const env = readEnvelopeFromRequest({
      headers: makeHeaders({}),
      cookies: makeCookies({ _ga: 'GA1.2.111.222', _tb_gclid: 'g-1' }),
    });
    expect(env).not.toBeNull();
    // fromContext throws if required fields are missing — this would have
    // caught the original bug.
    expect(() => tracker.fromContext(env!)).not.toThrow();
  });
});
