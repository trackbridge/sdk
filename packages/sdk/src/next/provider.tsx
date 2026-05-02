import Script from 'next/script';
import type { ReactNode } from 'react';

import type { BrowserTrackerConfig, ConsentState } from '../browser/index.js';
import { TrackbridgeContextProvider } from './context.js';

const DEFAULT_CONSENT_DENIED: ConsentState = {
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
  analytics_storage: 'denied',
};

export type TrackbridgeProviderProps = {
  config: BrowserTrackerConfig;
  /**
   * Overrides for the Consent Mode v2 default-denied snippet. Merges
   * per field over the all-denied defaults. Useful for non-EEA
   * regions or local development where consent banners are skipped.
   */
  consentDefaults?: Partial<ConsentState>;
  children: ReactNode;
};

export function TrackbridgeProvider({
  config,
  consentDefaults,
  children,
}: TrackbridgeProviderProps): ReactNode {
  const consent: ConsentState = { ...DEFAULT_CONSENT_DENIED, ...consentDefaults };
  // Loader URL prefers the Ads ID (one gtag.js handles multiple `config`
  // calls). Falls back to GA4 if Ads is ever absent — defensive against
  // future config-shape loosening, no behavior change while adsConversionId
  // is required.
  const loaderId = config.adsConversionId ?? config.ga4MeasurementId;
  const consentScript = `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('consent', 'default', ${JSON.stringify(consent)});`;

  return (
    <>
      <Script id="tb-consent" strategy="beforeInteractive">
        {consentScript}
      </Script>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${loaderId}`}
        strategy="afterInteractive"
      />
      <TrackbridgeContextProvider config={config}>{children}</TrackbridgeContextProvider>
    </>
  );
}
