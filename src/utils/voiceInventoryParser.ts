import {
  FoodCategory,
  InventoryItem,
  StorageZone,
  Store,
  TrackingMode,
} from '../types/kitchen';
import {
  formatItemStockSummary,
  getRawStockPercent,
} from './inventoryDisplay';
import {
  getCategoryProfile,
  inferProductDefaultsFromText,
  parseMeasuredQuantity,
} from './productCategories';
import {
  matchVoiceIngredientToKitchen,
  normalizeBilingualText,
} from './voiceFoodParser';

export type VoiceInventoryAction = 'use' | 'finish' | 'set_level' | 'restock' | 'add_new';

export interface ProposedInventoryUpdate {
  id: string;
  spokenText: string;
  action: VoiceInventoryAction;
  matchedItemId?: string;
  name: string;
  alias: string;
  /** Exact target remainingPortions after update (for existing matched items). */
  targetRemainingPortions: number;
  /** Target level % for continuous items (0..100+ for overstock). */
  targetPercent?: number;
  /** Delta portions (negative for use/finish, positive for restock). */
  deltaPortions: number;
  /** Store used when restocking or adding a new item. */
  storeId?: string;
  /** Human-readable explanation of what was understood. */
  reason: string;
  included: boolean;
  /** Fields for creating a brand-new item (`action === 'add_new'`). */
  suggestedCategory: FoodCategory;
  suggestedZone: StorageZone;
  suggestedTrackingMode: TrackingMode;
  suggestedPackDescription: string;
  initialTotalPortions: number;
  portionLabel: string;
}

export interface VoiceInventoryParseResult {
  transcript: string;
  updates: ProposedInventoryUpdate[];
  source: 'gemini_audio' | 'gemini_text' | 'local_fallback';
}

export interface BeforeAfterPreview {
  beforeText: string;
  afterText: string;
  deltaLabel: string;
  willAutoAddToShopping: boolean;
}

/**
 * Computes human-readable BEFORE and AFTER stock summaries for confirmation UI.
 */
export function computeBeforeAfterSummary(
  update: ProposedInventoryUpdate,
  existingItem?: InventoryItem
): BeforeAfterPreview {
  if (!existingItem || update.action === 'add_new') {
    const qtyText =
      update.suggestedTrackingMode === 'continuous'
        ? `${update.suggestedPackDescription || '1 container'} (100%)`
        : `${update.targetRemainingPortions} × ${update.portionLabel}`;
    return {
      beforeText: 'Not in kitchen',
      afterText: qtyText,
      deltaLabel: '+ New item',
      willAutoAddToShopping: false,
    };
  }

  const beforeText = formatItemStockSummary(existingItem);
  const afterItem: InventoryItem = {
    ...existingItem,
    remainingPortions: Math.max(0, Number(update.targetRemainingPortions.toFixed(2))),
  };
  const afterText = formatItemStockSummary(afterItem);
  const diff = Number((afterItem.remainingPortions - existingItem.remainingPortions).toFixed(2));

  let deltaLabel = 'No change';
  if (existingItem.trackingMode === 'continuous' && existingItem.totalPortions === 100) {
    const beforePct = getRawStockPercent(existingItem);
    const afterPct = getRawStockPercent(afterItem);
    const pctDiff = afterPct - beforePct;
    deltaLabel = pctDiff === 0 ? 'No change' : `${pctDiff > 0 ? '+' : ''}${pctDiff}%`;
  } else if (diff !== 0) {
    deltaLabel = `${diff > 0 ? '+' : ''}${diff} × ${existingItem.portionLabel}`;
  }

  const willAutoAddToShopping =
    afterItem.remainingPortions === 0 &&
    existingItem.remainingPortions > 0 &&
    existingItem.autoAddOnEmpty;

  return {
    beforeText,
    afterText,
    deltaLabel,
    willAutoAddToShopping,
  };
}

/**
 * Converts a spoken amount + optional unit (e.g. "2 cups", "500ml", "half", "250g")
 * into portions on an InventoryItem's native scale.
 */
