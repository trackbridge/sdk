import {
  hashSha256,
  normalizeAddress,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  type TrackbridgeContext,
  type UserData,
} from '@trackbridge/core';

import {
  buildClickIdentifierCookieStrings,
  parseClickIdentifiersFromCookies,
  parseClickIdentifiersFromUrl,
} from './click-ids.js';
import { executePurchase, type BrowserHelperContext } from './helpers.js';
import type {
  BrowserAddToCartInput,
  BrowserBeginCheckoutInput,
  BrowserConversionInput,
  BrowserEventInput,
  BrowserIO,
  BrowserPageViewInput,
  BrowserPurchaseInput,
  BrowserRefundInput,
  BrowserSignUpInput,
  BrowserTracker,
  BrowserTrackerConfig,
  ClickIdentifiers,
  ConsentState,
  ConsentUpdate,
  ConsentValue,
  ExportContextInput,
} from './types.js';

const DEFAULT_COOKIE_EXPIRY_DAYS = 90;

/**
 * Creates a client-side tracker that captures Google Ads click
 * identifiers from the URL, persists them to first-party cookies
 * (subject to consent), and fires GA4 events / Google Ads conversions
 * via gtag.
 */
export function createBrowserTracker(config: BrowserTrackerConfig): BrowserTracker {
  if (!config.adsConversionId) {
    throw new Error('[trackbridge] adsConversionId is required');
  }

  const consentMode = config.consentMode ?? 'off';
  const storage = config.clickIdentifierStorage ?? 'cookie';
  const cookieExpiryDays = config.cookieExpiryDays ?? DEFAULT_COOKIE_EXPIRY_DAYS;
  const ga4MeasurementId = config.ga4MeasurementId;
  const io = config.io ?? createDefaultBrowserIO();
  let debug = resolveInitialDebug(config, io);
  const generateTransactionId =
    config.generateTransactionId ?? (() => `tb_${globalThis.crypto.randomUUID()}`);
  const now = config.now ?? (() => Date.now());

  // Replace the two-boolean state with a four-key record. The signals
  // we act on (ad_storage, ad_user_data) drive the same persistence /
  // PII-gate logic; ad_personalization and analytics_storage are
  // stored verbatim so banners can read them back via getConsent().
  let consent: ConsentState = initialConsentState(consentMode);
  let ids: ClickIdentifiers = {};
  let userId: string | undefined = undefined;
  let lastPageViewPath: string | undefined = undefined;

  if (storage !== 'none') {
    const cookieIds =
      storage === 'cookie' ? parseClickIdentifiersFromCookies(io.getCookieHeader()) : {};
    const urlIds = parseClickIdentifiersFromUrl(io.getUrlSearch());
    ids = { ...cookieIds, ...urlIds };
  }

  const persist = (): void => {
    if (storage !== 'cookie' || consent.ad_storage !== 'granted') return;
    if (Object.keys(ids).length === 0) return;
    const cookies = buildClickIdentifierCookieStrings(ids, {
      expiryDays: cookieExpiryDays,
      domain: config.cookieDomain,
    });
    for (const cookie of cookies) io.writeCookie(cookie);
  };

  persist();

  const maybeSetUserData = async (userData: UserData | undefined): Promise<void> => {
    if (userData === undefined) return;
    if (consent.ad_user_data !== 'granted') return;
    const built = await buildGtagUserData(userData);
    if (built !== undefined) io.gtag('set', 'user_data', built);
  };

  const conversionLabels = config.conversionLabels ?? {};
  const resolveTransactionId = (incoming: string | undefined): string => {
    if (incoming !== undefined && incoming !== '') return incoming;
    const generated = generateTransactionId();
    warnAutoTransactionId(generated);
    return generated;
  };

  const helperContext: BrowserHelperContext = {
    adsConversionId: config.adsConversionId,
    conversionLabels,
    debug: () => debug,
    ids: () => ({ ...ids }),
    consent: () => ({ ...consent }),
    maybeSetUserData,
    gtag: (...args) => io.gtag(...args),
    resolveTransactionId,
  };

  return {
    getClickIdentifiers(): ClickIdentifiers {
      return { ...ids };
    },
    getConsent(): ConsentState {
      return { ...consent };
    },
    getClientId(): string | undefined {
      return readGaClientId(io.getCookieHeader());
    },
    getSessionId(): string | undefined {
      if (ga4MeasurementId === undefined) return undefined;
      return readGa4SessionId(io.getCookieHeader(), ga4MeasurementId);
    },
    exportContext(input?: ExportContextInput): TrackbridgeContext {
      const ctx: TrackbridgeContext = {
        v: 1,
        createdAt: now(),
        clickIds: { ...ids },
        consent: { ...consent },
      };
      const cid = readGaClientId(io.getCookieHeader());
      if (cid !== undefined) ctx.clientId = cid;
      if (ga4MeasurementId !== undefined) {
        const sid = readGa4SessionId(io.getCookieHeader(), ga4MeasurementId);
        if (sid !== undefined) ctx.sessionId = sid;
      }
      if (userId !== undefined) ctx.userId = userId;
      if (input?.userData !== undefined) ctx.userData = input.userData;
      return ctx;
    },
    updateConsent(update: ConsentUpdate): void {
      const wasStorageGranted = consent.ad_storage === 'granted';
      if (update.ad_storage !== undefined) consent.ad_storage = update.ad_storage;
      if (update.ad_user_data !== undefined) consent.ad_user_data = update.ad_user_data;
      if (update.ad_personalization !== undefined) {
        consent.ad_personalization = update.ad_personalization;
      }
      if (update.analytics_storage !== undefined) {
        consent.analytics_storage = update.analytics_storage;
      }

      if (!wasStorageGranted && consent.ad_storage === 'granted') persist();
    },
    async trackEvent(input: BrowserEventInput): Promise<void> {
      try {
        await maybeSetUserData(input.userData);
        io.gtag('event', input.name, input.params ?? {});
      } catch (err) {
        if (debug) console.warn('[trackbridge] gtag event failed:', err);
      }
    },
    async trackConversion(input: BrowserConversionInput): Promise<void> {
      let transactionId = input.transactionId;
      if (transactionId === undefined || transactionId === '') {
        transactionId = generateTransactionId();
        warnAutoTransactionId(transactionId);
      }

      try {
        await maybeSetUserData(input.userData);

        const params: Record<string, unknown> = {
          send_to: `${config.adsConversionId}/${input.label}`,
          transaction_id: transactionId,
        };
        if (input.value !== undefined) params.value = input.value;
        if (input.currency !== undefined) params.currency = input.currency;
        if (ids.gclid !== undefined) params.gclid = ids.gclid;
        if (ids.gbraid !== undefined) params.gbraid = ids.gbraid;
        if (ids.wbraid !== undefined) params.wbraid = ids.wbraid;

        io.gtag('event', 'conversion', params);
      } catch (err) {
        if (debug) console.warn('[trackbridge] gtag conversion failed:', err);
      }
    },
    setDebug(enabled: boolean): void {
      debug = enabled;
    },
    identifyUser(id: string): void {
      if (ga4MeasurementId === undefined) {
        if (debug) {
          console.warn(
            '[trackbridge] identifyUser called without ga4MeasurementId — no-op',
          );
        }
        return;
      }
      userId = id;
      io.gtag('config', ga4MeasurementId, { user_id: id, send_page_view: false });
    },
    clearUser(): void {
      if (ga4MeasurementId === undefined) {
        if (debug) {
          console.warn(
            '[trackbridge] clearUser called without ga4MeasurementId — no-op',
          );
        }
        return;
      }
      userId = undefined;
      io.gtag('config', ga4MeasurementId, { user_id: undefined, send_page_view: false });
    },
    async trackPageView(input?: BrowserPageViewInput): Promise<void> {
      if (ga4MeasurementId === undefined) {
        if (debug) {
          console.warn(
            '[trackbridge] trackPageView called without ga4MeasurementId — no-op',
          );
        }
        return;
      }
      const path = input?.path ?? defaultPath();
      const title = input?.title ?? defaultTitle();
      const location = defaultLocation();

      if (path === lastPageViewPath) {
        if (debug) {
          console.warn(`[trackbridge] trackPageView deduped repeat for path: ${path}`);
        }
        return;
      }
      lastPageViewPath = path;

      try {
        io.gtag('event', 'page_view', {
          page_path: path,
          page_title: title,
          page_location: location,
        });
      } catch (err) {
        if (debug) console.warn('[trackbridge] gtag page_view failed:', err);
      }
    },
    async trackPurchase(input: BrowserPurchaseInput): Promise<void> {
      await executePurchase(input, helperContext);
    },
    async trackBeginCheckout(_input?: BrowserBeginCheckoutInput): Promise<void> {},
    async trackAddToCart(_input?: BrowserAddToCartInput): Promise<void> {},
    async trackSignUp(_input?: BrowserSignUpInput): Promise<void> {},
    async trackRefund(_input: BrowserRefundInput): Promise<void> {},
  };
}

