import { describe, expect, test } from 'vitest';

import { mapItemsForGa4, GA4_EVENT_NAMES, type TrackbridgeItem } from './items.js';

describe('mapItemsForGa4', () => {
  test('empty array → empty array', () => {
    expect(mapItemsForGa4([])).toEqual([]);
  });

  test('item with all fields → exact snake_case shape (golden)', () => {
    const input: TrackbridgeItem = {
      itemId: 'SKU-1',
      itemName: 'Widget',
      affiliation: 'Acme Store',
      coupon: 'SUMMER10',
      creativeName: 'hero-banner',
      creativeSlot: 'home_banner_1',
      discount: 5.5,
      index: 0,
      itemBrand: 'Acme',
      itemCategory: 'Apparel',
      itemCategory2: 'Mens',
      itemCategory3: 'Shirts',
      itemCategory4: 'Casual',
      itemCategory5: 'Solid',
      itemListId: 'list_001',
      itemListName: 'New Arrivals',
      itemVariant: 'Blue / L',
      locationId: 'NY-WAREHOUSE',
      price: 49.99,
      promotionId: 'promo_001',
      promotionName: 'Summer Sale',
      quantity: 2,
    };

    expect(mapItemsForGa4([input])).toEqual([
      {
        item_id: 'SKU-1',
        item_name: 'Widget',
        affiliation: 'Acme Store',
        coupon: 'SUMMER10',
        creative_name: 'hero-banner',
        creative_slot: 'home_banner_1',
        discount: 5.5,
        index: 0,
        item_brand: 'Acme',
        item_category: 'Apparel',
        item_category2: 'Mens',
        item_category3: 'Shirts',
        item_category4: 'Casual',
        item_category5: 'Solid',
        item_list_id: 'list_001',
        item_list_name: 'New Arrivals',
        item_variant: 'Blue / L',
        location_id: 'NY-WAREHOUSE',
        price: 49.99,
        promotion_id: 'promo_001',
        promotion_name: 'Summer Sale',
        quantity: 2,
      },
    ]);
  });

  test('item with only itemId → only item_id key', () => {
    expect(mapItemsForGa4([{ itemId: 'SKU-1' }])).toEqual([{ item_id: 'SKU-1' }]);
  });

  test('all five item_category levels map correctly', () => {
    const input: TrackbridgeItem = {
      itemId: 'a',
      itemCategory: 'c1',
      itemCategory2: 'c2',
      itemCategory3: 'c3',
      itemCategory4: 'c4',
      itemCategory5: 'c5',
    };
    const out = mapItemsForGa4([input])[0]!;
    expect(out).toMatchObject({
      item_category: 'c1',
      item_category2: 'c2',
      item_category3: 'c3',
      item_category4: 'c4',
      item_category5: 'c5',
    });
  });

  test('preserves array order', () => {
    const result = mapItemsForGa4([
      { itemId: 'a' },
      { itemId: 'b' },
      { itemId: 'c' },
    ]);
    expect(result.map((x) => x.item_id)).toEqual(['a', 'b', 'c']);
  });

  test('numeric fields pass through unchanged (no string coercion)', () => {
    const result = mapItemsForGa4([
      { itemId: 'a', price: 0, quantity: 0, discount: 0, index: 0 },
    ]);
    expect(result[0]).toMatchObject({
      price: 0,
      quantity: 0,
      discount: 0,
      index: 0,
    });
    expect(typeof result[0]!.price).toBe('number');
  });
});

describe('GA4_EVENT_NAMES', () => {
  test('exposes the five canonical wire names', () => {
    expect(GA4_EVENT_NAMES).toEqual({
      purchase: 'purchase',
      beginCheckout: 'begin_checkout',
      addToCart: 'add_to_cart',
      signUp: 'sign_up',
      refund: 'refund',
    });
  });
});
