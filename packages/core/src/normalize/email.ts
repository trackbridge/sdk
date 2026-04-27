/**
 * Normalizes an email address for hashing.
 *
 * Steps: trim → lowercase → Unicode NFC. Locale-independent
 * `toLowerCase` is used deliberately so output does not depend on the
 * runtime's locale — see {@link ../../../docs/dual-send-invariant.md}.
 */
export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase().normalize('NFC');
}
