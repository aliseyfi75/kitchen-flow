import { ForecastVerdict, InventoryItem, ItemForecast } from '../types/kitchen';

const DAY_MS = 1000 * 60 * 60 * 24;
const SHORT_DAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Returns how many days remain until the upcoming shopping day (e.g. Saturday = 6).
 * If today IS the shopping day, returns 0.
 */
export function getDaysUntilNextShopping(shoppingDay: number, now = new Date()): number {
  const today = now.getDay();
  return (shoppingDay - today + 7) % 7;
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
 * Computes live consumption forecast, freshness status, and weekend / mid-week run-out verdict.
 */
export function computeItemForecast(
  item: InventoryItem,
  shoppingDay: number,
  now = new Date()
): ItemForecast {
  const safeTotal = Math.max(item.totalPortions, 0.1);
  const stockPercent = Math.max(
    0,
    Math.min(100, Math.round((item.remainingPortions / safeTotal) * 100))
  );

  const avgDays = Math.max(item.avgDaysPerFullPack, 1);
  const dailyBurnRate = safeTotal / avgDays;
  const estimatedDaysLeft =
    item.remainingPortions <= 0
      ? 0
      : Number((item.remainingPortions / Math.max(dailyBurnRate, 0.05)).toFixed(1));

  const daysUntilNextShopping = getDaysUntilNextShopping(shoppingDay, now);
  const daysUntilFollowingShopping = daysUntilNextShopping + 7;

  const runOutDate = new Date(now.getTime() + Math.round(estimatedDaysLeft) * DAY_MS);
  const runOutDayLabel = SHORT_DAYS_EN[runOutDate.getDay()];

  let verdict: ForecastVerdict;
  let forecastDescription: string;

  if (item.remainingPortions <= 0) {
    verdict = 'out';
    forecastDescription = 'Out of stock right now';
  } else if (estimatedDaysLeft <= Math.max(daysUntilNextShopping + 0.5, 1.5)) {
    verdict = 'buy_this_weekend';
    forecastDescription = `Runs out by this weekend (~${estimatedDaysLeft}d left, ~${runOutDayLabel})`;
  } else if (estimatedDaysLeft <= daysUntilFollowingShopping) {
    // Will survive past THIS weekend's trip, but projected to finish mid-week NEXT week!
    verdict = 'runs_out_next_week';
    forecastDescription = `Will last past this weekend, but projected to run out mid-week next week (~${runOutDayLabel}, ~${estimatedDaysLeft}d left)`;
  } else if (estimatedDaysLeft <= daysUntilFollowingShopping + 2) {
    verdict = 'borderline';
    forecastDescription = `Borderline for following weekend (~${estimatedDaysLeft}d left)`;
  } else {
    verdict = 'good_until_next_week';
    forecastDescription = `Enough until next week (~${estimatedDaysLeft}d left)`;
  }

  let stockState: 'good' | 'low' | 'critical' = 'good';
  if (item.remainingPortions <= 0 || stockPercent <= 15) {
    stockState = 'critical';
  } else if (
    stockPercent <= 38 ||
    verdict === 'buy_this_weekend' ||
    verdict === 'runs_out_next_week'
  ) {
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
    runOutDayLabel,
    forecastDescription,
    daysUntilExpiry,
    expiringSoon,
    learnedStoreId: getLearnedStoreId(item),
    dailyBurnRate: Number(dailyBurnRate.toFixed(2)),
  };
}

/**
 * Exponential Moving Average (EMA) update when an item finishes a cycle.
 */
export function updateEmaCycleDays(
  previousAvgDays: number,
  lastRestockedAt: string,
  cycleCount: number,
  now = new Date()
): { avgDaysPerFullPack: number; cycleCount: number } {
  const restockMs = new Date(lastRestockedAt).getTime();
  const elapsedDays = (now.getTime() - restockMs) / DAY_MS;

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
