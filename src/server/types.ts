import type { ConsentValue, TrackbridgeContext, TrackbridgeItem, UserData } from '../core/index.js';
export type { ConsentValue } from '../core/index.js';

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
  ad_user_data?: ConsentValue | 'unknown';
  ad_personalization?: ConsentValue | 'unknown';
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
  /**
   * Per-helper Ads conversion labels. Same shape as the browser-side
   * config. Helper without an entry → fires GA4 only. `refund` key
   * intentionally absent — refund Ads is unsupported in v1.
   */
  conversionLabels?: {
    purchase?: string;
    beginCheckout?: string;
    addToCart?: string;
    signUp?: string;
  };
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
  /**
   * Maps to GA4 MP body's top-level `user_id`. Optional. When set,
   * GA4 ties the event to the supplied user across sessions.
   */
  userId?: string;
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

/**
 * Per-destination outcome inside a {@link ServerEventResult} or
 * {@link ServerConversionResult}. `ok: true` means the request reached
 * Google with a 2xx response; `ok: false` carries the underlying error
 * (network failure, OAuth refresh failure, or non-2xx response).
 */
export type SendResult = { ok: true } | { ok: false; error: Error };

/**
 * Result of {@link ServerTracker.trackEvent}. Currently a single GA4
 * destination; structured this way so future destinations (Meta CAPI,
 * TikTok Events API, etc.) can be added without breaking the contract.
 */
export type ServerEventResult = {
  ga4: SendResult;
};

/**
 * Result of {@link ServerTracker.trackConversion}. Currently a single
 * Ads destination; structured this way so future server-side GA4
 * conversion events or other destinations can be added without
 * breaking the contract.
 */
export type ServerConversionResult = {
  ads: SendResult;
};

/**
 * Input for {@link ContextBoundServerTracker.trackEvent}. Same as
 * {@link ServerEventInput}, but `clientId` is optional — when omitted,
 * the bound envelope's `clientId` is used. Throws at call time if
 * neither source supplies one.
 */
export type BoundServerEventInput = Omit<ServerEventInput, 'clientId'> & {
  clientId?: string;
};

/**
 * Input for {@link ContextBoundServerTracker.trackConversion}. Same
 * shape as {@link ServerConversionInput}: all envelope-supplied
 * fields (`gclid`/`gbraid`/`wbraid`, `userData`, `consent`) are
 * already optional in the unbound input. Per-call values override
 * envelope values on conflict (no deep merge).
 */
export type BoundServerConversionInput = ServerConversionInput;

/**
 * Tracker pre-bound to a {@link TrackbridgeContext}. Returned by
 * {@link ServerTracker.fromContext}. Failure semantics symmetric with
 * the unbound tracker — runtime API failures resolve via
 * {@link SendResult}; merge-time programming errors throw.
 */
export type ContextBoundServerTracker = {
  trackEvent(input: BoundServerEventInput): Promise<ServerEventResult>;
  trackConversion(input: BoundServerConversionInput): Promise<ServerConversionResult>;
  trackPurchase(input: BoundPurchaseInput): Promise<ServerHelperResult>;
  trackBeginCheckout(input?: BoundBeginCheckoutInput): Promise<ServerHelperResult>;
  trackAddToCart(input?: BoundAddToCartInput): Promise<ServerHelperResult>;
  trackSignUp(input?: BoundSignUpInput): Promise<ServerHelperResult>;
  trackRefund(input: BoundRefundInput): Promise<ServerHelperResult>;
};

export type ServerTracker = {
  /**
   * Send a GA4 event via the Measurement Protocol. Never throws on
   * runtime API failures — the result reports per-destination success
   * via {@link SendResult}. Configuration errors (e.g., missing
   * required config) throw at {@link createServerTracker} time.
   */
  trackEvent(input: ServerEventInput): Promise<ServerEventResult>;
  /**
   * Send a Google Ads click conversion. Never throws on runtime API
   * failures (OAuth refresh, Ads upload, network) — the result reports
   * per-destination success via {@link SendResult}. Throws only on
   * caller misuse: missing `ads` config, unknown conversion label.
   */
  trackConversion(input: ServerConversionInput): Promise<ServerConversionResult>;
  /**
   * Returns a tracker pre-bound to the supplied envelope. Per-call
   * inputs override envelope fields on conflict (no deep merge).
   * Throws synchronously if the envelope is malformed (unknown `v`,
   * missing required shape).
   */
  fromContext(envelope: TrackbridgeContext): ContextBoundServerTracker;
  trackPurchase(input: ServerPurchaseInput): Promise<ServerHelperResult>;
  trackBeginCheckout(input: ServerBeginCheckoutInput): Promise<ServerHelperResult>;
  trackAddToCart(input: ServerAddToCartInput): Promise<ServerHelperResult>;
  trackSignUp(input: ServerSignUpInput): Promise<ServerHelperResult>;
  trackRefund(input: ServerRefundInput): Promise<ServerHelperResult>;
};

