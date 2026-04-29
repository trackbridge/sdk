/**
 * @trackbridge/browser
 *
 * Client-side tracker. Wraps gtag, captures click identifiers,
 * fires conversions and events with Consent Mode v2 awareness.
 */

export const VERSION = '0.0.1';

export { createBrowserTracker } from './tracker.js';
export type {
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
export type { TrackbridgeContext, TrackbridgeItem } from '@trackbridge/core';
