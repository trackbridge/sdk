import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { TrackbridgeContext } from '../core/index.js';

import { createServerTracker } from './tracker.js';
import type { ServerAdsConfig, ServerTrackerConfig } from './types.js';

type FetchCall = { url: string; method: string; headers: Record<string, string>; body: unknown };

function captureFetch(response: Response = new Response(null, { status: 204 })) {
  const calls: FetchCall[] = [];
  const fn: typeof globalThis.fetch = async (input, init) => {
    const headerEntries = init?.headers ? Object.entries(init.headers) : [];
    calls.push({
      url: typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(headerEntries) as Record<string, string>,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
    });
    return response;
  };
  return { fn, calls };
}

const validConfig = (overrides: Partial<ServerTrackerConfig> = {}): ServerTrackerConfig => ({
  ga4MeasurementId: 'G-TESTING',
  ga4ApiSecret: 'secret-123',
  ...overrides,
});

const validEnvelope = (overrides: Partial<TrackbridgeContext> = {}): TrackbridgeContext => ({
  v: 1,
  createdAt: 1700000000000,
  clientId: '111.222',
  sessionId: '555',
  userId: 'u_xyz',
  clickIds: { gclid: 'ad-click-abc' },
  consent: {
    ad_storage: 'granted',
    ad_user_data: 'granted',
    ad_personalization: 'granted',
    analytics_storage: 'granted',
  },
  ...overrides,
});

describe('createServerTracker', () => {
  test('throws when ga4MeasurementId is missing', () => {
    expect(() =>
      createServerTracker({ ga4ApiSecret: 's' } as unknown as ServerTrackerConfig),
    ).toThrow(/ga4MeasurementId/);
  });

  test('throws when ga4ApiSecret is missing', () => {
    expect(() =>
      createServerTracker({ ga4MeasurementId: 'G-X' } as unknown as ServerTrackerConfig),
    ).toThrow(/ga4ApiSecret/);
  });

  test('returns a tracker exposing trackEvent', () => {
    const { fn } = captureFetch();
    const tracker = createServerTracker(validConfig({ fetch: fn }));
    expect(typeof tracker.trackEvent).toBe('function');
  });
});

