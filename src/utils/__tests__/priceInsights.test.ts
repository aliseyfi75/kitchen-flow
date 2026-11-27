import { describe, expect, it } from 'vitest';
import { InventoryItem, ShoppingItem, Store, TripReceipt } from '../../types/kitchen';
import {
  appendPriceRecord,
  computeMultiStorePriceComparisons,
  computeStoreSpendSummary,
  estimateShoppingListCost,
} from '../priceInsights';

const STORES: Store[] = [
  { id: 'store-costco', name: 'Costco', color: '#DC2626' },
  { id: 'store-superstore', name: 'Superstore', color: '#0F766E' },
];

const makeItem = (overrides: Partial<InventoryItem>): InventoryItem => ({
  id: 'item-1',
  name: '2% Milk',
  alias: 'شیر',
  zone: 'fridge',
  category: 'dairy',
  trackingMode: 'continuous',
  totalPortions: 16,
  remainingPortions: 8,
  portionLabel: '1 cup',
  packDescription: '4L jug',
  proteinPerPortion: 9,
  defaultStoreId: 'store-costco',
  storePurchaseCounts: { 'store-costco': 1 },
  avgDaysPerFullPack: 7,
  cycleCount: 1,
  lastRestockedAt: '2026-11-20T00:00:00.000Z',
  autoAddOnEmpty: true,
  ...overrides,
});

describe('priceInsights', () => {
  it('caps priceHistory at the 12 most recent valid records', () => {
    let history = undefined;
    for (let i = 1; i <= 15; i++) {
      history = appendPriceRecord(history, {
        price: i + 0.49,
        storeId: 'store-costco',
        date: `2026-11-${String(i).padStart(2, '0')}T00:00:00.000Z`,
      });
    }
    expect(history).toHaveLength(12);
    expect(history?.[0].price).toBe(4.49);
    expect(history?.[11].price).toBe(15.49);
  });

  it('estimates shopping list cost using store-specific priceHistory when available', () => {
    const milk = makeItem({
      id: 'item-milk',
      lastPrice: 6.29,
      lastPriceStoreId: 'store-superstore',
      priceHistory: [
        { price: 5.49, storeId: 'store-costco', date: '2026-11-10T00:00:00.000Z' },
        { price: 6.29, storeId: 'store-superstore', date: '2026-11-20T00:00:00.000Z' },
      ],
    });
    const eggs = makeItem({
      id: 'item-eggs',
      name: 'Eggs',
      lastPrice: 8.99,
    });
    const itemMap = new Map([
      [milk.id, milk],
      [eggs.id, eggs],
    ]);

    const list: ShoppingItem[] = [
      {
        id: 's1',
        inventoryItemId: 'item-milk',
        name: '2% Milk',
        storeId: 'store-costco',
        quantityLabel: '4L jug',
        targetPortions: 16,
        targetZone: 'fridge',
        priority: 'essential',
        reason: 'finished',
        checked: false,
        addedAt: '2026-11-25T00:00:00.000Z',
      },
      {
        id: 's2',
        inventoryItemId: 'item-eggs',
        name: 'Eggs',
        storeId: 'store-costco',
        quantityLabel: '12 eggs',
        targetPortions: 12,
        targetZone: 'fridge',
        priority: 'essential',
        reason: 'finished',
        checked: false,
        addedAt: '2026-11-25T00:00:00.000Z',
      },
      {
        id: 's3',
        name: 'Ad-hoc Snack',
        storeId: 'store-costco',
        quantityLabel: '1 pack',
        targetPortions: 4,
        targetZone: 'pantry',
        priority: 'optional',
        reason: 'manual',
        checked: false,
        addedAt: '2026-11-25T00:00:00.000Z',
      },
    ];

    const est = estimateShoppingListCost(list, itemMap);
    expect(est.pricedCount).toBe(2);
    expect(est.totalCount).toBe(3);
    expect(est.totalEstimated).toBe(14.48); // 5.49 (Costco history) + 8.99
  });

  it('summarizes 30-day store spend and ignores older receipts', () => {
    const nowMs = Date.parse('2026-11-27T12:00:00.000Z');
    const receipts: TripReceipt[] = [
      { id: 'r1', storeId: 'store-costco', date: '2026-11-20T12:00:00.000Z', totalSpent: 84.5, itemCount: 7 },
      { id: 'r2', storeId: 'store-superstore', date: '2026-11-10T12:00:00.000Z', totalSpent: 42.25, itemCount: 5 },
      { id: 'r3', storeId: 'store-costco', date: '2026-10-01T12:00:00.000Z', totalSpent: 120, itemCount: 10 },
    ];

    const summary = computeStoreSpendSummary(receipts, STORES, 30, nowMs);
    expect(summary.totalSpent).toBe(126.75);
    expect(summary.tripCount).toBe(2);
    expect(summary.byStore[0].storeId).toBe('store-costco');
    expect(summary.byStore[0].totalSpent).toBe(84.5);
  });

  it('finds multi-store price comparisons sorted by savings delta', () => {
    const milk = makeItem({
      id: 'item-milk',
      name: '2% Milk',
      priceHistory: [
        { price: 5.49, storeId: 'store-costco', date: '2026-11-10T00:00:00.000Z' },
        { price: 6.49, storeId: 'store-superstore', date: '2026-11-20T00:00:00.000Z' },
      ],
    });
    const singleStoreItem = makeItem({
      id: 'item-rice',
      name: 'Basmati Rice',
      priceHistory: [
        { price: 18.99, storeId: 'store-costco', date: '2026-11-12T00:00:00.000Z' },
      ],
    });

    const cmps = computeMultiStorePriceComparisons([milk, singleStoreItem], STORES);
    expect(cmps).toHaveLength(1);
    expect(cmps[0].cheapestStoreId).toBe('store-costco');
    expect(cmps[0].savingsDelta).toBe(1.0);
  });
});
