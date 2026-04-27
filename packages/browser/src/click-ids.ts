import type { ClickIdentifiers } from './types.js';

const ORDER = ['gclid', 'gbraid', 'wbraid'] as const;

const COOKIE_NAMES = {
  gclid: '_tb_gclid',
  gbraid: '_tb_gbraid',
  wbraid: '_tb_wbraid',
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Pulls click identifiers out of a query string. Accepts the search
 * portion of a URL with or without a leading `?`. Empty values are
 * treated as absent.
 */
export function parseClickIdentifiersFromUrl(search: string): ClickIdentifiers {
  const params = new URLSearchParams(search);
  const out: ClickIdentifiers = {};
  for (const key of ORDER) {
    const value = params.get(key);
    if (value !== null && value !== '') out[key] = value;
  }
  return out;
}

/**
 * Parses Trackbridge's `_tb_*` click-identifier cookies out of a
 * `document.cookie`-style header. Tolerates extra whitespace and
 * unrelated cookies. Empty values are treated as absent.
 */
export function parseClickIdentifiersFromCookies(cookieHeader: string): ClickIdentifiers {
  const out: ClickIdentifiers = {};
  if (cookieHeader === '') return out;

  for (const rawPair of cookieHeader.split(';')) {
    const pair = rawPair.trim();
    const eqIdx = pair.indexOf('=');
    if (eqIdx <= 0) continue;
    const name = pair.slice(0, eqIdx);
    const rawValue = pair.slice(eqIdx + 1);
    if (rawValue === '') continue;
    // Treat malformed percent-encoding as absent: a stray `%ZZ` from a
    // cookie a third-party tool wrote to the same name should not crash
    // tracker init.
    let value: string;
    try {
      value = decodeURIComponent(rawValue);
    } catch {
      continue;
    }
    if (name === COOKIE_NAMES.gclid) out.gclid = value;
    else if (name === COOKIE_NAMES.gbraid) out.gbraid = value;
    else if (name === COOKIE_NAMES.wbraid) out.wbraid = value;
  }
  return out;
}

/**
 * Builds `Set-Cookie`-style strings for the supplied click
 * identifiers, ready to assign to `document.cookie`. Returns one
 * string per non-empty identifier, in stable `gclid → gbraid → wbraid`
 * order. Attributes: `Expires`, `Path=/`, optional `Domain`, `Secure`,
 * and `SameSite=Lax` (Lax is required so the cookie survives the
 * cross-site redirect from the ad click).
 */
export function buildClickIdentifierCookieStrings(
  ids: ClickIdentifiers,
  options: { expiryDays: number; domain?: string; now?: Date },
): string[] {
  const now = options.now ?? new Date();
  const expires = new Date(now.getTime() + options.expiryDays * DAY_MS).toUTCString();
  const cookies: string[] = [];

  for (const key of ORDER) {
    const value = ids[key];
    if (value === undefined || value === '') continue;
    let cookie = `${COOKIE_NAMES[key]}=${encodeURIComponent(value)}`;
    cookie += `; Expires=${expires}`;
    cookie += `; Path=/`;
    if (options.domain !== undefined) cookie += `; Domain=${options.domain}`;
    cookie += `; Secure`;
    cookie += `; SameSite=Lax`;
    cookies.push(cookie);
  }
  return cookies;
}
