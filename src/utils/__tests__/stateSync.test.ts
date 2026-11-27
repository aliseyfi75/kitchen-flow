import { describe, expect, it } from 'vitest';
import { mergeKitchenStates, recordTombstones } from '../stateSync';
import { createCleanState } from '../../data/seedData';
import { InventoryItem, KitchenState } from '../../types/kitchen';

function makeItem(id: string, name: string, remaining: number, updatedAt: string): InventoryItem {
  return {
    id,
    name,
    alias: '',
    category: 'dairy',
    zone: 'fridge',
    trackingMode: 'portioned',
    totalPortions: 10,
    remainingPortions: remaining,
    portionLabel: 'egg',
    packDescription: '10 eggs',
    proteinPerPortion: 6,
    defaultStoreId: 'store-costco',
    storePurchaseCounts: { 'store-costco': 1 },
    avgDaysPerFullPack: 7,
    cycleCount: 1,
    lastRestockedAt: '2026-11-20T00:00:00.000Z',
    autoAddOnEmpty: true,
    updatedAt,
  };
}

describe('stateSync.mergeKitchenStates', () => {
  it('preserves concurrent non-conflicting edits from both partners', () => {
    const base = createCleanState();
    const local: KitchenState = {
      ...base,
      items: [
        makeItem('item-milk', 'Milk', 2, '2026-11-27T10:05:00.000Z'), // Partner A edited Milk
        makeItem('item-eggs', 'Eggs', 10, '2026-11-27T09:00:00.000Z'),
      ],
    };
    const remote: KitchenState = {
      ...base,
      items: [
        makeItem('item-milk', 'Milk', 8, '2026-11-27T09:00:00.000Z'),
        makeItem('item-eggs', 'Eggs', 6, '2026-11-27T10:06:00.000Z'), // Partner B edited Eggs
      ],
    };

    const merged = mergeKitchenStates(local, remote);
    const milk = merged.items.find((i) => i.id === 'item-milk');
    const eggs = merged.items.find((i) => i.id === 'item-eggs');
    expect(milk?.remainingPortions).toBe(2);
    expect(eggs?.remainingPortions).toBe(6);
  });

  it('respects deletion tombstones when deletion is newer than last update', () => {
    const base = createCleanState();
    const local: KitchenState = {
      ...base,
      items: [],
      syncMeta: recordTombstones({}, ['item-old'], '2026-11-27T11:00:00.000Z'),
    };
    const remote: KitchenState = {
      ...base,
      items: [makeItem('item-old', 'Old Yogurt', 1, '2026-11-27T10:00:00.000Z')],
    };

    const merged = mergeKitchenStates(local, remote);
    expect(merged.items.find((i) => i.id === 'item-old')).toBeUndefined();
  });

  it('deduplicates and sorts usage events newest-first', () => {
    const base = createCleanState();
    const local: KitchenState = {
      ...base,
      events: [
        { id: 'e1', itemId: 'i1', type: 'use_portion', deltaPortions: -1, timestamp: '2026-11-27T10:00:00.000Z', actor: 'Ali' },
        { id: 'e2', itemId: 'i1', type: 'use_portion', deltaPortions: -1, timestamp: '2026-11-27T12:00:00.000Z', actor: 'Ali' },
      ],
    };
    const remote: KitchenState = {
      ...base,
      events: [
        { id: 'e1', itemId: 'i1', type: 'use_portion', deltaPortions: -1, timestamp: '2026-11-27T10:00:00.000Z', actor: 'Ali' },
        { id: 'e3', itemId: 'i2', type: 'restock', deltaPortions: 8, timestamp: '2026-11-27T11:00:00.000Z', actor: 'Partner' },
      ],
    };

    const merged = mergeKitchenStates(local, remote);
    expect(merged.events.map((e) => e.id)).toEqual(['e2', 'e3', 'e1']);
  });
});
