/**
 * @trackbridge/core
 *
 * Shared types, normalization, and hashing logic used by both
 * @trackbridge/browser and @trackbridge/server.
 *
 * The contract here is the foundation of dual-send: identical input
 * must produce identical hashed output across runtimes, or Google
 * cannot dedupe conversions.
 */

export const VERSION = '0.0.1';

export type {
  Address,
  ConsentState,
  ConsentUpdate,
  ConsentValue,
  HashedAddress,
  HashedUserData,
  TrackbridgeContext,
  UserData,
} from './types.js';
export { hashSha256 } from './hash.js';
export { hashUserData } from './hash-user-data.js';
export { normalizeAddress } from './normalize/address.js';
export { normalizeEmail } from './normalize/email.js';
export { normalizeName } from './normalize/name.js';
export { normalizePhone } from './normalize/phone.js';
export {
  mapItemsForGa4,
  GA4_EVENT_NAMES,
  type SemanticHelperName,
  type TrackbridgeItem,
} from './items.js';
