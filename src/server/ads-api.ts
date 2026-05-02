import type { AccessTokenProvider } from './oauth.js';

const ADS_API_HOST = 'https://googleads.googleapis.com';
const DEFAULT_API_VERSION = 'v17';

export type AdsApiResponse = {
  ok: boolean;
  status: number;
  body: unknown;
};

export type AdsApiClient = {
  uploadClickConversions(input: {
    customerId: string;
    conversions: Array<Record<string, unknown>>;
  }): Promise<AdsApiResponse>;
};

/**
 * Creates an authenticated client for the Google Ads API conversion
 * upload endpoint.
 *
 * Each call fetches a fresh access token via {@link AccessTokenProvider}
 * (which itself caches tokens until near expiry), attaches the
 * `developer-token` and optional `login-customer-id` headers, and
 * POSTs the conversions wrapped in `{ conversions, partialFailure: true }`
 * — `partialFailure` lets a single bad row not fail the whole batch.
 *
 * Non-2xx responses resolve with `{ ok: false, status, body }` so the
 * caller can log and continue. Network errors propagate as throws.
 */
export function createAdsApiClient(deps: {
  developerToken: string;
  tokenProvider: AccessTokenProvider;
  loginCustomerId?: string;
  fetch?: typeof globalThis.fetch;
  apiVersion?: string;
}): AdsApiClient {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const apiVersion = deps.apiVersion ?? DEFAULT_API_VERSION;

  return {
    async uploadClickConversions({ customerId, conversions }): Promise<AdsApiResponse> {
      const url = `${ADS_API_HOST}/${apiVersion}/customers/${customerId}:uploadClickConversions`;
      const accessToken = await deps.tokenProvider.getAccessToken();

      const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
        'developer-token': deps.developerToken,
        'Content-Type': 'application/json',
      };
      if (deps.loginCustomerId !== undefined) {
        headers['login-customer-id'] = deps.loginCustomerId;
      }

      const response = await fetchImpl(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ conversions, partialFailure: true }),
      });

      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        // Non-JSON response; leave body as null.
      }

      return { ok: response.ok, status: response.status, body };
    },
  };
}
