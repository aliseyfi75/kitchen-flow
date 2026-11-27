import { describe, expect, it } from 'vitest';
import { InventoryItem, ShoppingItem, Store, UsageEvent } from '../../types/kitchen';
import {
  buildQuietContextualAlert,
  computeHouseholdActivitySummary,
  computeTodaysPlate,
} from '../personalInsights';

const STORES: Store[] = [
  { id: 'store-costco', name: 'Costco', color: '#DC2626' },
  { id: 'store-superstore', name: 'Superstore', color: '#0F766E' },
];

const makeItem = (overrides: Partial<InventoryItem>): InventoryItem => ({
  id: 'item-eggs',
  name: 'Eggs',
  alias: 'تخم‌مرغ',
  zone: 'fridge',
  category: 'protein',
  trackingMode: 'portioned',
  totalPortions: 12,
  remainingPortions: 8,
  portionLabel: 'egg',
  packDescription: '12 eggs',
  proteinPerPortion: 6,
  nutrition: {
    calories: 70,
    protein: 6,
    sugar: 0,
    fiber: 0,
    carbs: 1,
    fat: 5,
    micronutrients: {},
  },
  defaultStoreId: 'store-costco',
  storePurchaseCounts: { 'store-costco': 1 },
  avgDaysPerFullPack: 7,
  cycleCount: 1,
  lastRestockedAt: '2026-11-20T00:00:00.000Z',
  autoAddOnEmpty: true,
  ...overrides,
});

describe('personalInsights', () => {
  it('computes Today’s Plate accurately from today’s events and ignores older days', () => {
    const now = new Date(2026, 10, 27, 14, 0, 0); // Nov 27, 2026 local
    const todayIso = new Date(2026, 10, 27, 9, 30, 0).toISOString();
    const yesterdayIso = new Date(2026, 10, 26, 18, 0, 0).toISOString();

    const eggs = makeItem({});
    const yogurt = makeItem({
      id: 'item-yogurt',
      name: 'Greek Yogurt',
      proteinPerPortion: 17,
      nutrition: {
        calories: 130,
        protein: 17,
        sugar: 5,
        fiber: 0,
        carbs: 6,
        fat: 4,
        micronutrients: {},
      },
    });

    const events: UsageEvent[] = [
      { id: 'e1', itemId: 'item-eggs', type: 'use_portion', deltaPortions: -3, timestamp: todayIso, actor: 'Ali' },
      { id: 'e2', itemId: 'item-yogurt', type: 'use_portion', deltaPortions: -1, timestamp: todayIso, actor: 'Ali' },
      { id: 'e3', itemId: 'item-eggs', type: 'use_portion', deltaPortions: -4, timestamp: yesterdayIso, actor: 'Ali' },
      { id: 'e4', itemId: 'item-eggs', type: 'restock', deltaPortions: 12, timestamp: todayIso, actor: 'Ali' },
    ];

    const plate = computeTodaysPlate(events, [eggs, yogurt], now.getTime());
    expect(plate.loggedCount).toBe(2);
    expect(plate.protein).toBe(35); // 3*6 + 17
    expect(plate.calories).toBe(340); // 3*70 + 130
    expect(plate.sugar).toBe(5);
  });

  it('summarizes household activity and counts items used before expiry', () => {
    const nowMs = Date.parse('2026-11-27T12:00:00.000Z');
    const spinach = makeItem({
      id: 'item-spinach',
      name: 'Baby Spinach',
      expiresAt: '2026-11-29T12:00:00.000Z',
    });

    const events: UsageEvent[] = [
      {
        id: 'e1',
        itemId: 'item-spinach',
        type: 'finished',
        deltaPortions: -2,
        timestamp: '2026-11-26T18:00:00.000Z',
        actor: 'Partner',
      },
      {
        id: 'e2',
        itemId: 'item-spinach',
        type: 'restock',
        deltaPortions: 4,
        storeId: 'store-superstore',
        timestamp: '2026-11-22T18:00:00.000Z',
        actor: 'Ali',
      },
    ];

    const summary = computeHouseholdActivitySummary(events, [spinach], STORES, 30, nowMs);
    expect(summary.rescuedBeforeExpiryCount).toBe(1);
    expect(summary.usesCount).toBe(1);
    expect(summary.restocksCount).toBe(1);
    expect(summary.recentRows[0].actor).toBe('Partner');
    expect(summary.recentRows[1].actionText).toContain('Superstore');
  });

  it('builds a quiet expiring alert when an item expires within 48 hours', () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const salmon = makeItem({
      id: 'item-salmon',
      name: 'Salmon Fillets',
      remainingPortions: 2,
      expiresAt: tomorrow,
    });

    const alert = buildQuietContextualAlert({
      items: [salmon],
      shoppingList: [],
      stores: STORES,
      shoppingDay: 6,
    });

    expect(alert?.type).toBe('expiring');
    if (alert?.type === 'expiring') {
      expect(alert.itemIds).toEqual(['item-salmon']);
      expect(alert.headline).toContain('Salmon Fillets');
    }
  });

  it('builds a shopping-day brief on shopping day/eve when essential items wait, and returns null otherwise', () => {
    // Nov 27, 2026 is a Friday (getDay() === 5); shoppingDay = 6 (Saturday -> daysUntilShop = 1)
    const fridayMs = new Date(2026, 10, 27, 15, 0, 0).getTime();
    const essentialMilk: ShoppingItem = {
      id: 's1',
      name: '2% Milk',
      storeId: 'store-costco',
      quantityLabel: '4L jug',
      targetPortions: 16,
      targetZone: 'fridge',
      priority: 'essential',
      reason: 'finished',
      checked: false,
      addedAt: '2026-11-26T12:00:00.000Z',
    };

    const shopAlert = buildQuietContextualAlert({
      items: [makeItem({ expiresAt: undefined })],
      shoppingList: [essentialMilk],
      stores: STORES,
      shoppingDay: 6,
      nowMs: fridayMs,
    });

    expect(shopAlert?.type).toBe('shopping_day');
    expect(shopAlert?.headline).toContain('Costco (1)');

    // When shopping day is far away (e.g. Wednesday = 3) and nothing expires soon, returns null (calm!)
    const calmAlert = buildQuietContextualAlert({
      items: [makeItem({ expiresAt: undefined })],
      shoppingList: [essentialMilk],
      stores: STORES,
      shoppingDay: 3,
      nowMs: fridayMs,
    });

    expect(calmAlert).toBeNull();
  });
});
