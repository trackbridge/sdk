/**
 * @trackbridge/sdk/next/server
 *
 * Next.js framework adapter — Node-side. Cached server-tracker factory
 * and a typed envelope reader for forwarded cookies/headers.
 */

export {
  defineServerTracker,
  type ServerTrackerFactory,
} from './define-server-tracker.js';
export {
  readEnvelopeFromRequest,
  type CookieReader,
  type HeaderReader,
  type ReadEnvelopeFromRequestArgs,
} from './read-envelope.js';

// Re-export the types consumers need most often, so they don't have to
// dual-import from /server.
export type {
  ServerTracker,
  ServerTrackerConfig,
} from '../../server/index.js';
export type { TrackbridgeContext } from '../../core/index.js';
