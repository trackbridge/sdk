'use client';

import { useState } from 'react';

import { getTracker } from '@/lib/tracker';

const SAMPLE_USER_DATA = {
  email: 'jane@example.com',
  phone: '+1 (555) 123-4567',
  firstName: 'Jane',
  lastName: 'Doe',
  address: {
    street: '123 Main St',
    city: 'Austin',
    region: 'TX',
    postalCode: '78701',
    country: 'US',
  },
} as const;

export default function Home() {
  const [status, setStatus] = useState<string>(
    'Click "Simulate purchase" to fire a conversion on both sides with the same transactionId.',
  );
  const [busy, setBusy] = useState(false);

  async function fireConversion(): Promise<void> {
    setBusy(true);
    try {
      // Demo only — DO NOT do this in production. Use your real order /
      // transaction primary key so browser and server agree on the dedup
      // key. A timestamp+random pair regenerated in two places is exactly
      // the failure mode the dual-send invariant protects against.
      const orderId = `order_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
      const label = process.env.NEXT_PUBLIC_ADS_CONVERSION_LABEL ?? 'demo';

      const tracker = getTracker();

      // 1. Browser side — fires gtag('set', 'user_data', …) then
      //    gtag('event', 'conversion', …) under the hood.
      await tracker.trackConversion({
        label,
        value: 99,
        currency: 'USD',
        transactionId: orderId,
        userData: SAMPLE_USER_DATA,
      });

      // 2. Server side — POST the order data + captured click IDs to our
      //    API route, which calls serverTracker.trackConversion with the
      //    SAME transactionId so Google dedupes.
      const clickIds = tracker.getClickIdentifiers();
      const response = await fetch('/api/conversion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          label,
          value: 99,
          currency: 'USD',
          userData: SAMPLE_USER_DATA,
          gclid: clickIds.gclid,
          gbraid: clickIds.gbraid,
          wbraid: clickIds.wbraid,
        }),
      });

      const result = (await response.json()) as {
        ok: boolean;
        ads?: { ok: true } | { ok: false; error: string };
      };
      const adsStatus = result.ads
        ? result.ads.ok
          ? 'Ads OK'
          : `Ads FAILED: ${result.ads.error}`
        : 'Ads not configured';
      setStatus(
        `Fired both sides with transactionId="${orderId}". Server: HTTP ${response.status}, ${adsStatus}. ` +
          `Check window.dataLayer in DevTools and the Network tab for /api/conversion.`,
      );
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <h1>Trackbridge dual-send demo</h1>
      <p>
        Add <code>?gclid=demo-click-id</code> to the URL on first load to simulate landing from a Google ad — the SDK
        captures it into a <code>_tb_gclid</code> cookie and forwards it to the server-side call.
      </p>
      <button
        onClick={() => {
          void fireConversion();
        }}
        disabled={busy}
        style={{ padding: '0.75rem 1.25rem', fontSize: '1rem', cursor: busy ? 'wait' : 'pointer' }}
      >
        {busy ? 'Firing…' : 'Simulate purchase'}
      </button>
      <p style={{ marginTop: '1.5rem', color: '#444' }}>{status}</p>
    </main>
  );
}
