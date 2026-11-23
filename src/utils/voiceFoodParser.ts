import {
  CookingTool,
  FoodCategory,
  InventoryItem,
  MealRecipe,
  StorageZone,
  TrackingMode,
} from '../types/kitchen';
import {
  getCategoryProfile,
  inferProductDefaultsFromText,
  parseMeasuredQuantity,
} from './productCategories';

export interface VoiceParsedIngredient {
  id: string;
  spokenText: string;
  matchedItemId?: string;
  matchConfidence: 'exact' | 'fuzzy' | 'new';
  name: string;
  alias: string;
  portionsNeeded: number;
  portionLabel: string;
  /** Suggested defaults if this ingredient is missing from the kitchen and needs to be created */
  suggestedCategory: FoodCategory;
  suggestedZone: StorageZone;
  suggestedTrackingMode: TrackingMode;
  suggestedPackDescription: string;
  /** Confirmation state for creating missing items in Kitchen Inventory */
  confirmCreateInKitchen: boolean;
  /** Whether the user already has this missing ingredient at home right now */
  initialInStock: boolean;
  initialStockCount: number;
  storeId: string;
}

export interface VoiceParsedFood {
  transcript: string;
  name: string;
  alias: string;
  cuisine: string;
  mealType: MealRecipe['mealType'];
  prepMinutes: number;
  tools: CookingTool[];
  quickSteps: string[];
  ingredients: VoiceParsedIngredient[];
  source: 'gemini_audio' | 'gemini_text' | 'local_fallback';
}

// Bilingual synonym groups so Persian spoken ingredients match English kitchen items and vice versa
const BILINGUAL_SYNONYMS: string[][] = [
  ['chicken', 'chicken breast', 'مرغ', 'سینه مرغ', 'جوجه', 'ران مرغ'],
  ['beef', 'ground beef', 'steak', 'گوشت', 'گوشت چرخ کرده', 'گوشت چرخ‌کرده', 'گوشت گوساله', 'راسته'],
  ['lamb', 'گوشت بره', 'گوسفند', 'ماهیچه'],
  ['salmon', 'fish', 'ماهی', 'سالمون', 'فیله ماهی'],
  ['shrimp', 'میگو'],
  ['egg', 'eggs', 'تخم مرغ', 'تخم‌مرغ'],
  ['milk', 'شیر'],
  ['yogurt', 'greek yogurt', 'ماست', 'ماست یونانی'],
  ['cheese', 'feta', 'پنیر', 'پنیر فتا', 'پنیر پیتزا'],
  ['butter', 'کره'],
  ['spinach', 'اسفناج'],
  ['herb', 'herbs', 'sabzi', 'parsley', 'cilantro', 'سبزی', 'سبزی خوردن', 'جعفری', 'گشنیز', 'شنبلیله'],
  ['rice', 'basmati', 'برنج', 'برنج باسماتی'],
  ['olive oil', 'oil', 'روغن', 'روغن زیتون'],
  ['tomato', 'tomatoes', 'گوجه', 'گوجه‌فرنگی', 'گوجه فرنگی'],
  ['tomato paste', 'رب', 'رب گوجه', 'رب گوجه‌فرنگی'],
  ['onion', 'onions', 'پیاز'],
  ['garlic', 'سیر'],
  ['potato', 'potatoes', 'سیب زمینی', 'سیب‌زمینی'],
  ['mushroom', 'mushrooms', 'قارچ'],
  ['pepper', 'bell pepper', 'فلفل', 'فلفل دلمه', 'فلفل دلمه‌ای'],
  ['cucumber', 'خیار'],
  ['lemon', 'lime', 'لیمو', 'لیموترش', 'آبلیمو', 'آب لیمو'],
  ['saffron', 'زعفران', 'زعفرون'],
  ['turmeric', 'زردچوبه'],
  ['salt', 'نمک'],
  ['black pepper', 'فلفل سیاه'],
  ['beans', 'kidney beans', 'لوبیا', 'لوبیا قرمز', 'لوبیا چیتی'],
  ['chickpeas', 'نخود'],
  ['lentils', 'عدس'],
  ['bread', 'sangak', 'نان', 'سنگک', 'لواش'],
  ['pasta', 'ماکارونی', 'پاستا'],
  ['oats', 'جو دوسر'],
  ['walnut', 'walnuts', 'گردو'],
  ['pomegranate', 'pomegranate molasses', 'رب انار', 'انار'],
  ['broccoli', 'بروکلی', 'کلم بروکلی'],
  ['carrot', 'carrots', 'هویج'],
  ['zucchini', 'کدو', 'کدو سبز'],
  ['eggplant', 'بادمجان', 'بادمجون'],
  ['avocado', 'آووکادو'],
  ['whey', 'protein powder', 'پروتئین وی', 'پروتئین'],
];

