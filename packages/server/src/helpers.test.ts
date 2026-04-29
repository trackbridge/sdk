import { describe, expect, test, vi } from 'vitest';

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

describe('serverTracker.trackBeginCheckout', () => {
  test('fires GA4 begin_checkout with mapped items, skips Ads without label', async () => {
    const { fn, calls } = captureFetch();
    const tracker = createServerTracker(baseConfig({ fetch: fn }));

    const result = await tracker.trackBeginCheckout({
      transactionId: 'cart_42',
      value: 50,
      currency: 'USD',
      items: [{ itemId: 'a' }],
      coupon: 'SAVE5',
      clientId: '1.2',
    });

    expect(result.ads).toEqual({ skipped: true, reason: 'no_label_configured' });
    expect(result.ga4).toEqual({ ok: true });

    const ga4Call = calls.find((c) => c.url.includes('/mp/collect'))!;
    const body = ga4Call.body as { events: Array<{ name: string; params: Record<string, unknown> }> };
    expect(body.events[0]!.name).toBe('begin_checkout');
    expect(body.events[0]!.params).toMatchObject({
      transaction_id: 'cart_42',
      coupon: 'SAVE5',
      items: [{ item_id: 'a' }],
    });
  });

  test('auto-generates transactionId when omitted', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { fn, calls } = captureFetch();
      const tracker = createServerTracker(
        baseConfig({
          fetch: fn,
          generateTransactionId: () => 'tb_auto-cart',
        }),
      );

      await tracker.trackBeginCheckout({ clientId: '1.2' });

      const ga4Call = calls.find((c) => c.url.includes('/mp/collect'))!;
      const body = ga4Call.body as { events: Array<{ params: Record<string, unknown> }> };
      expect(body.events[0]!.params.transaction_id).toBe('tb_auto-cart');
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('serverTracker.trackAddToCart', () => {
  test('fires GA4 add_to_cart event, skips Ads without label', async () => {
    const { fn, calls } = captureFetch();
    const tracker = createServerTracker(baseConfig({ fetch: fn }));

    const result = await tracker.trackAddToCart({
      value: 25,
      currency: 'USD',
      items: [{ itemId: 'a', quantity: 2 }],
      clientId: '1.2',
    });

    expect(result.ads).toEqual({ skipped: true, reason: 'no_label_configured' });
    const ga4Call = calls.find((c) => c.url.includes('/mp/collect'))!;
    const body = ga4Call.body as { events: Array<{ name: string; params: Record<string, unknown> }> };
    expect(body.events[0]!.name).toBe('add_to_cart');
    expect(body.events[0]!.params.items).toEqual([{ item_id: 'a', quantity: 2 }]);
  });

  test('fires Ads when addToCart label configured', async () => {
    const { fn } = captureFetch(
      new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const tracker = createServerTracker(
      baseConfig({
        fetch: fn,
        ads: {
          ...baseAds,
          conversionActions: {
            ...baseAds.conversionActions,
            CART_LABEL: 'customers/1234567890/conversionActions/222',
          },
        },
        conversionLabels: { addToCart: 'CART_LABEL' },
      }),
    );

    const result = await tracker.trackAddToCart({
      value: 25,
      currency: 'USD',
      items: [{ itemId: 'a' }],
      clientId: '1.2',
      gclid: 'g',
    });

    expect(result.ads).toEqual({ ok: true });
    expect(result.ga4).toEqual({ ok: true });
  });
});

describe('serverTracker.trackSignUp', () => {
  test('fires GA4 sign_up with method param', async () => {
    const { fn, calls } = captureFetch();
    const tracker = createServerTracker(baseConfig({ fetch: fn }));

    const result = await tracker.trackSignUp({
      transactionId: 'user_42',
      method: 'email',
      clientId: '1.2',
    });

    expect(result.ads).toEqual({ skipped: true, reason: 'no_label_configured' });

    const ga4Call = calls.find((c) => c.url.includes('/mp/collect'))!;
    const body = ga4Call.body as { events: Array<{ name: string; params: Record<string, unknown> }> };
    expect(body.events[0]!.name).toBe('sign_up');
    expect(body.events[0]!.params).toMatchObject({
      transaction_id: 'user_42',
      method: 'email',
    });
  });

  test('fires Ads label-only conversion when signUp label configured (no value/currency)', async () => {
    const { fn, calls } = captureFetch(
      new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const tracker = createServerTracker(
      baseConfig({
        fetch: fn,
        ads: {
          ...baseAds,
          conversionActions: {
            ...baseAds.conversionActions,
            SIGNUP_LABEL: 'customers/1234567890/conversionActions/333',
          },
        },
        conversionLabels: { signUp: 'SIGNUP_LABEL' },
      }),
    );

    const result = await tracker.trackSignUp({
      transactionId: 'user_42',
      method: 'google',
      clientId: '1.2',
      gclid: 'g',
    });

    expect(result.ads).toEqual({ ok: true });
    expect(result.ga4).toEqual({ ok: true });
    expect(calls.some((c) => c.url.includes('googleads'))).toBe(true);
  });
});

describe('serverTracker.trackRefund', () => {
  test('fires GA4 refund event, ads always skipped with refund_ads_unsupported reason', async () => {
    const { fn, calls } = captureFetch();
    const tracker = createServerTracker(
      baseConfig({
        fetch: fn,
        ads: baseAds,
        // conversionLabels intentionally has only `purchase` — `refund` is not part of the type.
        conversionLabels: { purchase: 'PURCHASE_LABEL' },
      }),
    );

    const result = await tracker.trackRefund({
      transactionId: 'order_42',
      value: 99.99,
      currency: 'USD',
      items: [{ itemId: 'a' }],
      clientId: '1.2',
    });

    expect(result.ads).toEqual({ skipped: true, reason: 'refund_ads_unsupported' });
    expect(result.ga4).toEqual({ ok: true });

    const ga4Call = calls.find((c) => c.url.includes('/mp/collect'))!;
    const body = ga4Call.body as { events: Array<{ name: string; params: Record<string, unknown> }> };
    expect(body.events[0]!.name).toBe('refund');
    expect(body.events[0]!.params.transaction_id).toBe('order_42');
    expect(body.events[0]!.params.value).toBe(99.99);

    // No Ads upload call hit
    expect(calls.some((c) => c.url.includes('googleads'))).toBe(false);
  });
});
