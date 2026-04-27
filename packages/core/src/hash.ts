/**
 * SHA-256 of `input`'s UTF-8 byte representation, returned as 64
 * lowercase hex characters.
 *
 * Encoding is fixed to UTF-8 inside this function so callers cannot
 * accidentally diverge browser-vs-server. The caller is responsible
 * for normalizing strings before hashing — this is a hash, not a
 * normalizer. See {@link ../../../docs/dual-send-invariant.md}.
 */
export async function hashSha256(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const subtle = await getSubtle();
  const buffer = await subtle.digest('SHA-256', bytes);
  return bytesToHex(new Uint8Array(buffer));
}

async function getSubtle(): Promise<SubtleCrypto> {
  // Browsers and Node 19+ expose Web Crypto on the global.
  const globalSubtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
  if (globalSubtle) return globalSubtle;

  // Node 18.x: globalThis.crypto is gated behind a flag, but webcrypto
  // is available via the built-in module.
  const nodeCrypto = await import('node:crypto');
  return nodeCrypto.webcrypto.subtle as SubtleCrypto;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}
