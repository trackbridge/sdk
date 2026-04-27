/**
 * @trackbridge/browser
 *
 * Client-side tracker. Wraps gtag, captures click identifiers,
 * fires conversions and events with Consent Mode v2 awareness.
 */

export const VERSION = '0.0.1';

export { createBrowserTracker } from './tracker.js';
export type {
  BrowserConversionInput,
  BrowserEventInput,
  BrowserIO,
  BrowserTracker,
  BrowserTrackerConfig,
  ClickIdentifiers,
  ConsentUpdate,
  ConsentValue,
} from './types.js';