export function convertSpokenAmountToPortions(
  item: InventoryItem,
  amount: number,
  rawUnit?: string
): number {
  const safeAmt = Math.max(0.05, amount);
  const unit = (rawUnit || '').toLowerCase().trim();

  // If item has containerSize + containerUnit, convert matching volume/weight units proportionally!
  if (item.trackingMode === 'continuous' && item.containerSize && item.containerUnit) {
    const cUnit = item.containerUnit;
    const toMl = (val: number, u: string): number | null => {
      if (u === 'ml' || u === 'milliliter' || u === 'milliliters' || u === 'میلی‌لیتر' || u === 'میلی لیتر') return val;
      if (u === 'l' || u === 'liter' || u === 'liters' || u === 'litre' || u === 'litres' || u === 'لیتر') return val * 1000;
      if (u === 'cup' || u === 'cups' || u === 'لیوان' || u === 'پیمانه' || u === 'فنجان') return val * 250;
      if (u === 'tbsp' || u === 'tablespoon' || u === 'tablespoons' || u === 'قاشق' || u === 'قاشق غذاخوری') return val * 15;
      if (u === 'tsp' || u === 'teaspoon' || u === 'teaspoons' || u === 'قاشق چایخوری') return val * 5;
      if (u === 'fl_oz' || u === 'fl oz') return val * 29.57;
      if (u === 'gal' || u === 'gallon') return val * 3785;
      return null;
    };
    const toGrams = (val: number, u: string): number | null => {
      if (u === 'g' || u === 'gram' || u === 'grams' || u === 'گرم') return val;
      if (u === 'kg' || u === 'kilogram' || u === 'kilograms' || u === 'کیلو' || u === 'کیلوگرم') return val * 1000;
      if (u === 'lb' || u === 'lbs' || u === 'pound' || u === 'pounds') return val * 453.6;
      if (u === 'oz' || u === 'ounce' || u === 'ounces') return val * 28.35;
      if (u === 'tbsp' || u === 'tablespoon' || u === 'قاشق') return val * 15;
      if (u === 'cup' || u === 'cups' || u === 'پیمانه' || u === 'لیوان') return val * 200;
      return null;
    };

    const containerMl = toMl(item.containerSize, cUnit.toLowerCase());
    const spokenMl = unit ? toMl(safeAmt, unit) : null;
    if (containerMl && spokenMl) {
      const ratio = spokenMl / containerMl;
      return Math.max(0.25, Number((ratio * item.totalPortions).toFixed(2)));
    }

    const containerG = toGrams(item.containerSize, cUnit.toLowerCase());
    const spokenG = unit ? toGrams(safeAmt, unit) : null;
    if (containerG && spokenG) {
      const ratio = spokenG / containerG;
      return Math.max(0.25, Number((ratio * item.totalPortions).toFixed(2)));
    }
  }

  // For level-only / 100-scale continuous items (like olive oil, spices, herbs),
  // prevent "2 tbsp" or "1 handful" from deducting 2% blindly vs sensible step
  if (item.trackingMode === 'continuous' && item.totalPortions === 100) {
    if (/(tbsp|tablespoon|tsp|teaspoon|قاشق|کمی|یه کم|a little|pinch|splash)/i.test(unit)) {
      return Math.min(25, Math.max(2, Math.round(safeAmt * 2)));
    }
    if (/(handful|مشت|cup|لیوان|bowl|کاسه|پیمانه)/i.test(unit)) {
      return Math.min(50, Math.max(10, Math.round(safeAmt * 15)));
    }
    if (/(container|pack|bag|bottle|jar|tub|jug|بسته|بطری|قوطی|شیشه)/i.test(unit)) {
      return Math.round(safeAmt * 100);
    }
    if (unit === '%' || unit === 'percent' || unit === 'درصد') {
      return Math.min(100, Math.max(1, Math.round(safeAmt)));
    }
    return Math.min(50, Math.max(5, Math.round(safeAmt * 15)));
  }

  // Portioned items or measured items with serving labels: use amount directly
  return Number(safeAmt.toFixed(2));
}

// ============================================================================
// Offline Bilingual (EN / Farsi) Local Parser for Kitchen Inventory Updates
// ============================================================================

