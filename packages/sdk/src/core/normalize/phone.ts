/**
 * Normalizes a phone number toward E.164 (`+` followed by digits).
 *
 * Strips whitespace, separators, and letters; preserves a leading `+`
 * if one was present in the original input. Does **not** infer a
 * country code — silent guessing across runtimes is a dual-send
 * footgun. Inputs without a leading `+` are returned as digits only,
 * and the downstream API will reject them.
 */
export function normalizePhone(input: string): string {
  const trimmed = input.trim();
  if (trimmed === '') return '';

  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (digits === '') return '';

  return hasPlus ? `+${digits}` : digits;
}
