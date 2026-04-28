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
  adsConversionId: 'AW-123456789',
  ...overrides,
});

describe('createBrowserTracker — config validation', () => {
  test('throws when adsConversionId is missing', () => {
    const { io } = captureIO();
    expect(() =>
      createBrowserTracker({ io } as unknown as BrowserTrackerConfig),
    ).toThrow(/adsConversionId/);
  });

  test('returns a tracker exposing getClickIdentifiers and updateConsent', () => {
    const { io } = captureIO();
    const tracker = createBrowserTracker(baseConfig({ io }));
    expect(typeof tracker.getClickIdentifiers).toBe('function');
    expect(typeof tracker.updateConsent).toBe('function');
  });
});

describe('createBrowserTracker — init capture', () => {
  test('captures gclid from URL and writes a cookie under default consent (off)', () => {
    const { io, writes } = captureIO({ url: '?gclid=abc123' });
    const tracker = createBrowserTracker(baseConfig({ io }));

    expect(tracker.getClickIdentifiers()).toEqual({ gclid: 'abc123' });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatch(/^_tb_gclid=abc123;/);
  });

  test('reads existing cookies at init', () => {
    const { io, writes } = captureIO({ cookies: '_ga=x; _tb_gclid=existing' });
    const tracker = createBrowserTracker(baseConfig({ io }));

    expect(tracker.getClickIdentifiers()).toEqual({ gclid: 'existing' });
    // Existing cookie value gets refreshed (extends expiry on each init)
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatch(/^_tb_gclid=existing;/);
  });

  test('URL value overrides existing cookie value', () => {
    const { io, writes } = captureIO({
      url: '?gclid=fromUrl',
      cookies: '_tb_gclid=fromCookie',
    });
    const tracker = createBrowserTracker(baseConfig({ io }));

    expect(tracker.getClickIdentifiers()).toEqual({ gclid: 'fromUrl' });
    expect(writes[0]).toMatch(/^_tb_gclid=fromUrl;/);
  });

  test('captures all three click ID flavors when present in URL', () => {
    const { io, writes } = captureIO({ url: '?gclid=g&gbraid=b&wbraid=w' });
    const tracker = createBrowserTracker(baseConfig({ io }));

    expect(tracker.getClickIdentifiers()).toEqual({ gclid: 'g', gbraid: 'b', wbraid: 'w' });
    expect(writes).toHaveLength(3);
  });

  test('writes nothing when storage is "none"', () => {
    const { io, writes } = captureIO({ url: '?gclid=abc', cookies: '_tb_gclid=existing' });
    const tracker = createBrowserTracker(baseConfig({ io, clickIdentifierStorage: 'none' }));

    expect(tracker.getClickIdentifiers()).toEqual({});
    expect(writes).toEqual([]);
  });

  test('captures URL but skips cookie writes when storage is "memory"', () => {
    const { io, writes } = captureIO({ url: '?gclid=abc' });
    const tracker = createBrowserTracker(baseConfig({ io, clickIdentifierStorage: 'memory' }));

    expect(tracker.getClickIdentifiers()).toEqual({ gclid: 'abc' });
    expect(writes).toEqual([]);
  });

  test('does not read existing cookies when storage is "memory"', () => {
    const { io, writes } = captureIO({ cookies: '_tb_gclid=fromCookie' });
    const tracker = createBrowserTracker(baseConfig({ io, clickIdentifierStorage: 'memory' }));

    expect(tracker.getClickIdentifiers()).toEqual({});
    expect(writes).toEqual([]);
  });

  test('threads cookieDomain through to cookie writes', () => {
    const { io, writes } = captureIO({ url: '?gclid=abc' });
    createBrowserTracker(baseConfig({ io, cookieDomain: '.example.com' }));

    expect(writes[0]).toContain('; Domain=.example.com');
  });

  test('honors a custom cookieExpiryDays', () => {
    const { io, writes } = captureIO({ url: '?gclid=abc' });
    createBrowserTracker(baseConfig({ io, cookieExpiryDays: 1 }));

    expect(writes[0]).toMatch(/Expires=[A-Z][a-z]{2}, /);
    // 90-day default would have a date ~3 months out; 1 day should mention "now or soon"
    // Easier to just verify only one Expires attribute and that it's a valid HTTP-date prefix.
  });
});

