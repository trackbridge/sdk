import { describe, expect, test } from 'vitest';

import type { Address } from '../types.js';
import { normalizeAddress } from './address.js';

describe('normalizeAddress', () => {
  test('normalizes a fully populated address', () => {
    const input: Address = {
      street: '  123 Main St. ',
      city: 'AUSTIN',
      region: ' TX ',
      postalCode: '78701',
      country: 'us',
    };
    expect(normalizeAddress(input)).toEqual({
      street: '123 main st.',
      city: 'austin',
      region: 'tx',
      postalCode: '78701',
      country: 'US',
    });
  });

  test('is idempotent on an already-normalized address', () => {
    const normalized: Address = {
      street: '123 main st.',
      city: 'austin',
      region: 'tx',
      postalCode: '78701',
      country: 'US',
    };
    expect(normalizeAddress(normalized)).toEqual(normalized);
  });

  test('preserves diacritics in NFC form on the street', () => {
    expect(normalizeAddress({ street: "Côte d'Azur" })).toEqual({
      street: "côte d'azur",
    });
  });

  test('case-folds UK postal codes and preserves the internal space', () => {
    expect(normalizeAddress({ postalCode: 'SW1A 1AA' })).toEqual({
      postalCode: 'sw1a 1aa',
    });
  });

  test('trims whitespace from a US ZIP', () => {
    expect(normalizeAddress({ postalCode: '  78701  ' })).toEqual({
      postalCode: '78701',
    });
  });

  test('uppercases lowercase country codes', () => {
    expect(normalizeAddress({ country: 'br' })).toEqual({ country: 'BR' });
  });

  test('trims whitespace around country codes', () => {
    expect(normalizeAddress({ country: '  US  ' })).toEqual({ country: 'US' });
  });

  test('returns an empty object for an empty input', () => {
    expect(normalizeAddress({})).toEqual({});
  });

  test('omits keys that were undefined on input', () => {
    expect(normalizeAddress({ city: 'Austin', country: 'US' })).toEqual({
      city: 'austin',
      country: 'US',
    });
  });

  test('returns an empty string (not undefined) for a whitespace-only field', () => {
    expect(normalizeAddress({ street: '   \t' })).toEqual({ street: '' });
  });
});