/**
 * Input for `serverTracker.trackPurchase`. `transactionId` is required
 * (no auto-generation) — purchase is the canonical dual-fire dedup target.
 * Fires Ads when `config.conversionLabels.purchase` is set; GA4 always
 * (when `ga4MeasurementId` configured).
 */
export type ServerPurchaseInput = {
  transactionId: string;
  value: number;
  currency: string;
  items: TrackbridgeItem[];
  clientId: string;
  userId?: string;
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  affiliation?: string;
  coupon?: string;
  shipping?: number;
  tax?: number;
  userData?: UserData;
  consent?: ServerConsent;
};

/**
 * Input for `serverTracker.trackBeginCheckout`. Most fields optional —
 * `clientId` always required for GA4 MP.
 */
export type ServerBeginCheckoutInput = {
  transactionId?: string;
  value?: number;
  currency?: string;
  items?: TrackbridgeItem[];
  coupon?: string;
  clientId: string;
  userId?: string;
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  userData?: UserData;
  consent?: ServerConsent;
};

/**
 * Input for `serverTracker.trackAddToCart`. Most fields optional —
 * `clientId` always required for GA4 MP.
 */
export type ServerAddToCartInput = {
  transactionId?: string;
  value?: number;
  currency?: string;
  items?: TrackbridgeItem[];
  clientId: string;
  userId?: string;
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  userData?: UserData;
  consent?: ServerConsent;
};

/**
 * Input for `serverTracker.trackSignUp`. `method` maps to GA4's
 * `method` param.
 */
export type ServerSignUpInput = {
  transactionId?: string;
  method?: string;
  clientId: string;
  userId?: string;
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  userData?: UserData;
  consent?: ServerConsent;
};

/**
 * Input for `serverTracker.trackRefund`. `transactionId` is required to
 * refund the original purchase by the same dedup key. Always fires GA4
 * only — `conversionLabels.refund` is intentionally not supported in v1.
 */
export type ServerRefundInput = {
  transactionId: string;
  value?: number;
  currency?: string;
  items?: TrackbridgeItem[];
  affiliation?: string;
  coupon?: string;
  shipping?: number;
  tax?: number;
  clientId: string;
  userId?: string;
  userData?: UserData;
  consent?: ServerConsent;
};

/**
 * Per-destination result for the helpers. Mirrors the existing
 * `SendResult` (`{ ok: true } | { ok: false; error: Error }`) plus a
 * `{ skipped: true; reason }` variant for cases where the helper
 * deliberately did not fire (no label configured, or refund Ads
 * unsupported in v1). Existing `SendResult` is unchanged.
 */
export type HelperSendResult =
  | { ok: true }
  | { ok: false; error: Error }
  | {
      skipped: true;
      reason: 'no_label_configured' | 'refund_ads_unsupported';
    };

export type ServerHelperResult = {
  ads: HelperSendResult;
  ga4: HelperSendResult;
};

export type BoundPurchaseInput = Omit<ServerPurchaseInput, 'clientId'> & {
  clientId?: string;
};
export type BoundBeginCheckoutInput = Omit<ServerBeginCheckoutInput, 'clientId'> & {
  clientId?: string;
};
export type BoundAddToCartInput = Omit<ServerAddToCartInput, 'clientId'> & {
  clientId?: string;
};
export type BoundSignUpInput = Omit<ServerSignUpInput, 'clientId'> & {
  clientId?: string;
};
export type BoundRefundInput = Omit<ServerRefundInput, 'clientId'> & {
  clientId?: string;
};
