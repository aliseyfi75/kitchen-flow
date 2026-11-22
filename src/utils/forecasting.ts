import { ForecastVerdict, InventoryItem, ItemForecast } from '../types/kitchen';

const DAY_MS = 1000 * 60 * 60 * 24;

/**
 * Returns how many days remain until the upcoming shopping day (e.g. Saturday = 6).
 * If today IS the shopping day, returns 0.
 */
export function getDaysUntilNextShopping(shoppingDay: number, now = new Date()): number {
  const today = now.getDay();
  const diff = (shoppingDay - today + 7) % 7;
  return diff;
}

/**
 * Determines the most frequently used store for an item based on historical purchase counts.
 */
export function getLearnedStoreId(item: InventoryItem): string {
  let bestStoreId = item.defaultStoreId;
  let bestCount = -1;
  for (const [storeId, count] of Object.entries(item.storePurchaseCounts || {})) {
    if (count > bestCount) {
      bestCount = count;
      bestStoreId = storeId;
    }
  }
  return bestStoreId;
}

/**
 * Computes live consumption forecast, freshness status, and weekend buy verdict.
 */
export function computeItemForecast(
  item: InventoryItem,
  shoppingDay: number,
  now = new Date()
): ItemForecast {
  const safeTotal = Math.max(item.totalPortions, 0.1);
  const stockPercent = Math.max(0, Math.min(100, Math.round((item.remainingPortions / safeTotal) * 100)));

  const avgDays = Math.max(item.avgDaysPerFullPack, 1);
  const dailyBurnRate = safeTotal / avgDays; // portions per day
  const estimatedDaysLeft =
    item.remainingPortions <= 0
      ? 0
      : Number((item.remainingPortions / Math.max(dailyBurnRate, 0.05)).toFixed(1));

  const daysUntilNextShopping = getDaysUntilNextShopping(shoppingDay, now);
  // Following shopping trip is 7 days after the upcoming weekend trip
  const daysUntilFollowingShopping = daysUntilNextShopping + 7;

  let verdict: ForecastVerdict;
  if (item.remainingPortions <= 0) {
    verdict = 'out';
  } else if (estimatedDaysLeft <= daysUntilFollowingShopping - 1.5) {
    // Will run out before next week's shopping trip -> buy this weekend!
    verdict = 'buy_this_weekend';
  } else if (estimatedDaysLeft <= daysUntilFollowingShopping + 2) {
    // Tight buffer around next weekend -> borderline
    verdict = 'borderline';
  } else {
    verdict = 'good_until_next_week';
  }

  let stockState: 'good' | 'low' | 'critical' = 'good';
  if (item.remainingPortions <= 0 || stockPercent <= 15) {
    stockState = 'critical';
  } else if (stockPercent <= 38 || verdict === 'buy_this_weekend') {
    stockState = 'low';
  }

  let daysUntilExpiry: number | null = null;
  let expiringSoon = false;
  if (item.expiresAt && item.remainingPortions > 0) {
    const expMs = new Date(item.expiresAt).getTime();
    daysUntilExpiry = Math.ceil((expMs - now.getTime()) / DAY_MS);
    expiringSoon = daysUntilExpiry <= 3;
  }

  return {
    stockPercent,
    stockState,
    estimatedDaysLeft,
    daysUntilNextShopping,
    daysUntilFollowingShopping,
    verdict,
    daysUntilExpiry,
    expiringSoon,
    learnedStoreId: getLearnedStoreId(item),
    dailyBurnRate: Number(dailyBurnRate.toFixed(2)),
  };
}

/**
 * Exponential Moving Average (EMA) update when an item finishes a cycle.
 * Blends the observed days-to-finish with prior learned avgDaysPerFullPack.
 */
export function updateEmaCycleDays(
  previousAvgDays: number,
  lastRestockedAt: string,
  cycleCount: number,
  now = new Date()
): { avgDaysPerFullPack: number; cycleCount: number } {
  const restockMs = new Date(lastRestockedAt).getTime();
  const elapsedDays = (now.getTime() - restockMs) / DAY_MS;

  // Ignore unrealistic cycles (< 0.5 days or > 120 days) so accidental taps don't corrupt learning
  if (!Number.isFinite(elapsedDays) || elapsedDays < 0.5 || elapsedDays > 120) {
    return { avgDaysPerFullPack: previousAvgDays, cycleCount };
  }

  const alpha = cycleCount === 0 ? 0.5 : 0.35;
  const blended = previousAvgDays * (1 - alpha) + elapsedDays * alpha;
  return {
    avgDaysPerFullPack: Number(Math.max(1, blended).toFixed(1)),
    cycleCount: cycleCount + 1,
  };
}

export function formatShoppingDayName(day: number, lang: 'en' | 'fa'): string {
  const enDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const faDays = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];
  return lang === 'fa' ? faDays[day % 7] : enDays[day % 7];
}