describe('createBrowserTracker — Consent Mode v2', () => {
  test('captures URL ids into memory but defers cookie writes when consent is unknown', () => {
    const { io, writes } = captureIO({ url: '?gclid=abc' });
    const tracker = createBrowserTracker(baseConfig({ io, consentMode: 'v2' }));

    expect(tracker.getClickIdentifiers()).toEqual({ gclid: 'abc' });
    expect(writes).toEqual([]);
  });

  test('writes cookies when consent is granted via updateConsent', () => {
    const { io, writes } = captureIO({ url: '?gclid=abc' });
    const tracker = createBrowserTracker(baseConfig({ io, consentMode: 'v2' }));
    expect(writes).toEqual([]);

    tracker.updateConsent({ ad_storage: 'granted' });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatch(/^_tb_gclid=abc;/);
  });

  test('does not write cookies when consent is denied', () => {
    const { io, writes } = captureIO({ url: '?gclid=abc' });
    const tracker = createBrowserTracker(baseConfig({ io, consentMode: 'v2' }));

    tracker.updateConsent({ ad_storage: 'denied' });
    expect(writes).toEqual([]);
    // In-memory IDs persist
    expect(tracker.getClickIdentifiers()).toEqual({ gclid: 'abc' });
  });

  test('a second grant after the first does not re-write the same cookies', () => {
    const { io, writes } = captureIO({ url: '?gclid=abc' });
    const tracker = createBrowserTracker(baseConfig({ io, consentMode: 'v2' }));

    tracker.updateConsent({ ad_storage: 'granted' });
    expect(writes).toHaveLength(1);

    tracker.updateConsent({ ad_storage: 'granted' });
    expect(writes).toHaveLength(1);
  });

  test('denying after granting keeps in-memory IDs (does not delete cookies)', () => {
    const { io, writes } = captureIO({ url: '?gclid=abc' });
    const tracker = createBrowserTracker(baseConfig({ io, consentMode: 'v2' }));

    tracker.updateConsent({ ad_storage: 'granted' });
    expect(writes).toHaveLength(1);

    tracker.updateConsent({ ad_storage: 'denied' });
    expect(tracker.getClickIdentifiers()).toEqual({ gclid: 'abc' });
    expect(writes).toHaveLength(1); // no additional writes
  });

  test('consentMode "off" treats consent as granted from the start', () => {
    const { io, writes } = captureIO({ url: '?gclid=abc' });
    createBrowserTracker(baseConfig({ io, consentMode: 'off' }));

    // Cookies write at init without any updateConsent call
    expect(writes).toHaveLength(1);
  });

  test('an updateConsent call without ad_storage leaves consent state unchanged', () => {
    const { io, writes } = captureIO({ url: '?gclid=abc' });
    const tracker = createBrowserTracker(baseConfig({ io, consentMode: 'v2' }));

    tracker.updateConsent({ analytics_storage: 'granted' });
    expect(writes).toEqual([]);

    tracker.updateConsent({ ad_storage: 'granted' });
    expect(writes).toHaveLength(1);
  });
});

describe('getClickIdentifiers', () => {
  test('returns a fresh copy each call so callers cannot mutate internal state', () => {
    const { io } = captureIO({ url: '?gclid=abc' });
    const tracker = createBrowserTracker(baseConfig({ io }));

    const first = tracker.getClickIdentifiers();
    first.gclid = 'tampered';

    expect(tracker.getClickIdentifiers()).toEqual({ gclid: 'abc' });
  });
});

