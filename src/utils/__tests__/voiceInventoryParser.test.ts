import { describe, expect, it } from 'vitest';
import { InventoryItem, Store } from '../../types/kitchen';
import {
  computeBeforeAfterSummary,
  convertSpokenAmountToPortions,
  parseKitchenVoiceUpdateLocally,
} from '../voiceInventoryParser';

const STORES: Store[] = [
  { id: 'store-costco', name: 'Costco', alias: 'کاستکو', color: '#e11d48' },
  { id: 'store-superstore', name: 'Superstore', alias: 'سوپراستور', color: '#0f766e' },
];

const INVENTORY: InventoryItem[] = [
  {
    id: 'item-eggs',
    name: 'Eggs',
    alias: 'تخم‌مرغ',
    zone: 'fridge',
    category: 'protein',
    trackingMode: 'portioned',
    totalPortions: 12,
    remainingPortions: 10,
    portionLabel: 'egg',
    packDescription: '12 eggs',
    proteinPerPortion: 6,
    defaultStoreId: 'store-costco',
    storePurchaseCounts: { 'store-costco': 2 },
    avgDaysPerFullPack: 7,
    cycleCount: 2,
    lastRestockedAt: '2026-11-20T00:00:00.000Z',
    autoAddOnEmpty: true,
  },
  {
    id: 'item-milk',
    name: '2% Milk',
    alias: 'شیر',
    zone: 'fridge',
    category: 'dairy',
    trackingMode: 'continuous',
    continuousStyle: 'measured',
    containerSize: 4,
    containerUnit: 'L',
    totalPortions: 16,
    remainingPortions: 8,
    portionLabel: '1 cup (250ml)',
    packDescription: '4L jug',
    proteinPerPortion: 9,
    defaultStoreId: 'store-costco',
    storePurchaseCounts: { 'store-costco': 3 },
    avgDaysPerFullPack: 8,
    cycleCount: 3,
    lastRestockedAt: '2026-11-22T00:00:00.000Z',
    autoAddOnEmpty: true,
  },
  {
    id: 'item-spinach',
    name: 'Baby Spinach',
    alias: 'اسفناج',
    zone: 'fridge',
    category: 'produce',
    trackingMode: 'continuous',
    continuousStyle: 'level_only',
    totalPortions: 100,
    remainingPortions: 60,
    portionLabel: 'container',
    packDescription: '1 tub',
    proteinPerPortion: 2,
    defaultStoreId: 'store-superstore',
    storePurchaseCounts: { 'store-superstore': 1 },
    avgDaysPerFullPack: 6,
    cycleCount: 1,
    lastRestockedAt: '2026-11-23T00:00:00.000Z',
    autoAddOnEmpty: false,
  },
];

describe('voiceInventoryParser', () => {
  it('parses English multi-item used + half + finished utterance accurately', () => {
    const res = parseKitchenVoiceUpdateLocally(
      'I used 3 eggs, half the baby spinach, and the milk is finished',
      INVENTORY,
      STORES
    );

    expect(res.updates).toHaveLength(3);

    const eggsUpd = res.updates.find((u) => u.matchedItemId === 'item-eggs');
    expect(eggsUpd?.action).toBe('use');
    expect(eggsUpd?.targetRemainingPortions).toBe(7);
    expect(eggsUpd?.deltaPortions).toBe(-3);

    const spinachUpd = res.updates.find((u) => u.matchedItemId === 'item-spinach');
    expect(spinachUpd?.action).toBe('use');
    expect(spinachUpd?.targetRemainingPortions).toBe(30);

    const milkUpd = res.updates.find((u) => u.matchedItemId === 'item-milk');
    expect(milkUpd?.action).toBe('finish');
    expect(milkUpd?.targetRemainingPortions).toBe(0);
  });

  it('parses Farsi multi-item utterance with Persian numerals accurately', () => {
    const res = parseKitchenVoiceUpdateLocally(
      '۳ تا تخم‌مرغ و نصف اسفناج رو مصرف کردم، شیر هم تموم شد',
      INVENTORY,
      STORES
    );

    expect(res.updates).toHaveLength(3);

    const eggsUpd = res.updates.find((u) => u.matchedItemId === 'item-eggs');
    expect(eggsUpd?.targetRemainingPortions).toBe(7);

    const spinachUpd = res.updates.find((u) => u.matchedItemId === 'item-spinach');
    expect(spinachUpd?.targetRemainingPortions).toBe(30);

    const milkUpd = res.updates.find((u) => u.matchedItemId === 'item-milk');
    expect(milkUpd?.action).toBe('finish');
    expect(milkUpd?.targetRemainingPortions).toBe(0);
  });

  it('parses restock utterances and detects store name', () => {
    const res = parseKitchenVoiceUpdateLocally(
      'Bought 2 jugs of milk from Costco',
      INVENTORY,
      STORES
    );

    expect(res.updates).toHaveLength(1);
    const milkUpd = res.updates[0];
    expect(milkUpd.action).toBe('restock');
    expect(milkUpd.matchedItemId).toBe('item-milk');
    expect(milkUpd.storeId).toBe('store-costco');
    expect(milkUpd.targetRemainingPortions).toBe(40); // 8 existing + 2 * 16
  });

  it('converts spoken metric volume units proportionally for measured continuous items', () => {
    const milk = INVENTORY[1]; // 4L = 16 portions
    expect(convertSpokenAmountToPortions(milk, 1, 'L')).toBe(4);
    expect(convertSpokenAmountToPortions(milk, 500, 'ml')).toBe(2);
    expect(convertSpokenAmountToPortions(milk, 2, 'لیوان')).toBe(2);
  });

  it('computes accurate before -> after summary and flags auto-add to shopping on empty', () => {
    const milk = INVENTORY[1];
    const res = parseKitchenVoiceUpdateLocally('milk is finished', INVENTORY, STORES);
    const preview = computeBeforeAfterSummary(res.updates[0], milk);

    expect(preview.beforeText).toContain('2 L');
    expect(preview.afterText).toContain('Empty');
    expect(preview.willAutoAddToShopping).toBe(true);
  });
});
