import { InventoryItem, ShoppingItem, Store, UsageEvent } from '../types/kitchen';
import { computeItemForecast, formatShoppingDayName } from './forecasting';

export interface TodaysPlateSummary {
  calories: number;
  protein: number;
  sugar: number;
  fiber: number;
  loggedCount: number;
}

function isSameLocalCalendarDay(tsIso: string, nowMs: number): boolean {
  const d = new Date(tsIso);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date(nowMs);
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

/**
 * Computes today's estimated protein, sugar, fiber, and calories from logged consumption events.
 * Skips 100-scale level-only continuous items (like spice jars) so percentage drags don't inflate macros.
 */
export function computeTodaysPlate(
  events: UsageEvent[],
  items: InventoryItem[],
  nowMs = Date.now()
): TodaysPlateSummary {
  const itemMap = new Map(items.map((i) => [i.id, i]));
  let calories = 0;
  let protein = 0;
  let sugar = 0;
  let fiber = 0;
  let loggedCount = 0;

  for (const ev of events) {
    if (ev.deltaPortions >= 0) continue;
    if (ev.type !== 'use_portion' && ev.type !== 'finished') continue;
    if (!isSameLocalCalendarDay(ev.timestamp, nowMs)) continue;

    const item = itemMap.get(ev.itemId);
    if (!item) continue;

    // Avoid multiplying nutrition by raw percentage points on level-only 100-scale containers
    const isPercentScale = item.trackingMode === 'continuous' && item.totalPortions === 100;
    const servingsUsed = isPercentScale
      ? Math.max(0.25, Math.min(3, Math.abs(ev.deltaPortions) / 20))
      : Math.min(12, Math.abs(ev.deltaPortions));

    const perProtein = item.nutrition?.protein ?? item.proteinPerPortion ?? 0;
    const perCalories = item.nutrition?.calories ?? 0;
    const perSugar = item.nutrition?.sugar ?? 0;
    const perFiber = item.nutrition?.fiber ?? 0;

    if (perProtein > 0 || perCalories > 0 || perSugar > 0 || perFiber > 0) {
      protein += perProtein * servingsUsed;
      calories += perCalories * servingsUsed;
      sugar += perSugar * servingsUsed;
      fiber += perFiber * servingsUsed;
      loggedCount += 1;
    }
  }

  return {
    calories: Math.round(calories),
    protein: Math.round(protein),
    sugar: Math.round(sugar),
    fiber: Math.round(fiber),
    loggedCount,
  };
}

export interface ActivityFeedRow {
  id: string;
  actor: string;
  itemName: string;
  itemAlias?: string;
  actionText: string;
  tone: 'teal' | 'amber' | 'emerald' | 'stone';
  timestamp: string;
  relativeTime: string;
}

export interface HouseholdActivitySummary {
  recentRows: ActivityFeedRow[];
  rescuedBeforeExpiryCount: number;
  restocksCount: number;
  usesCount: number;
  topUsedItems: { itemId: string; name: string; count: number }[];
}

export function formatRelativeTime(tsIso: string, nowMs = Date.now()): string {
  const ms = Date.parse(tsIso);
  if (!Number.isFinite(ms)) return '';
  const diffSec = Math.max(0, Math.round((nowMs - ms) / 1000));
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return 'yesterday';
  if (diffDay < 14) return `${diffDay}d ago`;
  return new Date(ms).toLocaleDateString();
}

export function computeHouseholdActivitySummary(
  events: UsageEvent[],
  items: InventoryItem[],
  stores: Store[],
  windowDays = 30,
  nowMs = Date.now()
): HouseholdActivitySummary {
  const itemMap = new Map(items.map((i) => [i.id, i]));
  const storeMap = new Map(stores.map((s) => [s.id, s]));
  const cutoffMs = nowMs - windowDays * 24 * 60 * 60 * 1000;

  const rescuedItemIds = new Set<string>();
  const usageCounts = new Map<string, number>();
  let restocksCount = 0;
  let usesCount = 0;

  for (const ev of events) {
    const ms = Date.parse(ev.timestamp);
    if (!Number.isFinite(ms) || ms < cutoffMs) continue;

    if (ev.type === 'restock') {
      restocksCount += 1;
    } else if (ev.type === 'use_portion' || ev.type === 'finished') {
      usesCount += 1;
      usageCounts.set(ev.itemId, (usageCounts.get(ev.itemId) || 0) + 1);
      const item = itemMap.get(ev.itemId);
      if (item?.expiresAt) {
        const expMs = Date.parse(item.expiresAt);
        if (Number.isFinite(expMs) && ms <= expMs) {
          rescuedItemIds.add(item.id);
        }
      }
    }
  }

  const topUsedItems = Array.from(usageCounts.entries())
    .map(([itemId, count]) => ({
      itemId,
      name: itemMap.get(itemId)?.name ?? 'Removed item',
      count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const recentRows: ActivityFeedRow[] = events.slice(0, 25).map((ev) => {
    const item = itemMap.get(ev.itemId);
    const store = ev.storeId ? storeMap.get(ev.storeId) : undefined;
    const absDelta = Math.abs(Number(ev.deltaPortions.toFixed(2)));
    const isPercentScale = item?.trackingMode === 'continuous' && item.totalPortions === 100;

    let actionText = 'updated';
    let tone: ActivityFeedRow['tone'] = 'stone';

    if (ev.type === 'restock') {
      actionText = store ? `restocked from ${store.name}` : 'restocked';
      tone = 'emerald';
    } else if (ev.type === 'finished') {
      actionText = 'marked finished';
      tone = 'amber';
    } else if (ev.type === 'level_adjust') {
      actionText = 'adjusted level';
      tone = 'stone';
    } else {
      actionText = isPercentScale
        ? `used ~${Math.round(absDelta)}%`
        : `used ${absDelta}${item?.portionLabel ? ` × ${item.portionLabel}` : ''}`;
      tone = 'teal';
    }

    return {
      id: ev.id,
      actor: ev.actor || 'Household',
      itemName: item?.name ?? 'Kitchen item',
      itemAlias: item?.alias,
      actionText,
      tone,
      timestamp: ev.timestamp,
      relativeTime: formatRelativeTime(ev.timestamp, nowMs),
    };
  });

  return {
    recentRows,
    rescuedBeforeExpiryCount: rescuedItemIds.size,
    restocksCount,
    usesCount,
    topUsedItems,
  };
}

export type QuietContextualAlert =
  | {
      type: 'expiring';
      key: string;
      itemIds: string[];
      headline: string;
      subtext: string;
    }
  | {
      type: 'shopping_day';
      key: string;
      headline: string;
      subtext: string;
    };

/**
 * Produces a single calm, genuinely actionable alert ONLY when needed:
 * 1) Stocked item(s) expiring within 48 hours -> offers 1-tap "Cook with it"
 * 2) Day before or day of Shopping Day with essential items waiting -> offers 1-tap "Open List"
 * Returns `null` when everything is calm.
 */
export function buildQuietContextualAlert(params: {
  items: InventoryItem[];
  shoppingList: ShoppingItem[];
  stores: Store[];
  shoppingDay: number;
  nowMs?: number;
}): QuietContextualAlert | null {
  const { items, shoppingList, stores, shoppingDay, nowMs = Date.now() } = params;
  const now = new Date(nowMs);
  const dateStamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;

  // Priority 1: Expiring within 48 hours
  const urgentExpiring = items
    .filter((item) => item.remainingPortions > 0 && item.expiresAt)
    .map((item) => ({ item, fc: computeItemForecast(item, shoppingDay) }))
    .filter(({ fc }) => fc.daysUntilExpiry !== null && fc.daysUntilExpiry <= 2)
    .sort((a, b) => (a.fc.daysUntilExpiry ?? 99) - (b.fc.daysUntilExpiry ?? 99));

  if (urgentExpiring.length > 0) {
    const names = urgentExpiring.slice(0, 3).map((x) => x.item.name);
    const extra = urgentExpiring.length > 3 ? ` +${urgentExpiring.length - 3} more` : '';
    const minDays = urgentExpiring[0].fc.daysUntilExpiry ?? 0;
    const timing =
      minDays <= 0 ? 'expires today' : minDays === 1 ? 'expires tomorrow' : 'expires in 2 days';

    return {
      type: 'expiring',
      key: `expiring-${dateStamp}`,
      itemIds: urgentExpiring.map((x) => x.item.id),
      headline:
        urgentExpiring.length === 1
          ? `${names[0]} ${timing}`
          : `${urgentExpiring.length} items need using soon (${names.join(', ')}${extra})`,
      subtext: 'Tap “Cook with it” to get quick meal ideas using what’s expiring first.',
    };
  }

  // Priority 2: Shopping day or eve of shopping day when essential items are waiting
  const todayDow = now.getDay();
  const daysUntilShop = (shoppingDay - todayDow + 7) % 7;
  if (daysUntilShop <= 1) {
    const pendingEssentials = shoppingList.filter((s) => !s.checked && s.priority === 'essential');
    if (pendingEssentials.length > 0) {
      const storeMap = new Map(stores.map((s) => [s.id, s]));
      const counts = new Map<string, number>();
      for (const s of pendingEssentials) {
        counts.set(s.storeId, (counts.get(s.storeId) || 0) + 1);
      }
      const storeParts = Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([sid, cnt]) => `${storeMap.get(sid)?.name ?? 'Store'} (${cnt})`);
      const dayLabel = daysUntilShop === 0 ? 'Today' : formatShoppingDayName(shoppingDay);

      return {
        type: 'shopping_day',
        key: `shop-${dateStamp}`,
        headline: `${dayLabel} grocery run: ${storeParts.join(', ')}`,
        subtext: `${pendingEssentials.length} essential item(s) ready on your Shopping List.`,
      };
    }
  }

  return null;
}
