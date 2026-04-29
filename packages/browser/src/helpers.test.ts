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

describe('trackBeginCheckout', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  test('fires both Ads and GA4 when label configured', async () => {
    const { io, gtagCalls } = captureIO();
    const tracker = createBrowserTracker(
      baseConfig({ io, conversionLabels: { beginCheckout: 'BEGIN_LABEL' } }),
    );

    await tracker.trackBeginCheckout({
      transactionId: 'cart_42',
      value: 50,
      currency: 'USD',
      items: [{ itemId: 'a' }],
      coupon: 'SAVE5',
    });

    const adsCall = gtagCalls.find((c) => c[1] === 'conversion')!;
    expect((adsCall[2] as Record<string, unknown>).send_to).toBe('AW-12345/BEGIN_LABEL');

    const ga4Call = gtagCalls.find((c) => c[1] === 'begin_checkout')!;
    const params = ga4Call[2] as Record<string, unknown>;
    expect(params.transaction_id).toBe('cart_42');
    expect(params.coupon).toBe('SAVE5');
    expect(params.items).toEqual([{ item_id: 'a' }]);
  });

  test('fires GA4 only when label absent', async () => {
    const { io, gtagCalls } = captureIO();
    const tracker = createBrowserTracker(baseConfig({ io }));

    await tracker.trackBeginCheckout({
      transactionId: 'cart_42',
      value: 50,
      currency: 'USD',
      items: [{ itemId: 'a' }],
    });

    expect(gtagCalls.find((c) => c[1] === 'conversion')).toBeUndefined();
    expect(gtagCalls.find((c) => c[1] === 'begin_checkout')).toBeDefined();
  });

  test('auto-generates transactionId with debug warn when omitted', async () => {
    const { io, gtagCalls, generateTransactionId } = captureIO({
      transactionId: 'tb_auto-cart',
    });
    const tracker = createBrowserTracker(baseConfig({ io, generateTransactionId }));

    await tracker.trackBeginCheckout({});

    expect(warnSpy).toHaveBeenCalled();
    const ga4Call = gtagCalls.find((c) => c[1] === 'begin_checkout')!;
    expect((ga4Call[2] as Record<string, unknown>).transaction_id).toBe('tb_auto-cart');
  });
});

describe('trackAddToCart', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warnSpy.mockRestore());

  test('fires both Ads and GA4 when label configured', async () => {
    const { io, gtagCalls } = captureIO();
    const tracker = createBrowserTracker(
      baseConfig({ io, conversionLabels: { addToCart: 'CART_LABEL' } }),
    );

    await tracker.trackAddToCart({
      transactionId: 'cart_42',
      value: 25,
      currency: 'USD',
      items: [{ itemId: 'a' }],
    });

    expect(gtagCalls.find((c) => c[1] === 'conversion')).toBeDefined();
    expect(gtagCalls.find((c) => c[1] === 'add_to_cart')).toBeDefined();
  });

  test('fires GA4 only when label absent', async () => {
    const { io, gtagCalls } = captureIO();
    const tracker = createBrowserTracker(baseConfig({ io }));

    await tracker.trackAddToCart({
      value: 25,
      currency: 'USD',
      items: [{ itemId: 'a' }],
    });

    expect(gtagCalls.find((c) => c[1] === 'conversion')).toBeUndefined();
    expect(gtagCalls.find((c) => c[1] === 'add_to_cart')).toBeDefined();
  });

  test('items array is snake_case-mapped on GA4 call', async () => {
    const { io, gtagCalls } = captureIO();
    const tracker = createBrowserTracker(baseConfig({ io }));

    await tracker.trackAddToCart({
      value: 25,
      currency: 'USD',
      items: [{ itemId: 'sku-1', itemName: 'Widget', itemBrand: 'Acme' }],
    });

    const ga4Call = gtagCalls.find((c) => c[1] === 'add_to_cart')!;
    const params = ga4Call[2] as Record<string, unknown>;
    expect(params.items).toEqual([
      { item_id: 'sku-1', item_name: 'Widget', item_brand: 'Acme' },
    ]);
  });
});