const PERSIAN_NUMBER_WORDS: Record<string, number> = {
  نصف: 0.5,
  نیم: 0.5,
  یک: 1,
  یه: 1,
  دو: 2,
  دوتا: 2,
  سه: 3,
  سه‌تا: 3,
  چهار: 4,
  پنج: 5,
  شش: 6,
  هفت: 7,
  هشت: 8,
  نه: 9,
  ده: 10,
  دوازده: 12,
};

const ENGLISH_NUMBER_WORDS: Record<string, number> = {
  half: 0.5,
  quarter: 0.25,
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  dozen: 12,
};

function detectStoreFromText(text: string, stores: Store[]): Store | undefined {
  const lower = text.toLowerCase();
  return stores.find(
    (s) =>
      lower.includes(s.name.toLowerCase()) ||
      (s.alias && lower.includes(s.alias.toLowerCase()))
  );
}

function splitUtteranceIntoClauses(raw: string): string[] {
  // Preserve compound Persian phrases before splitting on "و" / "and" / commas
  const normalized = raw
    .replace(/[,،;؛\n]+/g, ' | ')
    .replace(/\band\b/gi, ' | ')
    .replace(/\bplus\b/gi, ' | ')
    .replace(/\balso\b/gi, ' | ')
    .replace(/\s+و\s+/g, ' | ');

  return normalized
    .split('|')
    .map((c) => c.trim())
    .filter((c) => c.length >= 2);
}

function detectClauseAction(
  clause: string,
  inheritedAction: VoiceInventoryAction
): { action: VoiceInventoryAction; explicitLevelPct?: number } {
  const c = normalizeBilingualText(clause);

  // Finished / empty
  if (
    /\b(finished|ran out|out of|empty|no more|used up|all gone)\b/.test(c) ||
    /(تموم شد|تمام شد|تموم شده|تمام شده|خالی شد|نداریم|دیگه نداریم|هیچی نمونده)/.test(c)
  ) {
    return { action: 'finish', explicitLevelPct: 0 };
  }

  // Bought / restocked
  if (
    /\b(bought|buy|picked up|got|restocked|refilled|added|new)\b/.test(c) ||
    /(خریدم|خریدیم|گرفتم|گرفتیم|شارژ کردم|اضافه کردم|آوردم)/.test(c)
  ) {
    return { action: 'restock' };
  }

  // Explicit remaining level ("half left", "almost out", "نصفش مونده", "کم مونده")
  if (
    /(almost out|almost empty|running low|very low|barely any|کم مونده|تهش مونده|ته‌ش مونده|خیلی کم مونده)/.test(
      c
    )
  ) {
    return { action: 'set_level', explicitLevelPct: 15 };
  }
  if (/(quarter left|a quarter left|یک چهارم مونده|یه چهارم مونده)/.test(c)) {
    return { action: 'set_level', explicitLevelPct: 25 };
  }
  if (/(half left|half full|نصفش مونده|نصف مونده|نصفه)/.test(c)) {
    return { action: 'set_level', explicitLevelPct: 50 };
  }
  if (/(mostly full|three quarters|سه چهارم مونده)/.test(c)) {
    return { action: 'set_level', explicitLevelPct: 75 };
  }
  if (/(is full|still full|پره|پر شده|کامله)/.test(c)) {
    return { action: 'set_level', explicitLevelPct: 100 };
  }

  // Used / ate / cooked
  if (
    /\b(used|use|ate|eat|drank|drink|cooked|made|had|took|poured|finished half)\b/.test(c) ||
    /(مصرف کردم|مصرف کردیم|استفاده کردم|خوردم|خوردیم|پختم|درست کردم|زدم|ریختم|برداشتم)/.test(c)
  ) {
    return { action: 'use' };
  }

  return { action: inheritedAction };
}

