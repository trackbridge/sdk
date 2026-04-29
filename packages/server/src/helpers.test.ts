import { describe, expect, test } from 'vitest';

import { createServerTracker } from './tracker.js';
import type { ServerAdsConfig, ServerTrackerConfig } from './types.js';

type FetchCall = { url: string; method: string; headers: Record<string, string>; body: unknown };

function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function captureFetch(response: Response = new Response(null, { status: 204 })) {
  const calls: FetchCall[] = [];
  const fn: typeof globalThis.fetch = async (input, init) => {
    const headerEntries = init?.headers ? Object.entries(init.headers) : [];
    calls.push({
      url: typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(headerEntries) as Record<string, string>,
      body: typeof init?.body === 'string' ? tryParseJson(init.body) : init?.body,
    });
    return response;
  };
  return { fn, calls };
}

const baseAds: ServerAdsConfig = {
  developerToken: 'dev-token',
  customerId: '1234567890',
  clientId: 'oauth-client',
  clientSecret: 'oauth-secret',
  refreshToken: 'oauth-refresh',
  conversionActions: { PURCHASE_LABEL: 'customers/1234567890/conversionActions/111' },
};

const baseConfig = (overrides: Partial<ServerTrackerConfig> = {}): ServerTrackerConfig => ({
  ga4MeasurementId: 'G-TESTING',
  ga4ApiSecret: 'secret-123',
  ...overrides,
});

describe('serverTracker.trackPurchase', () => {
  test('fires both GA4 and Ads when label + ads config present', async () => {
    const { fn, calls } = captureFetch(
      new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const tracker = createServerTracker(
      baseConfig({
        fetch: fn,
        ads: baseAds,
        conversionLabels: { purchase: 'PURCHASE_LABEL' },
      }),
    );

    const result = await tracker.trackPurchase({
      transactionId: 'order_42',
      value: 99.99,
      currency: 'USD',
      items: [{ itemId: 'SKU-1', itemName: 'Widget', price: 99.99, quantity: 1 }],
      clientId: '111.222',
      gclid: 'abc',
    });

    // GA4 MP body assertion
    const ga4Call = calls.find((c) => c.url.includes('/mp/collect'));
    expect(ga4Call).toBeDefined();
    const body = ga4Call!.body as {
      events: Array<{ name: string; params: Record<string, unknown> }>;
    };
    expect(body.events[0]!.name).toBe('purchase');
    expect(body.events[0]!.params).toMatchObject({
      transaction_id: 'order_42',
      value: 99.99,
      currency: 'USD',
      items: [
        { item_id: 'SKU-1', item_name: 'Widget', price: 99.99, quantity: 1 },
      ],
    });

    // Ads — at least one upload call hit googleads endpoint
    expect(calls.some((c) => c.url.includes('googleads.googleapis.com'))).toBe(true);

    expect(result.ga4).toEqual({ ok: true });
    expect(result.ads).toEqual({ ok: true });
  });

  test('returns { ads: skipped: no_label_configured } when conversionLabels.purchase is absent', async () => {
    const { fn, calls } = captureFetch();
    const tracker = createServerTracker(baseConfig({ fetch: fn, ads: baseAds }));

    const result = await tracker.trackPurchase({
      transactionId: 'order_42',
      value: 99.99,
      currency: 'USD',
      items: [{ itemId: 'SKU-1' }],
      clientId: '111.222',
    });

    expect(result.ads).toEqual({ skipped: true, reason: 'no_label_configured' });
    expect(result.ga4).toEqual({ ok: true });
    expect(calls.some((c) => c.url.includes('googleads'))).toBe(false);
  });

  test('returns ga4 error when GA4 MP responds non-2xx', async () => {
    const { fn } = captureFetch(new Response(null, { status: 500 }));
    const tracker = createServerTracker(
      baseConfig({ fetch: fn, conversionLabels: { purchase: 'L' }, ads: { ...baseAds, conversionActions: { L: 'customers/1/conversionActions/1' } } }),
    );

    const result = await tracker.trackPurchase({
      transactionId: 'order_42',
      value: 1,
      currency: 'USD',
      items: [{ itemId: 'a' }],
      clientId: '1.2',
      gclid: 'g',
    });

    expect(result.ga4).toMatchObject({ ok: false });
    expect((result.ga4 as { ok: false; error: Error }).error.message).toMatch(
      /GA4 MP returned 500/,
    );
  });

  test('forwards optional purchase fields into GA4 MP params', async () => {
    const { fn, calls } = captureFetch();
    const tracker = createServerTracker(baseConfig({ fetch: fn }));

    await tracker.trackPurchase({
      transactionId: 'order_42',
      value: 100,
      currency: 'USD',
      items: [{ itemId: 'a' }],
      clientId: '1.2',
      affiliation: 'Acme',
      coupon: 'X',
      shipping: 5,
      tax: 4,
    });

    const ga4Call = calls.find((c) => c.url.includes('/mp/collect'))!;
    const body = ga4Call.body as { events: Array<{ params: Record<string, unknown> }> };
    expect(body.events[0]!.params).toMatchObject({
      affiliation: 'Acme',
      coupon: 'X',
      shipping: 5,
      tax: 4,
    });
  });
});
