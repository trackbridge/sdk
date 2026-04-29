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
  // Pinning that gmail-style dots and plus-tags survive normalization. If
  // the SDK ever switches to gmail-aware stripping (jane.doe+promo@gmail.com
  // → janedoe@gmail.com), this hash changes and the test breaks loudly.
  email_jane_dot_plus: 'c3374bcfe3572e09f37602e0e179782352c5e117a4a3767824abbaa21bbdef8b',
} as const;

// Pinned digests for the non-Latin composite — produced by the canonical
// pipeline (trim → lowercase → NFC → UTF-8 → SHA-256). Same major-bump rule
// as HASH above: changing any of these diverges every existing user's data.
const HASH_NON_LATIN = {
  email_jose_cafe: '68e3b9e62c3ec70609fb2b2fa8d15b8bada9f25a24f7ec3cc6a800f278422e3d',
  name_jose: 'd994e1d001886fe5b45b1267bd1fa2b752ac50742579bd3dad7b2a2aa0ed6866',
  name_garcia: 'ad321a21e537233f2cf61e749c48dba9461f84dec289e418ab8f9d73d6c83125',
  street_cote_dazur: 'eee4f5330bf7043fe06036318fbe97b7f8a9c6b47530e2fdcf0f4e8fd188ed1e',
  city_sao_paulo: '577abdbf90dadd651458eee7576c6e3684b5c27beabd465cc4bb3c42441b5b38',
  region_sp: 'be18b85f77fc024db379acf19e8a1ce62307ab7bb1bca395389ecfc2dafaf741',
  country_BR: 'bbaf8352442730e92c16c5ea6b0ff7cc595c24e02d8e8bfc5fea5a4e0bb0b46b',
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

  // Edge-case raw inputs that should all collapse to the same canonical hash
  // after normalization. These pin the *contract* — that the normalizer +
  // hasher together produce one digest per logical phone number / email,
  // regardless of how the user typed it on the page or sent it from the
  // server. A regression in any normalizer step (whitespace, case folding,
  // separator stripping, double-plus collapse) breaks one of these.
  test('phone format variants all collapse to the same canonical hash', async () => {
    for (const phone of [
      '+15551234567',
      '+1 (555) 123-4567',
      '+1.555.123.4567',
      '+1-555-123-4567',
      '++15551234567',
      '\t+1 555-1234567\n',
    ]) {
      expect(await hashUserData({ phone })).toEqual({ phone: HASH.phone_15551234567 });
    }
  });

  test('email case and whitespace variants all collapse to the same canonical hash', async () => {
    for (const email of [
      'jane@example.com',
      'JANE@EXAMPLE.COM',
      'Jane@Example.com',
      '  jane@example.com  ',
      '\tJane@Example.COM\n',
    ]) {
      expect(await hashUserData({ email })).toEqual({ email: HASH.email_jane });
    }
  });

  // Documents the intentional spec deviation: Google's enhanced conversions
  // guidance is sometimes read as requiring gmail-style local-part
  // normalization (strip dots, drop +tag). The SDK does NOT do that —
  // preserving the user's input is the lower-risk choice and matches what
  // the gtag client side does. If that policy ever changes, this hash moves
  // and forces an explicit decision rather than a silent breakage.
  test('preserves dots and plus-tags in the local part (no gmail-style stripping)', async () => {
    expect(await hashUserData({ email: 'Jane.Doe+promo@example.com' })).toEqual({
      email: HASH.email_jane_dot_plus,
    });
  });

  // The ASCII composite above does not exercise NFC normalization or
  // case-folding of non-Latin letters end-to-end. The two tests below do —
  // if any byte of the normalize → NFC → UTF-8 → SHA-256 pipeline changes
  // for non-ASCII input, these digests diverge.
  //
  // Inputs use \u escapes so the codepoint sequence is unambiguous
  // regardless of how this file is saved on disk. The first test pins NFC
  // (precomposed) input; the second pins NFD (decomposed) input. They MUST
  // produce identical digests — that equality is the dual-send invariant.
  test('hashes a fully populated non-Latin UserData with NFC (precomposed) input', async () => {
    // NFC codepoints used:
    //   é = é   ô = ô   ã = ã   í = í
    const input: UserData = {
      email: '  José@Café.com ',
      firstName: 'José',
      lastName: 'García',
      address: {
        street: "Côte d'Azur",
        city: 'São Paulo',
        region: 'SP',
        country: 'br',
      },
    };
    expect(await hashUserData(input)).toEqual({
      email: HASH_NON_LATIN.email_jose_cafe,
      firstName: HASH_NON_LATIN.name_jose,
      lastName: HASH_NON_LATIN.name_garcia,
      address: {
        street: HASH_NON_LATIN.street_cote_dazur,
        city: HASH_NON_LATIN.city_sao_paulo,
        region: HASH_NON_LATIN.region_sp,
        country: HASH_NON_LATIN.country_BR,
      },
    });
  });

  test('NFD (decomposed) input produces the same digests as NFC input', async () => {
    // NFD: each accented letter is base + combining mark.
    //   ́ = combining acute   ̂ = combining circumflex
    //   ̃ = combining tilde
    const input: UserData = {
      email: '  José@Café.com ',
      firstName: 'José',
      lastName: 'García',
      address: {
        street: "Côte d'Azur",
        city: 'São Paulo',
        region: 'SP',
        country: 'br',
      },
    };
    expect(await hashUserData(input)).toEqual({
      email: HASH_NON_LATIN.email_jose_cafe,
      firstName: HASH_NON_LATIN.name_jose,
      lastName: HASH_NON_LATIN.name_garcia,
      address: {
        street: HASH_NON_LATIN.street_cote_dazur,
        city: HASH_NON_LATIN.city_sao_paulo,
        region: HASH_NON_LATIN.region_sp,
        country: HASH_NON_LATIN.country_BR,
      },
    });
  });
});
