import {
  ContinuousTrackingStyle,
  FoodCategory,
  MeasureUnit,
  StorageZone,
  TrackingMode,
} from '../types/kitchen';

export interface MeasuredSizePreset {
  label: string;
  size: number;
  unit: MeasureUnit;
  packDesc: string;
  servingLabel?: string;
  servingsPerContainer?: number;
}

export interface ProductCategoryProfile {
  key: FoodCategory;
  en: string;
  fa: string;
  shortEn: string;
  examplesEn: string;
  defaultZone: StorageZone;
  defaultTrackingMode: TrackingMode;
  defaultContinuousStyle: ContinuousTrackingStyle;
  defaultAvgDays: number;
  defaultAutoAdd: boolean;
  /** True when Best-By / Freshness date should be highlighted prominently in the entry form. */
  perishable: boolean;
  namePlaceholder: string;
  aliasPlaceholder: string;
  defaultPortionCount: number;
  defaultPortionLabel: string;
  portionUnitPresets: string[];
  defaultUnit: MeasureUnit;
  allowedUnits: MeasureUnit[];
  measuredPresets: MeasuredSizePreset[];
  levelPackPresets: string[];
  quickDaysPresets: number[];
  expiryQuickDays: number[];
}

export const MEASURE_UNIT_META: Record<MeasureUnit, { label: string; kind: 'volume' | 'weight' }> = {
  L: { label: 'L', kind: 'volume' },
  ml: { label: 'ml', kind: 'volume' },
  gal: { label: 'gal', kind: 'volume' },
  fl_oz: { label: 'fl oz', kind: 'volume' },
  cups: { label: 'cups', kind: 'volume' },
  kg: { label: 'kg', kind: 'weight' },
  g: { label: 'g', kind: 'weight' },
  lb: { label: 'lb', kind: 'weight' },
  oz: { label: 'oz', kind: 'weight' },
};

export const ALL_MEASURE_UNITS: MeasureUnit[] = [
  'L',
  'ml',
  'gal',
  'fl_oz',
  'kg',
  'g',
  'lb',
  'oz',
  'cups',
];

export const PRODUCT_CATEGORY_ORDER: FoodCategory[] = [
  'protein',
  'dairy',
  'produce',
  'beverages',
  'grains',
  'condiments',
  'spices',
  'pantry_staple',
  'snacks',
  'prepared',
];