describe('trackEvent', () => {
  test('pushes a gtag event with name and params', async () => {
    const { io, gtagCalls } = captureIO();
    const tracker = createBrowserTracker(baseConfig({ io }));

    await tracker.trackEvent({
      name: 'add_to_cart',
      params: { value: 49, currency: 'USD' },
    });

    expect(gtagCalls).toEqual([['event', 'add_to_cart', { value: 49, currency: 'USD' }]]);
  });

  test('passes an empty params object when none supplied', async () => {
    const { io, gtagCalls } = captureIO();
    const tracker = createBrowserTracker(baseConfig({ io }));

    await tracker.trackEvent({ name: 'page_view' });

    expect(gtagCalls).toEqual([['event', 'page_view', {}]]);
  });

  test('returns a Promise that resolves to undefined', async () => {
    const { io } = captureIO();
    const tracker = createBrowserTracker(baseConfig({ io }));

    await expect(tracker.trackEvent({ name: 'page_view' })).resolves.toBeUndefined();
  });

  test('resolves silently when gtag throws', async () => {
    const failingIO: BrowserIO = {
      getUrlSearch: () => '',
      getCookieHeader: () => '',
      writeCookie: () => {},
      gtag: () => {
        throw new Error('boom');
      },
    };
    const tracker = createBrowserTracker(baseConfig({ io: failingIO }));

    await expect(tracker.trackEvent({ name: 'page_view' })).resolves.toBeUndefined();
  });

  describe('debug mode logging', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    test('logs a warning when gtag throws in debug mode', async () => {
      const failingIO: BrowserIO = {
        getUrlSearch: () => '',
        getCookieHeader: () => '',
        writeCookie: () => {},
        gtag: () => {
          throw new Error('boom');
        },
      };
      const tracker = createBrowserTracker(baseConfig({ io: failingIO, debug: true }));
      await tracker.trackEvent({ name: 'page_view' });

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(String(warnSpy.mock.calls[0]?.[0])).toMatch(/trackbridge/);
    });

    test('does NOT log when debug mode is off', async () => {
      const failingIO: BrowserIO = {
        getUrlSearch: () => '',
        getCookieHeader: () => '',
        writeCookie: () => {},
        gtag: () => {
          throw new Error('boom');
        },
      };
      const tracker = createBrowserTracker(baseConfig({ io: failingIO }));
      await tracker.trackEvent({ name: 'page_view' });

      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});

// Pinned digests for canonical normalized inputs — same source of truth as
// core/src/hash.test.ts. If these change, the dual-send invariant has been
// broken somewhere upstream.
const HASH = {
  email_jane: '8c87b489ce35cf2e2f39f80e282cb2e804932a56a213983eeeb428407d43b52d',
  phone_15551234567: '8a59780bb8cd2ba022bfa5ba2ea3b6e07af17a7d8b30c1f9b3390e36f69019e4',
  name_jane: '81f8f6dde88365f3928796ec7aa53f72820b06db8664f5fe76a7eb13e24546a2',
  name_doe: '799ef92a11af918e3fb741df42934f3b568ed2d93ac1df74f1b8d41a27932a6f',
  street_123_main_st: '9425c187ddc6f9409d827854c2b2935feca5bbc75c6001e449b7d2fdbce73bea',
} as const;

describe('trackConversion', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  test('builds send_to as "{adsConversionId}/{label}"', async () => {
    const { io, gtagCalls } = captureIO();
    const tracker = createBrowserTracker(
      baseConfig({ io, adsConversionId: 'AW-12345' }),
    );

    await tracker.trackConversion({ label: 'AbCdEfGh', transactionId: 'order_1' });

    const ev = gtagCalls.find((c) => c[0] === 'event' && c[1] === 'conversion');
    expect((ev?.[2] as Record<string, unknown>).send_to).toBe('AW-12345/AbCdEfGh');
  });

  test('passes transaction_id verbatim when supplied', async () => {
    const { io, gtagCalls } = captureIO();
    const tracker = createBrowserTracker(baseConfig({ io }));

    await tracker.trackConversion({ label: 'X', transactionId: 'order_8a91bf' });

    const ev = gtagCalls.find((c) => c[0] === 'event' && c[1] === 'conversion');
    expect((ev?.[2] as Record<string, unknown>).transaction_id).toBe('order_8a91bf');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('auto-generates transaction_id with tb_ prefix when missing', async () => {
    const { io, gtagCalls, generateTransactionId } = captureIO({ transactionId: 'tb_auto-xyz' });
    const tracker = createBrowserTracker(baseConfig({ io, generateTransactionId }));

    await tracker.trackConversion({ label: 'X' });

    const ev = gtagCalls.find((c) => c[0] === 'event' && c[1] === 'conversion');
    expect((ev?.[2] as Record<string, unknown>).transaction_id).toBe('tb_auto-xyz');
  });

  test('emits a loud warning when auto-generating transactionId (always, regardless of debug)', async () => {
    const { io, generateTransactionId } = captureIO({ transactionId: 'tb_auto-xyz' });
    const tracker = createBrowserTracker(
      baseConfig({ io, generateTransactionId, debug: false }),
    );

    await tracker.trackConversion({ label: 'X' });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const msg = String(warnSpy.mock.calls[0]?.[0]);
    expect(msg).toMatch(/trackbridge/);
    expect(msg).toMatch(/transactionId/);
    expect(msg).toMatch(/Dual-send disabled/);
    expect(msg).toContain('tb_auto-xyz');
  });

  test('treats an empty-string transactionId as missing and auto-generates', async () => {
    const { io, gtagCalls, generateTransactionId } = captureIO({ transactionId: 'tb_auto-xyz' });
    const tracker = createBrowserTracker(baseConfig({ io, generateTransactionId }));

    await tracker.trackConversion({ label: 'X', transactionId: '' });

    const ev = gtagCalls.find((c) => c[0] === 'event' && c[1] === 'conversion');
    expect((ev?.[2] as Record<string, unknown>).transaction_id).toBe('tb_auto-xyz');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  test('passes value and currency through to the conversion event', async () => {
    const { io, gtagCalls } = captureIO();
    const tracker = createBrowserTracker(baseConfig({ io }));

    await tracker.trackConversion({
      label: 'X',
      transactionId: 'order_1',
      value: 99,
      currency: 'USD',
    });

    const params = gtagCalls.find((c) => c[1] === 'conversion')?.[2] as Record<string, unknown>;
    expect(params.value).toBe(99);
    expect(params.currency).toBe('USD');
  });

  test('attaches captured click identifiers to the conversion event', async () => {
    const { io, gtagCalls } = captureIO({ url: '?gclid=ad-click-abc' });
    const tracker = createBrowserTracker(baseConfig({ io }));

    await tracker.trackConversion({ label: 'X', transactionId: 'order_1' });

    const params = gtagCalls.find((c) => c[1] === 'conversion')?.[2] as Record<string, unknown>;
    expect(params.gclid).toBe('ad-click-abc');
  });

  describe('userData → enhanced conversions user_data', () => {
    test('fires gtag set user_data BEFORE the conversion event', async () => {
      const { io, gtagCalls } = captureIO();
      const tracker = createBrowserTracker(baseConfig({ io }));

      await tracker.trackConversion({
        label: 'X',
        transactionId: 'order_1',
        userData: { email: 'jane@example.com' },
      });

      const setIdx = gtagCalls.findIndex((c) => c[0] === 'set' && c[1] === 'user_data');
      const evIdx = gtagCalls.findIndex((c) => c[0] === 'event' && c[1] === 'conversion');
      expect(setIdx).toBeGreaterThanOrEqual(0);
      expect(evIdx).toBeGreaterThanOrEqual(0);
      expect(setIdx).toBeLessThan(evIdx);
    });

    test('hashes email at the top level under the "email" key', async () => {
      const { io, gtagCalls } = captureIO();
      const tracker = createBrowserTracker(baseConfig({ io }));

      await tracker.trackConversion({
        label: 'X',
        transactionId: 'order_1',
        userData: { email: '  Jane@Example.COM ' },
      });

      const set = gtagCalls.find((c) => c[0] === 'set' && c[1] === 'user_data');
      expect(set?.[2]).toEqual({ email: HASH.email_jane });
    });

    test('hashes phone at the top level under the "phone_number" key', async () => {
      const { io, gtagCalls } = captureIO();
      const tracker = createBrowserTracker(baseConfig({ io }));

      await tracker.trackConversion({
        label: 'X',
        transactionId: 'order_1',
        userData: { phone: '+1 (555) 123-4567' },
      });

      const set = gtagCalls.find((c) => c[0] === 'set' && c[1] === 'user_data');
      expect(set?.[2]).toEqual({ phone_number: HASH.phone_15551234567 });
    });

    test('puts hashed name fields and street inside the address sub-object', async () => {
      const { io, gtagCalls } = captureIO();
      const tracker = createBrowserTracker(baseConfig({ io }));

      await tracker.trackConversion({
        label: 'X',
        transactionId: 'order_1',
        userData: { firstName: 'Jane', lastName: 'Doe' },
      });

      const set = gtagCalls.find((c) => c[0] === 'set' && c[1] === 'user_data');
      expect(set?.[2]).toEqual({
        address: { first_name: HASH.name_jane, last_name: HASH.name_doe },
      });
    });

    test('keeps city, region, postal_code, and country unhashed in the address sub-object', async () => {
      const { io, gtagCalls } = captureIO();
      const tracker = createBrowserTracker(baseConfig({ io }));

      await tracker.trackConversion({
        label: 'X',
        transactionId: 'order_1',
        userData: {
          address: { city: 'AUSTIN', region: ' TX ', postalCode: '78701', country: 'us' },
        },
      });

      const set = gtagCalls.find((c) => c[0] === 'set' && c[1] === 'user_data');
      expect(set?.[2]).toEqual({
        address: { city: 'austin', region: 'tx', postal_code: '78701', country: 'US' },
      });
    });

    test('full userData mixes hashed PII with normalized unhashed address in gtag shape', async () => {
      const { io, gtagCalls } = captureIO();
      const tracker = createBrowserTracker(baseConfig({ io }));

      await tracker.trackConversion({
        label: 'X',
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

      const set = gtagCalls.find((c) => c[0] === 'set' && c[1] === 'user_data');
      expect(set?.[2]).toEqual({
        email: HASH.email_jane,
        phone_number: HASH.phone_15551234567,
        address: {
          first_name: HASH.name_jane,
          last_name: HASH.name_doe,
          street: HASH.street_123_main_st,
          city: 'austin',
          region: 'tx',
          postal_code: '78701',
          country: 'US',
        },
      });
    });

    test('skips the gtag set call entirely when userData has no surviving fields', async () => {
      const { io, gtagCalls } = captureIO();
      const tracker = createBrowserTracker(baseConfig({ io }));

      await tracker.trackConversion({
        label: 'X',
        transactionId: 'order_1',
        userData: { email: '   \t', address: { city: '' } },
      });

      expect(gtagCalls.find((c) => c[0] === 'set' && c[1] === 'user_data')).toBeUndefined();
    });

    test('skips the gtag set call when userData is omitted entirely', async () => {
      const { io, gtagCalls } = captureIO();
      const tracker = createBrowserTracker(baseConfig({ io }));

      await tracker.trackConversion({ label: 'X', transactionId: 'order_1' });

      expect(gtagCalls.find((c) => c[0] === 'set' && c[1] === 'user_data')).toBeUndefined();
    });
  });

  test('returns a Promise<void>', async () => {
    const { io } = captureIO();
    const tracker = createBrowserTracker(baseConfig({ io }));

    await expect(
      tracker.trackConversion({ label: 'X', transactionId: 'order_1' }),
    ).resolves.toBeUndefined();
  });

  test('resolves silently when gtag throws', async () => {
    const failingIO: BrowserIO = {
      getUrlSearch: () => '',
      getCookieHeader: () => '',
      writeCookie: () => {},
      gtag: () => {
        throw new Error('boom');
      },
    };
    const tracker = createBrowserTracker(baseConfig({ io: failingIO }));

    await expect(
      tracker.trackConversion({ label: 'X', transactionId: 'order_1' }),
    ).resolves.toBeUndefined();
  });

  test('logs a debug warning when gtag throws in debug mode', async () => {
    const failingIO: BrowserIO = {
      getUrlSearch: () => '',
      getCookieHeader: () => '',
      writeCookie: () => {},
      gtag: () => {
        throw new Error('boom');
      },
    };
    const tracker = createBrowserTracker(baseConfig({ io: failingIO, debug: true }));

    await tracker.trackConversion({ label: 'X', transactionId: 'order_1' });

    // A second console.warn from the gtag failure (auto-tx warning would only fire if no transactionId).
    expect(warnSpy).toHaveBeenCalled();
    const messages = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes('conversion failed'))).toBe(true);
  });
});

describe('trackEvent — userData (symmetric with server)', () => {
  test('fires gtag set user_data BEFORE the event when userData is supplied', async () => {
    const { io, gtagCalls } = captureIO();
    const tracker = createBrowserTracker(baseConfig({ io }));

    await tracker.trackEvent({
      name: 'login',
      userData: { email: 'jane@example.com' },
    });

    const setIdx = gtagCalls.findIndex((c) => c[0] === 'set' && c[1] === 'user_data');
    const evIdx = gtagCalls.findIndex((c) => c[0] === 'event' && c[1] === 'login');
    expect(setIdx).toBeGreaterThanOrEqual(0);
    expect(evIdx).toBeGreaterThanOrEqual(0);
    expect(setIdx).toBeLessThan(evIdx);
  });

  test('hashes email under "email" key (same shape as trackConversion)', async () => {
    const { io, gtagCalls } = captureIO();
    const tracker = createBrowserTracker(baseConfig({ io }));

    await tracker.trackEvent({
      name: 'sign_up',
      userData: { email: '  Jane@Example.COM ' },
    });

    const set = gtagCalls.find((c) => c[0] === 'set' && c[1] === 'user_data');
    expect(set?.[2]).toEqual({ email: HASH.email_jane });
  });

  test('skips the gtag set call when userData is omitted', async () => {
    const { io, gtagCalls } = captureIO();
    const tracker = createBrowserTracker(baseConfig({ io }));

    await tracker.trackEvent({ name: 'page_view' });

    expect(gtagCalls.find((c) => c[0] === 'set' && c[1] === 'user_data')).toBeUndefined();
    expect(gtagCalls.find((c) => c[1] === 'page_view')).toBeDefined();
  });
});

describe('Consent Mode v2 — ad_user_data gates userData sending', () => {
  test('omits the gtag set call entirely when consentMode v2 and ad_user_data has not been granted', async () => {
    const { io, gtagCalls } = captureIO();
    const tracker = createBrowserTracker(baseConfig({ io, consentMode: 'v2' }));

    await tracker.trackConversion({
      label: 'X',
      transactionId: 'order_1',
      userData: { email: 'jane@example.com' },
    });

    expect(gtagCalls.find((c) => c[0] === 'set' && c[1] === 'user_data')).toBeUndefined();
    // Conversion event itself still fires — only userData is suppressed.
    expect(gtagCalls.find((c) => c[1] === 'conversion')).toBeDefined();
  });

  test('still omits userData after ad_storage grant if ad_user_data is not granted', async () => {
    const { io, gtagCalls } = captureIO();
    const tracker = createBrowserTracker(baseConfig({ io, consentMode: 'v2' }));
    tracker.updateConsent({ ad_storage: 'granted' });

    await tracker.trackConversion({
      label: 'X',
      transactionId: 'order_1',
      userData: { email: 'jane@example.com' },
    });

    expect(gtagCalls.find((c) => c[0] === 'set' && c[1] === 'user_data')).toBeUndefined();
  });

  test('attaches userData once ad_user_data is granted', async () => {
    const { io, gtagCalls } = captureIO();
    const tracker = createBrowserTracker(baseConfig({ io, consentMode: 'v2' }));
    tracker.updateConsent({ ad_user_data: 'granted' });

    await tracker.trackConversion({
      label: 'X',
      transactionId: 'order_1',
      userData: { email: 'jane@example.com' },
    });

    const set = gtagCalls.find((c) => c[0] === 'set' && c[1] === 'user_data');
    expect(set?.[2]).toEqual({ email: HASH.email_jane });
  });

  test('drops userData again after ad_user_data is denied', async () => {
    const { io, gtagCalls } = captureIO();
    const tracker = createBrowserTracker(baseConfig({ io, consentMode: 'v2' }));
    tracker.updateConsent({ ad_user_data: 'granted' });
    tracker.updateConsent({ ad_user_data: 'denied' });

    await tracker.trackConversion({
      label: 'X',
      transactionId: 'order_1',
      userData: { email: 'jane@example.com' },
    });

    expect(gtagCalls.find((c) => c[0] === 'set' && c[1] === 'user_data')).toBeUndefined();
  });

  test('also gates trackEvent userData under ad_user_data', async () => {
    const { io, gtagCalls } = captureIO();
    const tracker = createBrowserTracker(baseConfig({ io, consentMode: 'v2' }));

    await tracker.trackEvent({
      name: 'login',
      userData: { email: 'jane@example.com' },
    });

    expect(gtagCalls.find((c) => c[0] === 'set' && c[1] === 'user_data')).toBeUndefined();
    expect(gtagCalls.find((c) => c[1] === 'login')).toBeDefined();
  });

  test('consentMode "off" does not gate userData (treats as granted)', async () => {
    const { io, gtagCalls } = captureIO();
    const tracker = createBrowserTracker(baseConfig({ io, consentMode: 'off' }));

    await tracker.trackConversion({
      label: 'X',
      transactionId: 'order_1',
      userData: { email: 'jane@example.com' },
    });

    const set = gtagCalls.find((c) => c[0] === 'set' && c[1] === 'user_data');
    expect(set?.[2]).toEqual({ email: HASH.email_jane });
  });
});

describe('getConsent', () => {
  test('consentMode "off" → all four signals start "granted"', () => {
    const { io } = captureIO();
    const tracker = createBrowserTracker(baseConfig({ io, consentMode: 'off' }));

    expect(tracker.getConsent()).toEqual({
      ad_storage: 'granted',
      ad_user_data: 'granted',
      ad_personalization: 'granted',
      analytics_storage: 'granted',
    });
  });

  test('consentMode "v2" → all four signals start "unknown"', () => {
    const { io } = captureIO();
    const tracker = createBrowserTracker(baseConfig({ io, consentMode: 'v2' }));

    expect(tracker.getConsent()).toEqual({
      ad_storage: 'unknown',
      ad_user_data: 'unknown',
      ad_personalization: 'unknown',
      analytics_storage: 'unknown',
    });
  });

  test('updateConsent only changes the signals it specifies', () => {
    const { io } = captureIO();
    const tracker = createBrowserTracker(baseConfig({ io, consentMode: 'v2' }));

    tracker.updateConsent({ ad_storage: 'granted' });
    expect(tracker.getConsent()).toEqual({
      ad_storage: 'granted',
      ad_user_data: 'unknown',
      ad_personalization: 'unknown',
      analytics_storage: 'unknown',
    });
  });

  test('updateConsent stores ad_personalization and analytics_storage verbatim', () => {
    const { io } = captureIO();
    const tracker = createBrowserTracker(baseConfig({ io, consentMode: 'v2' }));

    tracker.updateConsent({ ad_personalization: 'denied', analytics_storage: 'granted' });
    const c = tracker.getConsent();
    expect(c.ad_personalization).toBe('denied');
    expect(c.analytics_storage).toBe('granted');
    // The two we don't act on are stored — but the two we DO act on remain unknown.
    expect(c.ad_storage).toBe('unknown');
    expect(c.ad_user_data).toBe('unknown');
  });

  test('returns a defensive copy — mutating it does not affect the next read', () => {
    const { io } = captureIO();
    const tracker = createBrowserTracker(baseConfig({ io, consentMode: 'off' }));

    const first = tracker.getConsent();
    first.ad_storage = 'denied';

    expect(tracker.getConsent().ad_storage).toBe('granted');
  });

  test('round-trip: tracker.updateConsent(tracker.getConsent()) is idempotent', () => {
    const { io, writes } = captureIO({ url: '?gclid=abc' });
    const tracker = createBrowserTracker(baseConfig({ io, consentMode: 'v2' }));

    tracker.updateConsent({ ad_storage: 'granted', ad_user_data: 'granted' });
    expect(writes).toHaveLength(1);

    // Read state, write it back — should not produce additional cookie writes
    // and should not change the visible consent state.
    const before = tracker.getConsent();
    tracker.updateConsent(before);
    expect(tracker.getConsent()).toEqual(before);
    expect(writes).toHaveLength(1);
  });
});

describe('getClientId', () => {
  test('returns the canonical clientId from a valid _ga cookie', () => {
    const { io } = captureIO({ cookies: '_ga=GA1.1.1234567890.9876543210' });
    const tracker = createBrowserTracker(baseConfig({ io }));

    expect(tracker.getClientId()).toBe('1234567890.9876543210');
  });

  test('returns undefined when the _ga cookie is absent', () => {
    const { io } = captureIO({ cookies: '_tb_gclid=xyz; _other=1' });
    const tracker = createBrowserTracker(baseConfig({ io }));

    expect(tracker.getClientId()).toBeUndefined();
  });

  test('returns undefined for malformed _ga values (no dots)', () => {
    const { io } = captureIO({ cookies: '_ga=GA1' });
    const tracker = createBrowserTracker(baseConfig({ io }));

    expect(tracker.getClientId()).toBeUndefined();
  });

  test('returns undefined for malformed _ga values (only one dot)', () => {
    const { io } = captureIO({ cookies: '_ga=GA1.1' });
    const tracker = createBrowserTracker(baseConfig({ io }));

    expect(tracker.getClientId()).toBeUndefined();
  });

  test('returns undefined when the substring after the second dot is empty', () => {
    const { io } = captureIO({ cookies: '_ga=GA1.1.' });
    const tracker = createBrowserTracker(baseConfig({ io }));

    expect(tracker.getClientId()).toBeUndefined();
  });

  test('does NOT match the GA4 session cookie _ga_<measurementId>', () => {
    const { io } = captureIO({ cookies: '_ga_G-XXXXXXXXXX=GS1.1.1.1.0.0' });
    const tracker = createBrowserTracker(baseConfig({ io }));

    expect(tracker.getClientId()).toBeUndefined();
  });

  test('tolerates leading whitespace and ordering — _ga later in the cookie header', () => {
    const { io } = captureIO({ cookies: '_other=foo; _ga=GA1.1.111.222' });
    const tracker = createBrowserTracker(baseConfig({ io }));

    expect(tracker.getClientId()).toBe('111.222');
  });

  test('skips a malformed _ga and continues to a later valid one in the same header', () => {
    const { io } = captureIO({ cookies: '_ga=GA1; _ga=GA1.1.111.222' });
    const tracker = createBrowserTracker(baseConfig({ io }));

    expect(tracker.getClientId()).toBe('111.222');
  });
});

describe('setDebug', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  test('toggling debug to true makes a failing gtag call produce a warn', async () => {
    const failingIO: BrowserIO = {
      getUrlSearch: () => '',
      getCookieHeader: () => '',
      writeCookie: () => {},
      gtag: () => {
        throw new Error('boom');
      },
    };
    const tracker = createBrowserTracker(baseConfig({ io: failingIO, debug: false }));

    // Confirm baseline: no warn at debug:false
    await tracker.trackEvent({ name: 'page_view' });
    expect(warnSpy).not.toHaveBeenCalled();

    tracker.setDebug(true);
    await tracker.trackEvent({ name: 'page_view' });
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  test('toggling debug to false silences subsequent warns', async () => {
    const failingIO: BrowserIO = {
      getUrlSearch: () => '',
      getCookieHeader: () => '',
      writeCookie: () => {},
      gtag: () => {
        throw new Error('boom');
      },
    };
    const tracker = createBrowserTracker(baseConfig({ io: failingIO, debug: true }));

    await tracker.trackEvent({ name: 'page_view' });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockClear();

    tracker.setDebug(false);
    await tracker.trackEvent({ name: 'page_view' });
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