function extractQuantityAndUnit(clause: string): {
  amount?: number;
  unit?: string;
  isHalfOfRemaining?: boolean;
  isQuarterOfRemaining?: boolean;
} {
  const norm = normalizeBilingualText(clause);

  // Explicit percentage (e.g. "30%", "30 percent", "30 درصد")
  const pctMatch = norm.match(/(\d+(?:\.\d+)?)\s*(?:%|percent|درصد)/);
  if (pctMatch) {
    return { amount: parseFloat(pctMatch[1]), unit: '%' };
  }

  // Numeric amount + optional unit
  const numMatch = norm.match(
    /(\d+(?:\.\d+)?)\s*(ml|l|liter|liters|litre|litres|kg|g|gram|grams|lb|lbs|oz|cup|cups|tbsp|tablespoon|tablespoons|tsp|teaspoon|bag|bags|pack|packs|fillet|fillets|scoop|scoops|bottle|bottles|carton|cartons|jug|jugs|tub|tubs|can|cans|slice|slices|egg|eggs|handful|handfuls|تا|عدد|بسته|لیوان|پیمانه|فنجان|قاشق|گرم|کیلو|لیتر|میلی لیتر|مشت|کاسه|بطری)?/
  );
  if (numMatch) {
    const amt = parseFloat(numMatch[1]);
    if (Number.isFinite(amt) && amt > 0) {
      return { amount: amt, unit: numMatch[2] || undefined };
    }
  }

  // Half / Quarter phrases
  if (/(half of|half the|نصف|نیم)/.test(norm)) {
    const unitAfterHalf = norm.match(
      /(?:half(?:\s+(?:a|an|of|the))?|نصف|نیم)\s+(cup|cups|liter|litre|kg|bag|pack|لیوان|پیمانه|بسته|لیتر|کیلو)/
    );
    if (unitAfterHalf) {
      return { amount: 0.5, unit: unitAfterHalf[1] };
    }
    return { isHalfOfRemaining: true };
  }
  if (/(quarter of|a quarter|یک چهارم|یه چهارم)/.test(norm)) {
    return { isQuarterOfRemaining: true };
  }

  // Word numbers
  for (const [word, val] of Object.entries(PERSIAN_NUMBER_WORDS)) {
    if (new RegExp(`(?:^|\\s)${word}(?:\\s|$)`).test(norm)) {
      return { amount: val };
    }
  }
  for (const [word, val] of Object.entries(ENGLISH_NUMBER_WORDS)) {
    if (word === 'a' || word === 'an') continue;
    if (new RegExp(`\\b${word}\\b`).test(norm)) {
      return { amount: val };
    }
  }

  return {};
}

