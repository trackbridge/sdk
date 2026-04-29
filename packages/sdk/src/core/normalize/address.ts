import type { Address } from '../types.js';

/**
 * Normalizes a postal address field-by-field.
 *
 * - `street`, `city`, `region`: trim → lowercase → NFC.
 * - `postalCode`: trim → lowercase. Preserves internal spaces (UK
 *   codes like `SW1A 1AA` need the space). No NFC since postal codes
 *   are ASCII alphanumerics.
 * - `country`: trim → uppercase → NFC. Convention is uppercase
 *   ISO-3166-1 alpha-2; the SDK does not validate the code.
 *
 * Undefined input fields are omitted from the result. A field that is
 * present but normalizes to an empty string is preserved as such — the
 * caller decides whether to send empties.
 */
export function normalizeAddress(input: Address): Address {
  const out: Address = {};
  if (input.street !== undefined) {
    out.street = input.street.trim().toLowerCase().normalize('NFC');
  }
  if (input.city !== undefined) {
    out.city = input.city.trim().toLowerCase().normalize('NFC');
  }
  if (input.region !== undefined) {
    out.region = input.region.trim().toLowerCase().normalize('NFC');
  }
  if (input.postalCode !== undefined) {
    out.postalCode = input.postalCode.trim().toLowerCase();
  }
  if (input.country !== undefined) {
    out.country = input.country.trim().toUpperCase().normalize('NFC');
  }
  return out;
}
