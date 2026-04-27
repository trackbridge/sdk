import { describe, expect, test } from 'vitest';

import { hashUserData } from './hash-user-data.js';
import type { UserData } from './types.js';

// Pinned digests for the canonical normalized inputs. If these change,
// every existing user's hashed PII diverges from prior runs — major bump.
const HASH = {
  email_jane: '8c87b489ce35cf2e2f39f80e282cb2e804932a56a213983eeeb428407d43b52d',
  phone_15551234567: '8a59780bb8cd2ba022bfa5ba2ea3b6e07af17a7d8b30c1f9b3390e36f69019e4',
  name_jane: '81f8f6dde88365f3928796ec7aa53f72820b06db8664f5fe76a7eb13e24546a2',
  name_doe: '799ef92a11af918e3fb741df42934f3b568ed2d93ac1df74f1b8d41a27932a6f',
  street_123_main_st: '9425c187ddc6f9409d827854c2b2935feca5bbc75c6001e449b7d2fdbce73bea',
  city_austin: 'c7c1319276e936c8d64f1d5ed80cd8a0cf54e6dea7b0125533eb4163e03a2c11',
  region_tx: '1b5b9ccb3e8d006a5230de9bda23ff91edc794d4f56410560830b418528e446c',
  postal_78701: '384248b18055777d69403b479d74e10a96ecc6c6dd6f02308684d3d94eaacad1',
  country_US: '9b202ecbc6d45c6d8901d989a918878397a3eb9d00e8f48022fc051b19d21a1d',
} as const;

describe('hashUserData', () => {
  test('hashes a fully populated UserData (with messy raw input)', async () => {
    const input: UserData = {
      email: '  Jane@Example.COM ',
      phone: '+1 (555) 123-4567',
      firstName: 'Jane',
      lastName: 'Doe',
      address: {
        street: '  123 Main St. ',
        city: 'AUSTIN',
        region: ' TX ',
        postalCode: '78701',
        country: 'us',
      },
    };
    expect(await hashUserData(input)).toEqual({
      email: HASH.email_jane,
      phone: HASH.phone_15551234567,
      firstName: HASH.name_jane,
      lastName: HASH.name_doe,
      address: {
        street: HASH.street_123_main_st,
        city: HASH.city_austin,
        region: HASH.region_tx,
        postalCode: HASH.postal_78701,
        country: HASH.country_US,
      },
    });
  });

  test('omits keys for fields that were absent on input', async () => {
    expect(await hashUserData({ email: 'jane@example.com' })).toEqual({
      email: HASH.email_jane,
    });
  });

  test('omits keys for fields that normalize to empty strings', async () => {
    expect(await hashUserData({ email: '   \t', phone: '+1 (555) 123-4567' })).toEqual({
      phone: HASH.phone_15551234567,
    });
  });

  test('omits the address key when no address sub-field has content', async () => {
    expect(
      await hashUserData({
        email: 'jane@example.com',
        address: { street: '   ', city: '' },
      }),
    ).toEqual({ email: HASH.email_jane });
  });

  test('returns an empty object for empty input', async () => {
    expect(await hashUserData({})).toEqual({});
  });

  test('preserves only the address sub-fields that have content', async () => {
    expect(
      await hashUserData({ address: { city: 'Austin', country: 'us', postalCode: '   ' } }),
    ).toEqual({
      address: { city: HASH.city_austin, country: HASH.country_US },
    });
  });

  test('is deterministic across calls', async () => {
    const input: UserData = { email: 'jane@example.com', firstName: 'Jane' };
    const a = await hashUserData(input);
    const b = await hashUserData(input);
    expect(a).toEqual(b);
  });
});