function cleanCandidateName(clause: string): string {
  return clause
    .replace(
      /\b(i|we|just|used|use|ate|eat|drank|cooked|made|had|finished|ran out of|out of|bought|picked up|got|restocked|refilled|added|almost out of|running low on|from|at|the|some|of|is|are|left|empty|full|half|quarter|a|an)\b/gi,
      ' '
    )
    .replace(
      /(من|ما|الان|امروز|دیروز|مصرف کردم|مصرف کردیم|استفاده کردم|خوردم|خوردیم|پختم|خریدم|خریدیم|گرفتم|شارژ کردم|اضافه کردم|تموم شد|تمام شد|تموم شده|خالی شد|کم مونده|نصفش|نصف|رو|را|هم|از|توی|تو|تا|عدد|بسته|لیوان|پیمانه|قاشق|مشت|کاسه)/g,
      ' '
    )
    .replace(/[0-9۰-۹.%]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildProposedUpdateForItem(params: {
  id: string;
  spokenText: string;
  action: VoiceInventoryAction;
  item: InventoryItem;
  amount?: number;
  unit?: string;
  explicitLevelPct?: number;
  isHalfOfRemaining?: boolean;
  isQuarterOfRemaining?: boolean;
  storeId?: string;
  reason?: string;
}): ProposedInventoryUpdate {
  const {
    id,
    spokenText,
    action,
    item,
    amount,
    unit,
    explicitLevelPct,
    isHalfOfRemaining,
    isQuarterOfRemaining,
    storeId,
    reason,
  } = params;

  let targetRemaining = item.remainingPortions;
  let targetPercent: number | undefined;
  let computedReason = reason || '';

  if (action === 'finish') {
    targetRemaining = 0;
    targetPercent = 0;
    computedReason = computedReason || 'Marked finished / empty';
  } else if (action === 'set_level') {
    if (explicitLevelPct !== undefined) {
      const pct = Math.max(0, Math.min(100, Math.round(explicitLevelPct)));
      targetPercent = pct;
      targetRemaining =
        pct === 0 ? 0 : Math.max(0.01, Number(((item.totalPortions * pct) / 100).toFixed(2)));
      computedReason = computedReason || `Set remaining level to ${pct}%`;
    } else if (amount !== undefined) {
      targetRemaining = Math.max(0, Number(amount.toFixed(2)));
      targetPercent =
        item.totalPortions > 0
          ? Math.round((targetRemaining / item.totalPortions) * 100)
          : 0;
      computedReason = computedReason || `Set remaining stock to ${targetRemaining}`;
    }
  } else if (action === 'restock') {
    let addPortions: number;
    if (item.trackingMode === 'continuous') {
      const containers = amount && amount >= 1 && amount <= 10 ? Math.round(amount) : 1;
      addPortions = containers * item.totalPortions;
      computedReason = computedReason || `Restocked +${containers} container(s)`;
    } else {
      const qty =
        amount !== undefined
          ? amount <= 2 && /(pack|bag|carton|box|بسته|شانه)/i.test(unit || spokenText)
            ? Math.round(amount) * item.totalPortions
            : amount
          : item.totalPortions;
      addPortions = Number(qty.toFixed(2));
      computedReason = computedReason || `Restocked +${addPortions} × ${item.portionLabel}`;
    }
    targetRemaining = Number((item.remainingPortions + addPortions).toFixed(2));
    if (item.trackingMode === 'continuous') {
      targetPercent = Math.round((targetRemaining / Math.max(item.totalPortions, 1)) * 100);
    }
  } else {
    // 'use'
    let deduct = 1;
    if (isHalfOfRemaining) {
      deduct =
        item.remainingPortions > 0
          ? Number((item.remainingPortions / 2).toFixed(2))
          : Number((item.totalPortions / 2).toFixed(2));
      computedReason = computedReason || 'Used half of remaining stock';
    } else if (isQuarterOfRemaining) {
      deduct =
        item.remainingPortions > 0
          ? Number((item.remainingPortions / 4).toFixed(2))
          : Number((item.totalPortions / 4).toFixed(2));
      computedReason = computedReason || 'Used a quarter of remaining stock';
    } else if (amount !== undefined) {
      deduct = convertSpokenAmountToPortions(item, amount, unit);
      computedReason =
        computedReason ||
        `Used ${amount}${unit ? ` ${unit}` : ` × ${item.portionLabel}`}`;
    } else {
      deduct = item.trackingMode === 'continuous' && item.totalPortions === 100 ? 15 : 1;
      computedReason = computedReason || `Used 1 serving`;
    }
    targetRemaining = Math.max(0, Number((item.remainingPortions - deduct).toFixed(2)));
    if (item.trackingMode === 'continuous') {
      targetPercent =
        item.totalPortions > 0
          ? Math.max(0, Math.min(100, Math.round((targetRemaining / item.totalPortions) * 100)))
          : 0;
    }
  }

  const deltaPortions = Number((targetRemaining - item.remainingPortions).toFixed(2));

  return {
    id,
    spokenText,
    action: targetRemaining === 0 && action === 'use' ? 'finish' : action,
    matchedItemId: item.id,
    name: item.name,
    alias: item.alias,
    targetRemainingPortions: targetRemaining,
    targetPercent,
    deltaPortions,
    storeId: storeId || item.defaultStoreId,
    reason: computedReason,
    included: true,
    suggestedCategory: item.category,
    suggestedZone: item.zone,
    suggestedTrackingMode: item.trackingMode,
    suggestedPackDescription: item.packDescription,
    initialTotalPortions: item.totalPortions,
    portionLabel: item.portionLabel,
  };
}

/**
 * Offline / fallback bilingual EN + Farsi kitchen update parser.
 * Understands phrases like:
 * - "I used 3 eggs, half the spinach, and finished the milk"
 * - "۳ تا تخم‌مرغ و نصف اسفناج رو مصرف کردم، شیر هم تموم شد"
 * - "Bought 2 cartons of milk and chicken breast from Costco"
 */
export function parseKitchenVoiceUpdateLocally(
  transcript: string,
  inventory: InventoryItem[],
  stores: Store[]
): VoiceInventoryParseResult {
  const defaultStore = detectStoreFromText(transcript, stores) ?? stores[0];
  const clauses = splitUtteranceIntoClauses(transcript);
  const updates: ProposedInventoryUpdate[] = [];

  let inheritedAction: VoiceInventoryAction = 'use';
  const topDetect = detectClauseAction(transcript, 'use');
  if (topDetect.action === 'restock') inheritedAction = 'restock';

  clauses.forEach((clause, idx) => {
    const clauseStore = detectStoreFromText(clause, stores) ?? defaultStore;
    const { action, explicitLevelPct } = detectClauseAction(clause, inheritedAction);
    if (action === 'restock' || action === 'use') {
      inheritedAction = action;
    }

    const qty = extractQuantityAndUnit(clause);
    const cleaned = cleanCandidateName(clause);
    const matched =
      matchVoiceIngredientToKitchen(clause, '', inventory) ??
      (cleaned ? matchVoiceIngredientToKitchen(cleaned, '', inventory) : null);

    if (matched) {
      const effectiveAction: VoiceInventoryAction =
        qty.unit === '%' && action === 'use' && /(left|مونده|full|پر)/.test(clause.toLowerCase())
          ? 'set_level'
          : action;

      updates.push(
        buildProposedUpdateForItem({
          id: `vupd-loc-${idx}-${Date.now()}`,
          spokenText: clause,
          action: effectiveAction,
          item: matched.item,
          amount: qty.amount,
          unit: qty.unit,
          explicitLevelPct:
            explicitLevelPct ?? (effectiveAction === 'set_level' && qty.unit === '%' ? qty.amount : undefined),
          isHalfOfRemaining: qty.isHalfOfRemaining,
          isQuarterOfRemaining: qty.isQuarterOfRemaining,
          storeId: clauseStore?.id,
        })
      );
      return;
    }

    // If the user explicitly bought/added something not yet in Kitchen, propose creating it
    if (action === 'restock' && cleaned.length >= 2) {
      const inferred = inferProductDefaultsFromText(cleaned);
      const cat = inferred?.category ?? 'produce';
      const prof = getCategoryProfile(cat);
      const trackingMode = inferred?.trackingMode ?? prof.defaultTrackingMode;
      const measured = parseMeasuredQuantity(clause);
      const totalPortions =
        trackingMode === 'continuous'
          ? 100
          : Math.max(1, Math.round(qty.amount || prof.defaultPortionCount));

      updates.push({
        id: `vupd-new-${idx}-${Date.now()}`,
        spokenText: clause,
        action: 'add_new',
        matchedItemId: undefined,
        name: cleaned.charAt(0).toUpperCase() + cleaned.slice(1),
        alias: '',
        targetRemainingPortions: totalPortions,
        targetPercent: trackingMode === 'continuous' ? 100 : undefined,
        deltaPortions: totalPortions,
        storeId: clauseStore?.id ?? stores[0]?.id,
        reason: `New item to add${clauseStore ? ` (${clauseStore.name})` : ''}`,
        included: true,
        suggestedCategory: cat,
        suggestedZone: inferred?.zone ?? prof.defaultZone,
        suggestedTrackingMode: trackingMode,
        suggestedPackDescription: measured
          ? `${measured.size} ${measured.unit}`
          : trackingMode === 'continuous'
          ? prof.levelPackPresets[0] ?? '1 container'
          : `${totalPortions} × ${prof.defaultPortionLabel}`,
        initialTotalPortions: totalPortions,
        portionLabel: trackingMode === 'continuous' ? 'container' : prof.defaultPortionLabel,
      });
    }
  });

  return {
    transcript,
    updates,
    source: 'local_fallback',
  };
}
