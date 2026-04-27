import { hashSha256 } from './hash.js';
import { normalizeAddress } from './normalize/address.js';
import { normalizeEmail } from './normalize/email.js';
import { normalizeName } from './normalize/name.js';
import { normalizePhone } from './normalize/phone.js';
import type { HashedAddress, HashedUserData, UserData } from './types.js';

/**
 * Normalizes and SHA-256-hashes every field of {@link UserData}.
 *
 * Fields that are absent on input or normalize to an empty string are
 * omitted from the result, so downstream API code does not have to
 * filter empties before sending. The `address` key is itself omitted
 * when no sub-field survives normalization.
 *
 * Browser and server packages both call this — the dual-send invariant
 * holds because every byte that reaches SHA-256 comes from the same
 * normalization pipeline.
 */
export async function hashUserData(input: UserData): Promise<HashedUserData> {
  const out: HashedUserData = {};

  if (input.email !== undefined) {
    const v = normalizeEmail(input.email);
    if (v !== '') out.email = await hashSha256(v);
  }
  if (input.phone !== undefined) {
    const v = normalizePhone(input.phone);
    if (v !== '') out.phone = await hashSha256(v);
  }
  if (input.firstName !== undefined) {
    const v = normalizeName(input.firstName);
    if (v !== '') out.firstName = await hashSha256(v);
  }
  if (input.lastName !== undefined) {
    const v = normalizeName(input.lastName);
    if (v !== '') out.lastName = await hashSha256(v);
  }
  if (input.address !== undefined) {
    const hashedAddress = await hashAddress(input.address);
    if (hashedAddress !== undefined) out.address = hashedAddress;
  }

  return out;
}

async function hashAddress(input: NonNullable<UserData['address']>): Promise<HashedAddress | undefined> {
  const normalized = normalizeAddress(input);
  const out: HashedAddress = {};

  if (normalized.street !== undefined && normalized.street !== '') {
    out.street = await hashSha256(normalized.street);
  }
  if (normalized.city !== undefined && normalized.city !== '') {
    out.city = await hashSha256(normalized.city);
  }
  if (normalized.region !== undefined && normalized.region !== '') {
    out.region = await hashSha256(normalized.region);
  }
  if (normalized.postalCode !== undefined && normalized.postalCode !== '') {
    out.postalCode = await hashSha256(normalized.postalCode);
  }
  if (normalized.country !== undefined && normalized.country !== '') {
    out.country = await hashSha256(normalized.country);
  }

  return Object.keys(out).length > 0 ? out : undefined;
}
