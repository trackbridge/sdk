import type { TrackbridgeContext } from '../../core/index.js';

type ClickIdentifiers = NonNullable<TrackbridgeContext['clickIds']>;

/**
 * Minimal interface for the cookie source. Compatible with both Next's
 * `ReadonlyRequestCookies` (from `cookies()` in app router) and a
 * synthesized stand-in for testing.
 */
export type CookieReader = {
  get(name: string): { value: string } | undefined;
};

/**
 * Header source. Compatible with Next's `ReadonlyHeaders` (from
 * `headers()` in app router) and the standard `Headers` global.
 */
export type HeaderReader = Pick<Headers, 'get'>;

export type ReadEnvelopeFromRequestArgs = {
  headers: HeaderReader;
  cookies: CookieReader;
};

/**
 * Reads the auto-captured first-party Trackbridge / GA cookies plus an
 * optional `x-trackbridge-context` JSON header, returning a partial
 * `TrackbridgeContext` envelope ready to feed into
 * `serverTracker.fromContext(envelope)`. Returns `null` if neither
 * cookies nor headers carry any usable data.
 *
 * The header value, when present and valid JSON, takes precedence
 * per-field over cookie-derived values; cookie values fill in fields
 * the header omits.
 */
export function readEnvelopeFromRequest({
  headers,
  cookies,
}: ReadEnvelopeFromRequestArgs): TrackbridgeContext | null {
  const fromCookies = readFromCookies(cookies);
  const fromHeader = readFromHeader(headers);

  if (fromCookies === null && fromHeader === null) {
    return null;
  }
  if (fromCookies === null) return fromHeader;
  if (fromHeader === null) return fromCookies;
  // Header wins per field.
  return { ...fromCookies, ...fromHeader };
}

function readFromCookies(cookies: CookieReader): TrackbridgeContext | null {
  const clickIds = readClickIdsFromCookies(cookies);
  const clientId = readClientIdFromGaCookie(cookies);

  if (clickIds === null && clientId === null) return null;

  const env: TrackbridgeContext = { v: 1, createdAt: Date.now() };
  if (clientId !== null) env.clientId = clientId;
  if (clickIds !== null) env.clickIds = clickIds;
  return env;
}

function readClickIdsFromCookies(cookies: CookieReader): ClickIdentifiers | null {
  const gclid = cookies.get('_tb_gclid')?.value;
  const gbraid = cookies.get('_tb_gbraid')?.value;
  const wbraid = cookies.get('_tb_wbraid')?.value;
  if (gclid === undefined && gbraid === undefined && wbraid === undefined) return null;
  const out: ClickIdentifiers = {};
  if (gclid !== undefined) out.gclid = gclid;
  if (gbraid !== undefined) out.gbraid = gbraid;
  if (wbraid !== undefined) out.wbraid = wbraid;
  return out;
}

function readClientIdFromGaCookie(cookies: CookieReader): string | null {
  const ga = cookies.get('_ga')?.value;
  if (ga === undefined) return null;
  // GA4 cookie format: GA1.{N}.{clientId}, where clientId is "<rand>.<timestamp>".
  const parts = ga.split('.');
  if (parts.length < 4) return null;
  if (parts[0] !== 'GA1') return null;
  return `${parts[2]}.${parts[3]}`;
}

function readFromHeader(headers: HeaderReader): TrackbridgeContext | null {
  const raw = headers.get('x-trackbridge-context');
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as TrackbridgeContext;
    return parsed;
  } catch {
    // Malformed JSON — silently treated as absent.
    return null;
  }
}