export const PRODUCT_CATEGORIES: Record<FoodCategory, ProductCategoryProfile> = {
  protein: {
    key: 'protein',
    en: 'Meat, Poultry & Fish',
    fa: 'پروتئین و گوشت',
    shortEn: 'Meat & Fish',
    examplesEn: 'Chicken bags, ground beef, salmon fillets, deli',
    defaultZone: 'freezer',
    defaultTrackingMode: 'portioned',
    defaultContinuousStyle: 'measured',
    defaultAvgDays: 14,
    defaultAutoAdd: true,
    perishable: false, // Becomes perishable when zone === 'fridge'
    namePlaceholder: 'e.g. Chicken Breast, Salmon Fillets',
    aliasPlaceholder: 'مثلاً سینه مرغ',
    defaultPortionCount: 8,
    defaultPortionLabel: '180g freezer bag',
    portionUnitPresets: ['180g freezer bag', 'fillet', 'breast', 'patty', 'serving'],
    defaultUnit: 'kg',
    allowedUnits: ['kg', 'g', 'lb', 'oz'],
    measuredPresets: [
      { label: '1.5 kg pack', size: 1.5, unit: 'kg', packDesc: '1.5 kg pack', servingLabel: '180g serving', servingsPerContainer: 8 },
      { label: '1 kg pack', size: 1, unit: 'kg', packDesc: '1 kg pack', servingLabel: '175g serving', servingsPerContainer: 6 },
      { label: '500g tray', size: 500, unit: 'g', packDesc: '500g tray', servingLabel: '170g serving', servingsPerContainer: 3 },
      { label: '1 lb pack', size: 1, unit: 'lb', packDesc: '1 lb pack', servingLabel: '150g serving', servingsPerContainer: 3 },
    ],
    levelPackPresets: ['1 pack', '1 tray', '1 bag'],
    quickDaysPresets: [4, 7, 14, 21],
    expiryQuickDays: [2, 3, 4, 5],
  },
  dairy: {
    key: 'dairy',
    en: 'Dairy & Eggs',
    fa: 'لبنیات و تخم‌مرغ',
    shortEn: 'Dairy & Eggs',
    examplesEn: 'Milk, Greek yogurt, eggs, feta, butter, cream',
    defaultZone: 'fridge',
    defaultTrackingMode: 'continuous',
    defaultContinuousStyle: 'measured',
    defaultAvgDays: 7,
    defaultAutoAdd: true,
    perishable: true,
    namePlaceholder: 'e.g. 2% Milk, Greek Yogurt, Eggs',
    aliasPlaceholder: 'مثلاً شیر ۲ درصد یا ماست یونانی',
    defaultPortionCount: 12,
    defaultPortionLabel: 'egg',
    portionUnitPresets: ['egg', 'cheese slice', 'stick', '175g bowl', 'serving'],
    defaultUnit: 'L',
    allowedUnits: ['L', 'ml', 'gal', 'fl_oz', 'kg', 'g', 'lb', 'oz', 'cups'],
    measuredPresets: [
      { label: '4L jug', size: 4, unit: 'L', packDesc: '4L jug', servingLabel: '1 cup (250ml)', servingsPerContainer: 16 },
      { label: '2L carton', size: 2, unit: 'L', packDesc: '2L carton', servingLabel: '1 cup (250ml)', servingsPerContainer: 8 },
      { label: '750g tub', size: 750, unit: 'g', packDesc: '750g tub', servingLabel: '175g bowl', servingsPerContainer: 4 },
      { label: '2×750g tubs', size: 1.5, unit: 'kg', packDesc: '2 × 750g tubs', servingLabel: '175g bowl', servingsPerContainer: 8 },
      { label: '454g block', size: 454, unit: 'g', packDesc: '454g block' },
    ],
    levelPackPresets: ['1 jug', '1 carton', '1 tub', '1 block'],
    quickDaysPresets: [5, 7, 10, 14],
    expiryQuickDays: [5, 7, 10, 14],
  },
  produce: {
    key: 'produce',
    en: 'Produce & Fresh Herbs',
    fa: 'سبزیجات و میوه',
    shortEn: 'Produce',
    examplesEn: 'Spinach, Persian herbs, berries, avocados, tomatoes',
    defaultZone: 'fridge',
    defaultTrackingMode: 'continuous',
    defaultContinuousStyle: 'level_only',
    defaultAvgDays: 5,
    defaultAutoAdd: true,
    perishable: true,
    namePlaceholder: 'e.g. Baby Spinach, Avocados, Persian Herbs',
    aliasPlaceholder: 'مثلاً اسفناج یا سبزی خوردن',
    defaultPortionCount: 6,
    defaultPortionLabel: 'piece',
    portionUnitPresets: ['piece', 'avocado', 'apple', 'cucumber', 'bunch'],
    defaultUnit: 'g',
    allowedUnits: ['g', 'kg', 'lb', 'oz', 'cups'],
    measuredPresets: [
      { label: '454g clamshell', size: 454, unit: 'g', packDesc: '454g clamshell', servingLabel: '2 handfuls', servingsPerContainer: 6 },
      { label: '500g box', size: 500, unit: 'g', packDesc: '500g box' },
      { label: '1 kg bag', size: 1, unit: 'kg', packDesc: '1 kg bag' },
      { label: '1.5 kg frozen', size: 1.5, unit: 'kg', packDesc: '1.5 kg bag', servingLabel: '1 cup', servingsPerContainer: 10 },
    ],
    levelPackPresets: ['1 clamshell', '1 washed herb box', '1 bunch', '1 bag'],
    quickDaysPresets: [3, 5, 7, 10],
    expiryQuickDays: [3, 5, 7, 10],
  },
  beverages: {
    key: 'beverages',
    en: 'Drinks & Beverages',
    fa: 'نوشیدنی‌ها',
    shortEn: 'Drinks',
    examplesEn: 'Oat milk, juice, cold brew, doogh, sparkling water',
    defaultZone: 'fridge',
    defaultTrackingMode: 'continuous',
    defaultContinuousStyle: 'measured',
    defaultAvgDays: 7,
    defaultAutoAdd: true,
    perishable: true,
    namePlaceholder: 'e.g. Oat Milk, Orange Juice, Doogh',
    aliasPlaceholder: 'مثلاً شیر جو دوسر یا دوغ',
    defaultPortionCount: 12,
    defaultPortionLabel: 'can',
    portionUnitPresets: ['can', 'bottle', 'carton', 'glass (250ml)'],
    defaultUnit: 'L',
    allowedUnits: ['L', 'ml', 'gal', 'fl_oz', 'cups'],
    measuredPresets: [
      { label: '2L carton', size: 2, unit: 'L', packDesc: '2L carton', servingLabel: '1 cup (250ml)', servingsPerContainer: 8 },
      { label: '1.89L jug', size: 1.89, unit: 'L', packDesc: '1.89L jug', servingLabel: '1 cup (240ml)', servingsPerContainer: 8 },
      { label: '1L bottle', size: 1, unit: 'L', packDesc: '1L bottle', servingLabel: '1 glass (250ml)', servingsPerContainer: 4 },
      { label: '946ml carton', size: 946, unit: 'ml', packDesc: '946ml carton', servingLabel: '1 cup (240ml)', servingsPerContainer: 4 },
    ],
    levelPackPresets: ['1 carton', '1 bottle', '1 pitcher'],
    quickDaysPresets: [5, 7, 10, 14],
    expiryQuickDays: [5, 7, 14, 30],
  },
  grains: {
    key: 'grains',
    en: 'Grains, Rice & Bread',
    fa: 'غلات، برنج و نان',
    shortEn: 'Grains & Bread',
    examplesEn: 'Basmati rice, oats, pasta, lentils, sangak, tortillas',
    defaultZone: 'pantry',
    defaultTrackingMode: 'continuous',
    defaultContinuousStyle: 'measured',
    defaultAvgDays: 30,
    defaultAutoAdd: true,
    perishable: false,
    namePlaceholder: 'e.g. Basmati Rice, Rolled Oats, Sangak Bread',
    aliasPlaceholder: 'مثلاً برنج باسماتی یا نان سنگک',
    defaultPortionCount: 10,
    defaultPortionLabel: 'slice',
    portionUnitPresets: ['slice', 'tortilla', 'loaf', 'box', '1/3 cup dry'],
    defaultUnit: 'kg',
    allowedUnits: ['kg', 'g', 'lb', 'oz', 'cups'],
    measuredPresets: [
      { label: '4.5 kg bag', size: 4.5, unit: 'kg', packDesc: '4.5 kg bag', servingLabel: '1/3 cup dry', servingsPerContainer: 30 },
      { label: '2 kg bag', size: 2, unit: 'kg', packDesc: '2 kg bag', servingLabel: '1/2 cup dry', servingsPerContainer: 20 },
      { label: '1 kg bag', size: 1, unit: 'kg', packDesc: '1 kg bag', servingLabel: '1/2 cup', servingsPerContainer: 12 },
      { label: '500g box', size: 500, unit: 'g', packDesc: '500g box', servingLabel: '85g dry', servingsPerContainer: 6 },
    ],
    levelPackPresets: ['1 bag', '1 canister', '1 loaf', '1 box'],
    quickDaysPresets: [10, 21, 30, 45],
    expiryQuickDays: [5, 14, 30],
  },
  condiments: {
    key: 'condiments',
    en: 'Oils, Sauces & Condiments',
    fa: 'روغن، سس و چاشنی',
    shortEn: 'Oils & Sauces',
    examplesEn: 'Olive oil, tahini, soy sauce, pesto, ketchup, honey',
    defaultZone: 'pantry',
    defaultTrackingMode: 'continuous',
    defaultContinuousStyle: 'level_only',
    defaultAvgDays: 45,
    defaultAutoAdd: true,
    perishable: false,
    namePlaceholder: 'e.g. Extra Virgin Olive Oil, Tahini, Soy Sauce',
    aliasPlaceholder: 'مثلاً روغن زیتون یا رب انار',
    defaultPortionCount: 1,
    defaultPortionLabel: 'bottle',
    portionUnitPresets: ['bottle', 'jar', 'packet', 'tbsp'],
    defaultUnit: 'ml',
    allowedUnits: ['L', 'ml', 'fl_oz', 'g', 'oz'],
    measuredPresets: [
      { label: '1L bottle', size: 1, unit: 'L', packDesc: '1L bottle' },
      { label: '750ml bottle', size: 750, unit: 'ml', packDesc: '750ml bottle' },
      { label: '500ml bottle', size: 500, unit: 'ml', packDesc: '500ml bottle' },
      { label: '500g jar', size: 500, unit: 'g', packDesc: '500g jar' },
    ],
    levelPackPresets: ['1 bottle', '1 jar', '1 squeeze bottle', '1 tub'],
    quickDaysPresets: [14, 30, 45, 90],
    expiryQuickDays: [14, 30, 60],
  },
  spices: {
    key: 'spices',
    en: 'Spices, Tea & Baking',
    fa: 'ادویه، چای و پخت',
    shortEn: 'Spices & Tea',
    examplesEn: 'Saffron, turmeric, cumin, salt, coffee beans, tea',
    defaultZone: 'pantry',
    defaultTrackingMode: 'continuous',
    defaultContinuousStyle: 'level_only',
    defaultAvgDays: 90,
    defaultAutoAdd: true,
    perishable: false,
    namePlaceholder: 'e.g. Saffron, Turmeric, Coffee Beans, Black Tea',
    aliasPlaceholder: 'مثلاً زعفران یا زردچوبه',
    defaultPortionCount: 40,
    defaultPortionLabel: 'tea bag',
    portionUnitPresets: ['tea bag', 'pod', 'jar', 'packet'],
    defaultUnit: 'g',
    allowedUnits: ['g', 'kg', 'oz', 'lb'],
    measuredPresets: [
      { label: '1 kg bag', size: 1, unit: 'kg', packDesc: '1 kg bag' },
      { label: '500g bag', size: 500, unit: 'g', packDesc: '500g bag' },
      { label: '250g tin', size: 250, unit: 'g', packDesc: '250g tin' },
      { label: '100g jar', size: 100, unit: 'g', packDesc: '100g jar' },
    ],
    levelPackPresets: ['1 jar', '1 tin', '1 grinder', '1 bag', '1 box'],
    quickDaysPresets: [30, 60, 90, 180],
    expiryQuickDays: [90, 180],
  },
  pantry_staple: {
    key: 'pantry_staple',
    en: 'Canned & Dry Staples',
    fa: 'کنسرو و اقلام پایه',
    shortEn: 'Canned & Dry',
    examplesEn: 'Canned chickpeas, tomato paste, broth cartons, tuna',
    defaultZone: 'pantry',
    defaultTrackingMode: 'portioned',
    defaultContinuousStyle: 'level_only',
    defaultAvgDays: 30,
    defaultAutoAdd: true,
    perishable: false,
    namePlaceholder: 'e.g. Canned Chickpeas, Chicken Broth, Tomato Paste',
    aliasPlaceholder: 'مثلاً کنسرو نخود یا رب گوجه',
    defaultPortionCount: 4,
    defaultPortionLabel: 'can',
    portionUnitPresets: ['can', 'carton', 'jar', 'box', 'pouch'],
    defaultUnit: 'g',
    allowedUnits: ['kg', 'g', 'L', 'ml', 'oz', 'lb'],
    measuredPresets: [
      { label: '1L carton', size: 1, unit: 'L', packDesc: '1L carton' },
      { label: '1 kg bag', size: 1, unit: 'kg', packDesc: '1 kg bag' },
      { label: '500g jar', size: 500, unit: 'g', packDesc: '500g jar' },
    ],
    levelPackPresets: ['1 bag', '1 jar', '1 canister'],
    quickDaysPresets: [14, 30, 45, 60],
    expiryQuickDays: [30, 90],
  },
  snacks: {
    key: 'snacks',
    en: 'Snacks, Nuts & Protein',
    fa: 'میان‌وعده، آجیل و پروتئین',
    shortEn: 'Snacks & Nuts',
    examplesEn: 'Whey protein, walnuts, dates, peanut butter, bars',
    defaultZone: 'pantry',
    defaultTrackingMode: 'continuous',
    defaultContinuousStyle: 'measured',
    defaultAvgDays: 14,
    defaultAutoAdd: true,
    perishable: false,
    namePlaceholder: 'e.g. Whey Protein, Walnuts, Dates, Protein Bars',
    aliasPlaceholder: 'مثلاً گردو، خرما یا پروتئین وی',
    defaultPortionCount: 12,
    defaultPortionLabel: 'bar',
    portionUnitPresets: ['bar', 'scoop', 'pack', 'handful', 'serving'],
    defaultUnit: 'g',
    allowedUnits: ['kg', 'g', 'lb', 'oz'],
    measuredPresets: [
      { label: '2 kg tub', size: 2, unit: 'kg', packDesc: '2 kg tub', servingLabel: '1 scoop (33g)', servingsPerContainer: 60 },
      { label: '1 kg bag', size: 1, unit: 'kg', packDesc: '1 kg bag', servingLabel: '30g handful', servingsPerContainer: 30 },
      { label: '500g jar', size: 500, unit: 'g', packDesc: '500g jar', servingLabel: '2 tbsp', servingsPerContainer: 15 },
      { label: '750g box', size: 750, unit: 'g', packDesc: '750g box' },
    ],
    levelPackPresets: ['1 bag', '1 tub', '1 jar', '1 box'],
    quickDaysPresets: [7, 14, 21, 30],
    expiryQuickDays: [14, 30, 60],
  },
  prepared: {
    key: 'prepared',
    en: 'Prepared & Leftovers',
    fa: 'غذای آماده و باقیمانده',
    shortEn: 'Leftovers',
    examplesEn: 'Meal prep boxes, cooked stew, soup, frozen dumplings',
    defaultZone: 'fridge',
    defaultTrackingMode: 'portioned',
    defaultContinuousStyle: 'level_only',
    defaultAvgDays: 3,
    defaultAutoAdd: false,
    perishable: true,
    namePlaceholder: 'e.g. Leftover Ghormeh Sabzi, Meal Prep Chicken',
    aliasPlaceholder: 'مثلاً قورمه‌سبزی باقیمانده',
    defaultPortionCount: 3,
    defaultPortionLabel: 'meal container',
    portionUnitPresets: ['meal container', 'serving', 'bowl', 'piece'],
    defaultUnit: 'g',
    allowedUnits: ['kg', 'g', 'L', 'ml', 'cups'],
    measuredPresets: [
      { label: '1L container', size: 1, unit: 'L', packDesc: '1L container', servingLabel: '1 bowl', servingsPerContainer: 3 },
      { label: '500g container', size: 500, unit: 'g', packDesc: '500g container', servingLabel: '1 serving', servingsPerContainer: 2 },
    ],
    levelPackPresets: ['1 container', '1 pot', '1 tray'],
    quickDaysPresets: [2, 3, 4, 7],
    expiryQuickDays: [2, 3, 4, 5],
  },
};

