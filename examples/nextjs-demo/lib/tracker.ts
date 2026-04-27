'use client';

import { createBrowserTracker, type BrowserTracker } from '@trackbridge/browser';

let instance: BrowserTracker | null = null;

/**
 * Lazily creates the browser tracker on first use. Module-level init
 * would crash the page if `NEXT_PUBLIC_ADS_CONVERSION_ID` is missing;
 * this defers the failure to the click handler so the rest of the
 * page still renders.
 */
export function getTracker(): BrowserTracker {
  if (instance !== null) return instance;

  const adsId = process.env.NEXT_PUBLIC_ADS_CONVERSION_ID;
  if (adsId === undefined || adsId === '') {
    throw new Error(
      'NEXT_PUBLIC_ADS_CONVERSION_ID is not set. ' +
        'Copy examples/nextjs-demo/.env.local.example to .env.local and fill in your IDs.',
    );
  }

  instance = createBrowserTracker({
    adsConversionId: adsId,
    ga4MeasurementId: process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID,
    debug: process.env.NODE_ENV !== 'production',
  });
  return instance;
}
