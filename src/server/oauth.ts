const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const EXPIRY_SAFETY_MARGIN_SECONDS = 60;

export type OAuthCredentials = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
};

export type AccessTokenProvider = {
  getAccessToken(): Promise<string>;
};

type CachedToken = { token: string; expiresAt: number };

type TokenResponse = { access_token: string; expires_in: number };

/**
 * Creates an access-token provider for the Google OAuth refresh-token
 * flow.
 *
 * Caches the access token in memory until ~60 seconds before its
 * advertised expiry, then transparently refreshes on the next call.
 * Concurrent calls during a refresh share a single in-flight request,
 * so a burst of conversion uploads never causes a thundering-herd of
 * token exchanges. A failed refresh clears the pending promise so the
 * next call retries.
 */
export function createAccessTokenProvider(
  credentials: OAuthCredentials,
  options: { fetch?: typeof globalThis.fetch; now?: () => number } = {},
): AccessTokenProvider {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => Date.now());

  let cached: CachedToken | null = null;
  let pending: Promise<string> | null = null;

  async function refresh(): Promise<string> {
    const body = new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: credentials.refreshToken,
      grant_type: 'refresh_token',
    });
    const response = await fetchImpl(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!response.ok) {
      throw new Error(
        `[trackbridge] OAuth refresh failed with ${response.status} ${response.statusText}`,
      );
    }
    const json = (await response.json()) as TokenResponse;
    cached = {
      token: json.access_token,
      expiresAt: now() + (json.expires_in - EXPIRY_SAFETY_MARGIN_SECONDS) * 1000,
    };
    return json.access_token;
  }

  return {
    async getAccessToken(): Promise<string> {
      if (cached !== null && cached.expiresAt > now()) {
        return cached.token;
      }
      if (pending !== null) return pending;

      pending = refresh().finally(() => {
        pending = null;
      });
      return pending;
    },
  };
}
