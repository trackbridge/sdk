/**
 * Click identifiers Google Ads uses to attribute conversions.
 *
 * - `gclid` — standard click ID for web traffic.
 * - `gbraid` — iOS app campaigns under ATT restrictions.
 * - `wbraid` — web equivalent for ATT-restricted scenarios.
 *
 * Typically only one is set per user. The browser tracker captures
 * whichever appears in the URL on landing and persists it according
 * to the configured storage mode.
 */
export type ClickIdentifiers = {
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
};

export type ConsentValue = 'granted' | 'denied';

/**
 * Subset of the gtag Consent Mode v2 signals Trackbridge cares about.
 *
 * Behavior under `consentMode: 'v2'`:
 * - `ad_storage` gates click-identifier cookie writes.
 * - `ad_user_data` gates whether `userData` (PII) is attached to
 *   outbound `gtag` calls. Unknown state (no `updateConsent` yet) is
 *   treated as denied — userData is dropped until consent is granted.
 *
 * `ad_personalization` and `analytics_storage` are stored for
 * forward-compatibility but do not currently change behavior.
 */
export type ConsentUpdate = {
  ad_storage?: ConsentValue;
  ad_user_data?: ConsentValue;
  ad_personalization?: ConsentValue;
  analytics_storage?: ConsentValue;
};

/**
 * Test seam — overrides the DOM I/O the tracker uses to read the URL,
 * read/write cookies, and push gtag entries onto `window.dataLayer`.
 * Production code should leave {@link BrowserTrackerConfig.io} unset
 * so the tracker uses `window.location`, `document.cookie`, and
 * `window.dataLayer` directly.
 */
export type BrowserIO = {
  getUrlSearch(): string;
  getCookieHeader(): string;
  writeCookie(cookieString: string): void;
  /**
   * Pushes a gtag-style call onto `window.dataLayer`. Trackbridge
   * does not inject `gtag.js` itself — the user's site is expected to
   * load it (directly or via Google Tag Manager). Pushes work whether
   * or not `gtag.js` has loaded yet, since `dataLayer` is a queue.
   */
  gtag(...args: unknown[]): void;
};

import type { UserData } from '@trackbridge/core';

/**
 * Input for {@link BrowserTracker.trackEvent}. Mirror of
 * {@link import('@trackbridge/server').ServerEventInput} — same shape
 * minus `clientId`, which the browser doesn't need (gtag tracks the
 * GA4 client ID itself).
 *
 * When `userData` is supplied, the tracker fires
 * `gtag('set', 'user_data', …)` before the event so gtag attaches the
 * hashed identifiers to it (per Google's enhanced-conversions spec).
 */
export type BrowserEventInput = {
  name: string;
  params?: Record<string, unknown>;
  userData?: UserData;
};

/**
 * Input for {@link BrowserTracker.trackConversion}.
 *
 * `transactionId` is the dedup key shared with the server-side
 * counterpart — strongly recommended. If omitted the SDK auto-
 * generates one, but **dual-send is disabled for that call** because
 * a separate auto-generated ID on the server would silently
 * double-count. See {@link ../../../docs/dedup-strategy.md}.
 */
export type BrowserConversionInput = {
  label: string;
  value?: number;
  currency?: string;
  transactionId?: string;
  userData?: UserData;
};

export type BrowserTrackerConfig = {
  adsConversionId: string;
  ga4MeasurementId?: string;
  /** Default: `'off'`. */
  consentMode?: 'v2' | 'off';
  /** Default: `'cookie'`. */
  clickIdentifierStorage?: 'cookie' | 'memory' | 'none';
  cookieDomain?: string;
  /** Default: `90`. */
  cookieExpiryDays?: number;
  debug?: boolean;
  /** See {@link BrowserIO}. */
  io?: BrowserIO;
  /**
   * Test seam — defaults to `() => ` `tb_${crypto.randomUUID()}` ``.
   * Used by {@link BrowserTracker.trackConversion} when `transactionId`
   * is absent. Lives at the top level (not on {@link BrowserIO}) for
   * symmetry with the server tracker config.
   */
  generateTransactionId?: () => string;
};

export type BrowserTracker = {
  getClickIdentifiers(): ClickIdentifiers;
  updateConsent(update: ConsentUpdate): void;
  trackEvent(input: BrowserEventInput): Promise<void>;
  trackConversion(input: BrowserConversionInput): Promise<void>;
};