export function getCategoryProfile(category: FoodCategory): ProductCategoryProfile {
  return PRODUCT_CATEGORIES[category] ?? PRODUCT_CATEGORIES.pantry_staple;
}

export function isPerishableInZone(category: FoodCategory, zone: StorageZone): boolean {
  if (zone === 'freezer') return false;
  if (category === 'protein' && zone === 'fridge') return true;
  return getCategoryProfile(category).perishable;
}

/**
 * Infers the best category, zone, and tracking mode from a product name or Open Food Facts tags.
 */
export function inferProductDefaultsFromText(text: string): {
  category: FoodCategory;
  zone: StorageZone;
  trackingMode: TrackingMode;
  continuousStyle: ContinuousTrackingStyle;
} | null {
  const s = text.toLowerCase();
  if (/\b(milk|yogurt|kefir|cream|butter|cheese|feta|paneer|cottage)\b/.test(s)) {
    return { category: 'dairy', zone: 'fridge', trackingMode: 'continuous', continuousStyle: 'measured' };
  }
  if (/\b(egg|eggs)\b/.test(s)) {
    return { category: 'dairy', zone: 'fridge', trackingMode: 'portioned', continuousStyle: 'level_only' };
  }
  if (/\b(juice|oat milk|almond milk|soy milk|coffee|cold brew|kombucha|soda|sparkling|doogh|drink|beverage)\b/.test(s)) {
    return { category: 'beverages', zone: 'fridge', trackingMode: 'continuous', continuousStyle: 'measured' };
  }
  if (/\b(chicken|beef|lamb|turkey|salmon|fish|shrimp|steak|meat|tuna|pork|fillet)\b/.test(s)) {
    return { category: 'protein', zone: 'freezer', trackingMode: 'portioned', continuousStyle: 'measured' };
  }
  if (/\b(spinach|lettuce|kale|herb|cilantro|parsley|berries|strawberry|blueberry|arugula|greens|salad|sabzi)\b/.test(s)) {
    return { category: 'produce', zone: 'fridge', trackingMode: 'continuous', continuousStyle: 'level_only' };
  }
  if (/\b(apple|banana|avocado|tomato|cucumber|onion|pepper|lemon|lime|garlic|potato|zucchini|carrot|broccoli)\b/.test(s)) {
    return { category: 'produce', zone: 'fridge', trackingMode: 'portioned', continuousStyle: 'level_only' };
  }
  if (/\b(olive oil|avocado oil|oil|vinegar|ketchup|mayo|mustard|soy sauce|sriracha|pesto|tahini|molasses|sauce|dressing|hummus|jam|honey|syrup)\b/.test(s)) {
    const isFridge = /\b(ketchup|mayo|mustard|pesto|hummus|dressing|salsa|jam)\b/.test(s);
    return { category: 'condiments', zone: isFridge ? 'fridge' : 'pantry', trackingMode: 'continuous', continuousStyle: 'level_only' };
  }
  if (/\b(saffron|turmeric|cumin|pepper|salt|cinnamon|spice|seasoning|paprika|oregano|tea|baking|yeast|vanilla)\b/.test(s)) {
    return { category: 'spices', zone: 'pantry', trackingMode: 'continuous', continuousStyle: 'level_only' };
  }
  if (/\b(rice|oat|oats|quinoa|pasta|flour|lentil|barley|bulgur)\b/.test(s)) {
    return { category: 'grains', zone: 'pantry', trackingMode: 'continuous', continuousStyle: 'measured' };
  }
  if (/\b(bread|sangak|lavash|tortilla|pita|bagel|wrap)\b/.test(s)) {
    return { category: 'grains', zone: 'pantry', trackingMode: 'portioned', continuousStyle: 'level_only' };
  }
  if (/\b(whey|protein powder|almond|walnut|pistachio|cashew|nut|peanut butter|date|chocolate|bar|cracker|chip)\b/.test(s)) {
    const isCountable = /\b(bar|bars)\b/.test(s);
    return {
      category: 'snacks',
      zone: 'pantry',
      trackingMode: isCountable ? 'portioned' : 'continuous',
      continuousStyle: 'measured',
    };
  }
  if (/\b(can|canned|broth|stock|chickpea|bean|tomato paste|diced tomato)\b/.test(s)) {
    return { category: 'pantry_staple', zone: 'pantry', trackingMode: 'portioned', continuousStyle: 'level_only' };
  }
  return null;
}

/**
 * Parses a quantity string like "4 L", "750g", "1.89 l", "500 ml", "4.5 kg" into size & unit.
 */
export function parseMeasuredQuantity(raw?: string): { size: number; unit: MeasureUnit } | null {
  if (!raw) return null;
  const match = raw.match(/(\d+(?:[.,]\d+)?)\s*(ml|mL|l|L|liters?|litres?|kg|g|grams?|lb|lbs|fl\s*oz|oz|gal|gallon)/i);
  if (!match) return null;
  const size = parseFloat(match[1].replace(',', '.'));
  if (!Number.isFinite(size) || size <= 0) return null;
  const rawUnit = match[2].toLowerCase().replace(/\s+/g, '');
  const map: Record<string, MeasureUnit> = {
    l: 'L',
    liter: 'L',
    liters: 'L',
    litre: 'L',
    litres: 'L',
    ml: 'ml',
    kg: 'kg',
    g: 'g',
    gram: 'g',
    grams: 'g',
    lb: 'lb',
    lbs: 'lb',
    oz: 'oz',
    floz: 'fl_oz',
    gal: 'gal',
    gallon: 'gal',
  };
  const unit = map[rawUnit];
  return unit ? { size, unit } : null;
}