describe('trackSignUp', () => {
  test('fires both Ads and GA4 when signUp label configured (label-only Ads, no value/currency)', async () => {
    const { io, gtagCalls } = captureIO();
    const tracker = createBrowserTracker(
      baseConfig({ io, conversionLabels: { signUp: 'SIGNUP_LABEL' } }),
    );

    await tracker.trackSignUp({ transactionId: 'user_42', method: 'email' });

    const adsCall = gtagCalls.find((c) => c[1] === 'conversion')!;
    const adsParams = adsCall[2] as Record<string, unknown>;
    expect(adsParams.send_to).toBe('AW-12345/SIGNUP_LABEL');
    expect(adsParams.value).toBeUndefined();
    expect(adsParams.currency).toBeUndefined();
    expect(adsParams.transaction_id).toBe('user_42');

    const ga4Call = gtagCalls.find((c) => c[1] === 'sign_up')!;
    expect((ga4Call[2] as Record<string, unknown>).method).toBe('email');
  });

  test('fires GA4 only when label absent', async () => {
    const { io, gtagCalls } = captureIO();
    const tracker = createBrowserTracker(baseConfig({ io }));

    await tracker.trackSignUp({ method: 'google' });

    expect(gtagCalls.find((c) => c[1] === 'conversion')).toBeUndefined();
    const ga4Call = gtagCalls.find((c) => c[1] === 'sign_up')!;
    expect((ga4Call[2] as Record<string, unknown>).method).toBe('google');
  });

  test('omits method from GA4 params when not supplied', async () => {
    const { io, gtagCalls } = captureIO();
    const tracker = createBrowserTracker(baseConfig({ io }));

    await tracker.trackSignUp();

    const ga4Call = gtagCalls.find((c) => c[1] === 'sign_up')!;
    expect((ga4Call[2] as Record<string, unknown>).method).toBeUndefined();
  });
});

describe('trackRefund', () => {
  test('fires GA4 refund event only — never fires Ads', async () => {
    const { io, gtagCalls } = captureIO();
    // Force a refund label via cast — mirrors runtime safety even when type-level guard is bypassed.
    const tracker = createBrowserTracker(
      baseConfig({
        io,
        conversionLabels: { refund: 'REFUND_LABEL' } as unknown as Record<string, string>,
      } as BrowserTrackerConfig),
    );

    await tracker.trackRefund({
      transactionId: 'order_42',
      value: 99.99,
      currency: 'USD',
      items: [{ itemId: 'SKU-1' }],
    });

    expect(gtagCalls.find((c) => c[1] === 'conversion')).toBeUndefined();
    const ga4Call = gtagCalls.find((c) => c[1] === 'refund')!;
    const params = ga4Call[2] as Record<string, unknown>;
    expect(params.transaction_id).toBe('order_42');
    expect(params.value).toBe(99.99);
    expect(params.items).toEqual([{ item_id: 'SKU-1' }]);
  });

  test('forwards optional refund fields into GA4 params', async () => {
    const { io, gtagCalls } = captureIO();
    const tracker = createBrowserTracker(baseConfig({ io }));

    await tracker.trackRefund({
      transactionId: 'order_42',
      value: 50,
      currency: 'USD',
      items: [{ itemId: 'a' }],
      affiliation: 'Acme',
      coupon: 'X',
      shipping: 5,
      tax: 4,
    });

    const ga4Call = gtagCalls.find((c) => c[1] === 'refund')!;
    expect(ga4Call[2]).toMatchObject({
      affiliation: 'Acme',
      coupon: 'X',
      shipping: 5,
      tax: 4,
    });
  });
});

