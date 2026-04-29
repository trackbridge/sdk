import {
  hashSha256,
  normalizeAddress,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  type TrackbridgeContext,
  type UserData,
} from '@trackbridge/core';

import { createAdsApiClient, type AdsApiClient } from './ads-api.js';
import {
  executeAddToCart,
  executeBeginCheckout,
  executePurchase,
  executeRefund,
  executeSignUp,
  type ServerHelperContext,
} from './helpers.js';
import { createAccessTokenProvider } from './oauth.js';
import type {
  BoundAddToCartInput,
  BoundBeginCheckoutInput,
  BoundPurchaseInput,
  BoundRefundInput,
  BoundServerConversionInput,
  BoundServerEventInput,
  BoundSignUpInput,
  ContextBoundServerTracker,
  SendResult,
  ServerAddToCartInput,
  ServerBeginCheckoutInput,
  ServerConsent,
  ServerConversionInput,
  ServerConversionResult,
  ServerEventInput,
  ServerEventResult,
  ServerHelperResult,
  ServerPurchaseInput,
  ServerRefundInput,
  ServerSignUpInput,
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

  const tracker: ServerTracker = {
    async trackEvent(input: ServerEventInput): Promise<ServerEventResult> {
      const url = new URL(GA4_MP_ENDPOINT);
      url.searchParams.set('measurement_id', config.ga4MeasurementId);
      url.searchParams.set('api_secret', config.ga4ApiSecret);

      const body: Record<string, unknown> = {
        client_id: input.clientId,
        events: [{ name: input.name, params: input.params ?? {} }],
      };
      if (input.userId !== undefined) body.user_id = input.userId;

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

    fromContext(envelope: TrackbridgeContext): ContextBoundServerTracker {
      if (envelope === null || typeof envelope !== 'object') {
        throw new Error('[trackbridge] fromContext: envelope must be an object');
      }
      if ((envelope as { v?: unknown }).v !== 1) {
        throw new Error(
          `[trackbridge] fromContext: unknown envelope version v=${String((envelope as { v?: unknown }).v)} ` +
            `(this server understands v=1)`,
        );
      }
      if (typeof envelope.clickIds !== 'object' || envelope.clickIds === null) {
        throw new Error('[trackbridge] fromContext: envelope.clickIds must be an object');
      }
      if (typeof envelope.consent !== 'object' || envelope.consent === null) {
        throw new Error('[trackbridge] fromContext: envelope.consent must be an object');
      }
      // Snapshot the envelope so post-bind mutations by the caller don't
      // affect the bound tracker. Common pattern: persist envelope on a row,
      // hydrate later — without this, mutating the hydrated object after
      // fromContext returns would silently change subsequent sends.
      const env: TrackbridgeContext = structuredClone(envelope);
      return {
        async trackEvent(input: BoundServerEventInput): Promise<ServerEventResult> {
          const clientId = input.clientId ?? env.clientId;
          if (clientId === undefined) {
            throw new Error(
              '[trackbridge] fromContext-bound trackEvent called without clientId — ' +
                'envelope did not capture one and input did not supply one',
            );
          }
          let params = input.params;
          if (env.sessionId !== undefined && params?.session_id === undefined) {
            params = { ...(params ?? {}), session_id: env.sessionId };
          }
          return tracker.trackEvent({
            name: input.name,
            clientId,
            userId: input.userId ?? env.userId,
            params,
            userData: input.userData ?? env.userData,
            consent: input.consent ?? env.consent,
          });
        },
        async trackConversion(input: BoundServerConversionInput): Promise<ServerConversionResult> {
          return tracker.trackConversion({
            ...input,
            gclid: input.gclid ?? env.clickIds.gclid,
            gbraid: input.gbraid ?? env.clickIds.gbraid,
            wbraid: input.wbraid ?? env.clickIds.wbraid,
            userData: input.userData ?? env.userData,
            consent: input.consent ?? env.consent,
          });
        },
        async trackPurchase(input: BoundPurchaseInput): Promise<ServerHelperResult> {
          const clientId = input.clientId ?? env.clientId;
          if (clientId === undefined) {
            throw new Error(
              '[trackbridge] fromContext-bound trackPurchase called without clientId — ' +
                'envelope did not capture one and input did not supply one',
            );
          }
          return tracker.trackPurchase({
            transactionId: input.transactionId,
            value: input.value,
            currency: input.currency,
            items: input.items,
            affiliation: input.affiliation,
            coupon: input.coupon,
            shipping: input.shipping,
            tax: input.tax,
            clientId,
            userId: input.userId ?? env.userId,
            gclid: input.gclid ?? env.clickIds.gclid,
            gbraid: input.gbraid ?? env.clickIds.gbraid,
            wbraid: input.wbraid ?? env.clickIds.wbraid,
            userData: input.userData ?? env.userData,
            consent: input.consent ?? env.consent,
          });
        },
        async trackBeginCheckout(input?: BoundBeginCheckoutInput): Promise<ServerHelperResult> {
          const i = input ?? {};
          const clientId = i.clientId ?? env.clientId;
          if (clientId === undefined) {
            throw new Error(
              '[trackbridge] fromContext-bound trackBeginCheckout called without clientId — ' +
                'envelope did not capture one and input did not supply one',
            );
          }
          return tracker.trackBeginCheckout({
            transactionId: i.transactionId,
            value: i.value,
            currency: i.currency,
            items: i.items,
            coupon: i.coupon,
            clientId,
            userId: i.userId ?? env.userId,
            gclid: i.gclid ?? env.clickIds.gclid,
            gbraid: i.gbraid ?? env.clickIds.gbraid,
            wbraid: i.wbraid ?? env.clickIds.wbraid,
            userData: i.userData ?? env.userData,
            consent: i.consent ?? env.consent,
          });
        },
        async trackAddToCart(input?: BoundAddToCartInput): Promise<ServerHelperResult> {
          const i = input ?? {};
          const clientId = i.clientId ?? env.clientId;
          if (clientId === undefined) {
            throw new Error(
              '[trackbridge] fromContext-bound trackAddToCart called without clientId — ' +
                'envelope did not capture one and input did not supply one',
            );
          }
          return tracker.trackAddToCart({
            transactionId: i.transactionId,
            value: i.value,
            currency: i.currency,
            items: i.items,
            clientId,
            userId: i.userId ?? env.userId,
            gclid: i.gclid ?? env.clickIds.gclid,
            gbraid: i.gbraid ?? env.clickIds.gbraid,
            wbraid: i.wbraid ?? env.clickIds.wbraid,
            userData: i.userData ?? env.userData,
            consent: i.consent ?? env.consent,
          });
        },
        async trackSignUp(input?: BoundSignUpInput): Promise<ServerHelperResult> {
          const i = input ?? {};
          const clientId = i.clientId ?? env.clientId;
          if (clientId === undefined) {
            throw new Error(
              '[trackbridge] fromContext-bound trackSignUp called without clientId — ' +
                'envelope did not capture one and input did not supply one',
            );
          }
          return tracker.trackSignUp({
            transactionId: i.transactionId,
            method: i.method,
            clientId,
            userId: i.userId ?? env.userId,
            gclid: i.gclid ?? env.clickIds.gclid,
            gbraid: i.gbraid ?? env.clickIds.gbraid,
            wbraid: i.wbraid ?? env.clickIds.wbraid,
            userData: i.userData ?? env.userData,
            consent: i.consent ?? env.consent,
          });
        },
        async trackRefund(input: BoundRefundInput): Promise<ServerHelperResult> {
          const clientId = input.clientId ?? env.clientId;
          if (clientId === undefined) {
            throw new Error(
              '[trackbridge] fromContext-bound trackRefund called without clientId — ' +
                'envelope did not capture one and input did not supply one',
            );
          }
          return tracker.trackRefund({
            transactionId: input.transactionId,
            value: input.value,
            currency: input.currency,
            items: input.items,
            affiliation: input.affiliation,
            coupon: input.coupon,
            shipping: input.shipping,
            tax: input.tax,
            clientId,
            userId: input.userId ?? env.userId,
            userData: input.userData ?? env.userData,
            consent: input.consent ?? env.consent,
          });
        },
      };
    },

    async trackPurchase(_input: ServerPurchaseInput): Promise<ServerHelperResult> {
      // Replaced below via helperContext assignment after tracker is constructed.
      return { ads: { skipped: true, reason: 'no_label_configured' }, ga4: { ok: true } };
    },
    async trackBeginCheckout(_input: ServerBeginCheckoutInput): Promise<ServerHelperResult> {
      return { ads: { skipped: true, reason: 'no_label_configured' }, ga4: { ok: true } };
    },
    async trackAddToCart(_input: ServerAddToCartInput): Promise<ServerHelperResult> {
      return { ads: { skipped: true, reason: 'no_label_configured' }, ga4: { ok: true } };
    },
    async trackSignUp(_input: ServerSignUpInput): Promise<ServerHelperResult> {
      return { ads: { skipped: true, reason: 'no_label_configured' }, ga4: { ok: true } };
    },
    async trackRefund(_input: ServerRefundInput): Promise<ServerHelperResult> {
      return { ads: { skipped: true, reason: 'refund_ads_unsupported' }, ga4: { ok: true } };
    },
  };

  const helperContext: ServerHelperContext = {
    underlying: tracker,
    conversionLabels: config.conversionLabels ?? {},
    hasMeasurementId: Boolean(config.ga4MeasurementId),
    hasAds: config.ads !== undefined && adsApiClient !== null,
    resolveTransactionId: (incoming) => {
      if (incoming !== undefined && incoming !== '') return incoming;
      const generated = generateTransactionId();
      warnAutoTransactionId(generated);
      return generated;
    },
  };

  tracker.trackPurchase = (input) => executePurchase(input, helperContext);
  tracker.trackBeginCheckout = (input) => executeBeginCheckout(input, helperContext);
  tracker.trackAddToCart = (input) => executeAddToCart(input, helperContext);
  tracker.trackSignUp = (input) => executeSignUp(input, helperContext);
  tracker.trackRefund = (input) => executeRefund(input, helperContext);

  return tracker;
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
