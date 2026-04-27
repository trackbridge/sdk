import type { UserData } from '@trackbridge/core';

export type ConsentValue = 'granted' | 'denied';

/**
 * Per-call consent signals for the server tracker. Unlike the browser
 * tracker (which stores consent state internally because gtag's
 * Consent Mode is a long-lived browser thing), the server has no
 * session — the caller passes consent through from their request
 * handler on every call.
 *
 * When `ad_user_data` is `'denied'`, `userData` is dropped from the
 * outbound payload (no PII leaves the server). Other signals are
 * stored for forward-compatibility but do not currently affect
 * behavior. Omitting `consent` entirely is treated as "consent not
 * tracked here" — the request is sent in full.
 */
export type ServerConsent = {
  ad_user_data?: ConsentValue;
  ad_personalization?: ConsentValue;
};

/**
 * Google Ads API credentials and conversion-action mapping. Required
 * to use {@link ServerTracker.trackConversion} — the SDK uses these
 * for OAuth refresh + the upload-click-conversions call.
 */
export type ServerAdsConfig = {
  developerToken: string;
  customerId: string;
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  loginCustomerId?: string;
  /**
   * Map from a user-facing conversion label (e.g. `"purchase"`) to
   * the Ads API resource name
   * `customers/{customerId}/conversionActions/{conversionActionId}`.
   *
   * The same `label` is used on the browser side for `send_to`; the
   * server needs the explicit map because the Ads API does not accept
   * gtag-style short labels.
   */
  conversionActions: Record<string, string>;
  /** Default: `'v17'`. */
  apiVersion?: string;
};

/**
 * Configuration for {@link createServerTracker}.
 *
 * `ga4MeasurementId` + `ga4ApiSecret` are required and gate
 * `trackEvent`. `ads` is optional; when provided it gates
 * `trackConversion`. Calling `trackConversion` without `ads` throws.
 */
export type ServerTrackerConfig = {
  ga4MeasurementId: string;
  ga4ApiSecret: string;
  ads?: ServerAdsConfig;
  debug?: boolean;
  /**
   * Optional `fetch` override. Defaults to `globalThis.fetch`. Tests
   * inject a stub here; production code should leave this unset.
   */
  fetch?: typeof globalThis.fetch;
  /** Test seam — defaults to `Date.now`. */
  now?: () => number;
  /**
   * Test seam — defaults to `tb_${crypto.randomUUID()}`. Used by
   * {@link ServerTracker.trackConversion} when `transactionId` is
   * absent.
   */
  generateTransactionId?: () => string;
};

/**
 * Input for {@link ServerTracker.trackEvent}. `clientId` is required —
 * unlike the browser tracker, the server has no way to read the GA4
 * client ID cookie itself, so the caller must pass it through from
 * their request handler. `userData` is optional and only attaches
 * hashed PII when supplied; the SDK normalizes and hashes the fields
 * Google requires hashed and forwards city/region/postal_code/country
 * as plaintext per the GA4 Measurement Protocol spec.
 */
export type ServerEventInput = {
  name: string;
  clientId: string;
  params?: Record<string, unknown>;
  userData?: UserData;
  /**
   * Per-call consent signals. When `ad_user_data` is `'denied'`,
   * `userData` is omitted from the outbound payload.
   */
  consent?: ServerConsent;
};

/**
 * Input for {@link ServerTracker.trackConversion}.
 *
 * `label` is looked up in {@link ServerAdsConfig.conversionActions}.
 * Click identifiers (`gclid`/`gbraid`/`wbraid`) come from the
 * browser-side `getClickIdentifiers()` and must be persisted by the
 * caller (e.g., on the order record) and passed back at conversion
 * time. `transactionId` is the dual-send dedup key — strongly
 * recommended; auto-generated with a loud warning when missing.
 */
export type ServerConversionInput = {
  label: string;
  value?: number;
  currency?: string;
  transactionId?: string;
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  userData?: UserData;
  /**
   * Per-call consent signals. When `ad_user_data` is `'denied'`,
   * `userData` is omitted from the outbound payload.
   */
  consent?: ServerConsent;
};

export type ServerTracker = {
  trackEvent(input: ServerEventInput): Promise<void>;
  trackConversion(input: ServerConversionInput): Promise<void>;
};
