import { describe, expect, it } from 'vitest';
import {
  computeItemForecast,
  formatShoppingDayName,
  getDaysUntilNextShopping,
  getLearnedStoreId,
  updateEmaCycleDays,
} from '../forecasting';
import { InventoryItem } from '../../types/kitchen';

function makeItem(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: 'item-1',
    name: '2% Milk',
    alias: 'شیر',
    category: 'dairy',
    zone: 'fridge',
    trackingMode: 'continuous',
    totalPortions: 16,
    remainingPortions: 8,
    portionLabel: '1 cup',
    packDescription: '4L jug',
    proteinPerPortion: 9,
    defaultStoreId: 'store-superstore',
    storePurchaseCounts: { 'store-superstore': 4, 'store-costco': 1 },
    avgDaysPerFullPack: 8,
    cycleCount: 3,
    lastRestockedAt: '2026-11-20T12:00:00.000Z',
    autoAddOnEmpty: true,
    ...overrides,
  };
}

describe('forecasting', () => {
  it('computes days until next shopping day correctly', () => {
    // Wed Nov 25, 2026 (day = 3), shoppingDay = Saturday (6) -> 3 days
    const wed = new Date(2026, 10, 25, 12, 0, 0);
    expect(getDaysUntilNextShopping(6, wed)).toBe(3);

    // Saturday -> 0 days
    const sat = new Date(2026, 10, 28, 12, 0, 0);
    expect(getDaysUntilNextShopping(6, sat)).toBe(0);
  });

  it('picks learned store from purchase counts', () => {
    const item = makeItem({
      defaultStoreId: 'store-costco',
      storePurchaseCounts: { 'store-costco': 2, 'store-persian': 6 },
    });
    expect(getLearnedStoreId(item)).toBe('store-persian');
  });

  it('classifies out, buy_this_weekend, runs_out_next_week, and good_until_next_week', () => {
    const wed = new Date(2026, 10, 25, 12, 0, 0); // 3d to Saturday, 10d to following Saturday

    expect(computeItemForecast(makeItem({ remainingPortions: 0 }), 6, wed).verdict).toBe('out');

    // 2/16 left of an 8-day pack -> 1d left -> buy_this_weekend
    expect(computeItemForecast(makeItem({ remainingPortions: 2 }), 6, wed).verdict).toBe(
      'buy_this_weekend'
    );

    // 10/16 left of an 8-day pack -> 5d left (survives Sat, finishes Mon/Tue next week) -> runs_out_next_week
    expect(computeItemForecast(makeItem({ remainingPortions: 10 }), 6, wed).verdict).toBe(
      'runs_out_next_week'
    );

    // 16/16 left of a 20-day pack -> 20d left -> good_until_next_week
    expect(
      computeItemForecast(makeItem({ remainingPortions: 16, avgDaysPerFullPack: 20 }), 6, wed)
        .verdict
    ).toBe('good_until_next_week');
  });

  it('flags soon-expiring items within 3 days', () => {
    const now = new Date('2026-11-25T12:00:00.000Z');
    const fc = computeItemForecast(
      makeItem({ expiresAt: '2026-11-27T12:00:00.000Z' }),
      6,
      now
    );
    expect(fc.expiringSoon).toBe(true);
    expect(fc.daysUntilExpiry).toBe(2);
  });

  it('updates EMA cycle days smoothly and ignores extreme outliers', () => {
    const now = new Date('2026-11-25T12:00:00.000Z');
    const res = updateEmaCycleDays(10, '2026-11-19T12:00:00.000Z', 0, now); // 6 days elapsed, alpha 0.5 -> 8.0
    expect(res.avgDaysPerFullPack).toBe(8);
    expect(res.cycleCount).toBe(1);

    // Sub-half-day finish ignored
    const tooFast = updateEmaCycleDays(10, '2026-11-25T10:00:00.000Z', 2, now);
    expect(tooFast.avgDaysPerFullPack).toBe(10);
    expect(tooFast.cycleCount).toBe(2);
  });

  it('formats shopping day names safely', () => {
    expect(formatShoppingDayName(6)).toBe('Saturday');
    expect(formatShoppingDayName(0)).toBe('Sunday');
  });
});
