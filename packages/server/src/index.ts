/**
 * @trackbridge/server
 *
 * Server-side tracker. Talks to the Google Ads API for conversion uploads
 * and the GA4 Measurement Protocol for events, with hashed user data.
 */

export const VERSION = '0.0.1';

export { createServerTracker } from './tracker.js';
export type {
  ConsentValue,
  ServerAdsConfig,
  ServerConsent,
  ServerConversionInput,
  ServerEventInput,
  ServerTracker,
  ServerTrackerConfig,
} from './types.js';
