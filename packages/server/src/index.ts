/**
 * @trackbridge/server
 *
 * Server-side tracker. Talks to the Google Ads API for conversion uploads
 * and the GA4 Measurement Protocol for events, with hashed user data.
 */

export const VERSION = '0.0.1';

export { createServerTracker } from './tracker.js';
export type {
  BoundServerConversionInput,
  BoundServerEventInput,
  ConsentValue,
  ContextBoundServerTracker,
  SendResult,
  ServerAdsConfig,
  ServerConsent,
  ServerConversionInput,
  ServerConversionResult,
  ServerEventInput,
  ServerEventResult,
  ServerTracker,
  ServerTrackerConfig,
} from './types.js';
export type { TrackbridgeContext } from '@trackbridge/core';