function warnAutoTransactionId(id: string): void {
  console.warn(
    `[trackbridge] ⚠️ trackConversion called without transactionId\n` +
      `  → Auto-generated: ${id}\n` +
      `  → Dual-send disabled for this call. Pass a transactionId you control\n` +
      `    to enable cross-side dedup.\n` +
      `  → See: https://docs.trackbridge.dev/sdk/concepts/deduplication/`,
  );
}

type GtagAddressEntry = {
  first_name?: string;
  last_name?: string;
  street?: string;
  city?: string;
  region?: string;
  postal_code?: string;
  country?: string;
};

type GtagUserData = {
  email?: string;
  phone_number?: string;
  address?: GtagAddressEntry;
};

/**
 * Builds the `user_data` payload for gtag's enhanced conversions.
 *
 * Email, phone, first name, last name, and street are SHA-256 hashed
 * (Google's spec). City, region, postal code, and country are sent as
 * normalized plaintext inside the same `address` sub-object. Returns
 * `undefined` when no field survives normalization, so the caller can
 * skip the `gtag('set', 'user_data', …)` call entirely.
 */
async function buildGtagUserData(input: UserData): Promise<GtagUserData | undefined> {
  const out: GtagUserData = {};

  if (input.email !== undefined) {
    const v = normalizeEmail(input.email);
    if (v !== '') out.email = await hashSha256(v);
  }
  if (input.phone !== undefined) {
    const v = normalizePhone(input.phone);
    if (v !== '') out.phone_number = await hashSha256(v);
  }

  const addr: GtagAddressEntry = {};
  if (input.firstName !== undefined) {
    const v = normalizeName(input.firstName);
    if (v !== '') addr.first_name = await hashSha256(v);
  }
  if (input.lastName !== undefined) {
    const v = normalizeName(input.lastName);
    if (v !== '') addr.last_name = await hashSha256(v);
  }
  if (input.address !== undefined) {
    const norm = normalizeAddress(input.address);
    if (norm.street !== undefined && norm.street !== '') {
      addr.street = await hashSha256(norm.street);
    }
    if (norm.city !== undefined && norm.city !== '') addr.city = norm.city;
    if (norm.region !== undefined && norm.region !== '') addr.region = norm.region;
    if (norm.postalCode !== undefined && norm.postalCode !== '') addr.postal_code = norm.postalCode;
    if (norm.country !== undefined && norm.country !== '') addr.country = norm.country;
  }
  if (Object.keys(addr).length > 0) out.address = addr;

  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Parses the canonical GA4 client ID from a `document.cookie`-style
 * header. The `_ga` value format is `GA<major>.<subDomainCount>.<rand>.<ts>`
 * (see https://developers.google.com/analytics/devguides/collection/analyticsjs/cookies-user-id);
 * the canonical client ID for Measurement Protocol calls is everything
 * after the second `.`. Returns `undefined` if the cookie is absent or
 * malformed. Must NOT match `_ga_<measurementId>` (the GA4 session
 * cookie).
 */
function readGaClientId(cookieHeader: string): string | undefined {
  if (cookieHeader === '') return undefined;
  for (const rawPair of cookieHeader.split(';')) {
    const pair = rawPair.trim();
    const eqIdx = pair.indexOf('=');
    if (eqIdx <= 0) continue;
    if (pair.slice(0, eqIdx) !== '_ga') continue;
    const value = pair.slice(eqIdx + 1);
    const firstDot = value.indexOf('.');
    if (firstDot <= 0) continue;
    const secondDot = value.indexOf('.', firstDot + 1);
    if (secondDot <= 0) continue;
    const id = value.slice(secondDot + 1);
    if (id === '') continue;
    return id;
  }
  return undefined;
}

/**
 * Parses the canonical GA4 session ID from a `document.cookie`-style
 * header. The `_ga_<containerId>` value format is
 * `GS<version>.<count>.<sessionId>.<sessionStart>.<...>`. The session
 * ID is everything between the second and third dots. Returns
 * `undefined` if the cookie is absent or malformed. Cookie name uses
 * the measurement ID with the leading `G-` stripped.
 */
function readGa4SessionId(cookieHeader: string, measurementId: string): string | undefined {
  if (cookieHeader === '') return undefined;
  const cookieName = `_ga_${measurementId.replace(/^G-/, '')}`;
  for (const rawPair of cookieHeader.split(';')) {
    const pair = rawPair.trim();
    const eqIdx = pair.indexOf('=');
    if (eqIdx <= 0) continue;
    if (pair.slice(0, eqIdx) !== cookieName) continue;
    const value = pair.slice(eqIdx + 1);
    const parts = value.split('.');
    if (parts.length < 3) continue;
    const id = parts[2];
    if (id === undefined || id === '') continue;
    return id;
  }
  return undefined;
}

function resolveInitialDebug(config: BrowserTrackerConfig, io: BrowserIO): boolean {
  let debug = config.debug ?? false;
  if (config.debugUrlParam === true) {
    const params = new URLSearchParams(io.getUrlSearch());
    const flag = params.get('tb_debug');
    if (flag === '1') debug = true;
    else if (flag === '0') debug = false;
  }
  return debug;
}

function initialConsentState(mode: 'v2' | 'off'): ConsentState {
  const initial: ConsentValue | 'unknown' = mode === 'off' ? 'granted' : 'unknown';
  return {
    ad_storage: initial,
    ad_user_data: initial,
    ad_personalization: initial,
    analytics_storage: initial,
  };
}

function createDefaultBrowserIO(): BrowserIO {
  return {
    getUrlSearch: () => (typeof window !== 'undefined' ? window.location.search : ''),
    getCookieHeader: () => (typeof document !== 'undefined' ? document.cookie : ''),
    writeCookie: (cookie) => {
      if (typeof document !== 'undefined') document.cookie = cookie;
    },
    gtag: (...args) => {
      if (typeof window === 'undefined') return;
      const w = window as Window & { dataLayer?: unknown[] };
      if (w.dataLayer === undefined) w.dataLayer = [];
      w.dataLayer.push(args);
    },
  };
}

function defaultPath(): string {
  if (typeof window === 'undefined') return '';
  return window.location.pathname + window.location.search;
}

function defaultTitle(): string {
  if (typeof document === 'undefined') return '';
  return document.title;
}

function defaultLocation(): string {
  if (typeof window === 'undefined') return '';
  return window.location.href;
}
