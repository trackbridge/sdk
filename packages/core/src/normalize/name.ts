/**
 * Normalizes a personal name (first or last) for hashing.
 *
 * Steps: trim → lowercase → Unicode NFC. Hyphens, apostrophes, and
 * internal spaces are preserved — Google's enhanced conversions spec
 * only requires trim + lowercase, so we keep all letters (including
 * diacritics) intact rather than risk lossy transformations diverging
 * across runtimes.
 */
export function normalizeName(input: string): string {
  return input.trim().toLowerCase().normalize('NFC');
}
