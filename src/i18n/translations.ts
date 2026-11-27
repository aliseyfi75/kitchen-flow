import { CookingTool, EffortLevel, FoodCategory, StorageZone } from '../types/kitchen';

export const TOOL_META: Record<CookingTool, { en: string; emoji: string }> = {
  air_fryer: { en: 'Air Fryer', emoji: '🍟' },
  oven: { en: 'Oven', emoji: '🔥' },
  pan: { en: 'Pan / Stovetop', emoji: '🍳' },
  grill: { en: 'Grill', emoji: '🥩' },
  instant_pot: { en: 'Instant Pot', emoji: '🍲' },
  slow_cooker: { en: 'Slow Cooker', emoji: '🥘' },
  blender: { en: 'Blender', emoji: '🥤' },
  no_cook: { en: 'No-Cook', emoji: '🥗' },
};

export const ZONE_META: Record<StorageZone, { en: string }> = {
  fridge: { en: 'Fridge' },
  freezer: { en: 'Freezer' },
  pantry: { en: 'Pantry' },
};

/** Keeps Persian category keywords (`fa`) so bilingual search matches Persian category queries. */
export const CATEGORY_META: Record<FoodCategory, { en: string; fa: string }> = {
  protein: { en: 'Meat, Poultry & Fish', fa: 'پروتئین و گوشت' },
  dairy: { en: 'Dairy & Eggs', fa: 'لبنیات و تخم‌مرغ' },
  produce: { en: 'Produce & Fresh Herbs', fa: 'سبزیجات و میوه' },
  beverages: { en: 'Drinks & Beverages', fa: 'نوشیدنی‌ها' },
  grains: { en: 'Grains, Rice & Bread', fa: 'غلات، برنج و نان' },
  condiments: { en: 'Oils, Sauces & Condiments', fa: 'روغن، سس و چاشنی' },
  spices: { en: 'Spices, Tea & Baking', fa: 'ادویه، چای و پخت' },
  pantry_staple: { en: 'Canned & Dry Staples', fa: 'کنسرو و اقلام پایه' },
  snacks: { en: 'Snacks, Nuts & Protein', fa: 'میان‌وعده، آجیل و پروتئین' },
  prepared: { en: 'Prepared & Leftovers', fa: 'غذای آماده و باقیمانده' },
};

export const EFFORT_META: Record<EffortLevel, { en: string; descEn: string }> = {
  exhausted: {
    en: 'Tired / Quick (<20m)',
    descEn: 'Minimal prep, air fryer & one-pan meals',
  },
  normal: {
    en: 'Balanced (20–35m)',
    descEn: 'Healthy everyday cooking',
  },
  batch_prep: {
    en: 'Batch Prep',
    descEn: 'Cook once, eat 2–3 times',
  },
};

export const UI_LABELS = {
  appName: 'KitchenFlow',
  tagline: 'Zero-stress kitchen inventory & meals',
  navKitchen: 'Kitchen',
  navShopping: 'Shopping',
  navMeals: 'Meal Plan',
  navInsights: 'Settings',
  simpleMode: 'Simple',
  detailedMode: 'Detailed',
  scanReceipt: 'Scan Receipt',
  scanLabel: 'Scan Nutrition Label',
  whosEating: "Who's eating?",
  solo: 'Solo (1×)',
  together: 'Together (2×)',
  guests: 'Guests',
  searchPlaceholder: 'Search English or Persian (e.g. chicken, مرغ, شیر)...',
  addItem: 'Add Item',
  allZones: 'All',
  usePortion: 'Use',
  finishedBtn: 'Finished',
  restockBtn: 'Restock',
  outOfStock: 'Out of stock',
  buyThisWeekend: 'Buy this weekend',
  borderline: 'Borderline',
  goodNextWeek: 'Good till next week',
  expiringSoon: 'Use soon',
  weekendTripTitle: 'Weekend Shopping Forecast',
  noTripNeeded: 'You are stocked! No essential trip needed this weekend.',
  addSmartSuggestions: 'Sync Forecast',
  completeTrip: 'Finish Trip & Restock',
  essential: 'Essential',
  optional: 'Optional',
  generatePlan: 'Generate Smart Plan',
  cookingTools: 'Available Cooking Tools',
  ingredientFocus: 'Ingredient Preferences (from your stock)',
  cookedBtn: 'Cooked & Deduct',
  cookedDone: 'Cooked',
  addRecipe: 'Add Meal',
  storesManager: 'Your Grocery Stores',
  velocityInsights: 'Learned Consumption Rhythm',
} as const;
