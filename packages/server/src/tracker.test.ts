import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

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
