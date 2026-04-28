import {
  hashSha256,
  normalizeAddress,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  type UserData,
} from '@trackbridge/core';

import { createAdsApiClient, type AdsApiClient } from './ads-api.js';
import { createAccessTokenProvider } from './oauth.js';
import type {
  SendResult,
  ServerConsent,
  ServerConversionInput,
  ServerConversionResult,
  ServerEventInput,
  ServerEventResult,
  ServerTracker,
  ServerTrackerConfig,
} from './types.js';

/**
 * userData is dropped from the outbound payload when the caller
 * supplied a consent object and `ad_user_data` is anything other than
 * `'granted'`. Omitting consent entirely is treated as "the caller
 * doesn't track consent here" — userData is sent.
 */
function userDataAllowed(consent: ServerConsent | undefined): boolean {
  if (consent === undefined) return true;
  return consent.ad_user_data === 'granted';
}

const GA4_MP_ENDPOINT = 'https://www.google-analytics.com/mp/collect';

/**
 * Creates a server-side tracker that sends events through the GA4
 * Measurement Protocol and (when {@link ServerTrackerConfig.ads} is
 * configured) conversions through the Google Ads API.
 *
 * Failure semantics: runtime API failures (network errors, non-2xx
 * responses, OAuth refresh failures) never throw. They resolve to a
 * structured {@link SendResult} on the returned object so callers can
 * surface, log, or ignore them without try/catch. Programming errors
 * (missing required config, unknown conversion label) throw at
 * config-time or call-time so they fail loud.
 */
