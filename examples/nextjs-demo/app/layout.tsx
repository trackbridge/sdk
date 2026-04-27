import Script from 'next/script';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Trackbridge dual-send demo',
  description: 'End-to-end Trackbridge integration in Next.js.',
};

const ADS_ID = process.env.NEXT_PUBLIC_ADS_CONVERSION_ID;
const GA4_ID = process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 720, margin: '4rem auto', padding: '0 1rem' }}>
        {ADS_ID !== undefined && ADS_ID !== '' ? (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${ADS_ID}`}
              strategy="afterInteractive"
            />
            <Script id="gtag-init" strategy="afterInteractive">
              {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${ADS_ID}');
${GA4_ID !== undefined && GA4_ID !== '' ? `gtag('config', '${GA4_ID}');` : ''}`}
            </Script>
          </>
        ) : null}
        {children}
      </body>
    </html>
  );
}