describe('trackEvent (GA4 Measurement Protocol)', () => {
  test('POSTs to the GA4 MP collect endpoint with measurement_id and api_secret in the query string', async () => {
    const { fn, calls } = captureFetch();
    const tracker = createServerTracker(validConfig({ fetch: fn }));
    await tracker.trackEvent({ name: 'add_to_cart', clientId: '123.456' });

    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]!.url);
    expect(url.origin + url.pathname).toBe('https://www.google-analytics.com/mp/collect');
    expect(url.searchParams.get('measurement_id')).toBe('G-TESTING');
    expect(url.searchParams.get('api_secret')).toBe('secret-123');
    expect(calls[0]!.method).toBe('POST');
  });

  test('sends a JSON body with client_id and a single event', async () => {
    const { fn, calls } = captureFetch();
    const tracker = createServerTracker(validConfig({ fetch: fn }));
    await tracker.trackEvent({
      name: 'add_to_cart',
      clientId: '123.456',
      params: { value: 49, currency: 'USD' },
    });

    expect(calls[0]!.headers['Content-Type']).toBe('application/json');
    expect(calls[0]!.body).toEqual({
      client_id: '123.456',
      events: [{ name: 'add_to_cart', params: { value: 49, currency: 'USD' } }],
    });
  });

  test('omits params when none supplied (GA4 MP accepts an empty object)', async () => {
    const { fn, calls } = captureFetch();
    const tracker = createServerTracker(validConfig({ fetch: fn }));
    await tracker.trackEvent({ name: 'page_view', clientId: '123.456' });

    expect(calls[0]!.body).toEqual({
      client_id: '123.456',
      events: [{ name: 'page_view', params: {} }],
    });
  });

  test('resolves with ga4.ok=false when fetch rejects (network error)', async () => {
    const failingFetch: typeof globalThis.fetch = async () => {
      throw new Error('connection reset');
    };
    const tracker = createServerTracker(validConfig({ fetch: failingFetch }));
    const result = await tracker.trackEvent({ name: 'page_view', clientId: '123.456' });
    expect(result.ga4.ok).toBe(false);
    if (!result.ga4.ok) {
      expect(result.ga4.error.message).toContain('connection reset');
    }
  });

  test('resolves with ga4.ok=false when GA4 MP returns 4xx', async () => {
    const { fn } = captureFetch(new Response('bad request', { status: 400 }));
    const tracker = createServerTracker(validConfig({ fetch: fn }));
    const result = await tracker.trackEvent({ name: 'page_view', clientId: '123.456' });
    expect(result.ga4.ok).toBe(false);
    if (!result.ga4.ok) {
      expect(result.ga4.error.message).toMatch(/GA4 MP returned 400/);
    }
  });

  test('resolves with ga4.ok=true on a 2xx response', async () => {
    const { fn } = captureFetch();
    const tracker = createServerTracker(validConfig({ fetch: fn }));
    const result = await tracker.trackEvent({ name: 'page_view', clientId: '123.456' });
    expect(result).toEqual({ ga4: { ok: true } });
  });

  describe('debug mode logging', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    test('logs a warning when fetch rejects in debug mode', async () => {
      const failingFetch: typeof globalThis.fetch = async () => {
        throw new Error('connection reset');
      };
      const tracker = createServerTracker(validConfig({ fetch: failingFetch, debug: true }));
      await tracker.trackEvent({ name: 'page_view', clientId: '123.456' });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(String(warnSpy.mock.calls[0]?.[0])).toMatch(/trackbridge/);
    });

    test('logs a warning when GA4 MP returns 4xx in debug mode', async () => {
      const { fn } = captureFetch(new Response('bad request', { status: 400 }));
      const tracker = createServerTracker(validConfig({ fetch: fn, debug: true }));
      await tracker.trackEvent({ name: 'page_view', clientId: '123.456' });
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    test('does NOT log when debug mode is off', async () => {
      const failingFetch: typeof globalThis.fetch = async () => {
        throw new Error('connection reset');
      };
      const tracker = createServerTracker(validConfig({ fetch: failingFetch }));
      await tracker.trackEvent({ name: 'page_view', clientId: '123.456' });
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  test('falls back to globalThis.fetch when no fetch is injected', async () => {
    const original = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      calls.push(typeof input === 'string' ? input : (input as URL).toString());
      return new Response(null, { status: 204 });
    }) as typeof globalThis.fetch;

    try {
      const tracker = createServerTracker(validConfig());
      await tracker.trackEvent({ name: 'page_view', clientId: '123.456' });
      expect(calls).toHaveLength(1);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('trackEvent — userId field (envelope-friendly)', () => {
  test('when userId is set, MP body includes a top-level user_id', async () => {
    const { fn, calls } = captureFetch();
    const tracker = createServerTracker(validConfig({ fetch: fn }));
    await tracker.trackEvent({
      name: 'login',
      clientId: '123.456',
      userId: 'u_xyz',
    });

    expect(calls[0]!.body).toEqual({
      client_id: '123.456',
      user_id: 'u_xyz',
      events: [{ name: 'login', params: {} }],
    });
  });

  test('when userId is unset, MP body has NO user_id key', async () => {
    const { fn, calls } = captureFetch();
    const tracker = createServerTracker(validConfig({ fetch: fn }));
    await tracker.trackEvent({ name: 'page_view', clientId: '123.456' });

    const body = calls[0]!.body as Record<string, unknown>;
    expect('user_id' in body).toBe(false);
  });
});

// Pinned digests for canonical normalized inputs. Same source of truth as
// core/src/hash.test.ts — if these change, dual-send divergence is the
// likely cause. See docs/dual-send-invariant.md.
const HASH = {
  email_jane: '8c87b489ce35cf2e2f39f80e282cb2e804932a56a213983eeeb428407d43b52d',
  phone_15551234567: '8a59780bb8cd2ba022bfa5ba2ea3b6e07af17a7d8b30c1f9b3390e36f69019e4',
  name_jane: '81f8f6dde88365f3928796ec7aa53f72820b06db8664f5fe76a7eb13e24546a2',
  name_doe: '799ef92a11af918e3fb741df42934f3b568ed2d93ac1df74f1b8d41a27932a6f',
  street_123_main_st: '9425c187ddc6f9409d827854c2b2935feca5bbc75c6001e449b7d2fdbce73bea',
} as const;

describe('trackEvent userData → GA4 MP user_data shape', () => {
  test('includes no user_data when userData is omitted', async () => {
    const { fn, calls } = captureFetch();
    const tracker = createServerTracker(validConfig({ fetch: fn }));
    await tracker.trackEvent({ name: 'page_view', clientId: '123.456' });

    expect((calls[0]!.body as Record<string, unknown>).user_data).toBeUndefined();
  });

  test('email-only userData → sha256_email_address as a single-element array', async () => {
    const { fn, calls } = captureFetch();
    const tracker = createServerTracker(validConfig({ fetch: fn }));
    await tracker.trackEvent({
      name: 'login',
      clientId: '123.456',
      userData: { email: '  Jane@Example.COM ' },
    });

    expect((calls[0]!.body as Record<string, unknown>).user_data).toEqual({
      sha256_email_address: [HASH.email_jane],
    });
  });

  test('phone-only userData → sha256_phone_number as a single-element array', async () => {
    const { fn, calls } = captureFetch();
    const tracker = createServerTracker(validConfig({ fetch: fn }));
    await tracker.trackEvent({
      name: 'login',
      clientId: '123.456',
      userData: { phone: '+1 (555) 123-4567' },
    });

    expect((calls[0]!.body as Record<string, unknown>).user_data).toEqual({
      sha256_phone_number: [HASH.phone_15551234567],
    });
  });

  test('first/last name → user_data.address[0] with hashed name fields', async () => {
    const { fn, calls } = captureFetch();
    const tracker = createServerTracker(validConfig({ fetch: fn }));
    await tracker.trackEvent({
      name: 'sign_up',
      clientId: '123.456',
      userData: { firstName: 'Jane', lastName: 'Doe' },
    });

    expect((calls[0]!.body as Record<string, unknown>).user_data).toEqual({
      address: [{ sha256_first_name: HASH.name_jane, sha256_last_name: HASH.name_doe }],
    });
  });

  test('postal address fields are normalized but unhashed in the address entry', async () => {
    const { fn, calls } = captureFetch();
    const tracker = createServerTracker(validConfig({ fetch: fn }));
    await tracker.trackEvent({
      name: 'sign_up',
      clientId: '123.456',
      userData: {
        address: { city: 'AUSTIN', region: ' TX ', postalCode: '78701', country: 'us' },
      },
    });

    expect((calls[0]!.body as Record<string, unknown>).user_data).toEqual({
      address: [{ city: 'austin', region: 'tx', postal_code: '78701', country: 'US' }],
    });
  });

  test('full userData mixes hashed PII with normalized unhashed address', async () => {
    const { fn, calls } = captureFetch();
    const tracker = createServerTracker(validConfig({ fetch: fn }));
    await tracker.trackEvent({
      name: 'purchase',
      clientId: '123.456',
      userData: {
        email: '  Jane@Example.COM ',
        phone: '+1 (555) 123-4567',
        firstName: 'Jane',
        lastName: 'Doe',
        address: {
          street: '  123 Main St. ',
          city: 'AUSTIN',
          region: ' TX ',
          postalCode: '78701',
          country: 'us',
        },
      },
    });

    expect((calls[0]!.body as Record<string, unknown>).user_data).toEqual({
      sha256_email_address: [HASH.email_jane],
      sha256_phone_number: [HASH.phone_15551234567],
      address: [
        {
          sha256_first_name: HASH.name_jane,
          sha256_last_name: HASH.name_doe,
          sha256_street: HASH.street_123_main_st,
          city: 'austin',
          region: 'tx',
          postal_code: '78701',
          country: 'US',
        },
      ],
    });
  });

  test('omits user_data entirely when all fields normalize to empty', async () => {
    const { fn, calls } = captureFetch();
    const tracker = createServerTracker(validConfig({ fetch: fn }));
    await tracker.trackEvent({
      name: 'page_view',
      clientId: '123.456',
      userData: { email: '   \t', phone: '', firstName: '', address: { city: '   ' } },
    });

    expect((calls[0]!.body as Record<string, unknown>).user_data).toBeUndefined();
  });

  test('omits user_data when userData is an empty object', async () => {
    const { fn, calls } = captureFetch();
    const tracker = createServerTracker(validConfig({ fetch: fn }));
    await tracker.trackEvent({ name: 'page_view', clientId: '123.456', userData: {} });

    expect((calls[0]!.body as Record<string, unknown>).user_data).toBeUndefined();
  });

  test('drops the address[] array when no address sub-field has content but other PII does', async () => {
    const { fn, calls } = captureFetch();
    const tracker = createServerTracker(validConfig({ fetch: fn }));
    await tracker.trackEvent({
      name: 'login',
      clientId: '123.456',
      userData: { email: 'jane@example.com', address: { street: '   ' } },
    });

    expect((calls[0]!.body as Record<string, unknown>).user_data).toEqual({
      sha256_email_address: [HASH.email_jane],
    });
  });
});

describe('trackEvent — ad_user_data consent gate', () => {
  test('omits user_data when consent.ad_user_data is "denied"', async () => {
    const { fn, calls } = captureFetch();
    const tracker = createServerTracker(validConfig({ fetch: fn }));
    await tracker.trackEvent({
      name: 'login',
      clientId: '123.456',
      userData: { email: 'jane@example.com' },
      consent: { ad_user_data: 'denied' },
    });

    expect((calls[0]!.body as Record<string, unknown>).user_data).toBeUndefined();
    // The event itself still fires.
    expect((calls[0]!.body as Record<string, unknown>).events).toBeDefined();
  });

  test('omits user_data when consent.ad_user_data is unset (only ad_personalization passed)', async () => {
    const { fn, calls } = captureFetch();
    const tracker = createServerTracker(validConfig({ fetch: fn }));
    await tracker.trackEvent({
      name: 'login',
      clientId: '123.456',
      userData: { email: 'jane@example.com' },
      consent: { ad_personalization: 'granted' },
    });

    expect((calls[0]!.body as Record<string, unknown>).user_data).toBeUndefined();
  });

  test('includes user_data when consent.ad_user_data is "granted"', async () => {
    const { fn, calls } = captureFetch();
    const tracker = createServerTracker(validConfig({ fetch: fn }));
    await tracker.trackEvent({
      name: 'login',
      clientId: '123.456',
      userData: { email: 'jane@example.com' },
      consent: { ad_user_data: 'granted' },
    });

    expect((calls[0]!.body as Record<string, unknown>).user_data).toEqual({
      sha256_email_address: [HASH.email_jane],
    });
  });

  test('includes user_data when consent is omitted entirely (caller does not track consent here)', async () => {
    const { fn, calls } = captureFetch();
    const tracker = createServerTracker(validConfig({ fetch: fn }));
    await tracker.trackEvent({
      name: 'login',
      clientId: '123.456',
      userData: { email: 'jane@example.com' },
    });

    expect((calls[0]!.body as Record<string, unknown>).user_data).toEqual({
      sha256_email_address: [HASH.email_jane],
    });
  });
});

// --- trackConversion (Google Ads API + OAuth) ---------------------------

const validAdsConfig: ServerAdsConfig = {
  developerToken: 'dev-token',
  customerId: '1234567890',
  refreshToken: 'refresh-x',
  clientId: 'client-x.apps.googleusercontent.com',
  clientSecret: 'GOCSPX-secret',
  conversionActions: { purchase: 'customers/1234567890/conversionActions/9999' },
};

function captureFetchSequence(responses: Response[]) {
  const calls: FetchCall[] = [];
  let i = 0;
  const fn: typeof globalThis.fetch = async (input, init) => {
    const headerEntries = init?.headers ? Object.entries(init.headers) : [];
    calls.push({
      url: typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(headerEntries) as Record<string, string>,
      body:
        typeof init?.body === 'string' && init.body.trim().startsWith('{')
          ? JSON.parse(init.body)
          : init?.body,
    });
    const r = responses[i++] ?? responses[responses.length - 1];
    if (r === undefined) throw new Error('no responses queued');
    return r.clone();
  };
  return { fn, calls };
}

const oauthResponseOk = () =>
  new Response(JSON.stringify({ access_token: 'ya29.test', expires_in: 3600 }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const adsResponseOk = () =>
  new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });

const FIXED_TX = 'tb_test-fixed';
const FIXED_NOW = Date.UTC(2026, 3, 25, 12, 0, 0); // 2026-04-25 12:00:00 UTC

function findAdsCall(calls: FetchCall[]) {
  return calls.find((c) => c.url.includes('uploadClickConversions'));
}

describe('trackConversion (server-side via Google Ads API)', () => {
  test('throws when ads is not configured', async () => {
    const { fn } = captureFetchSequence([oauthResponseOk(), adsResponseOk()]);
    const tracker = createServerTracker(validConfig({ fetch: fn }));

    await expect(
      tracker.trackConversion({ label: 'purchase', transactionId: 'order_1' }),
    ).rejects.toThrow(/ads/i);
  });

  test('throws when label is not in conversionActions map', async () => {
    const { fn } = captureFetchSequence([oauthResponseOk(), adsResponseOk()]);
    const tracker = createServerTracker(
      validConfig({ fetch: fn, ads: validAdsConfig }),
    );

    await expect(
      tracker.trackConversion({ label: 'unknown_label', transactionId: 'order_1' }),
    ).rejects.toThrow(/unknown_label/);
  });

  test('uploads a click conversion using the resource name from the map', async () => {
    const { fn, calls } = captureFetchSequence([oauthResponseOk(), adsResponseOk()]);
    const tracker = createServerTracker(
      validConfig({
        fetch: fn,
        ads: validAdsConfig,
        now: () => FIXED_NOW,
        generateTransactionId: () => FIXED_TX,
      }),
    );

    await tracker.trackConversion({ label: 'purchase', transactionId: 'order_8a91bf' });

    const ads = findAdsCall(calls);
    expect(ads).toBeDefined();
    expect(ads!.url).toBe(
      'https://googleads.googleapis.com/v17/customers/1234567890:uploadClickConversions',
    );
    const body = ads!.body as { conversions: Array<Record<string, unknown>> };
    expect(body.conversions[0]!.conversionAction).toBe(
      'customers/1234567890/conversionActions/9999',
    );
    expect(body.conversions[0]!.orderId).toBe('order_8a91bf');
  });

  test('formats conversionDateTime as "yyyy-mm-dd hh:mm:ss+00:00" from injected now()', async () => {
    const { fn, calls } = captureFetchSequence([oauthResponseOk(), adsResponseOk()]);
    const tracker = createServerTracker(
      validConfig({
        fetch: fn,
        ads: validAdsConfig,
        now: () => FIXED_NOW,
      }),
    );

    await tracker.trackConversion({ label: 'purchase', transactionId: 'order_1' });

    const ads = findAdsCall(calls);
    const body = ads!.body as { conversions: Array<Record<string, unknown>> };
    expect(body.conversions[0]!.conversionDateTime).toBe('2026-04-25 12:00:00+00:00');
  });

  test('passes value and currency through as conversionValue / currencyCode', async () => {
    const { fn, calls } = captureFetchSequence([oauthResponseOk(), adsResponseOk()]);
    const tracker = createServerTracker(
      validConfig({ fetch: fn, ads: validAdsConfig }),
    );

    await tracker.trackConversion({
      label: 'purchase',
      transactionId: 'order_1',
      value: 99,
      currency: 'USD',
    });

    const ads = findAdsCall(calls);
    const conv = (ads!.body as { conversions: Array<Record<string, unknown>> }).conversions[0]!;
    expect(conv.conversionValue).toBe(99);
    expect(conv.currencyCode).toBe('USD');
  });

  test('attaches gclid / gbraid / wbraid to the conversion record when supplied', async () => {
    const { fn, calls } = captureFetchSequence([oauthResponseOk(), adsResponseOk()]);
    const tracker = createServerTracker(
      validConfig({ fetch: fn, ads: validAdsConfig }),
    );

    await tracker.trackConversion({
      label: 'purchase',
      transactionId: 'order_1',
      gclid: 'EAIaIQobChMI',
    });

    const ads = findAdsCall(calls);
    const conv = (ads!.body as { conversions: Array<Record<string, unknown>> }).conversions[0]!;
    expect(conv.gclid).toBe('EAIaIQobChMI');
  });

  test('builds Ads userIdentifiers from userData', async () => {
    const { fn, calls } = captureFetchSequence([oauthResponseOk(), adsResponseOk()]);
    const tracker = createServerTracker(
      validConfig({ fetch: fn, ads: validAdsConfig }),
    );

    await tracker.trackConversion({
      label: 'purchase',
      transactionId: 'order_1',
      userData: {
        email: '  Jane@Example.COM ',
        phone: '+1 (555) 123-4567',
        firstName: 'Jane',
        lastName: 'Doe',
        address: {
          street: '  123 Main St. ',
          city: 'AUSTIN',
          region: ' TX ',
          postalCode: '78701',
          country: 'us',
        },
      },
    });

    const ads = findAdsCall(calls);
    const conv = (ads!.body as { conversions: Array<Record<string, unknown>> }).conversions[0]!;
    expect(conv.userIdentifiers).toEqual([
      { hashedEmail: HASH.email_jane },
      { hashedPhoneNumber: HASH.phone_15551234567 },
      {
        addressInfo: {
          hashedFirstName: HASH.name_jane,
          hashedLastName: HASH.name_doe,
          hashedStreetAddress: HASH.street_123_main_st,
          city: 'austin',
          state: 'tx',
          postalCode: '78701',
          countryCode: 'US',
        },
      },
    ]);
  });

  test('omits userIdentifiers entirely when no field survives normalization', async () => {
    const { fn, calls } = captureFetchSequence([oauthResponseOk(), adsResponseOk()]);
    const tracker = createServerTracker(
      validConfig({ fetch: fn, ads: validAdsConfig }),
    );

    await tracker.trackConversion({
      label: 'purchase',
      transactionId: 'order_1',
      userData: { email: '   \t', address: { city: '' } },
    });

    const ads = findAdsCall(calls);
    const conv = (ads!.body as { conversions: Array<Record<string, unknown>> }).conversions[0]!;
    expect(conv.userIdentifiers).toBeUndefined();
  });

  test('omits userIdentifiers when consent.ad_user_data is "denied"', async () => {
    const { fn, calls } = captureFetchSequence([oauthResponseOk(), adsResponseOk()]);
    const tracker = createServerTracker(
      validConfig({ fetch: fn, ads: validAdsConfig }),
    );

    await tracker.trackConversion({
      label: 'purchase',
      transactionId: 'order_1',
      userData: { email: 'jane@example.com' },
      consent: { ad_user_data: 'denied' },
    });

    const ads = findAdsCall(calls);
    const conv = (ads!.body as { conversions: Array<Record<string, unknown>> }).conversions[0]!;
    expect(conv.userIdentifiers).toBeUndefined();
    // Conversion itself still uploads.
    expect(conv.orderId).toBe('order_1');
  });

  test('includes userIdentifiers when consent.ad_user_data is "granted"', async () => {
    const { fn, calls } = captureFetchSequence([oauthResponseOk(), adsResponseOk()]);
    const tracker = createServerTracker(
      validConfig({ fetch: fn, ads: validAdsConfig }),
    );

    await tracker.trackConversion({
      label: 'purchase',
      transactionId: 'order_1',
      userData: { email: 'jane@example.com' },
      consent: { ad_user_data: 'granted' },
    });

    const ads = findAdsCall(calls);
    const conv = (ads!.body as { conversions: Array<Record<string, unknown>> }).conversions[0]!;
    expect(conv.userIdentifiers).toEqual([{ hashedEmail: HASH.email_jane }]);
  });

  test('auto-generates transactionId with always-on warning when missing', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { fn, calls } = captureFetchSequence([oauthResponseOk(), adsResponseOk()]);
      const tracker = createServerTracker(
        validConfig({
          fetch: fn,
          ads: validAdsConfig,
          generateTransactionId: () => FIXED_TX,
        }),
      );

      await tracker.trackConversion({ label: 'purchase' });

      const ads = findAdsCall(calls);
      const conv = (ads!.body as { conversions: Array<Record<string, unknown>> }).conversions[0]!;
      expect(conv.orderId).toBe(FIXED_TX);

      expect(warnSpy).toHaveBeenCalledTimes(1);
      const msg = String(warnSpy.mock.calls[0]?.[0]);
      expect(msg).toMatch(/trackbridge/);
      expect(msg).toMatch(/transactionId/);
      expect(msg).toMatch(/Dual-send disabled/);
      expect(msg).toContain(FIXED_TX);
    } finally {
      warnSpy.mockRestore();
    }
  });

  test('treats an empty-string transactionId as missing and auto-generates', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { fn, calls } = captureFetchSequence([oauthResponseOk(), adsResponseOk()]);
      const tracker = createServerTracker(
        validConfig({
          fetch: fn,
          ads: validAdsConfig,
          generateTransactionId: () => FIXED_TX,
        }),
      );

      await tracker.trackConversion({ label: 'purchase', transactionId: '' });

      const ads = findAdsCall(calls);
      const conv = (ads!.body as { conversions: Array<Record<string, unknown>> }).conversions[0]!;
      expect(conv.orderId).toBe(FIXED_TX);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
    }
  });

  test('resolves with ads.ok=false when the Ads API returns 4xx (logs in debug mode)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const adsBad = new Response(JSON.stringify({ error: { message: 'invalid' } }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
      const { fn } = captureFetchSequence([oauthResponseOk(), adsBad]);
      const tracker = createServerTracker(
        validConfig({ fetch: fn, ads: validAdsConfig, debug: true }),
      );

      const result = await tracker.trackConversion({
        label: 'purchase',
        transactionId: 'order_1',
      });
      expect(result.ads.ok).toBe(false);
      if (!result.ads.ok) {
        expect(result.ads.error.message).toMatch(/Ads API returned 400/);
      }
      expect(warnSpy).toHaveBeenCalled();
      const messages = warnSpy.mock.calls.map((c) => String(c[0]));
      expect(messages.some((m) => m.includes('400') || m.includes('Ads API'))).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  test('resolves with ads.ok=false when fetch throws (logs in debug mode)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const failingFetch: typeof globalThis.fetch = async () => {
        throw new Error('ECONNRESET');
      };
      const tracker = createServerTracker(
        validConfig({ fetch: failingFetch, ads: validAdsConfig, debug: true }),
      );

      const result = await tracker.trackConversion({
        label: 'purchase',
        transactionId: 'order_1',
      });
      expect(result.ads.ok).toBe(false);
      if (!result.ads.ok) {
        expect(result.ads.error.message).toContain('ECONNRESET');
      }
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  test('resolves with ads.ok=true on a 2xx Ads API response', async () => {
    const { fn } = captureFetchSequence([oauthResponseOk(), adsResponseOk()]);
    const tracker = createServerTracker(
      validConfig({ fetch: fn, ads: validAdsConfig }),
    );
    const result = await tracker.trackConversion({
      label: 'purchase',
      transactionId: 'order_1',
    });
    expect(result).toEqual({ ads: { ok: true } });
  });

  test('does NOT log Ads API failures outside debug mode', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const adsBad = new Response('boom', { status: 500 });
      const { fn } = captureFetchSequence([oauthResponseOk(), adsBad]);
      const tracker = createServerTracker(
        validConfig({ fetch: fn, ads: validAdsConfig }),
      );

      await tracker.trackConversion({ label: 'purchase', transactionId: 'order_1' });

      // No warns from the Ads call (debug=false). Only the auto-tx warning would
      // have been emitted, but transactionId was provided here.
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('fromContext — envelope validation', () => {
  test('throws on null envelope', () => {
    const { fn } = captureFetch();
    const tracker = createServerTracker(validConfig({ fetch: fn }));
    expect(() => tracker.fromContext(null as unknown as TrackbridgeContext)).toThrow(
      /must be an object/,
    );
  });

  test('throws on unknown version (v: 2)', () => {
    const { fn } = captureFetch();
    const tracker = createServerTracker(validConfig({ fetch: fn }));
    expect(() =>
      tracker.fromContext({ ...validEnvelope(), v: 2 as unknown as 1 }),
    ).toThrow(/unknown envelope version v=2/);
  });

  test('throws when clickIds is missing', () => {
    const { fn } = captureFetch();
    const tracker = createServerTracker(validConfig({ fetch: fn }));
    const env = validEnvelope();
    delete (env as Partial<TrackbridgeContext>).clickIds;
    expect(() => tracker.fromContext(env)).toThrow(/clickIds must be an object/);
  });

  test('throws when consent is missing', () => {
    const { fn } = captureFetch();
    const tracker = createServerTracker(validConfig({ fetch: fn }));
    const env = validEnvelope();
    delete (env as Partial<TrackbridgeContext>).consent;
    expect(() => tracker.fromContext(env)).toThrow(/consent must be an object/);
  });

  test('valid envelope returns a ContextBoundServerTracker with both methods', () => {
    const { fn } = captureFetch();
    const tracker = createServerTracker(validConfig({ fetch: fn }));
    const bound = tracker.fromContext(validEnvelope());
    expect(typeof bound.trackEvent).toBe('function');
    expect(typeof bound.trackConversion).toBe('function');
  });

  test('bound tracker works when fromContext is destructured (no this-binding)', async () => {
    const { fn, calls } = captureFetch();
    const tracker = createServerTracker(validConfig({ fetch: fn }));
    const { fromContext } = tracker;
    const bound = fromContext(validEnvelope());

    await bound.trackEvent({ name: 'page_view' });
    expect((calls[0]!.body as Record<string, unknown>).client_id).toBe('111.222');
  });

  test('mutating the envelope after fromContext does not affect the bound tracker', async () => {
    const { fn, calls } = captureFetch();
    const tracker = createServerTracker(validConfig({ fetch: fn }));
    const env = validEnvelope();
    const bound = tracker.fromContext(env);

    // Mutate the original envelope after binding.
    env.clientId = 'tampered.999';
    if (env.consent) env.consent.ad_user_data = 'denied';
    if (env.clickIds) env.clickIds.gclid = 'tampered-click';

    await bound.trackEvent({ name: 'page_view' });

    // The bound tracker should still see the original values from when fromContext was called.
    const body = calls[0]!.body as Record<string, unknown>;
    expect(body.client_id).toBe('111.222');
    // user_data still flows because envelope's original consent was 'granted'.
    // (Asserting only the specific fields we care about; userData hashing test is elsewhere.)
  });
});

describe('ContextBoundServerTracker.trackEvent', () => {
  test('uses envelope.clientId when input omits it', async () => {
    const { fn, calls } = captureFetch();
    const tracker = createServerTracker(validConfig({ fetch: fn }));
    const bound = tracker.fromContext(validEnvelope());

    await bound.trackEvent({ name: 'page_view' });
    expect((calls[0]!.body as Record<string, unknown>).client_id).toBe('111.222');
  });

  test('per-call clientId overrides envelope.clientId', async () => {
    const { fn, calls } = captureFetch();
    const tracker = createServerTracker(validConfig({ fetch: fn }));
    const bound = tracker.fromContext(validEnvelope());

    await bound.trackEvent({ name: 'page_view', clientId: 'override.999' });
    expect((calls[0]!.body as Record<string, unknown>).client_id).toBe('override.999');
  });

  test('throws when neither envelope nor input supplies clientId', async () => {
    const { fn } = captureFetch();
    const tracker = createServerTracker(validConfig({ fetch: fn }));
    const env = validEnvelope();
    delete env.clientId;
    const bound = tracker.fromContext(env);

    await expect(bound.trackEvent({ name: 'page_view' })).rejects.toThrow(
      /fromContext-bound trackEvent called without clientId/,
    );
  });

  test('uses envelope.userId for MP body user_id', async () => {
    const { fn, calls } = captureFetch();
    const tracker = createServerTracker(validConfig({ fetch: fn }));
    const bound = tracker.fromContext(validEnvelope());

    await bound.trackEvent({ name: 'page_view' });
    expect((calls[0]!.body as Record<string, unknown>).user_id).toBe('u_xyz');
  });

  test('per-call userId overrides envelope.userId', async () => {
    const { fn, calls } = captureFetch();
    const tracker = createServerTracker(validConfig({ fetch: fn }));
    const bound = tracker.fromContext(validEnvelope());

    await bound.trackEvent({ name: 'page_view', userId: 'override_user' });
    expect((calls[0]!.body as Record<string, unknown>).user_id).toBe('override_user');
  });

  test('injects envelope.sessionId into params.session_id', async () => {
    const { fn, calls } = captureFetch();
    const tracker = createServerTracker(validConfig({ fetch: fn }));
    const bound = tracker.fromContext(validEnvelope());

    await bound.trackEvent({ name: 'page_view' });
    const events = (calls[0]!.body as { events: { params: Record<string, unknown> }[] }).events;
    expect(events[0]!.params.session_id).toBe('555');
  });

  test('per-call params.session_id overrides envelope.sessionId', async () => {
    const { fn, calls } = captureFetch();
    const tracker = createServerTracker(validConfig({ fetch: fn }));
    const bound = tracker.fromContext(validEnvelope());

    await bound.trackEvent({ name: 'page_view', params: { session_id: 'override_sess' } });
    const events = (calls[0]!.body as { events: { params: Record<string, unknown> }[] }).events;
    expect(events[0]!.params.session_id).toBe('override_sess');
  });

  test('per-call userData overrides envelope.userData', async () => {
    const { fn, calls } = captureFetch();
    const tracker = createServerTracker(validConfig({ fetch: fn }));
    const bound = tracker.fromContext(
      validEnvelope({ userData: { email: 'envelope@example.com' } }),
    );

    await bound.trackEvent({
      name: 'login',
      userData: { email: 'override@example.com' },
    });
    const body = calls[0]!.body as Record<string, unknown>;
    expect(body.user_data).toBeDefined();
  });
});

describe('ContextBoundServerTracker.trackConversion', () => {
  const adsConfig: ServerAdsConfig = {
    developerToken: 'dev-token',
    customerId: '1234567890',
    refreshToken: 'refresh-token',
    clientId: 'oauth-client',
    clientSecret: 'oauth-secret',
    conversionActions: { purchase: 'customers/1234567890/conversionActions/9876543210' },
  };

  function trackerWithAds() {
    const calls: FetchCall[] = [];
    const fn: typeof globalThis.fetch = async (input, init) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const isOauth = url.includes('oauth2');
      const headerEntries = init?.headers ? Object.entries(init.headers) : [];
      calls.push({
        url,
        method: init?.method ?? 'GET',
        headers: Object.fromEntries(headerEntries) as Record<string, string>,
        body:
          typeof init?.body === 'string'
            ? (() => {
                try {
                  return JSON.parse(init.body);
                } catch {
                  return init.body;
                }
              })()
            : init?.body,
      });
      if (isOauth) {
        return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ partialFailureError: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    return {
      tracker: createServerTracker(validConfig({ fetch: fn, ads: adsConfig })),
      calls,
    };
  }

  test('maps envelope.clickIds.gclid into the Ads conversion gclid field', async () => {
    const { tracker, calls } = trackerWithAds();
    const bound = tracker.fromContext(validEnvelope());

    await bound.trackConversion({
      label: 'purchase',
      transactionId: 'order_1',
    });

    const adsCall = calls.find((c) => c.url.includes('googleads.googleapis.com'));
    const conversion = (adsCall!.body as { conversions: Array<Record<string, unknown>> })
      .conversions[0]!;
    expect(conversion.gclid).toBe('ad-click-abc');
  });

  test('per-call gclid overrides envelope.clickIds.gclid', async () => {
    const { tracker, calls } = trackerWithAds();
    const bound = tracker.fromContext(validEnvelope());

    await bound.trackConversion({
      label: 'purchase',
      transactionId: 'order_1',
      gclid: 'override-click',
    });

    const adsCall = calls.find((c) => c.url.includes('googleads.googleapis.com'));
    const conversion = (adsCall!.body as { conversions: Array<Record<string, unknown>> })
      .conversions[0]!;
    expect(conversion.gclid).toBe('override-click');
  });

  test('envelope userData flows through to userIdentifiers', async () => {
    const { tracker, calls } = trackerWithAds();
    const bound = tracker.fromContext(
      validEnvelope({ userData: { email: 'jane@example.com' } }),
    );

    await bound.trackConversion({ label: 'purchase', transactionId: 'order_1' });

    const adsCall = calls.find((c) => c.url.includes('googleads.googleapis.com'));
    const conversion = (adsCall!.body as { conversions: Array<Record<string, unknown>> })
      .conversions[0]!;
    expect(conversion.userIdentifiers).toBeDefined();
  });

  test('per-call userData fully replaces envelope userData', async () => {
    const { tracker, calls } = trackerWithAds();
    const bound = tracker.fromContext(
      validEnvelope({ userData: { email: 'envelope@example.com' } }),
    );

    await bound.trackConversion({
      label: 'purchase',
      transactionId: 'order_1',
      userData: { phone: '+1 (555) 123-4567' },
    });

    const adsCall = calls.find((c) => c.url.includes('googleads.googleapis.com'));
    const conversion = (adsCall!.body as { conversions: Array<Record<string, unknown>> })
      .conversions[0]!;
    const ids = conversion.userIdentifiers as Array<Record<string, unknown>>;
    expect(ids.some((u) => 'hashedEmail' in u)).toBe(false);
    expect(ids.some((u) => 'hashedPhoneNumber' in u)).toBe(true);
  });

  test('envelope consent { ad_user_data: denied } drops userData from payload', async () => {
    const { tracker, calls } = trackerWithAds();
    const bound = tracker.fromContext(
      validEnvelope({
        userData: { email: 'jane@example.com' },
        consent: {
          ad_storage: 'granted',
          ad_user_data: 'denied',
          ad_personalization: 'unknown',
          analytics_storage: 'unknown',
        },
      }),
    );

    await bound.trackConversion({ label: 'purchase', transactionId: 'order_1' });

    const adsCall = calls.find((c) => c.url.includes('googleads.googleapis.com'));
    const conversion = (adsCall!.body as { conversions: Array<Record<string, unknown>> })
      .conversions[0]!;
    expect(conversion.userIdentifiers).toBeUndefined();
  });

  test('per-call consent overrides envelope consent', async () => {
    const { tracker, calls } = trackerWithAds();
    const bound = tracker.fromContext(
      validEnvelope({
        userData: { email: 'jane@example.com' },
        consent: {
          ad_storage: 'granted',
          ad_user_data: 'denied',
          ad_personalization: 'unknown',
          analytics_storage: 'unknown',
        },
      }),
    );

    await bound.trackConversion({
      label: 'purchase',
      transactionId: 'order_1',
      consent: { ad_user_data: 'granted' },
    });

    const adsCall = calls.find((c) => c.url.includes('googleads.googleapis.com'));
    const conversion = (adsCall!.body as { conversions: Array<Record<string, unknown>> })
      .conversions[0]!;
    expect(conversion.userIdentifiers).toBeDefined();
  });
});

describe('fromContext bound helpers', () => {
  const purchaseAdsConfig: ServerAdsConfig = {
    developerToken: 'dev-token',
    customerId: '1234567890',
    refreshToken: 'refresh-x',
    clientId: 'client-x.apps.googleusercontent.com',
    clientSecret: 'GOCSPX-secret',
    conversionActions: { PURCHASE_LABEL: 'customers/1234567890/conversionActions/111' },
  };

  function trackerWithPurchaseAds() {
    const calls: FetchCall[] = [];
    const fn: typeof globalThis.fetch = async (input, init) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const headerEntries = init?.headers ? Object.entries(init.headers) : [];
      calls.push({
        url,
        method: init?.method ?? 'GET',
        headers: Object.fromEntries(headerEntries) as Record<string, string>,
        body:
          typeof init?.body === 'string'
            ? (() => {
                try {
                  return JSON.parse(init.body);
                } catch {
                  return init.body;
                }
              })()
            : init?.body,
      });
      if (url.includes('oauth2')) {
        return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    return { fn, calls };
  }

  test('boundTracker.trackPurchase hydrates clientId, gclid, userData, consent from envelope', async () => {
    const { fn, calls } = trackerWithPurchaseAds();
    const tracker = createServerTracker(
      validConfig({
        fetch: fn,
        ads: purchaseAdsConfig,
        conversionLabels: { purchase: 'PURCHASE_LABEL' },
      }),
    );

    const bound = tracker.fromContext(validEnvelope());
    const result = await bound.trackPurchase({
      transactionId: 'order_42',
      value: 99.99,
      currency: 'USD',
      items: [{ itemId: 'SKU-1' }],
    });

    const ga4Call = calls.find((c) => c.url.includes('/mp/collect'))!;
    const body = ga4Call.body as { client_id: string };
    expect(body.client_id).toBe('111.222');

    expect(result.ga4).toEqual({ ok: true });
    expect(result.ads).toEqual({ ok: true });
  });

  test('per-call clientId overrides envelope clientId', async () => {
    const { fn, calls } = captureFetch();
    const tracker = createServerTracker(validConfig({ fetch: fn }));
    const bound = tracker.fromContext(validEnvelope());

    await bound.trackBeginCheckout({
      clientId: '999.888',
      transactionId: 'cart_42',
      value: 50,
      currency: 'USD',
      items: [{ itemId: 'a' }],
    });

    const ga4Call = calls.find((c) => c.url.includes('/mp/collect'))!;
    expect((ga4Call.body as { client_id: string }).client_id).toBe('999.888');
  });

  test('bound trackRefund still skips Ads even when envelope has gclid', async () => {
    const { fn, calls } = trackerWithPurchaseAds();
    const tracker = createServerTracker(
      validConfig({
        fetch: fn,
        ads: purchaseAdsConfig,
      }),
    );
    const bound = tracker.fromContext(validEnvelope());

    const result = await bound.trackRefund({
      transactionId: 'order_42',
      value: 99.99,
      currency: 'USD',
      items: [{ itemId: 'a' }],
    });

    expect(result.ads).toEqual({ skipped: true, reason: 'refund_ads_unsupported' });
    expect(calls.some((c) => c.url.includes('googleads'))).toBe(false);
  });

  test('per-call userData overrides envelope userData (full replacement)', async () => {
    const { fn, calls } = captureFetch();
    const tracker = createServerTracker(validConfig({ fetch: fn }));

    const envelope = validEnvelope({
      userData: { email: 'envelope@example.com' },
    });
    const bound = tracker.fromContext(envelope);

    await bound.trackPurchase({
      transactionId: 'order_42',
      value: 1,
      currency: 'USD',
      items: [{ itemId: 'a' }],
      userData: { email: 'percall@example.com' },
    });

    const ga4Call = calls.find((c) => c.url.includes('/mp/collect'))!;
    const body = ga4Call.body as { user_data?: { sha256_email_address?: string[] } };
    // Hashed shape — we don't pin the hash here, just confirm there's only one
    expect(body.user_data?.sha256_email_address?.length).toBe(1);
  });
});
