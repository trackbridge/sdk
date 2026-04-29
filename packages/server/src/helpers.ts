import {
  GA4_EVENT_NAMES,
  mapItemsForGa4,
  type SemanticHelperName,
  type TrackbridgeItem,
  type UserData,
} from '@trackbridge/core';

import type {
  HelperSendResult,
  ServerAddToCartInput,
  ServerBeginCheckoutInput,
  ServerConsent,
  ServerHelperResult,
  ServerPurchaseInput,
  ServerSignUpInput,
  ServerTracker,
} from './types.js';

/**
 * Closure-bound state for the server-side helpers. The helpers reuse
 * the underlying `trackEvent` / `trackConversion` calls for transport,
 * so they need a reference to the tracker instance plus the
 * `conversionLabels` config and a transactionId resolver.
 */
export type ServerHelperContext = {
  readonly underlying: ServerTracker;
  readonly conversionLabels: {
    purchase?: string;
    beginCheckout?: string;
    addToCart?: string;
    signUp?: string;
  };
  readonly hasMeasurementId: boolean;
  readonly hasAds: boolean;
  readonly resolveTransactionId: (input: string | undefined) => string;
};

/**
 * Drops only `undefined` keys. Preserves `0`, `false`, `''`, `null` so
 * free purchases (`value: 0`) and intentional clears reach the wire.
 */
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

async function fireGa4(
  ctx: ServerHelperContext,
  args: {
    helperName: SemanticHelperName;
    params: Record<string, unknown>;
    clientId: string;
    userId: string | undefined;
    userData: UserData | undefined;
    consent: ServerConsent | undefined;
  },
): Promise<HelperSendResult> {
  if (!ctx.hasMeasurementId) {
    return { skipped: true, reason: 'no_measurement_id' };
  }
  const result = await ctx.underlying.trackEvent({
    name: GA4_EVENT_NAMES[args.helperName],
    clientId: args.clientId,
    userId: args.userId,
    params: args.params,
    userData: args.userData,
    consent: args.consent,
  });
  return result.ga4;
}

async function fireAdsConversion(
  ctx: ServerHelperContext,
  args: {
    label: string;
    transactionId: string;
    value: number | undefined;
    currency: string | undefined;
    gclid: string | undefined;
    gbraid: string | undefined;
    wbraid: string | undefined;
    userData: UserData | undefined;
    consent: ServerConsent | undefined;
  },
): Promise<HelperSendResult> {
  const result = await ctx.underlying.trackConversion({
    label: args.label,
    transactionId: args.transactionId,
    value: args.value,
    currency: args.currency,
    gclid: args.gclid,
    gbraid: args.gbraid,
    wbraid: args.wbraid,
    userData: args.userData,
    consent: args.consent,
  });
  return result.ads;
}

export async function executePurchase(
  input: ServerPurchaseInput,
  ctx: ServerHelperContext,
): Promise<ServerHelperResult> {
  const transactionId = ctx.resolveTransactionId(input.transactionId);

  const adsP: Promise<HelperSendResult> = (async () => {
    const label = ctx.conversionLabels.purchase;
    if (label === undefined) return { skipped: true, reason: 'no_label_configured' };
    return fireAdsConversion(ctx, {
      label,
      transactionId,
      value: input.value,
      currency: input.currency,
      gclid: input.gclid,
      gbraid: input.gbraid,
      wbraid: input.wbraid,
      userData: input.userData,
      consent: input.consent,
    });
  })();

  const ga4P = fireGa4(ctx, {
    helperName: 'purchase',
    params: buildGa4Params({
      transactionId,
      value: input.value,
      currency: input.currency,
      items: input.items,
      affiliation: input.affiliation,
      coupon: input.coupon,
      shipping: input.shipping,
      tax: input.tax,
    }),
    clientId: input.clientId,
    userId: input.userId,
    userData: input.userData,
    consent: input.consent,
  });

  const [ads, ga4] = await Promise.all([adsP, ga4P]);
  return { ads, ga4 };
}

export async function executeBeginCheckout(
  input: ServerBeginCheckoutInput,
  ctx: ServerHelperContext,
): Promise<ServerHelperResult> {
  const transactionId = ctx.resolveTransactionId(input.transactionId);

  const adsP: Promise<HelperSendResult> = (async () => {
    const label = ctx.conversionLabels.beginCheckout;
    if (label === undefined) return { skipped: true, reason: 'no_label_configured' };
    return fireAdsConversion(ctx, {
      label,
      transactionId,
      value: input.value,
      currency: input.currency,
      gclid: input.gclid,
      gbraid: input.gbraid,
      wbraid: input.wbraid,
      userData: input.userData,
      consent: input.consent,
    });
  })();

  const ga4P = fireGa4(ctx, {
    helperName: 'beginCheckout',
    params: buildGa4Params({
      transactionId,
      value: input.value,
      currency: input.currency,
      items: input.items,
      coupon: input.coupon,
    }),
    clientId: input.clientId,
    userId: input.userId,
    userData: input.userData,
    consent: input.consent,
  });

  const [ads, ga4] = await Promise.all([adsP, ga4P]);
  return { ads, ga4 };
}

export async function executeAddToCart(
  input: ServerAddToCartInput,
  ctx: ServerHelperContext,
): Promise<ServerHelperResult> {
  const transactionId = ctx.resolveTransactionId(input.transactionId);

  const adsP: Promise<HelperSendResult> = (async () => {
    const label = ctx.conversionLabels.addToCart;
    if (label === undefined) return { skipped: true, reason: 'no_label_configured' };
    return fireAdsConversion(ctx, {
      label,
      transactionId,
      value: input.value,
      currency: input.currency,
      gclid: input.gclid,
      gbraid: input.gbraid,
      wbraid: input.wbraid,
      userData: input.userData,
      consent: input.consent,
    });
  })();

  const ga4P = fireGa4(ctx, {
    helperName: 'addToCart',
    params: buildGa4Params({
      transactionId,
      value: input.value,
      currency: input.currency,
      items: input.items,
    }),
    clientId: input.clientId,
    userId: input.userId,
    userData: input.userData,
    consent: input.consent,
  });

  const [ads, ga4] = await Promise.all([adsP, ga4P]);
  return { ads, ga4 };
}

export async function executeSignUp(
  input: ServerSignUpInput,
  ctx: ServerHelperContext,
): Promise<ServerHelperResult> {
  const transactionId = ctx.resolveTransactionId(input.transactionId);

  const adsP: Promise<HelperSendResult> = (async () => {
    const label = ctx.conversionLabels.signUp;
    if (label === undefined) return { skipped: true, reason: 'no_label_configured' };
    return fireAdsConversion(ctx, {
      label,
      transactionId,
      value: undefined,
      currency: undefined,
      gclid: input.gclid,
      gbraid: input.gbraid,
      wbraid: input.wbraid,
      userData: input.userData,
      consent: input.consent,
    });
  })();

  const ga4P = fireGa4(ctx, {
    helperName: 'signUp',
    params: buildGa4Params({ transactionId, method: input.method }),
    clientId: input.clientId,
    userId: input.userId,
    userData: input.userData,
    consent: input.consent,
  });

  const [ads, ga4] = await Promise.all([adsP, ga4P]);
  return { ads, ga4 };
}
