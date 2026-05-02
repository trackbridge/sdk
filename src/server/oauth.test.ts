import { describe, expect, test } from 'vitest';

import { createAccessTokenProvider, type OAuthCredentials } from './oauth.js';

type FetchCall = { url: string; method: string; headers: Record<string, string>; body: string };

function captureFetch(responses: Response[]) {
  const calls: FetchCall[] = [];
  let i = 0;
  const fn: typeof globalThis.fetch = async (input, init) => {
    const headerEntries = init?.headers ? Object.entries(init.headers) : [];
    calls.push({
      url: typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(headerEntries) as Record<string, string>,
      body: typeof init?.body === 'string' ? init.body : '',
    });
    const next = responses[i++] ?? responses[responses.length - 1];
    if (next === undefined) throw new Error('captureFetch: no responses queued');
    return next.clone();
  };
  return { fn, calls };
}

const credentials: OAuthCredentials = {
  clientId: 'client-id-123.apps.googleusercontent.com',
  clientSecret: 'GOCSPX-secret',
  refreshToken: '1//0gRefresh',
};

const tokenResponse = (overrides: { access_token?: string; expires_in?: number } = {}) =>
  new Response(
    JSON.stringify({
      access_token: overrides.access_token ?? 'ya29.access-token-1',
      expires_in: overrides.expires_in ?? 3600,
      token_type: 'Bearer',
      scope: 'https://www.googleapis.com/auth/adwords',
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

describe('createAccessTokenProvider', () => {
  test('POSTs the refresh-token grant to oauth2.googleapis.com/token', async () => {
    const { fn, calls } = captureFetch([tokenResponse()]);
    const provider = createAccessTokenProvider(credentials, { fetch: fn });

    await provider.getAccessToken();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://oauth2.googleapis.com/token');
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
  });

  test('sends the correct form-encoded fields in the body', async () => {
    const { fn, calls } = captureFetch([tokenResponse()]);
    const provider = createAccessTokenProvider(credentials, { fetch: fn });

    await provider.getAccessToken();

    const params = new URLSearchParams(calls[0]!.body);
    expect(params.get('client_id')).toBe(credentials.clientId);
    expect(params.get('client_secret')).toBe(credentials.clientSecret);
    expect(params.get('refresh_token')).toBe(credentials.refreshToken);
    expect(params.get('grant_type')).toBe('refresh_token');
  });

  test('returns the access_token from the response', async () => {
    const { fn } = captureFetch([tokenResponse({ access_token: 'ya29.first' })]);
    const provider = createAccessTokenProvider(credentials, { fetch: fn });

    expect(await provider.getAccessToken()).toBe('ya29.first');
  });

  test('caches the access_token across calls within its expiry window', async () => {
    const { fn, calls } = captureFetch([tokenResponse()]);
    let now = 1_000_000;
    const provider = createAccessTokenProvider(credentials, { fetch: fn, now: () => now });

    const t1 = await provider.getAccessToken();
    now += 1_000_000; // 1000s later, still well within a 3600s expiry minus 60s margin
    const t2 = await provider.getAccessToken();

    expect(t1).toBe(t2);
    expect(calls).toHaveLength(1);
  });

  test('refreshes when the cached token is past the expiry window', async () => {
    const { fn, calls } = captureFetch([
      tokenResponse({ access_token: 'first', expires_in: 120 }),
      tokenResponse({ access_token: 'second', expires_in: 120 }),
    ]);
    let now = 1_000_000;
    const provider = createAccessTokenProvider(credentials, { fetch: fn, now: () => now });

    expect(await provider.getAccessToken()).toBe('first');

    // Past the 60s safety margin (cached until 60s from issuance)
    now += 90_000;
    expect(await provider.getAccessToken()).toBe('second');
    expect(calls).toHaveLength(2);
  });

  test('applies a 60-second safety margin (expires_in=120 → cached for 60s)', async () => {
    const { fn, calls } = captureFetch([
      tokenResponse({ access_token: 'first', expires_in: 120 }),
      tokenResponse({ access_token: 'second', expires_in: 120 }),
    ]);
    let now = 1_000_000;
    const provider = createAccessTokenProvider(credentials, { fetch: fn, now: () => now });

    await provider.getAccessToken();
    now += 59_000; // 59 seconds — still within margin
    expect(await provider.getAccessToken()).toBe('first');
    expect(calls).toHaveLength(1);

    now += 2_000; // total 61 seconds — past margin
    expect(await provider.getAccessToken()).toBe('second');
    expect(calls).toHaveLength(2);
  });

  test('coalesces concurrent calls into a single HTTP request', async () => {
    let resolveResponse!: () => void;
    const responseGate = new Promise<void>((resolve) => {
      resolveResponse = resolve;
    });
    const fn: typeof globalThis.fetch = async () => {
      await responseGate;
      return tokenResponse({ access_token: 'shared' });
    };
    let fetchCount = 0;
    const wrapped: typeof globalThis.fetch = async (...args) => {
      fetchCount++;
      return fn(...args);
    };

    const provider = createAccessTokenProvider(credentials, { fetch: wrapped });

    const a = provider.getAccessToken();
    const b = provider.getAccessToken();
    const c = provider.getAccessToken();
    resolveResponse();

    expect(await a).toBe('shared');
    expect(await b).toBe('shared');
    expect(await c).toBe('shared');
    expect(fetchCount).toBe(1);
  });

  test('rejects when the OAuth endpoint returns a non-200 status', async () => {
    const { fn } = captureFetch([new Response('invalid_grant', { status: 400 })]);
    const provider = createAccessTokenProvider(credentials, { fetch: fn });

    await expect(provider.getAccessToken()).rejects.toThrow(/400/);
  });

  test('rejects when the underlying fetch throws (network error)', async () => {
    const fn: typeof globalThis.fetch = async () => {
      throw new Error('connection reset');
    };
    const provider = createAccessTokenProvider(credentials, { fetch: fn });

    await expect(provider.getAccessToken()).rejects.toThrow(/connection reset/);
  });

  test('clears the pending promise after rejection so subsequent calls retry', async () => {
    let attempt = 0;
    const fn: typeof globalThis.fetch = async () => {
      attempt++;
      if (attempt === 1) throw new Error('first attempt fails');
      return tokenResponse({ access_token: 'recovered' });
    };
    const provider = createAccessTokenProvider(credentials, { fetch: fn });

    await expect(provider.getAccessToken()).rejects.toThrow(/first attempt fails/);
    expect(await provider.getAccessToken()).toBe('recovered');
    expect(attempt).toBe(2);
  });
});
