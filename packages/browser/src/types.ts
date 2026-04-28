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

import type { ConsentState, ConsentUpdate, UserData } from '@trackbridge/core';
export type { ConsentValue, ConsentUpdate, ConsentState } from '@trackbridge/core';

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

/**
 * Input for {@link BrowserTracker.trackPageView}. All fields are
 * optional and default to `window` / `document` reads when omitted
 * (or `''` when running outside the browser).
 */
export type BrowserPageViewInput = {
  /** Default: `window.location.pathname + window.location.search`. */
  path?: string;
  /** Default: `document.title`. */
  title?: string;
  // page_location is auto-filled from window.location.href; not configurable.
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
  /**
   * When `true`, `createBrowserTracker` reads `?tb_debug=1` (or `=0`)
   * from the URL and overrides `config.debug` for this tracker instance.
   * Memory-only — does not persist across full page reloads. Default:
   * `false`.
   */
  debugUrlParam?: boolean;
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
  /**
   * Returns a snapshot of the SDK's view of consent across all four
   * signals. Returns a defensive copy — mutating the result does not
   * affect internal state.
   */
  getConsent(): ConsentState;
  /**
   * Reads the GA4 `_ga` cookie and returns the canonical client ID
   * (the substring after `GA<v>.<count>.`). Returns `undefined` if
   * the cookie is missing or malformed. Synchronous; does NOT await
   * gtag init, so a fresh page that has not yet fired any gtag hit
   * may return `undefined`.
   */
  getClientId(): string | undefined;
  /**
   * Reads the GA4 session ID from the `_ga_<containerId>` cookie.
   * Returns `undefined` if `ga4MeasurementId` is unset, the cookie is
   * absent, or the value is malformed. Synchronous.
   */
  getSessionId(): string | undefined;
  updateConsent(update: ConsentUpdate): void;
  trackEvent(input: BrowserEventInput): Promise<void>;
  trackConversion(input: BrowserConversionInput): Promise<void>;
  /**
   * Runtime debug toggle. Overrides whatever was set at init or by
   * the `debugUrlParam`-driven URL override. Most-recent-call wins.
   */
  setDebug(enabled: boolean): void;
  /**
   * Sets `user_id` for subsequent GA4 events. Pushes
   * `gtag('config', ga4MeasurementId, { user_id, send_page_view: false })`.
   * `send_page_view: false` is required to prevent gtag from re-firing
   * a `page_view` whenever `config` is called.
   *
   * No-op if `ga4MeasurementId` is unset (debug-warn under `debug: true`).
   */
  identifyUser(userId: string): void;
  /**
   * Clears `user_id` for subsequent GA4 events. Pushes
   * `gtag('config', ga4MeasurementId, { user_id: undefined, send_page_view: false })`.
   *
   * No-op if `ga4MeasurementId` is unset (debug-warn under `debug: true`).
   */
  clearUser(): void;
  /**
   * Fires `gtag('event', 'page_view', …)` for SPA / App Router page
   * navigations. Defaults `path` to
   * `window.location.pathname + window.location.search`, `title` to
   * `document.title`, and always auto-fills `page_location` from
   * `window.location.href`. SSR-safe — defaults resolve to `''` outside
   * the browser.
   *
   * Dedupes: consecutive calls resolving to the same `page_path` are
   * no-ops (debug-warn under `debug: true`). Protects against React 18
   * strict-mode double-mount.
   *
   * No-op if `ga4MeasurementId` is unset (debug-warn under `debug: true`).
   */
  trackPageView(input?: BrowserPageViewInput): Promise<void>;
};