const PERSIAN_DIGITS: Record<string, string> = {
  '۰': '0',
  '۱': '1',
  '۲': '2',
  '۳': '3',
  '۴': '4',
  '۵': '5',
  '۶': '6',
  '۷': '7',
  '۸': '8',
  '۹': '9',
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
};

export function normalizeBilingualText(text: string): string {
  let out = text
    .replace(/[۰-۹٠-٩]/g, (ch) => PERSIAN_DIGITS[ch] || ch)
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\u200c/g, ' ')
    .toLowerCase();
  // Keep compound Persian phrases intact so "تخم مرغ" (egg) never collides with "مرغ" (chicken)
  out = out.replace(/تخم\s+مرغ/g, 'تخم_مرغ');
  out = out.replace(/[^a-z0-9_\u0600-\u06FF.\s/-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return out;
}

function getSynonymGroupIndices(normalized: string): Set<number> {
  const groups = new Set<number>();
  const padded = ` ${normalized} `;
  for (let idx = 0; idx < BILINGUAL_SYNONYMS.length; idx++) {
    for (const term of BILINGUAL_SYNONYMS[idx]) {
      const cleanTerm = normalizeBilingualText(term);
      if (
        normalized === cleanTerm ||
        padded.includes(` ${cleanTerm} `)
      ) {
        groups.add(idx);
        break;
      }
    }
  }
  return groups;
}

function tokenize(text: string): string[] {
  return normalizeBilingualText(text)
    .split(/[\s/-]+/)
    .filter((w) => w.length >= 2);
}

/**
 * Matches a spoken/extracted ingredient (English or Farsi) against the household's live kitchen inventory.
 */
export function matchVoiceIngredientToKitchen(
  name: string,
  alias: string,
  inventory: InventoryItem[]
): { item: InventoryItem; confidence: 'exact' | 'fuzzy' } | null {
  const queryCombined = normalizeBilingualText(`${name} ${alias}`);
  if (!queryCombined) return null;

  const queryNameNorm = normalizeBilingualText(name);
  const queryAliasNorm = normalizeBilingualText(alias);
  const queryTokens = new Set(tokenize(queryCombined));
  const querySynGroups = getSynonymGroupIndices(queryCombined);

  let best: InventoryItem | null = null;
  let bestScore = 0;

  for (const item of inventory) {
    const itemNameNorm = normalizeBilingualText(item.name);
    const itemAliasNorm = normalizeBilingualText(item.alias);
    const itemCombined = `${itemNameNorm} ${itemAliasNorm}`.trim();

    if (
      (queryNameNorm && (queryNameNorm === itemNameNorm || queryNameNorm === itemAliasNorm)) ||
      (queryAliasNorm && (queryAliasNorm === itemNameNorm || queryAliasNorm === itemAliasNorm))
    ) {
      return { item, confidence: 'exact' };
    }

    const itemTokens = tokenize(itemCombined);
    let overlap = 0;
    for (const tok of itemTokens) {
      if (queryTokens.has(tok)) overlap += 1;
    }
    let score =
      itemTokens.length > 0 && queryTokens.size > 0
        ? overlap / Math.min(itemTokens.length, queryTokens.size)
        : 0;

    // Cross-language synonym group boost (e.g. "سینه مرغ" <-> "Chicken Breast")
    if (querySynGroups.size > 0) {
      const itemSynGroups = getSynonymGroupIndices(itemCombined);
      for (const g of querySynGroups) {
        if (itemSynGroups.has(g)) {
          score = Math.max(score, 0.85);
          break;
        }
      }
    }

    // Substring match for multi-word items (e.g., "milk" -> "2% Milk")
    if (
      (queryNameNorm.length >= 3 && ` ${itemNameNorm} `.includes(` ${queryNameNorm} `)) ||
      (itemNameNorm.length >= 3 && ` ${queryNameNorm} `.includes(` ${itemNameNorm} `)) ||
      (queryAliasNorm.length >= 3 && ` ${itemAliasNorm} `.includes(` ${queryAliasNorm} `))
    ) {
      score = Math.max(score, 0.78);
    }

    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }

  if (best && bestScore >= 0.6) {
    return { item: best, confidence: bestScore >= 0.85 ? 'exact' : 'fuzzy' };
  }
  return null;
}

const PERSIAN_NUMBER_WORDS: Record<string, number> = {
  نصف: 0.5,
  نیم: 0.5,
  ربع: 0.25,
  یک: 1,
  یه: 1,
  دو: 2,
  دوتا: 2,
  سه: 3,
  چهار: 4,
  پنج: 5,
  شش: 6,
  هفت: 7,
  هشت: 8,
  نه: 9,
  ده: 10,
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
};

function parseLeadingQuantityAndUnit(segment: string): {
  qty: number;
  unitLabel: string;
  cleanedName: string;
} {
  let working = segment
    .replace(/[۰-۹٠-٩]/g, (ch) => PERSIAN_DIGITS[ch] || ch)
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .trim();

  // Strip filler prefixes
  working = working
    .replace(/^(and|with|plus|also|some|و|با|کمی|مقداری)\s+/i, '')
    .trim();

  let qty = 1;
  let unit = '';

  // 1. Numeric leading value (Unicode-safe lookahead so Persian units like گرم/تا/مشت match cleanly!)
  const numMatch = working.match(
    /^(\d+(?:\.\d+)?|\d+\s*\/\s*\d+)\s*(?:(kg|kilograms?|g|grams?|ml|l|liters?|litres?|oz|lbs?|cups?|tbsp|tablespoons?|tsp|teaspoons?|slices?|pieces?|fillets?|bags?|cans?|handfuls?|bunches?|cloves?|گرم|کیلوگرم|کیلو|لیتر|میلی‌لیتر|میلی\s+لیتر|پیمانه|لیوان|قاشق\s+غذاخوری|قاشق\s+چایخوری|قاشق|عدد|تا|بسته|مشت|حبه|ورق)(?=\s|$))?\s*(?:of\s+)?/i
  );

  if (numMatch) {
    const rawNum = numMatch[1].replace(/\s+/g, '');
    if (rawNum.includes('/')) {
      const [a, b] = rawNum.split('/').map(Number);
      qty = b ? Number((a / b).toFixed(2)) : 1;
    } else {
      qty = parseFloat(rawNum) || 1;
    }
    unit = (numMatch[2] || '').trim();
    working = working.slice(numMatch[0].length).trim();
  } else {
    // 2. Word numbers ("half a cup", "نصف لیوان", "دو تا")
    const firstWord = working.split(/\s+/)[0]?.toLowerCase() ?? '';
    const wordVal = PERSIAN_NUMBER_WORDS[firstWord] ?? ENGLISH_NUMBER_WORDS[firstWord];
    if (wordVal !== undefined) {
      qty = wordVal;
      working = working.slice(firstWord.length).trim();
      const unitMatch = working.match(
        /^(?:an?\s+)?(cups?|tbsp|tablespoons?|tsp|teaspoons?|slices?|pieces?|handfuls?|bunches?|cloves?|cans?|پیمانه|لیوان|قاشق\s+غذاخوری|قاشق\s+چایخوری|قاشق|عدد|تا|بسته|مشت|حبه)(?=\s|$)\s*(?:of\s+)?/i
      );
      if (unitMatch) {
        unit = unitMatch[1].trim();
        working = working.slice(unitMatch[0].length).trim();
      }
    }
  }

  // Convert gram/ml amounts into sensible portion count (e.g., "200g chicken" -> 1 × "200g")
  let portionsNeeded = qty;
  let portionLabel = unit || '1 portion';
  const lowerUnit = unit.toLowerCase();
  if (/^(g|gram|grams|ml|گرم|میلی‌لیتر|میلی\s+لیتر)$/.test(lowerUnit) && qty >= 15) {
    portionsNeeded = 1;
    portionLabel = `${qty}${lowerUnit === 'گرم' ? 'g' : lowerUnit.startsWith('میلی') ? 'ml' : lowerUnit}`;
  } else if (unit) {
    portionLabel = unit;
  }

  const cleanedName =
    working.replace(/^(an?|the|از|of)\s+/i, '').trim() || segment.trim();
  return {
    qty: Math.max(0.25, Number(portionsNeeded.toFixed(2))),
    unitLabel: portionLabel,
    cleanedName,
  };
}

function detectToolsFromTranscript(text: string): CookingTool[] {
  const lower = normalizeBilingualText(text);
  const tools: CookingTool[] = [];
  if (/air\s*fryer|ایرفرایر|سرخ\s*کن/.test(lower)) tools.push('air_fryer');
  if (/\boven\b|\bbake\b|\broast\b|\bفر\b|توی فر|در فر/.test(lower)) tools.push('oven');
  if (/\bpan\b|\bskillet\b|\bstovetop\b|\bpan\s*fry\b|تابه|ماهیتابه|قابلمه|گاز/.test(lower)) tools.push('pan');
  if (/\bgrill\b|\bbbq\b|گریل|منقل/.test(lower)) tools.push('grill');
  if (/instant\s*pot|pressure|زودپز/.test(lower)) tools.push('instant_pot');
  if (/slow\s*cooker|آرام\s*پز/.test(lower)) tools.push('slow_cooker');
  if (/\bblender\b|\bsmoothie\b|مخلوط\s*کن/.test(lower)) tools.push('blender');
  if (/no\s*cook|بدون پخت/.test(lower)) tools.push('no_cook');
  return tools.length > 0 ? tools : ['pan'];
}

function detectPrepMinutes(text: string): number {
  const norm = normalizeBilingualText(text);
  const minMatch = norm.match(/(\d+)\s*(min|mins|minutes|دقیقه)/i);
  if (minMatch) return Math.max(5, Math.min(240, Number(minMatch[1]) || 20));
  const hrMatch = norm.match(/(\d+(?:\.\d+)?)\s*(hr|hrs|hours?|ساعت)/i);
  if (hrMatch) return Math.max(15, Math.min(240, Math.round(Number(hrMatch[1]) * 60)));
  return 20;
}

function detectMealType(text: string): MealRecipe['mealType'] {
  const lower = normalizeBilingualText(text);
  if (/breakfast|omelette|omelet|oatmeal|smoothie|صبحانه|املت|نیمرو/.test(lower)) return 'breakfast';
  if (/snack|shake|میان‌وعده|میان وعده|عصرانه/.test(lower)) return 'snack';
  if (/lunch|ناهار/.test(lower)) return 'lunch';
  return 'dinner';
}

function isPersianText(text: string): boolean {
  return /[\u0600-\u06FF]/.test(text);
}

/**
 * Smart offline / local-demo fallback parser for English & Farsi voice transcripts.
 * Splits food title and ingredient clauses, extracts amounts, matches existing kitchen tickers,
 * and infers category/zone/tracking defaults for missing ingredients.
 */
export function parseVoiceFoodLocally(
  rawTranscript: string,
  inventory: InventoryItem[],
  defaultStoreId: string,
  cuisines: string[]
): VoiceParsedFood {
  const transcript = rawTranscript.trim();
  const hasPersian = isPersianText(transcript);

  // Split title from ingredients using colon, "with", "با", "شامل", "مواد لازم", or first comma
  let titlePart = '';
  let ingredientsPart = transcript;

  const colonIdx = transcript.search(/[:：؛;]/);
  if (colonIdx > 0 && colonIdx < 70) {
    titlePart = transcript.slice(0, colonIdx).trim();
    ingredientsPart = transcript.slice(colonIdx + 1).trim();
  } else {
    const withMatch = transcript.match(/^(.{2,55}?)\s+(?:with|using|made with|ingredients|با|شامل|مواد لازم)\s+(.+)$/i);
    if (withMatch) {
      titlePart = withMatch[1].trim();
      ingredientsPart = withMatch[2].trim();
    } else {
      const firstSep = transcript.search(/[,،\n]/);
      if (firstSep > 0 && firstSep < 55) {
        titlePart = transcript.slice(0, firstSep).trim();
        ingredientsPart = transcript.slice(firstSep + 1).trim();
      } else {
        titlePart = transcript.slice(0, 40).trim();
      }
    }
  }

  // Clean conversational filler from title
  titlePart = titlePart
    .replace(
      /^(i want to add|add a new food|add food|add meal|new meal|new food|می‌خوام|میخوام|می خواهم|اضافه کن|یه غذا|یک غذا|غذای جدید)\s+/i,
      ''
    )
    .replace(/\s+(اضافه کنم|اضافه کن|درست کنم|بپزم)$/i, '')
    .trim();

  // Strip trailing cook-time / tool notes from ingredient segment list
  const rawClauses = ingredientsPart
    .split(/[,،\n]+|\s+(?:and|plus|و)\s+/i)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2)
    .filter(
      (s) =>
        !/^(\d+\s*(min|mins|minutes|دقیقه|ساعت)|in\s+(the\s+)?(air\s*fryer|oven|pan|instant\s*pot)|توی\s+(ایرفرایر|فر|تابه|زودپز))/i.test(
          normalizeBilingualText(s)
        )
    );

  const ingredients: VoiceParsedIngredient[] = rawClauses.map((clause, idx) => {
    const { qty, unitLabel, cleanedName } = parseLeadingQuantityAndUnit(clause);
    const match = matchVoiceIngredientToKitchen(cleanedName, '', inventory);

    if (match) {
      const inv = match.item;
      return {
        id: `ving-${idx}-${Date.now()}`,
        spokenText: clause,
        matchedItemId: inv.id,
        matchConfidence: match.confidence,
        name: inv.name,
        alias: inv.alias,
        portionsNeeded: qty,
        portionLabel:
          unitLabel && unitLabel !== '1 portion' ? unitLabel : inv.portionLabel || '1 portion',
        suggestedCategory: inv.category,
        suggestedZone: inv.zone,
        suggestedTrackingMode: inv.trackingMode,
        suggestedPackDescription: inv.packDescription,
        confirmCreateInKitchen: false,
        initialInStock: inv.remainingPortions > 0,
        initialStockCount: inv.remainingPortions,
        storeId: inv.defaultStoreId || defaultStoreId,
      };
    }

    const inferred = inferProductDefaultsFromText(cleanedName);
    const cat = inferred?.category ?? 'produce';
    const prof = getCategoryProfile(cat);
    const trackingMode = inferred?.trackingMode ?? prof.defaultTrackingMode;
    const measured = parseMeasuredQuantity(clause);

    return {
      id: `ving-${idx}-${Date.now()}`,
      spokenText: clause,
      matchedItemId: undefined,
      matchConfidence: 'new',
      name: cleanedName,
      alias: '',
      portionsNeeded: qty,
      portionLabel: unitLabel !== '1 portion' ? unitLabel : prof.defaultPortionLabel,
      suggestedCategory: cat,
      suggestedZone: inferred?.zone ?? prof.defaultZone,
      suggestedTrackingMode: trackingMode,
      suggestedPackDescription: measured
        ? `${measured.size} ${measured.unit}`
        : trackingMode === 'continuous'
        ? prof.levelPackPresets[0] ?? '1 container'
        : `${prof.defaultPortionCount} × ${prof.defaultPortionLabel}`,
      confirmCreateInKitchen: true,
      initialInStock: false,
      initialStockCount: 0,
      storeId: defaultStoreId,
    };
  });

  const defaultCuisine = hasPersian
    ? cuisines.find((c) => c.toLowerCase() === 'persian') || cuisines[0] || 'Persian'
    : cuisines[0] || 'Western';

  return {
    transcript,
    name: hasPersian ? titlePart || 'غذای جدید' : titlePart || 'New Voice Meal',
    alias: '',
    cuisine: defaultCuisine,
    mealType: detectMealType(transcript),
    prepMinutes: detectPrepMinutes(transcript),
    tools: detectToolsFromTranscript(transcript),
    quickSteps: ['Prepare ingredients and cook until done.'],
    ingredients,
    source: 'local_fallback',
  };
}
