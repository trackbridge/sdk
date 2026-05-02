/**
 * @trackbridge/sdk/server
 *
 * Server-side tracker. Talks to the Google Ads API for conversion uploads
 * and the GA4 Measurement Protocol for events, with hashed user data.
 */

export const VERSION = '0.0.1';

export { createServerTracker } from './tracker.js';
export type {
  BoundAddToCartInput,
  BoundBeginCheckoutInput,
  BoundPurchaseInput,
  BoundRefundInput,
  BoundServerConversionInput,
  BoundServerEventInput,
  BoundSignUpInput,
  ConsentValue,
  ContextBoundServerTracker,
  HelperSendResult,
  SendResult,
  ServerAddToCartInput,
  ServerAdsConfig,
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
export type { TrackbridgeContext, TrackbridgeItem } from '../core/index.js';
