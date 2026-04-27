import {
  createServerTracker,
  type ServerConversionInput,
  type ServerTracker,
} from '@trackbridge/server';
import { NextResponse, type NextRequest } from 'next/server';

let cachedTracker: ServerTracker | null = null;
let cachedInitError: Error | null = null;

/**
 * Lazy server-tracker init. Module-level construction would crash the
 * entire route on import if env vars are missing; deferring to first
 * request lets the rest of the app render and surfaces the error in a
 * 500 response with a useful message.
 */
function getServerTracker(): ServerTracker {
  if (cachedTracker !== null) return cachedTracker;
  if (cachedInitError !== null) throw cachedInitError;

  try {
    const ga4MeasurementId = process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID;
    const ga4ApiSecret = process.env.GA4_API_SECRET;
    if (ga4MeasurementId === undefined || ga4ApiSecret === undefined) {
      throw new Error(
        'NEXT_PUBLIC_GA4_MEASUREMENT_ID and GA4_API_SECRET must be set. ' +
          'Copy examples/nextjs-demo/.env.local.example to .env.local and fill in your values.',
      );
    }

    // Ads block is optional — only attached if all five fields are present so
    // the demo can run with just GA4 configured.
    const ads = (() => {
      const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
      const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
      const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;
      const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
      const conversionAction = process.env.GOOGLE_ADS_CONVERSION_ACTION;
      const label = process.env.NEXT_PUBLIC_ADS_CONVERSION_LABEL;
      if (
        developerToken === undefined ||
        customerId === undefined ||
        refreshToken === undefined ||
        clientId === undefined ||
        clientSecret === undefined ||
        conversionAction === undefined ||
        label === undefined
      ) {
        return undefined;
      }
      return {
        developerToken,
        customerId,
        refreshToken,
        clientId,
        clientSecret,
        conversionActions: { [label]: conversionAction },
      };
    })();

    cachedTracker = createServerTracker({
      ga4MeasurementId,
      ga4ApiSecret,
      ads,
      debug: process.env.NODE_ENV !== 'production',
    });
    return cachedTracker;
  } catch (err) {
    cachedInitError = err instanceof Error ? err : new Error(String(err));
    throw cachedInitError;
  }
}

type ConversionPayload = {
  orderId: string;
  label: string;
  value?: number;
  currency?: string;
  userData?: ServerConversionInput['userData'];
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: ConversionPayload;
  try {
    body = (await req.json()) as ConversionPayload;
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (typeof body.orderId !== 'string' || typeof body.label !== 'string') {
    return NextResponse.json({ error: 'orderId and label required' }, { status: 400 });
  }

  let tracker: ServerTracker;
  try {
    tracker = getServerTracker();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }

  // userData passes through verbatim; the SDK normalizes + hashes before
  // sending to Google. Same input on browser + server → same hashes.
  await tracker.trackConversion({
    label: body.label,
    value: body.value,
    currency: body.currency,
    transactionId: body.orderId,
    gclid: body.gclid,
    gbraid: body.gbraid,
    wbraid: body.wbraid,
    userData: body.userData,
  });

  return NextResponse.json({ ok: true, transactionId: body.orderId });
}
