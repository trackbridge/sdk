import {
  hashSha256,
  normalizeAddress,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  type UserData,
} from '@trackbridge/core';

import {
  buildClickIdentifierCookieStrings,
  parseClickIdentifiersFromCookies,
  parseClickIdentifiersFromUrl,
} from './click-ids.js';
import type {
  BrowserConversionInput,
  BrowserEventInput,
  BrowserIO,
  BrowserTracker,
  BrowserTrackerConfig,
  ClickIdentifiers,
  ConsentUpdate,
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
  const debug = config.debug ?? false;
  const io = config.io ?? createDefaultBrowserIO();
  const generateTransactionId =
    config.generateTransactionId ?? (() => `tb_${globalThis.crypto.randomUUID()}`);

  let storageGranted = consentMode === 'off';
  // userData is gated independently of click-id cookies (different
  // GDPR signal). Default = granted under consentMode 'off', otherwise
  // denied-until-granted via updateConsent. See CLAUDE.md principle 4.
  let userDataGranted = consentMode === 'off';
  let ids: ClickIdentifiers = {};

  if (storage !== 'none') {
    const cookieIds =
      storage === 'cookie' ? parseClickIdentifiersFromCookies(io.getCookieHeader()) : {};
    const urlIds = parseClickIdentifiersFromUrl(io.getUrlSearch());
    ids = { ...cookieIds, ...urlIds };
  }

  const persist = (): void => {
    if (storage !== 'cookie' || !storageGranted) return;
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
    if (!userDataGranted) return;
    const built = await buildGtagUserData(userData);
    if (built !== undefined) io.gtag('set', 'user_data', built);
  };

  return {
    getClickIdentifiers(): ClickIdentifiers {
      return { ...ids };
    },
    updateConsent(update: ConsentUpdate): void {
      const wasStorageGranted = storageGranted;
      if (update.ad_storage === 'granted') storageGranted = true;
      else if (update.ad_storage === 'denied') storageGranted = false;

      if (update.ad_user_data === 'granted') userDataGranted = true;
      else if (update.ad_user_data === 'denied') userDataGranted = false;

      if (!wasStorageGranted && storageGranted) persist();
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
