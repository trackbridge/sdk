import {
  buildGa4HelperParams,
  GA4_EVENT_NAMES,
  type SemanticHelperName,
  type UserData,
} from '@trackbridge/core';

import type {
  HelperSendResult,
  ServerAddToCartInput,
  ServerBeginCheckoutInput,
  ServerConsent,
  ServerHelperResult,
  ServerPurchaseInput,
  ServerRefundInput,
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
  readonly resolveTransactionId: (input: string | undefined) => string;
};

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
    params: buildGa4HelperParams({
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
    params: buildGa4HelperParams({
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
    params: buildGa4HelperParams({
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
    params: buildGa4HelperParams({ transactionId, method: input.method }),
    clientId: input.clientId,
    userId: input.userId,
    userData: input.userData,
    consent: input.consent,
  });

  const [ads, ga4] = await Promise.all([adsP, ga4P]);
  return { ads, ga4 };
}

export async function executeRefund(
  input: ServerRefundInput,
  ctx: ServerHelperContext,
): Promise<ServerHelperResult> {
  const transactionId = ctx.resolveTransactionId(input.transactionId);

  // Refund Ads adjustments are out of scope for v1 — always skipped.
  // Even if a consumer forces `conversionLabels.refund` via `as any`, this
  // helper never fires Ads. The Ads-side `uploadConversionAdjustments` API
  // is a separate code path; revisit when a real consumer needs it.
  const ads: HelperSendResult = { skipped: true, reason: 'refund_ads_unsupported' };

  const ga4 = await fireGa4(ctx, {
    helperName: 'refund',
    params: buildGa4HelperParams({
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

  return { ads, ga4 };
}
