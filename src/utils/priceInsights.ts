import { InventoryItem, PriceRecord, ShoppingItem, Store, TripReceipt } from '../types/kitchen';

const MAX_PRICE_HISTORY_PER_ITEM = 12;

export function formatCurrency(amount: number, approximate = false): string {
  const safe = Number.isFinite(amount) ? Math.max(0, amount) : 0;
  const formatted = `$${safe.toFixed(2)}`;
  return approximate ? `~${formatted}` : formatted;
}

/**
 * Appends a new price record and caps history at the last 12 entries (newest last).
 */
export function appendPriceRecord(
  existing: PriceRecord[] | undefined,
  next: PriceRecord
): PriceRecord[] {
  const cleanPrice = Number(next.price.toFixed(2));
  if (!Number.isFinite(cleanPrice) || cleanPrice <= 0) {
    return existing ? [...existing] : [];
  }
  const normalized: PriceRecord = {
    ...next,
    price: cleanPrice,
  };
  return [...(existing || []), normalized].slice(-MAX_PRICE_HISTORY_PER_ITEM);
}

/**
 * Finds the best known price for an inventory item at a target store:
 * prefers the most recent price recorded at `preferredStoreId`, falling back to `item.lastPrice`.
 */
export function getBestKnownPriceForStore(
  item: InventoryItem | undefined,
  preferredStoreId?: string
): number | undefined {
  if (!item) return undefined;
  if (preferredStoreId && item.priceHistory && item.priceHistory.length > 0) {
    for (let i = item.priceHistory.length - 1; i >= 0; i--) {
      const rec = item.priceHistory[i];
      if (rec.storeId === preferredStoreId && rec.price > 0) {
        return rec.price;
      }
    }
  }
  if (typeof item.lastPrice === 'number' && Number.isFinite(item.lastPrice) && item.lastPrice > 0) {
    return item.lastPrice;
  }
  return undefined;
}

export interface ShoppingCostEstimate {
  totalEstimated: number;
  pricedCount: number;
  totalCount: number;
}

export function estimateShoppingListCost(
  shoppingItems: ShoppingItem[],
  itemMap: Map<string, InventoryItem>
): ShoppingCostEstimate {
  let totalEstimated = 0;
  let pricedCount = 0;

  for (const s of shoppingItems) {
    if (!s.inventoryItemId) continue;
    const inv = itemMap.get(s.inventoryItemId);
    const price = getBestKnownPriceForStore(inv, s.storeId);
    if (price !== undefined) {
      totalEstimated += price;
      pricedCount += 1;
    }
  }

  return {
    totalEstimated: Number(totalEstimated.toFixed(2)),
    pricedCount,
    totalCount: shoppingItems.length,
  };
}

export interface StoreSpendEntry {
  storeId: string;
  storeName: string;
  storeColor: string;
  totalSpent: number;
  tripCount: number;
}

export interface SpendWindowSummary {
  windowDays: number;
  totalSpent: number;
  tripCount: number;
  byStore: StoreSpendEntry[];
  recentReceipts: TripReceipt[];
}

export function computeStoreSpendSummary(
  receipts: TripReceipt[] | undefined,
  stores: Store[],
  windowDays = 30,
  nowMs = Date.now()
): SpendWindowSummary {
  const list = receipts || [];
  const cutoffMs = nowMs - windowDays * 24 * 60 * 60 * 1000;
  const storeMap = new Map(stores.map((s) => [s.id, s]));

  const inWindow = list.filter((r) => {
    const ms = Date.parse(r.date);
    return Number.isFinite(ms) && ms >= cutoffMs;
  });

  const totals = new Map<string, { total: number; trips: number }>();
  let totalSpent = 0;

  for (const r of inWindow) {
    totalSpent += r.totalSpent;
    const cur = totals.get(r.storeId) || { total: 0, trips: 0 };
    cur.total += r.totalSpent;
    cur.trips += 1;
    totals.set(r.storeId, cur);
  }

  const byStore: StoreSpendEntry[] = Array.from(totals.entries())
    .map(([storeId, data]) => {
      const st = storeMap.get(storeId);
      return {
        storeId,
        storeName: st?.name ?? 'Other Store',
        storeColor: st?.color ?? '#78716c',
        totalSpent: Number(data.total.toFixed(2)),
        tripCount: data.trips,
      };
    })
    .sort((a, b) => b.totalSpent - a.totalSpent);

  const recentReceipts = [...list]
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .slice(0, 6);

  return {
    windowDays,
    totalSpent: Number(totalSpent.toFixed(2)),
    tripCount: inWindow.length,
    byStore,
    recentReceipts,
  };
}

export interface MultiStorePriceComparison {
  itemId: string;
  itemName: string;
  itemAlias?: string;
  storePrices: {
    storeId: string;
    storeName: string;
    storeColor: string;
    price: number;
    date: string;
  }[];
  cheapestStoreId: string;
  savingsDelta: number;
}

/**
 * Finds items with recorded prices at 2 or more distinct stores so the household
 * can quietly compare where staples cost less.
 */
export function computeMultiStorePriceComparisons(
  items: InventoryItem[],
  stores: Store[]
): MultiStorePriceComparison[] {
  const storeMap = new Map(stores.map((s) => [s.id, s]));
  const comparisons: MultiStorePriceComparison[] = [];

  for (const item of items) {
    const history = item.priceHistory;
    if (!history || history.length < 2) continue;

    // Keep latest price per store
    const latestByStore = new Map<string, PriceRecord>();
    for (const rec of history) {
      if (rec.price <= 0) continue;
      const existing = latestByStore.get(rec.storeId);
      if (!existing || Date.parse(rec.date) >= Date.parse(existing.date)) {
        latestByStore.set(rec.storeId, rec);
      }
    }

    if (latestByStore.size < 2) continue;

    const storePrices = Array.from(latestByStore.values())
      .map((rec) => {
        const st = storeMap.get(rec.storeId);
        return {
          storeId: rec.storeId,
          storeName: st?.name ?? 'Store',
          storeColor: st?.color ?? '#78716c',
          price: rec.price,
          date: rec.date,
        };
      })
      .sort((a, b) => a.price - b.price);

    const minPrice = storePrices[0].price;
    const maxPrice = storePrices[storePrices.length - 1].price;
    const savingsDelta = Number((maxPrice - minPrice).toFixed(2));

    comparisons.push({
      itemId: item.id,
      itemName: item.name,
      itemAlias: item.alias,
      storePrices,
      cheapestStoreId: storePrices[0].storeId,
      savingsDelta,
    });
  }

  return comparisons.sort((a, b) => b.savingsDelta - a.savingsDelta);
}
