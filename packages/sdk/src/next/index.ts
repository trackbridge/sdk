/**
 * @trackbridge/sdk/next
 *
 * Next.js framework adapter — React-side. Provider, page-view tracker,
 * and the useTracker hook for client components.
 */

export { TrackbridgeProvider, type TrackbridgeProviderProps } from './provider.js';
export { TrackbridgePageViews } from './page-views.js';
export { useTracker } from './context.js';

// Re-export the types consumers need most often, so they don't have to
// dual-import from /browser.
export type {
  BrowserTracker,
  BrowserTrackerConfig,
  ConsentState,
  ConsentValue,
  ConsentUpdate,
  ClickIdentifiers,
} from '../browser/index.js';
export type { TrackbridgeContext, TrackbridgeItem } from '../core/index.js';
