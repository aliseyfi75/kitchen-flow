import { ContinuousTrackingStyle, InventoryItem, MeasureUnit } from '../types/kitchen';
import { MEASURE_UNIT_META } from './productCategories';

export const CONTINUOUS_LEVEL_PRESETS = [
  { pct: 100, shortLabel: 'Full', word: 'Full' },
  { pct: 75, shortLabel: '¾', word: 'Mostly full' },
  { pct: 50, shortLabel: '½', word: 'Half left' },
  { pct: 25, shortLabel: '¼', word: 'Running low' },
  { pct: 10, shortLabel: 'Low', word: 'Almost out' },
] as const;

export function inferContinuousStyle(item: InventoryItem): ContinuousTrackingStyle {
  if (item.continuousStyle) return item.continuousStyle;
  if (item.containerSize && item.containerSize > 0 && item.containerUnit) {
    return 'measured';
  }
  return 'level_only';
}

export function getRawStockPercent(item: InventoryItem): number {
  const safeTotal = Math.max(item.totalPortions, 0.01);
  if (item.remainingPortions <= 0) return 0;
  return Math.round((item.remainingPortions / safeTotal) * 100);
}

export function getClampedStockPercent(item: InventoryItem): number {
  return Math.max(0, Math.min(100, getRawStockPercent(item)));
}

export function getLevelWord(percent: number): string {
  if (percent <= 0) return 'Empty';
  if (percent > 100) return 'Full + extra';
  if (percent >= 90) return 'Full';
  if (percent >= 65) return 'Mostly full';
  if (percent >= 40) return 'Half left';
  if (percent >= 18) return 'Running low';
  return 'Almost out';
}

/**
 * Finds the single closest preset pill (100, 75, 50, 25, 10) for highlighting without ever
 * lighting up two buttons or losing accuracy on low-portion legacy items.
 */
export function getActiveLevelPreset(percent: number): number | null {
  if (percent <= 0) return null;
  if (percent >= 88) return 100;
  if (percent >= 63) return 75;
  if (percent >= 38) return 50;
  if (percent >= 18) return 25;
  return 10;
}

/**
 * Returns the next lower preset level when tapping "Step down" on a continuous item.
 */
export function getNextLowerLevelPercent(currentPercent: number): number {
  if (currentPercent <= 10) return 0;
  const presets = [75, 50, 25, 10, 0];
  for (const p of presets) {
    if (p < currentPercent - 4) return p;
  }
  return 0;
}

export function formatMeasureNumber(value: number): string {
  if (value === 0) return '0';
  if (value >= 100) return String(Math.round(value));
  if (value >= 10) return String(Number(value.toFixed(1)));
  return String(Number(value.toFixed(2)));
}

export function formatUnitLabel(unit: MeasureUnit): string {
  return MEASURE_UNIT_META[unit]?.label ?? unit;
}

export function formatMeasuredAmount(amount: number, unit: MeasureUnit): string {
  return `${formatMeasureNumber(amount)} ${formatUnitLabel(unit)}`;
}

/**
 * Returns remaining measured amount (e.g. "~3 L / 4 L") if the continuous item has container size & unit.
 */
export function getMeasuredRemainingDisplay(item: InventoryItem): {
  remainingText: string;
  totalText: string;
  compact: string;
} | null {
  if (item.trackingMode !== 'continuous' || !item.containerSize || !item.containerUnit) {
    return null;
  }
  const ratio = item.totalPortions > 0 ? item.remainingPortions / item.totalPortions : 0;
  const remainingAmt = Math.max(0, item.containerSize * ratio);
  const remainingText = formatMeasuredAmount(remainingAmt, item.containerUnit);
  const totalText = formatMeasuredAmount(item.containerSize, item.containerUnit);
  return {
    remainingText,
    totalText,
    compact: remainingAmt === 0 ? `0 / ${totalText}` : `~${remainingText} / ${totalText}`,
  };
}

/**
 * Whether a continuous item has a meaningful discrete serving step (e.g. Milk "1 cup (250ml)",
 * Greek Yogurt "175g bowl", Whey "1 scoop") so a quick "-1 serving" button makes sense.
 */
export function hasServingPourAction(item: InventoryItem): boolean {
  if (item.trackingMode !== 'continuous') return false;
  if (item.continuousStyle === 'level_only') return false;
  if (item.category === 'condiments' || item.category === 'spices') return false;
  if (item.totalPortions < 2 || item.totalPortions === 100) return false;
  const lbl = (item.portionLabel || '').trim().toLowerCase();
  if (!lbl || lbl === '1 portion' || lbl === 'portion' || lbl === '1% level' || lbl === 'container') {
    return false;
  }
  return true;
}

/**
 * Clean human-readable stock summary for Shopping notes, Settings table, and tooltips.
 */
export function formatItemStockSummary(item: InventoryItem): string {
  if (item.trackingMode === 'portioned') {
    return `${item.remainingPortions} / ${item.totalPortions} × ${item.portionLabel}`;
  }

  const rawPct = getRawStockPercent(item);
  const measured = getMeasuredRemainingDisplay(item);
  if (measured) {
    if (rawPct === 0) return `Empty (${measured.totalText})`;
    if (rawPct > 100) return `Full + extra (~${measured.remainingText})`;
    return `${measured.compact} (${rawPct}%)`;
  }

  const packSuffix = item.packDescription ? ` • ${item.packDescription}` : '';
  if (rawPct === 0) return `Empty${packSuffix}`;
  if (rawPct > 100) return `Full + extra (${rawPct}%)${packSuffix}`;
  return `${getLevelWord(rawPct)} (${rawPct}%)${packSuffix}`;
}

/**
 * Clean restock button text (never shows "16 portions" for a 4L milk jug).
 */
export function formatRestockLabel(item: InventoryItem): string {
  if (item.trackingMode === 'portioned') {
    return `${item.totalPortions} × ${item.portionLabel}`;
  }
  if (item.packDescription?.trim()) {
    return item.packDescription.trim();
  }
  if (item.containerSize && item.containerUnit) {
    return formatMeasuredAmount(item.containerSize, item.containerUnit);
  }
  return 'Full (100%)';
}

/**
 * Clean Shopping List quantity label for both continuous and portioned items.
 */
export function formatShoppingQuantityLabel(item: InventoryItem): string {
  if (item.trackingMode === 'continuous') {
    if (item.packDescription?.trim()) return item.packDescription.trim();
    if (item.containerSize && item.containerUnit) {
      return formatMeasuredAmount(item.containerSize, item.containerUnit);
    }
    return '1 container';
  }
  const pack = item.packDescription?.trim();
  if (pack && pack.toLowerCase() !== `${item.totalPortions} portions`) {
    return `${pack} (${item.totalPortions} × ${item.portionLabel})`;
  }
  return `${item.totalPortions} × ${item.portionLabel}`;
}
