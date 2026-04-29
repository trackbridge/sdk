/**
 * GA4 ecommerce item. Maps to the structure GA4's `items[]` array
 * expects on `purchase`, `refund`, `begin_checkout`, `add_to_cart`,
 * and related events.
 *
 * Field names are camelCase in the SDK and converted to snake_case
 * (`itemId` → `item_id`, etc.) at serialization time. One of `itemId`
 * or `itemName` should be set per GA4's spec; the SDK does not
 * runtime-validate this — the type leaves both optional.
 *
 * Per-item `currency` is intentionally not modeled in v1 — event-level
 * `currency` covers the cases we've seen.
 */
export type TrackbridgeItem = {
  itemId?: string;
  itemName?: string;
  affiliation?: string;
  coupon?: string;
  creativeName?: string;
  creativeSlot?: string;
  discount?: number;
  index?: number;
  itemBrand?: string;
  itemCategory?: string;
  itemCategory2?: string;
  itemCategory3?: string;
  itemCategory4?: string;
  itemCategory5?: string;
  itemListId?: string;
  itemListName?: string;
  itemVariant?: string;
  locationId?: string;
  price?: number;
  promotionId?: string;
  promotionName?: string;
  quantity?: number;
};

const ITEM_FIELD_TO_GA4: Record<keyof TrackbridgeItem, string> = {
  itemId: 'item_id',
  itemName: 'item_name',
  affiliation: 'affiliation',
  coupon: 'coupon',
  creativeName: 'creative_name',
  creativeSlot: 'creative_slot',
  discount: 'discount',
  index: 'index',
  itemBrand: 'item_brand',
  itemCategory: 'item_category',
  itemCategory2: 'item_category2',
  itemCategory3: 'item_category3',
  itemCategory4: 'item_category4',
  itemCategory5: 'item_category5',
  itemListId: 'item_list_id',
  itemListName: 'item_list_name',
  itemVariant: 'item_variant',
  locationId: 'location_id',
  price: 'price',
  promotionId: 'promotion_id',
  promotionName: 'promotion_name',
  quantity: 'quantity',
};

/**
 * Convert SDK-camelCase items to the snake_case shape GA4 expects on
 * the wire (gtag params and Measurement Protocol body alike). Pure
 * function — no validation, no defaulting. Identical input → identical
 * output, byte-for-byte, on browser and server.
 */
export function mapItemsForGa4(
  items: readonly TrackbridgeItem[],
): Array<Record<string, unknown>> {
  return items.map((item) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(item)) {
      if (v === undefined) continue;
      const ga4Key = ITEM_FIELD_TO_GA4[k as keyof TrackbridgeItem];
      if (ga4Key !== undefined) out[ga4Key] = v;
    }
    return out;
  });
}

/**
 * Internal canonical-name map. Single source of truth for the wire
 * names used by gtag (`event` second arg) and GA4 MP (`events[].name`).
 * Both `@trackbridge/browser` and `@trackbridge/server` reference this.
 */
export const GA4_EVENT_NAMES = {
  purchase: 'purchase',
  beginCheckout: 'begin_checkout',
  addToCart: 'add_to_cart',
  signUp: 'sign_up',
  refund: 'refund',
} as const;

export type SemanticHelperName = keyof typeof GA4_EVENT_NAMES;
