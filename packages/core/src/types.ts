/**
 * Postal address, sub-shape of {@link UserData}.
 *
 * `country` is ISO-3166-1 alpha-2 (e.g. `US`, `BR`). `region` is the
 * state/province code or name; Google's enhanced conversions spec
 * accepts either form for most countries.
 */
export type Address = {
  street?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
};

/**
 * The user-identifying fields used for enhanced conversions matching.
 *
 * Identical shape on browser and server — both packages import this type
 * from `@trackbridge/core`. All fields are pre-normalization; the SDK
 * applies normalization and SHA-256 hashing before sending to Google.
 */
export type UserData = {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  address?: Address;
};

/**
 * Hashed-form counterpart of {@link Address}. Same structural shape; the
 * alias exists so function signatures can distinguish raw input from
 * post-hash output at the type level.
 */
export type HashedAddress = {
  street?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
};

/**
 * Hashed-form counterpart of {@link UserData}. Each string field holds a
 * lowercase hex SHA-256 digest of the normalized input value. Fields that
 * were absent or normalized to an empty string are omitted entirely.
 */
export type HashedUserData = {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  address?: HashedAddress;
};

/**
 * Consent signal value. The two states a CMP reports.
 *
 * Trackbridge always also accepts `'unknown'` alongside this in
 * value unions where signal-not-yet-known is a real state (see
 * {@link ConsentUpdate}, {@link ConsentState}, and `ServerConsent`).
 */
export type ConsentValue = 'granted' | 'denied';

/**
 * Patch shape for `BrowserTracker.updateConsent`. Partial — only
 * signals the caller wants to change need to be present. Values
 * include `'unknown'` so the round-trip
 * `tracker.updateConsent(tracker.getConsent())` typechecks.
 */
export type ConsentUpdate = {
  ad_storage?: ConsentValue | 'unknown';
  ad_user_data?: ConsentValue | 'unknown';
  ad_personalization?: ConsentValue | 'unknown';
  analytics_storage?: ConsentValue | 'unknown';
};

/**
 * Snapshot returned by `BrowserTracker.getConsent`. All four signals
 * are present; values include `'unknown'` until the consumer's CMP
 * has reported a value via `updateConsent`.
 *
 * Under `consentMode: 'off'`, all signals start `'granted'`.
 * Under `consentMode: 'v2'`, all signals start `'unknown'`.
 *
 * The browser SDK only acts on `ad_storage` (gates `_tb_*` cookie
 * writes) and `ad_user_data` (gates outbound PII). The other two
 * signals are stored verbatim from the most recent `updateConsent`
 * call so banners can read them back.
 */
export type ConsentState = {
  ad_storage: ConsentValue | 'unknown';
  ad_user_data: ConsentValue | 'unknown';
  ad_personalization: ConsentValue | 'unknown';
  analytics_storage: ConsentValue | 'unknown';
};
