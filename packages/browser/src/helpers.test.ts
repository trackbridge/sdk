import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { createBrowserTracker } from './tracker.js';
import type { BrowserIO, BrowserTrackerConfig } from './types.js';

function captureIO(initial: { url?: string; cookies?: string; transactionId?: string } = {}) {
  const writes: string[] = [];
  const gtagCalls: unknown[][] = [];
  const io: BrowserIO = {
    getUrlSearch: () => initial.url ?? '',
    getCookieHeader: () => initial.cookies ?? '',
    writeCookie: (s) => writes.push(s),
    gtag: (...args) => gtagCalls.push(args),
  };
  const generateTransactionId = (): string => initial.transactionId ?? 'tb_test-fixed-id';
  return { io, writes, gtagCalls, generateTransactionId };
}

const baseConfig = (overrides: Partial<BrowserTrackerConfig> = {}): BrowserTrackerConfig => ({
  adsConversionId: 'AW-12345',
  ...overrides,
});

describe('trackPurchase', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  test('fires both Ads conversion and GA4 purchase event when label is configured', async () => {
    const { io, gtagCalls } = captureIO();
    const tracker = createBrowserTracker(
      baseConfig({ io, conversionLabels: { purchase: 'PURCHASE_LABEL' } }),
    );

    await tracker.trackPurchase({
      transactionId: 'order_42',
      value: 99.99,
      currency: 'USD',
      items: [{ itemId: 'SKU-1', itemName: 'Widget', price: 99.99, quantity: 1 }],
    });

    const adsCall = gtagCalls.find(
      (c) => c[0] === 'event' && c[1] === 'conversion',
    );
    expect(adsCall).toBeDefined();
    expect((adsCall?.[2] as Record<string, unknown>).send_to).toBe('AW-12345/PURCHASE_LABEL');
    expect((adsCall?.[2] as Record<string, unknown>).transaction_id).toBe('order_42');
    expect((adsCall?.[2] as Record<string, unknown>).value).toBe(99.99);
    expect((adsCall?.[2] as Record<string, unknown>).currency).toBe('USD');

    const ga4Call = gtagCalls.find((c) => c[0] === 'event' && c[1] === 'purchase');
    expect(ga4Call).toBeDefined();
    const params = ga4Call?.[2] as Record<string, unknown>;
    expect(params.transaction_id).toBe('order_42');
    expect(params.value).toBe(99.99);
    expect(params.currency).toBe('USD');
    expect(params.items).toEqual([
      { item_id: 'SKU-1', item_name: 'Widget', price: 99.99, quantity: 1 },
    ]);
  });

  test('fires GA4 only when conversionLabels.purchase is absent', async () => {
    const { io, gtagCalls } = captureIO();
    const tracker = createBrowserTracker(baseConfig({ io }));

    await tracker.trackPurchase({
      transactionId: 'order_42',
      value: 99.99,
      currency: 'USD',
      items: [{ itemId: 'SKU-1' }],
    });

    expect(gtagCalls.find((c) => c[0] === 'event' && c[1] === 'conversion')).toBeUndefined();
    expect(gtagCalls.find((c) => c[0] === 'event' && c[1] === 'purchase')).toBeDefined();
  });

  test('forwards optional purchase fields (affiliation, coupon, shipping, tax) into GA4 params', async () => {
    const { io, gtagCalls } = captureIO();
    const tracker = createBrowserTracker(baseConfig({ io }));

    await tracker.trackPurchase({
      transactionId: 'order_42',
      value: 100,
      currency: 'USD',
      items: [{ itemId: 'SKU-1' }],
      affiliation: 'Acme Store',
      coupon: 'SUMMER10',
      shipping: 7.5,
      tax: 9,
    });

    const ga4Call = gtagCalls.find((c) => c[1] === 'purchase')!;
    const params = ga4Call[2] as Record<string, unknown>;
    expect(params).toMatchObject({
      affiliation: 'Acme Store',
      coupon: 'SUMMER10',
      shipping: 7.5,
      tax: 9,
    });
  });

  test('attaches click identifiers to the Ads conversion call', async () => {
    const { io, gtagCalls } = captureIO({ url: '?gclid=g1&gbraid=b1&wbraid=w1' });
    const tracker = createBrowserTracker(
      baseConfig({ io, conversionLabels: { purchase: 'L' } }),
    );

    await tracker.trackPurchase({
      transactionId: 'order_42',
      value: 1,
      currency: 'USD',
      items: [{ itemId: 'a' }],
    });

    const adsCall = gtagCalls.find((c) => c[1] === 'conversion')!;
    const params = adsCall[2] as Record<string, unknown>;
    expect(params.gclid).toBe('g1');
    expect(params.gbraid).toBe('b1');
    expect(params.wbraid).toBe('w1');
  });

  test('GA4 call still fires when Ads gtag throws', async () => {
    const callOrder: string[] = [];
    let throwOnce = true;
    const failingIO: BrowserIO = {
      getUrlSearch: () => '',
      getCookieHeader: () => '',
      writeCookie: () => {},
      gtag: (...args) => {
        if (args[0] === 'event' && args[1] === 'conversion' && throwOnce) {
          throwOnce = false;
          throw new Error('boom-ads');
        }
        callOrder.push(`${args[0]}:${args[1]}`);
      },
    };
    const tracker = createBrowserTracker(
      baseConfig({ io: failingIO, conversionLabels: { purchase: 'L' } }),
    );

    await expect(
      tracker.trackPurchase({
        transactionId: 'order_42',
        value: 1,
        currency: 'USD',
        items: [{ itemId: 'a' }],
      }),
    ).resolves.toBeUndefined();

    expect(callOrder).toContain('event:purchase');
  });

  test('preserves value: 0 (free purchase) — does not drop the key', async () => {
    const { io, gtagCalls } = captureIO();
    const tracker = createBrowserTracker(
      baseConfig({ io, conversionLabels: { purchase: 'L' } }),
    );

    await tracker.trackPurchase({
      transactionId: 'order_42',
      value: 0,
      currency: 'USD',
      items: [{ itemId: 'a' }],
    });

    const ga4Call = gtagCalls.find((c) => c[1] === 'purchase')!;
    const ga4Params = ga4Call[2] as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(ga4Params, 'value')).toBe(true);
    expect(ga4Params.value).toBe(0);

    const adsCall = gtagCalls.find((c) => c[1] === 'conversion')!;
    const adsParams = adsCall[2] as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(adsParams, 'value')).toBe(true);
    expect(adsParams.value).toBe(0);
  });

  test('preserves empty items array on the GA4 call (does not drop the key)', async () => {
    const { io, gtagCalls } = captureIO();
    const tracker = createBrowserTracker(baseConfig({ io }));

    await tracker.trackPurchase({
      transactionId: 'order_42',
      value: 99.99,
      currency: 'USD',
      items: [],
    });

    const ga4Call = gtagCalls.find((c) => c[1] === 'purchase')!;
    const params = ga4Call[2] as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(params, 'items')).toBe(true);
    expect(params.items).toEqual([]);
  });

  test('logs a warning on Ads-side failure when debug is on', async () => {
    const failingIO: BrowserIO = {
      getUrlSearch: () => '',
      getCookieHeader: () => '',
      writeCookie: () => {},
      gtag: (...args) => {
        if (args[0] === 'event' && args[1] === 'conversion') {
          throw new Error('boom-ads');
        }
      },
    };
    const tracker = createBrowserTracker(
      baseConfig({
        io: failingIO,
        debug: true,
        conversionLabels: { purchase: 'L' },
      }),
    );

    await tracker.trackPurchase({
      transactionId: 'order_42',
      value: 1,
      currency: 'USD',
      items: [{ itemId: 'a' }],
    });

    expect(warnSpy).toHaveBeenCalled();
    const messages = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => /trackbridge/.test(m))).toBe(true);
  });
});