export function createServerTracker(config: ServerTrackerConfig): ServerTracker {
  if (!config.ga4MeasurementId) {
    throw new Error('[trackbridge] ga4MeasurementId is required');
  }
  if (!config.ga4ApiSecret) {
    throw new Error('[trackbridge] ga4ApiSecret is required');
  }

  const debug = config.debug ?? false;
  const fetchImpl = config.fetch ?? globalThis.fetch;
  const now = config.now ?? (() => Date.now());
  const generateTransactionId =
    config.generateTransactionId ?? (() => `tb_${globalThis.crypto.randomUUID()}`);

  let adsApiClient: AdsApiClient | null = null;
  if (config.ads !== undefined) {
    const tokenProvider = createAccessTokenProvider(
      {
        clientId: config.ads.clientId,
        clientSecret: config.ads.clientSecret,
        refreshToken: config.ads.refreshToken,
      },
      { fetch: fetchImpl, now },
    );
    adsApiClient = createAdsApiClient({
      developerToken: config.ads.developerToken,
      tokenProvider,
      loginCustomerId: config.ads.loginCustomerId,
      fetch: fetchImpl,
      apiVersion: config.ads.apiVersion,
    });
  }

  return {
    async trackEvent(input: ServerEventInput): Promise<ServerEventResult> {
      const url = new URL(GA4_MP_ENDPOINT);
      url.searchParams.set('measurement_id', config.ga4MeasurementId);
      url.searchParams.set('api_secret', config.ga4ApiSecret);

      const body: Record<string, unknown> = {
        client_id: input.clientId,
        events: [{ name: input.name, params: input.params ?? {} }],
      };

      if (input.userData !== undefined && userDataAllowed(input.consent)) {
        const userData = await buildGa4UserData(input.userData);
        if (userData !== undefined) body.user_data = userData;
      }

      let ga4: SendResult;
      try {
        const response = await fetchImpl(url.toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (response.ok) {
          ga4 = { ok: true };
        } else {
          const error = new Error(
            `[trackbridge] GA4 MP returned ${response.status} ${response.statusText}`,
          );
          if (debug) console.warn(error.message);
          ga4 = { ok: false, error };
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        if (debug) console.warn('[trackbridge] GA4 MP request failed:', error);
        ga4 = { ok: false, error };
      }
      return { ga4 };
    },

    async trackConversion(input: ServerConversionInput): Promise<ServerConversionResult> {
      const ads = config.ads;
      if (ads === undefined || adsApiClient === null) {
        throw new Error(
          '[trackbridge] trackConversion requires `ads` to be configured on createServerTracker',
        );
      }
      const conversionAction = ads.conversionActions[input.label];
      if (conversionAction === undefined) {
        throw new Error(
          `[trackbridge] no conversionAction configured for label "${input.label}". ` +
            `Add it to ads.conversionActions in createServerTracker config.`,
        );
      }

      let transactionId = input.transactionId;
      if (transactionId === undefined || transactionId === '') {
        transactionId = generateTransactionId();
        warnAutoTransactionId(transactionId);
      }

      const conversion: Record<string, unknown> = {
        conversionAction,
        conversionDateTime: formatConversionDateTime(new Date(now())),
        orderId: transactionId,
      };
      if (input.value !== undefined) conversion.conversionValue = input.value;
      if (input.currency !== undefined) conversion.currencyCode = input.currency;
      if (input.gclid !== undefined) conversion.gclid = input.gclid;
      if (input.gbraid !== undefined) conversion.gbraid = input.gbraid;
      if (input.wbraid !== undefined) conversion.wbraid = input.wbraid;

      if (input.userData !== undefined && userDataAllowed(input.consent)) {
        const ids = await buildAdsUserIdentifiers(input.userData);
        if (ids.length > 0) conversion.userIdentifiers = ids;
      }

      let ads_: SendResult;
      try {
        const response = await adsApiClient.uploadClickConversions({
          customerId: ads.customerId,
          conversions: [conversion],
        });
        if (response.ok) {
          ads_ = { ok: true };
        } else {
          const error = new Error(
            `[trackbridge] Ads API returned ${response.status}: ${
              typeof response.body === 'string' ? response.body : JSON.stringify(response.body)
            }`,
          );
          if (debug) console.warn(error.message);
          ads_ = { ok: false, error };
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        if (debug) console.warn('[trackbridge] Ads API request failed:', error);
        ads_ = { ok: false, error };
      }
      return { ads: ads_ };
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

function formatConversionDateTime(date: Date): string {
  return `${date.toISOString().slice(0, 19).replace('T', ' ')}+00:00`;
}

// --- GA4 user_data shape (Measurement Protocol) -----------------------

type Ga4AddressEntry = {
  sha256_first_name?: string;
  sha256_last_name?: string;
  sha256_street?: string;
  city?: string;
  region?: string;
  postal_code?: string;
  country?: string;
};

type Ga4UserData = {
  sha256_email_address?: [string];
  sha256_phone_number?: [string];
  address?: [Ga4AddressEntry];
};

/**
 * Builds the `user_data` payload for the GA4 Measurement Protocol.
 *
 * Email, phone, first name, last name, and street are SHA-256 hashed
 * (Google's spec). City, region, postal code, and country are sent as
 * normalized plaintext. Returns `undefined` when no field survives
 * normalization, so the caller can omit `user_data` entirely.
 */
async function buildGa4UserData(input: UserData): Promise<Ga4UserData | undefined> {
  const out: Ga4UserData = {};

  if (input.email !== undefined) {
    const v = normalizeEmail(input.email);
    if (v !== '') out.sha256_email_address = [await hashSha256(v)];
  }
  if (input.phone !== undefined) {
    const v = normalizePhone(input.phone);
    if (v !== '') out.sha256_phone_number = [await hashSha256(v)];
  }

  const addressEntry: Ga4AddressEntry = {};
  if (input.firstName !== undefined) {
    const v = normalizeName(input.firstName);
    if (v !== '') addressEntry.sha256_first_name = await hashSha256(v);
  }
  if (input.lastName !== undefined) {
    const v = normalizeName(input.lastName);
    if (v !== '') addressEntry.sha256_last_name = await hashSha256(v);
  }
  if (input.address !== undefined) {
    const norm = normalizeAddress(input.address);
    if (norm.street !== undefined && norm.street !== '') {
      addressEntry.sha256_street = await hashSha256(norm.street);
    }
    if (norm.city !== undefined && norm.city !== '') addressEntry.city = norm.city;
    if (norm.region !== undefined && norm.region !== '') addressEntry.region = norm.region;
    if (norm.postalCode !== undefined && norm.postalCode !== '') {
      addressEntry.postal_code = norm.postalCode;
    }
    if (norm.country !== undefined && norm.country !== '') addressEntry.country = norm.country;
  }
  if (Object.keys(addressEntry).length > 0) out.address = [addressEntry];

  return Object.keys(out).length > 0 ? out : undefined;
}

// --- Ads API userIdentifiers shape ------------------------------------

type AdsAddressInfo = {
  hashedFirstName?: string;
  hashedLastName?: string;
  hashedStreetAddress?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  countryCode?: string;
};

type AdsUserIdentifier =
  | { hashedEmail: string }
  | { hashedPhoneNumber: string }
  | { addressInfo: AdsAddressInfo };

/**
 * Builds the `userIdentifiers` array for a Google Ads click
 * conversion. Email, phone, first name, last name, and street are
 * hashed; city/state/postalCode/countryCode are sent as normalized
 * plaintext. Note the Ads API uses `state` rather than `region`.
 */
async function buildAdsUserIdentifiers(input: UserData): Promise<AdsUserIdentifier[]> {
  const result: AdsUserIdentifier[] = [];

  if (input.email !== undefined) {
    const v = normalizeEmail(input.email);
    if (v !== '') result.push({ hashedEmail: await hashSha256(v) });
  }
  if (input.phone !== undefined) {
    const v = normalizePhone(input.phone);
    if (v !== '') result.push({ hashedPhoneNumber: await hashSha256(v) });
  }

  const addressInfo: AdsAddressInfo = {};
  if (input.firstName !== undefined) {
    const v = normalizeName(input.firstName);
    if (v !== '') addressInfo.hashedFirstName = await hashSha256(v);
  }
  if (input.lastName !== undefined) {
    const v = normalizeName(input.lastName);
    if (v !== '') addressInfo.hashedLastName = await hashSha256(v);
  }
  if (input.address !== undefined) {
    const norm = normalizeAddress(input.address);
    if (norm.street !== undefined && norm.street !== '') {
      addressInfo.hashedStreetAddress = await hashSha256(norm.street);
    }
    if (norm.city !== undefined && norm.city !== '') addressInfo.city = norm.city;
    if (norm.region !== undefined && norm.region !== '') addressInfo.state = norm.region;
    if (norm.postalCode !== undefined && norm.postalCode !== '') {
      addressInfo.postalCode = norm.postalCode;
    }
    if (norm.country !== undefined && norm.country !== '') addressInfo.countryCode = norm.country;
  }
  if (Object.keys(addressInfo).length > 0) result.push({ addressInfo });

  return result;
}
