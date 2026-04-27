import { describe, expect, test } from 'vitest';

import { createAdsApiClient } from './ads-api.js';
import type { AccessTokenProvider } from './oauth.js';

type FetchCall = { url: string; method: string; headers: Record<string, string>; body: unknown };

function captureFetch(response: Response = new Response('{}', { status: 200 })) {
  const calls: FetchCall[] = [];
  const fn: typeof globalThis.fetch = async (input, init) => {
    const headerEntries = init?.headers ? Object.entries(init.headers) : [];
    calls.push({
      url: typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(headerEntries) as Record<string, string>,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
    });
    return response.clone();
  };
  return { fn, calls };
}

const fixedTokenProvider = (token = 'ya29.access-token'): AccessTokenProvider => ({
  getAccessToken: async () => token,
});

const sampleConversion = {
  conversionAction: 'customers/123/conversionActions/456',
  conversionDateTime: '2026-04-25 12:00:00+00:00',
  orderId: 'tb_test',
};

describe('createAdsApiClient.uploadClickConversions', () => {
  test('POSTs to googleads.googleapis.com/v17/customers/{customerId}:uploadClickConversions', async () => {
    const { fn, calls } = captureFetch();
    const client = createAdsApiClient({
      developerToken: 'dev-token',
      tokenProvider: fixedTokenProvider(),
      fetch: fn,
    });

    await client.uploadClickConversions({
      customerId: '1234567890',
      conversions: [sampleConversion],
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      'https://googleads.googleapis.com/v17/customers/1234567890:uploadClickConversions',
    );
    expect(calls[0]!.method).toBe('POST');
  });

  test('sets the Authorization header from the token provider', async () => {
    const { fn, calls } = captureFetch();
    const client = createAdsApiClient({
      developerToken: 'dev-token',
      tokenProvider: fixedTokenProvider('ya29.fresh'),
      fetch: fn,
    });

    await client.uploadClickConversions({
      customerId: '1',
      conversions: [sampleConversion],
    });

    expect(calls[0]!.headers.Authorization).toBe('Bearer ya29.fresh');
  });

  test('sets the developer-token header', async () => {
    const { fn, calls } = captureFetch();
    const client = createAdsApiClient({
      developerToken: 'super-secret-dev-token',
      tokenProvider: fixedTokenProvider(),
      fetch: fn,
    });

    await client.uploadClickConversions({
      customerId: '1',
      conversions: [sampleConversion],
    });

    expect(calls[0]!.headers['developer-token']).toBe('super-secret-dev-token');
  });

  test('sets login-customer-id header when configured', async () => {
    const { fn, calls } = captureFetch();
    const client = createAdsApiClient({
      developerToken: 'dev-token',
      tokenProvider: fixedTokenProvider(),
      loginCustomerId: '9876543210',
      fetch: fn,
    });

    await client.uploadClickConversions({
      customerId: '1',
      conversions: [sampleConversion],
    });

    expect(calls[0]!.headers['login-customer-id']).toBe('9876543210');
  });

  test('omits login-customer-id header when not configured', async () => {
    const { fn, calls } = captureFetch();
    const client = createAdsApiClient({
      developerToken: 'dev-token',
      tokenProvider: fixedTokenProvider(),
      fetch: fn,
    });

    await client.uploadClickConversions({
      customerId: '1',
      conversions: [sampleConversion],
    });

    expect(calls[0]!.headers['login-customer-id']).toBeUndefined();
  });

  test('sets Content-Type: application/json', async () => {
    const { fn, calls } = captureFetch();
    const client = createAdsApiClient({
      developerToken: 'dev-token',
      tokenProvider: fixedTokenProvider(),
      fetch: fn,
    });

    await client.uploadClickConversions({
      customerId: '1',
      conversions: [sampleConversion],
    });

    expect(calls[0]!.headers['Content-Type']).toBe('application/json');
  });

  test('wraps conversions in { conversions, partialFailure: true } body', async () => {
    const { fn, calls } = captureFetch();
    const client = createAdsApiClient({
      developerToken: 'dev-token',
      tokenProvider: fixedTokenProvider(),
      fetch: fn,
    });

    await client.uploadClickConversions({
      customerId: '1',
      conversions: [sampleConversion],
    });

    expect(calls[0]!.body).toEqual({
      conversions: [sampleConversion],
      partialFailure: true,
    });
  });

  test('returns { ok: true, status: 200, body } on success', async () => {
    const { fn } = captureFetch(
      new Response(JSON.stringify({ results: [{ orderId: 'tb_test' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = createAdsApiClient({
      developerToken: 'dev-token',
      tokenProvider: fixedTokenProvider(),
      fetch: fn,
    });

    const result = await client.uploadClickConversions({
      customerId: '1',
      conversions: [sampleConversion],
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ results: [{ orderId: 'tb_test' }] });
  });

  test('returns { ok: false, ... } on 4xx without throwing', async () => {
    const { fn } = captureFetch(
      new Response(JSON.stringify({ error: { message: 'invalid customer' } }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = createAdsApiClient({
      developerToken: 'dev-token',
      tokenProvider: fixedTokenProvider(),
      fetch: fn,
    });

    const result = await client.uploadClickConversions({
      customerId: '1',
      conversions: [sampleConversion],
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: { message: 'invalid customer' } });
  });

  test('returns { body: null } when the response is not JSON', async () => {
    const { fn } = captureFetch(new Response('plain text', { status: 500 }));
    const client = createAdsApiClient({
      developerToken: 'dev-token',
      tokenProvider: fixedTokenProvider(),
      fetch: fn,
    });

    const result = await client.uploadClickConversions({
      customerId: '1',
      conversions: [sampleConversion],
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
    expect(result.body).toBeNull();
  });

  test('rejects when the underlying fetch throws (network error)', async () => {
    const fn: typeof globalThis.fetch = async () => {
      throw new Error('ECONNRESET');
    };
    const client = createAdsApiClient({
      developerToken: 'dev-token',
      tokenProvider: fixedTokenProvider(),
      fetch: fn,
    });

    await expect(
      client.uploadClickConversions({ customerId: '1', conversions: [sampleConversion] }),
    ).rejects.toThrow(/ECONNRESET/);
  });

  test('calls tokenProvider.getAccessToken once per request', async () => {
    let calls = 0;
    const tokenProvider: AccessTokenProvider = {
      getAccessToken: async () => {
        calls++;
        return 'ya29.x';
      },
    };
    const { fn } = captureFetch();
    const client = createAdsApiClient({
      developerToken: 'dev-token',
      tokenProvider,
      fetch: fn,
    });

    await client.uploadClickConversions({ customerId: '1', conversions: [sampleConversion] });
    await client.uploadClickConversions({ customerId: '1', conversions: [sampleConversion] });

    expect(calls).toBe(2);
  });

  test('respects a custom apiVersion', async () => {
    const { fn, calls } = captureFetch();
    const client = createAdsApiClient({
      developerToken: 'dev-token',
      tokenProvider: fixedTokenProvider(),
      fetch: fn,
      apiVersion: 'v18',
    });

    await client.uploadClickConversions({
      customerId: '1',
      conversions: [sampleConversion],
    });

    expect(calls[0]!.url).toBe(
      'https://googleads.googleapis.com/v18/customers/1:uploadClickConversions',
    );
  });
});