describe('helpers — cross-cutting behavior', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warnSpy.mockRestore());

  test('userData is dropped when ad_user_data consent is denied', async () => {
    const { io, gtagCalls } = captureIO();
    const tracker = createBrowserTracker(
      baseConfig({ io, consentMode: 'v2', conversionLabels: { purchase: 'L' } }),
    );
    tracker.updateConsent({
      ad_storage: 'granted',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      analytics_storage: 'granted',
    });

    await tracker.trackPurchase({
      transactionId: 'order_1',
      value: 10,
      currency: 'USD',
      items: [{ itemId: 'a' }],
      userData: { email: 'foo@example.com' },
    });

    // The `set user_data` gtag call should NOT appear when consent denied.
    const setUserData = gtagCalls.find(
      (c) => c[0] === 'set' && c[1] === 'user_data',
    );
    expect(setUserData).toBeUndefined();
  });

  test('userData is set on gtag when ad_user_data consent is granted', async () => {
    const { io, gtagCalls } = captureIO();
    const tracker = createBrowserTracker(
      baseConfig({ io, consentMode: 'v2', conversionLabels: { purchase: 'L' } }),
    );
    tracker.updateConsent({
      ad_storage: 'granted',
      ad_user_data: 'granted',
      ad_personalization: 'granted',
      analytics_storage: 'granted',
    });

    await tracker.trackPurchase({
      transactionId: 'order_1',
      value: 10,
      currency: 'USD',
      items: [{ itemId: 'a' }],
      userData: { email: 'foo@example.com' },
    });

    const setUserData = gtagCalls.find(
      (c) => c[0] === 'set' && c[1] === 'user_data',
    );
    expect(setUserData).toBeDefined();
  });

  test('Ads-side throw does NOT prevent GA4 from firing (and vice versa)', async () => {
    let throwOn: 'conversion' | 'purchase' | null = 'conversion';
    const seen: string[] = [];
    const failingIO: BrowserIO = {
      getUrlSearch: () => '',
      getCookieHeader: () => '',
      writeCookie: () => {},
      gtag: (...args) => {
        if (args[0] === 'event' && args[1] === throwOn) {
          throw new Error('boom');
        }
        if (args[0] === 'event') seen.push(String(args[1]));
      },
    };
    const tracker = createBrowserTracker(
      baseConfig({ io: failingIO, conversionLabels: { purchase: 'L' } }),
    );

    // Ads throws — GA4 should still fire.
    await tracker.trackPurchase({
      transactionId: 'order_1',
      value: 10,
      currency: 'USD',
      items: [{ itemId: 'a' }],
    });
    expect(seen).toContain('purchase');
    expect(seen).not.toContain('conversion');

    // Now flip: GA4 throws — Ads should still have fired.
    seen.length = 0;
    throwOn = 'purchase';
    await tracker.trackPurchase({
      transactionId: 'order_2',
      value: 10,
      currency: 'USD',
      items: [{ itemId: 'a' }],
    });
    expect(seen).toContain('conversion');
    expect(seen).not.toContain('purchase');
  });

  test('helpers all return Promise<void> and resolve even when both branches throw', async () => {
    const failingIO: BrowserIO = {
      getUrlSearch: () => '',
      getCookieHeader: () => '',
      writeCookie: () => {},
      gtag: () => {
        throw new Error('boom');
      },
    };
    const tracker = createBrowserTracker(
      baseConfig({ io: failingIO, conversionLabels: { purchase: 'L' } }),
    );

    await expect(
      tracker.trackPurchase({
        transactionId: 'o',
        value: 1,
        currency: 'USD',
        items: [{ itemId: 'a' }],
      }),
    ).resolves.toBeUndefined();
    await expect(tracker.trackBeginCheckout()).resolves.toBeUndefined();
    await expect(tracker.trackAddToCart()).resolves.toBeUndefined();
    await expect(tracker.trackSignUp()).resolves.toBeUndefined();
    await expect(
      tracker.trackRefund({
        transactionId: 'o',
        value: 1,
        currency: 'USD',
        items: [{ itemId: 'a' }],
      }),
    ).resolves.toBeUndefined();
  });
});
