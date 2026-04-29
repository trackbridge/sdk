import {
  GA4_EVENT_NAMES,
  mapItemsForGa4,
  type SemanticHelperName,
  type TrackbridgeItem,
  type UserData,
} from '@trackbridge/core';

import type {
  BrowserPurchaseInput,
  ClickIdentifiers,
  ConsentState,
} from './types.js';

/**
 * Closure-bound state passed from `createBrowserTracker` into each
 * helper. Mirrors the dependencies that `trackEvent` / `trackConversion`
 * already use.
 */
export type BrowserHelperContext = {
  readonly adsConversionId: string;
  readonly conversionLabels: {
    purchase?: string;
    beginCheckout?: string;
    addToCart?: string;
    signUp?: string;
  };
  readonly debug: () => boolean;
  readonly ids: () => ClickIdentifiers;
  readonly consent: () => ConsentState;
  readonly maybeSetUserData: (userData: UserData | undefined) => Promise<void>;
  readonly gtag: (...args: unknown[]) => void;
  readonly resolveTransactionId: (input: string | undefined) => string;
};

function dropUndefined<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function buildGa4Params(args: {
  transactionId: string;
  value?: number;
  currency?: string;
  items?: readonly TrackbridgeItem[];
  affiliation?: string;
  coupon?: string;
  shipping?: number;
  tax?: number;
  method?: string;
}): Record<string, unknown> {
  return dropUndefined({
    transaction_id: args.transactionId,
    value: args.value,
    currency: args.currency,
    items: args.items === undefined ? undefined : mapItemsForGa4(args.items),
    affiliation: args.affiliation,
    coupon: args.coupon,
    shipping: args.shipping,
    tax: args.tax,
    method: args.method,
  });
}

function fireGa4(
  ctx: BrowserHelperContext,
  helperName: SemanticHelperName,
  params: Record<string, unknown>,
): void {
  try {
    ctx.gtag('event', GA4_EVENT_NAMES[helperName], params);
  } catch (err) {
    if (ctx.debug()) console.warn(`[trackbridge] gtag ${helperName} GA4 failed:`, err);
  }
}

function fireAdsConversion(
  ctx: BrowserHelperContext,
  args: {
    label: string;
    transactionId: string;
    value?: number;
    currency?: string;
  },
): void {
  const ids = ctx.ids();
  const params = dropUndefined({
    send_to: `${ctx.adsConversionId}/${args.label}`,
    transaction_id: args.transactionId,
    value: args.value,
    currency: args.currency,
    gclid: ids.gclid,
    gbraid: ids.gbraid,
    wbraid: ids.wbraid,
  });
  try {
    ctx.gtag('event', 'conversion', params);
  } catch (err) {
    if (ctx.debug()) console.warn('[trackbridge] gtag conversion (helper) failed:', err);
  }
}

export async function executePurchase(
  input: BrowserPurchaseInput,
  ctx: BrowserHelperContext,
): Promise<void> {
  const transactionId = ctx.resolveTransactionId(input.transactionId);
  await ctx.maybeSetUserData(input.userData);

  const label = ctx.conversionLabels.purchase;
  if (label !== undefined) {
    fireAdsConversion(ctx, {
      label,
      transactionId,
      value: input.value,
      currency: input.currency,
    });
  }

  fireGa4(
    ctx,
    'purchase',
    buildGa4Params({
      transactionId,
      value: input.value,
      currency: input.currency,
      items: input.items,
      affiliation: input.affiliation,
      coupon: input.coupon,
      shipping: input.shipping,
      tax: input.tax,
    }),
  );
}
