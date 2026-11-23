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
  source: 'gemini_audio' | 'gemini_text' | 'gemini_compat' | 'local_fallback';
}

interface BilingualConcept {
  id: string;
  broadGroup: string;
  en: string;
  fa: string;
  category: FoodCategory;
  defaultZone: StorageZone;
  trackingMode: TrackingMode;
  terms: string[];
}

/**
 * Rich bilingual English <-> Persian ingredient ontology used for:
 * 1. Matching spoken English or Persian ingredients to existing kitchen items in either language.
 * 2. Translating missing spoken ingredients into clean EN + FA names with smart category/zone defaults.
 */
const BILINGUAL_CONCEPTS: BilingualConcept[] = [
  // Oils & Condiments
  {
    id: 'olive_oil',
    broadGroup: 'oil',
    en: 'Olive Oil',
    fa: 'روغن زیتون',
    category: 'condiments',
    defaultZone: 'pantry',
    trackingMode: 'continuous',
    terms: ['olive oil', 'extra virgin olive oil', 'evoo', 'روغن زیتون', 'روغن زیتون فرابکر'],
  },
  {
    id: 'avocado_oil',
    broadGroup: 'oil',
    en: 'Avocado Oil',
    fa: 'روغن آووکادو',
    category: 'condiments',
    defaultZone: 'pantry',
    trackingMode: 'continuous',
    terms: ['avocado oil', 'روغن آووکادو'],
  },
  {
    id: 'cooking_oil',
    broadGroup: 'oil',
    en: 'Cooking Oil',
    fa: 'روغن',
    category: 'condiments',
    defaultZone: 'pantry',
    trackingMode: 'continuous',
    terms: ['oil', 'cooking oil', 'vegetable oil', 'canola oil', 'روغن', 'روغن مایع', 'روغن سرخ کردنی', 'روغن پخت'],
  },
  {
    id: 'soy_sauce',
    broadGroup: 'soy_sauce',
    en: 'Soy Sauce',
    fa: 'سس سویا',
    category: 'condiments',
    defaultZone: 'fridge',
    trackingMode: 'continuous',
    terms: ['soy sauce', 'tamari', 'سس سویا', 'سویا سس'],
  },
  {
    id: 'pomegranate_molasses',
    broadGroup: 'pomegranate_molasses',
    en: 'Pomegranate Molasses',
    fa: 'رب انار',
    category: 'condiments',
    defaultZone: 'fridge',
    trackingMode: 'continuous',
    terms: ['pomegranate molasses', 'pomegranate paste', 'رب انار'],
  },
  {
    id: 'tomato_paste',
    broadGroup: 'tomato_paste',
    en: 'Tomato Paste',
    fa: 'رب گوجه',
    category: 'condiments',
    defaultZone: 'fridge',
    trackingMode: 'continuous',
    terms: ['tomato paste', 'رب', 'رب گوجه', 'رب گوجه فرنگی', 'رب گوجه‌فرنگی'],
  },
  {
    id: 'tahini',
    broadGroup: 'tahini',
    en: 'Tahini',
    fa: 'ارده',
    category: 'condiments',
    defaultZone: 'pantry',
    trackingMode: 'continuous',
    terms: ['tahini', 'ارده'],
  },
  {
    id: 'honey',
    broadGroup: 'honey',
    en: 'Honey',
    fa: 'عسل',
    category: 'condiments',
    defaultZone: 'pantry',
    trackingMode: 'continuous',
    terms: ['honey', 'عسل'],
  },

  // Proteins
  {
    id: 'chicken_breast',
    broadGroup: 'chicken',
    en: 'Chicken Breast',
    fa: 'سینه مرغ',
    category: 'protein',
    defaultZone: 'freezer',
    trackingMode: 'portioned',
    terms: ['chicken breast', 'سینه مرغ', 'فیله مرغ'],
  },
  {
    id: 'chicken',
    broadGroup: 'chicken',
    en: 'Chicken',
    fa: 'مرغ',
    category: 'protein',
    defaultZone: 'freezer',
    trackingMode: 'portioned',
    terms: ['chicken', 'chicken thigh', 'chicken thighs', 'مرغ', 'ران مرغ', 'جوجه', 'گوشت مرغ'],
  },
  {
    id: 'ground_beef',
    broadGroup: 'beef',
    en: 'Ground Beef',
    fa: 'گوشت چرخ‌کرده',
    category: 'protein',
    defaultZone: 'freezer',
    trackingMode: 'portioned',
    terms: ['ground beef', 'minced beef', 'lean ground beef', 'گوشت چرخ کرده', 'گوشت چرخ‌کرده', 'چرخ کرده', 'چرخ‌کرده'],
  },
  {
    id: 'stew_beef',
    broadGroup: 'beef',
    en: 'Stew Beef',
    fa: 'گوشت خورشتی',
    category: 'protein',
    defaultZone: 'freezer',
    trackingMode: 'portioned',
    terms: [
      'stew beef',
      'beef chunks',
      'diced beef',
      'beef',
      'steak',
      'گوشت تیکه ای',
      'گوشت تیکه‌ای',
      'گوشت تکه ای',
      'گوشت تکه‌ای',
      'گوشت خورشتی',
      'گوشت قورمه',
      'گوشت قرمه',
      'گوشت گوساله',
      'گوشت قرمز',
      'گوشت',
      'راسته',
    ],
  },
  {
    id: 'lamb',
    broadGroup: 'beef',
    en: 'Lamb',
    fa: 'گوشت گوسفندی',
    category: 'protein',
    defaultZone: 'freezer',
    trackingMode: 'portioned',
    terms: ['lamb', 'lamb stew', 'گوشت بره', 'گوشت گوسفند', 'گوشت گوسفندی', 'ماهیچه'],
  },
  {
    id: 'salmon',
    broadGroup: 'fish',
    en: 'Salmon Fillet',
    fa: 'ماهی سالمون',
    category: 'protein',
    defaultZone: 'freezer',
    trackingMode: 'portioned',
    terms: ['salmon', 'salmon fillet', 'salmon fillets', 'سالمون', 'ماهی سالمون', 'فیله سالمون', 'فیله ماهی سالمون'],
  },
  {
    id: 'fish',
    broadGroup: 'fish',
    en: 'Fish',
    fa: 'ماهی',
    category: 'protein',
    defaultZone: 'freezer',
    trackingMode: 'portioned',
    terms: ['fish', 'tuna', 'cod', 'tilapia', 'ماهی', 'فیله ماهی', 'تن ماهی'],
  },
  {
    id: 'shrimp',
    broadGroup: 'shrimp',
    en: 'Shrimp',
    fa: 'میگو',
    category: 'protein',
    defaultZone: 'freezer',
    trackingMode: 'portioned',
    terms: ['shrimp', 'prawns', 'میگو'],
  },
  {
    id: 'turkey',
    broadGroup: 'turkey',
    en: 'Turkey',
    fa: 'بوقلمون',
    category: 'protein',
    defaultZone: 'freezer',
    trackingMode: 'portioned',
    terms: ['turkey', 'ground turkey', 'بوقلمون', 'گوشت بوقلمون'],
  },

  // Dairy & Eggs
  {
    id: 'eggs',
    broadGroup: 'eggs',
    en: 'Eggs',
    fa: 'تخم‌مرغ',
    category: 'dairy',
    defaultZone: 'fridge',
    trackingMode: 'portioned',
    terms: ['egg', 'eggs', 'تخم مرغ', 'تخم‌مرغ'],
  },
  {
    id: 'milk',
    broadGroup: 'milk',
    en: 'Milk',
    fa: 'شیر',
    category: 'dairy',
    defaultZone: 'fridge',
    trackingMode: 'continuous',
    terms: ['milk', '2% milk', 'whole milk', 'skim milk', 'شیر', 'شیر ۲ درصد', 'شیر کم چرب', 'شیر پرچرب'],
  },
  {
    id: 'oat_milk',
    broadGroup: 'milk',
    en: 'Oat Milk',
    fa: 'شیر جو دوسر',
    category: 'beverages',
    defaultZone: 'fridge',
    trackingMode: 'continuous',
    terms: ['oat milk', 'almond milk', 'soy milk', 'شیر جو دوسر', 'شیر بادام'],
  },
  {
    id: 'greek_yogurt',
    broadGroup: 'yogurt',
    en: 'Greek Yogurt',
    fa: 'ماست یونانی',
    category: 'dairy',
    defaultZone: 'fridge',
    trackingMode: 'continuous',
    terms: ['greek yogurt', 'yogurt', 'ماست', 'ماست یونانی', 'ماست چکیده', 'ماست همزده'],
  },
  {
    id: 'feta_cheese',
    broadGroup: 'cheese',
    en: 'Feta Cheese',
    fa: 'پنیر فتا',
    category: 'dairy',
    defaultZone: 'fridge',
    trackingMode: 'continuous',
    terms: ['feta', 'feta cheese', 'پنیر فتا', 'پنیر صبحانه'],
  },
  {
    id: 'cheese',
    broadGroup: 'cheese',
    en: 'Cheese',
    fa: 'پنیر',
    category: 'dairy',
    defaultZone: 'fridge',
    trackingMode: 'continuous',
    terms: ['cheese', 'mozzarella', 'cheddar', 'parmesan', 'cottage cheese', 'پنیر', 'پنیر پیتزا', 'پنیر چدار', 'پنیر موزارلا'],
  },
  {
    id: 'butter',
    broadGroup: 'butter',
    en: 'Butter',
    fa: 'کره',
    category: 'dairy',
    defaultZone: 'fridge',
    trackingMode: 'continuous',
    terms: ['butter', 'کره'],
  },
  {
    id: 'cream',
    broadGroup: 'cream',
    en: 'Cream',
    fa: 'خامه',
    category: 'dairy',
    defaultZone: 'fridge',
    trackingMode: 'continuous',
    terms: ['cream', 'heavy cream', 'sour cream', 'خامه'],
  },

  // Produce & Herbs
  {
    id: 'ghormeh_herbs',
    broadGroup: 'herbs',
    en: 'Ghormeh Sabzi Herbs',
    fa: 'سبزی قورمه',
    category: 'produce',
    defaultZone: 'freezer',
    trackingMode: 'continuous',
    terms: [
      'ghormeh sabzi herbs',
      'fried herbs',
      'frozen herbs',
      'سبزی قورمه',
      'سبزی قرمه',
      'سبزی خورشتی',
      'سبزی سرخ شده',
      'سبزی سرخ شده آماده',
      'سبزی سرخ شده آماده فریزری',
      'سبزی سرخ شده فریزری',
      'سبزی فریزری',
    ],
  },
  {
    id: 'fresh_herbs',
    broadGroup: 'herbs',
    en: 'Fresh Persian Herbs',
    fa: 'سبزی تازه',
    category: 'produce',
    defaultZone: 'fridge',
    trackingMode: 'continuous',
    terms: [
      'herbs',
      'fresh herbs',
      'persian herbs',
      'sabzi',
      'parsley',
      'cilantro',
      'dill',
      'mint',
      'سبزی',
      'سبزی خوردن',
      'سبزی تازه',
      'جعفری',
      'گشنیز',
      'شوید',
      'تره',
      'نعنا',
      'شنبلیله',
    ],
  },
  {
    id: 'spinach',
    broadGroup: 'spinach',
    en: 'Baby Spinach',
    fa: 'اسفناج',
    category: 'produce',
    defaultZone: 'fridge',
    trackingMode: 'continuous',
    terms: ['spinach', 'baby spinach', 'اسفناج', 'اسفناج تازه'],
  },
  {
    id: 'mushroom',
    broadGroup: 'mushroom',
    en: 'Mushrooms',
    fa: 'قارچ',
    category: 'produce',
    defaultZone: 'fridge',
    trackingMode: 'continuous',
    terms: ['mushroom', 'mushrooms', 'قارچ'],
  },
  {
    id: 'onion',
    broadGroup: 'onion',
    en: 'Onion',
    fa: 'پیاز',
    category: 'produce',
    defaultZone: 'pantry',
    trackingMode: 'portioned',
    terms: ['onion', 'onions', 'پیاز'],
  },
  {
    id: 'garlic',
    broadGroup: 'garlic',
    en: 'Garlic',
    fa: 'سیر',
    category: 'produce',
    defaultZone: 'pantry',
    trackingMode: 'portioned',
    terms: ['garlic', 'سیر'],
  },
  {
    id: 'tomato',
    broadGroup: 'tomato',
    en: 'Tomatoes',
    fa: 'گوجه‌فرنگی',
    category: 'produce',
    defaultZone: 'fridge',
    trackingMode: 'portioned',
    terms: ['tomato', 'tomatoes', 'cherry tomatoes', 'گوجه', 'گوجه فرنگی', 'گوجه‌فرنگی'],
  },
  {
    id: 'potato',
    broadGroup: 'potato',
    en: 'Potatoes',
    fa: 'سیب‌زمینی',
    category: 'produce',
    defaultZone: 'pantry',
    trackingMode: 'portioned',
    terms: ['potato', 'potatoes', 'sweet potato', 'سیب زمینی', 'سیب‌زمینی'],
  },
  {
    id: 'eggplant',
    broadGroup: 'eggplant',
    en: 'Eggplant',
    fa: 'بادمجان',
    category: 'produce',
    defaultZone: 'fridge',
    trackingMode: 'portioned',
    terms: ['eggplant', 'aubergine', 'بادمجان', 'بادمجون'],
  },
  {
    id: 'zucchini',
    broadGroup: 'zucchini',
    en: 'Zucchini',
    fa: 'کدو سبز',
    category: 'produce',
    defaultZone: 'fridge',
    trackingMode: 'portioned',
    terms: ['zucchini', 'کدو', 'کدو سبز'],
  },
  {
    id: 'bell_pepper',
    broadGroup: 'bell_pepper',
    en: 'Bell Pepper',
    fa: 'فلفل دلمه‌ای',
    category: 'produce',
    defaultZone: 'fridge',
    trackingMode: 'portioned',
    terms: ['bell pepper', 'bell peppers', 'sweet pepper', 'فلفل دلمه', 'فلفل دلمه ای', 'فلفل دلمه‌ای'],
  },
  {
    id: 'broccoli',
    broadGroup: 'broccoli',
    en: 'Broccoli',
    fa: 'بروکلی',
    category: 'produce',
    defaultZone: 'fridge',
    trackingMode: 'continuous',
    terms: ['broccoli', 'بروکلی', 'کلم بروکلی'],
  },
  {
    id: 'carrot',
    broadGroup: 'carrot',
    en: 'Carrots',
    fa: 'هویج',
    category: 'produce',
    defaultZone: 'fridge',
    trackingMode: 'portioned',
    terms: ['carrot', 'carrots', 'هویج'],
  },
  {
    id: 'cucumber',
    broadGroup: 'cucumber',
    en: 'Cucumber',
    fa: 'خیار',
    category: 'produce',
    defaultZone: 'fridge',
    trackingMode: 'portioned',
    terms: ['cucumber', 'cucumbers', 'خیار'],
  },
  {
    id: 'avocado',
    broadGroup: 'avocado',
    en: 'Avocado',
    fa: 'آووکادو',
    category: 'produce',
    defaultZone: 'fridge',
    trackingMode: 'portioned',
    terms: ['avocado', 'avocados', 'آووکادو'],
  },
  {
    id: 'lemon',
    broadGroup: 'lemon',
    en: 'Lemon / Lime',
    fa: 'لیمو',
    category: 'produce',
    defaultZone: 'fridge',
    trackingMode: 'portioned',
    terms: ['lemon', 'lemons', 'lime', 'lemon juice', 'لیمو', 'لیموترش', 'آبلیمو', 'آب لیمو'],
  },
  {
    id: 'dried_lime',
    broadGroup: 'dried_lime',
    en: 'Dried Lime (Limoo Amani)',
    fa: 'لیمو عمانی',
    category: 'spices',
    defaultZone: 'pantry',
    trackingMode: 'continuous',
    terms: ['dried lime', 'limoo amani', 'persian lime', 'لیمو عمانی', 'لیموعمانی'],
  },
  {
    id: 'banana',
    broadGroup: 'banana',
    en: 'Banana',
    fa: 'موز',
    category: 'produce',
    defaultZone: 'pantry',
    trackingMode: 'portioned',
    terms: ['banana', 'bananas', 'موز'],
  },
  {
    id: 'berries',
    broadGroup: 'berries',
    en: 'Berries',
    fa: 'توت و بری',
    category: 'produce',
    defaultZone: 'fridge',
    trackingMode: 'continuous',
    terms: ['berries', 'blueberries', 'strawberries', 'raspberries', 'توت فرنگی', 'بلوبری'],
  },

  // Grains, Legumes & Pantry
  {
    id: 'rice',
    broadGroup: 'rice',
    en: 'Basmati Rice',
    fa: 'برنج',
    category: 'grains',
    defaultZone: 'pantry',
    trackingMode: 'continuous',
    terms: ['rice', 'basmati', 'basmati rice', 'برنج', 'برنج باسماتی', 'برنج ایرانی'],
  },
  {
    id: 'pasta',
    broadGroup: 'pasta',
    en: 'Pasta',
    fa: 'ماکارونی',
    category: 'grains',
    defaultZone: 'pantry',
    trackingMode: 'continuous',
    terms: ['pasta', 'spaghetti', 'noodles', 'ماکارونی', 'پاستا', 'رشته'],
  },
  {
    id: 'oats',
    broadGroup: 'oats',
    en: 'Rolled Oats',
    fa: 'جو دوسر',
    category: 'grains',
    defaultZone: 'pantry',
    trackingMode: 'continuous',
    terms: ['oats', 'oatmeal', 'rolled oats', 'جو دوسر', 'جو'],
  },
  {
    id: 'bread',
    broadGroup: 'bread',
    en: 'Bread',
    fa: 'نان',
    category: 'grains',
    defaultZone: 'pantry',
    trackingMode: 'portioned',
    terms: ['bread', 'sangak', 'lavash', 'pita', 'tortilla', 'نان', 'سنگک', 'لواش', 'تافتون', 'بربری'],
  },
  {
    id: 'kidney_beans',
    broadGroup: 'beans',
    en: 'Kidney Beans',
    fa: 'لوبیا قرمز',
    category: 'pantry_staple',
    defaultZone: 'pantry',
    trackingMode: 'portioned',
    terms: ['kidney beans', 'red beans', 'beans', 'pinto beans', 'لوبیا', 'لوبیا قرمز', 'لوبیا چیتی', 'لوبیا سفید'],
  },
  {
    id: 'split_peas',
    broadGroup: 'lentils',
    en: 'Yellow Split Peas',
    fa: 'لپه',
    category: 'pantry_staple',
    defaultZone: 'pantry',
    trackingMode: 'continuous',
    terms: ['split peas', 'yellow split peas', 'لپه'],
  },
  {
    id: 'lentils',
    broadGroup: 'lentils',
    en: 'Lentils',
    fa: 'عدس',
    category: 'pantry_staple',
    defaultZone: 'pantry',
    trackingMode: 'continuous',
    terms: ['lentil', 'lentils', 'عدس'],
  },
  {
    id: 'chickpeas',
    broadGroup: 'chickpeas',
    en: 'Chickpeas',
    fa: 'نخود',
    category: 'pantry_staple',
    defaultZone: 'pantry',
    trackingMode: 'portioned',
    terms: ['chickpea', 'chickpeas', 'garbanzo', 'نخود'],
  },

  // Spices & Snacks
  {
    id: 'saffron',
    broadGroup: 'saffron',
    en: 'Saffron',
    fa: 'زعفران',
    category: 'spices',
    defaultZone: 'pantry',
    trackingMode: 'continuous',
    terms: ['saffron', 'زعفران', 'زعفرون'],
  },
  {
    id: 'turmeric',
    broadGroup: 'turmeric',
    en: 'Turmeric',
    fa: 'زردچوبه',
    category: 'spices',
    defaultZone: 'pantry',
    trackingMode: 'continuous',
    terms: ['turmeric', 'زردچوبه'],
  },
  {
    id: 'salt',
    broadGroup: 'salt',
    en: 'Salt',
    fa: 'نمک',
    category: 'spices',
    defaultZone: 'pantry',
    trackingMode: 'continuous',
    terms: ['salt', 'sea salt', 'نمک'],
  },
  {
    id: 'black_pepper',
    broadGroup: 'black_pepper',
    en: 'Black Pepper',
    fa: 'فلفل سیاه',
    category: 'spices',
    defaultZone: 'pantry',
    trackingMode: 'continuous',
    terms: ['black pepper', 'pepper', 'فلفل سیاه', 'فلفل'],
  },
  {
    id: 'barberries',
    broadGroup: 'barberries',
    en: 'Barberries (Zereshk)',
    fa: 'زرشک',
    category: 'spices',
    defaultZone: 'freezer',
    trackingMode: 'continuous',
    terms: ['barberries', 'zereshk', 'زرشک'],
  },
  {
    id: 'walnuts',
    broadGroup: 'walnuts',
    en: 'Walnuts',
    fa: 'گردو',
    category: 'snacks',
    defaultZone: 'pantry',
    trackingMode: 'continuous',
    terms: ['walnut', 'walnuts', 'گردو'],
  },
  {
    id: 'whey',
    broadGroup: 'whey',
    en: 'Whey Protein',
    fa: 'پروتئین وی',
    category: 'snacks',
    defaultZone: 'pantry',
    trackingMode: 'continuous',
    terms: ['whey', 'whey protein', 'protein powder', 'پروتئین وی', 'پروتئین'],
  },
  {
    id: 'peanut_butter',
    broadGroup: 'peanut_butter',
    en: 'Peanut Butter',
    fa: 'کره بادام‌زمینی',
    category: 'snacks',
    defaultZone: 'pantry',
    trackingMode: 'continuous',
    terms: ['peanut butter', 'almond butter', 'کره بادام زمینی', 'کره بادام‌زمینی'],
  },
];

// Common Persian & Western dishes for clean bilingual title extraction in offline fallback
const KNOWN_DISHES: { patterns: string[]; en: string; fa: string; cuisine: string }[] = [
  { patterns: ['قورمه سبزی', 'قرمه سبزی', 'قورمه‌سبزی', 'ghormeh sabzi'], en: 'Ghormeh Sabzi', fa: 'قورمه‌سبزی', cuisine: 'Persian' },
  { patterns: ['قیمه بادمجان', 'قیمه بادمجون', 'gheymeh bademjan'], en: 'Gheymeh Bademjan', fa: 'قیمه بادمجان', cuisine: 'Persian' },
  { patterns: ['خورشت قیمه', 'قیمه', 'gheymeh'], en: 'Khoresh Gheymeh', fa: 'خورشت قیمه', cuisine: 'Persian' },
  { patterns: ['فسنجون', 'فسنجان', 'fesenjan', 'fesenjoon'], en: 'Khoresh Fesenjan', fa: 'خورشت فسنجان', cuisine: 'Persian' },
  { patterns: ['زرشک پلو', 'زرشک پلو با مرغ', 'zereshk polo'], en: 'Zereshk Polo ba Morgh', fa: 'زرشک‌پلو با مرغ', cuisine: 'Persian' },
  { patterns: ['جوجه کباب', 'جوجه‌کباب', 'jujeh kabab', 'joojeh'], en: 'Jujeh Kabab', fa: 'جوجه‌کباب', cuisine: 'Persian' },
  { patterns: ['کباب کوبیده', 'کوبیده', 'koobideh'], en: 'Kabab Koobideh', fa: 'کباب کوبیده', cuisine: 'Persian' },
  { patterns: ['کباب تابه‌ای', 'کباب تابه ای', 'kabab tabei'], en: 'Kabab Tabei', fa: 'کباب تابه‌ای', cuisine: 'Persian' },
  { patterns: ['لوبیا پلو', 'lubia polo'], en: 'Lubia Polo', fa: 'لوبیاپلو', cuisine: 'Persian' },
  { patterns: ['عدس پلو', 'adas polo'], en: 'Adas Polo', fa: 'عدس‌پلو', cuisine: 'Persian' },
  { patterns: ['سبزی پلو با ماهی', 'سبزی پلو', 'sabzi polo'], en: 'Sabzi Polo', fa: 'سبزی‌پلو', cuisine: 'Persian' },
  { patterns: ['کتلت', 'kotlet'], en: 'Persian Kotlet', fa: 'کتلت', cuisine: 'Persian' },
  { patterns: ['کوکو سبزی', 'kuku sabzi'], en: 'Kuku Sabzi', fa: 'کوکو سبزی', cuisine: 'Persian' },
  { patterns: ['کوکو سیب زمینی', 'کوکو سیب‌زمینی', 'kuku sibzamini'], en: 'Potato Kuku', fa: 'کوکو سیب‌زمینی', cuisine: 'Persian' },
  { patterns: ['میرزا قاسمی', 'mirza ghasemi'], en: 'Mirza Ghasemi', fa: 'میرزا قاسمی', cuisine: 'Persian' },
  { patterns: ['کشک بادمجان', 'کشک بادمجون', 'kashke bademjan'], en: 'Kashke Bademjan', fa: 'کشک بادمجان', cuisine: 'Persian' },
  { patterns: ['آش رشته', 'ash reshteh'], en: 'Ash Reshteh', fa: 'آش رشته', cuisine: 'Persian' },
  { patterns: ['عدسی', 'adasi'], en: 'Persian Lentil Soup (Adasi)', fa: 'عدسی', cuisine: 'Persian' },
  { patterns: ['ماکارونی', 'persian pasta'], en: 'Persian Makaroni', fa: 'ماکارونی', cuisine: 'Persian' },
  { patterns: ['املت', 'omelette', 'omelet'], en: 'Omelette', fa: 'املت', cuisine: 'Western' },
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
  // and "فلفل دلمه" (bell pepper) doesn't collide with "فلفل سیاه" (black pepper)
  out = out
    .replace(/تخم\s+مرغ/g, 'تخم_مرغ')
    .replace(/فلفل\s+دلمه\s*ای?/g, 'فلفل_دلمه')
    .replace(/فلفل\s+سیاه/g, 'فلفل_سیاه')
    .replace(/روغن\s+زیتون/g, 'روغن_زیتون')
    .replace(/روغن\s+آووکادو/g, 'روغن_آووکادو')
    .replace(/رب\s+انار/g, 'رب_انار')
    .replace(/رب\s+گوجه(?:\s+فرنگی)?/g, 'رب_گوجه')
    .replace(/لیمو\s+عمانی/g, 'لیمو_عمانی')
    .replace(/گوشت\s+چرخ\s*کرده/g, 'گوشت_چرخ_کرده')
    .replace(/سینه\s+مرغ/g, 'سینه_مرغ')
    .replace(/سیب\s+زمینی/g, 'سیب_زمینی');
  out = out.replace(/[^a-z0-9_\u0600-\u06FF.\s/-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return out;
}

function findMatchingConcepts(normalized: string): BilingualConcept[] {
  const padded = ` ${normalized} `;
  const hits: { concept: BilingualConcept; specificity: number }[] = [];

  for (const concept of BILINGUAL_CONCEPTS) {
    let bestTermLen = 0;
    for (const term of concept.terms) {
      const cleanTerm = normalizeBilingualText(term);
      if (!cleanTerm) continue;
      if (normalized === cleanTerm || padded.includes(` ${cleanTerm} `)) {
        if (cleanTerm.length > bestTermLen) {
          bestTermLen = cleanTerm.length;
        }
      }
    }
    if (bestTermLen > 0) {
      hits.push({ concept, specificity: bestTermLen });
    }
  }

  return hits.sort((a, b) => b.specificity - a.specificity).map((h) => h.concept);
}

function tokenize(text: string): string[] {
  return normalizeBilingualText(text)
    .split(/[\s/-]+/)
    .filter((w) => w.length >= 2);
}

/**
 * Matches a spoken/extracted ingredient (English or Farsi) against the household's live kitchen inventory,
 * bridging Persian <-> English seamlessly (e.g. "روغن" -> "Olive Oil", "گوشت تیکه‌ای" -> "Stew Beef" or "Beef").
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
  const queryConcepts = findMatchingConcepts(queryCombined);
  const queryConceptIds = new Set(queryConcepts.map((c) => c.id));
  const queryBroadGroups = new Set(queryConcepts.map((c) => c.broadGroup));

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

    // Cross-language concept matching (Persian <-> English!)
    if (queryConcepts.length > 0) {
      const itemConcepts = findMatchingConcepts(itemCombined);
      for (const ic of itemConcepts) {
        if (queryConceptIds.has(ic.id)) {
          // Exact same bilingual concept (e.g. "روغن زیتون" <-> "Extra Virgin Olive Oil")
          score = Math.max(score, 0.94);
          break;
        }
        if (queryBroadGroups.has(ic.broadGroup)) {
          // Same broad family (e.g. "روغن" <-> "Olive Oil", "گوشت تیکه‌ای" <-> "Lean Ground Beef", "سبزی سرخ شده" <-> "Fresh Persian Herbs")
          score = Math.max(score, 0.78);
        }
      }
    }

    // Whole-word substring containment (e.g. "milk" -> "2% Milk")
    if (
      (queryNameNorm.length >= 3 && ` ${itemNameNorm} `.includes(` ${queryNameNorm} `)) ||
      (itemNameNorm.length >= 3 && ` ${queryNameNorm} `.includes(` ${itemNameNorm} `)) ||
      (queryAliasNorm.length >= 3 && ` ${itemAliasNorm} `.includes(` ${queryAliasNorm} `))
    ) {
      score = Math.max(score, 0.82);
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

const UNIT_TO_ENGLISH: Record<string, string> = {
  گرم: 'g',
  کیلوگرم: 'kg',
  کیلو: 'kg',
  لیتر: 'L',
  'میلی‌لیتر': 'ml',
  'میلی لیتر': 'ml',
  پیمانه: 'cup',
  لیوان: 'cup',
  'قاشق غذاخوری': 'tbsp',
  'قاشق چایخوری': 'tsp',
  قاشق: 'tbsp',
  عدد: 'piece',
  تا: 'piece',
  بسته: 'pack',
  مشت: 'handful',
  حبه: 'clove',
  ورق: 'slice',
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

  // Strip conversational fillers & trailing verbs (e.g. "ما ۲ قاشق روغن می‌خوایم")
  working = working
    .replace(
      /^(and|with|plus|also|some|we\s+need|i\s+need|you\s+need|add|use|و|با|کمی|مقداری|ما|به|حدود|تقریبا|تقریباً|یه\s+کم|یکم)\s+/gi,
      ''
    )
    .replace(
      /\s+(?:می‌خوایم|میخوایم|می‌خواهیم|میخواهیم|لازم\s+داریم|نیاز\s+داریم|می‌ریزیم|میریزیم|اضافه\s+می‌کنیم|اضافه\s+میکنیم|داریم|نیاز\s+داره|لازم\s+داره|می‌شه|میشه)\s*$/gi,
      ''
    )
    .trim();

  let qty = 1;
  let unit = '';

  // 1. Numeric leading value (Unicode-safe lookahead so Persian units like گرم/قاشق/تا/مشت match cleanly!)
  const numMatch = working.match(
    /^(\d+(?:\.\d+)?|\d+\s*\/\s*\d+)\s*(?:(kg|kilograms?|g|grams?|ml|l|liters?|litres?|oz|lbs?|cups?|tbsp|tablespoons?|tsp|teaspoons?|slices?|pieces?|fillets?|bags?|cans?|packs?|handfuls?|bunches?|cloves?|گرم|کیلوگرم|کیلو|لیتر|میلی‌لیتر|میلی\s+لیتر|پیمانه|لیوان|قاشق\s+غذاخوری|قاشق\s+چایخوری|قاشق|عدد|تا|بسته|مشت|حبه|ورق)(?=\s|$))?\s*(?:of\s+)?/i
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
    // 2. Word numbers ("half a cup", "نصف لیوان", "دو تا", "یک قاشق")
    const firstWord = working.split(/\s+/)[0]?.toLowerCase() ?? '';
    const wordVal = PERSIAN_NUMBER_WORDS[firstWord] ?? ENGLISH_NUMBER_WORDS[firstWord];
    if (wordVal !== undefined) {
      qty = wordVal;
      working = working.slice(firstWord.length).trim();
      const unitMatch = working.match(
        /^(?:an?\s+)?(cups?|tbsp|tablespoons?|tsp|teaspoons?|slices?|pieces?|packs?|handfuls?|bunches?|cloves?|cans?|پیمانه|لیوان|قاشق\s+غذاخوری|قاشق\s+چایخوری|قاشق|عدد|تا|بسته|مشت|حبه)(?=\s|$)\s*(?:of\s+)?/i
      );
      if (unitMatch) {
        unit = unitMatch[1].trim();
        working = working.slice(unitMatch[0].length).trim();
      }
    }
  }

  // Convert gram/ml amounts into sensible portion count (e.g., "250g beef" -> 1 × "250g")
  let portionsNeeded = qty;
  const normalizedUnitKey = unit.toLowerCase().replace(/\s+/g, ' ');
  const mappedUnit = UNIT_TO_ENGLISH[normalizedUnitKey] || unit;
  let portionLabel = mappedUnit || '1 portion';

  if (/^(g|gram|grams|ml)$/.test(mappedUnit.toLowerCase()) && qty >= 15) {
    portionsNeeded = 1;
    portionLabel = `${qty}${mappedUnit.toLowerCase().startsWith('m') ? 'ml' : 'g'}`;
  } else if (mappedUnit) {
    portionLabel = mappedUnit;
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

function detectZoneHintFromText(text: string): StorageZone | null {
  const lower = normalizeBilingualText(text);
  if (/فریزری|فریزر|یخ\s*زده|frozen|freezer/.test(lower)) return 'freezer';
  if (/کنسرو|خشک|canned|dried|pantry/.test(lower)) return 'pantry';
  if (/تازه|یخچالی|fresh|fridge/.test(lower)) return 'fridge';
  return null;
}

function isPersianText(text: string): boolean {
  return /[\u0600-\u06FF]/.test(text);
}

/**
 * Splits a natural unpunctuated spoken description (Persian or English) into:
 * 1. Dish title
 * 2. Individual ingredient clauses
 */
function splitSpokenFoodAndIngredients(rawTranscript: string): {
  rawTitle: string;
  clauses: string[];
} {
  const cleaned = rawTranscript
    .replace(/[۰-۹٠-٩]/g, (ch) => PERSIAN_DIGITS[ch] || ch)
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\u200c/g, ' ')
    .trim();

  let titlePart = '';
  let ingredientsPart = cleaned;

  // 1. Explicit colon / semicolon (e.g. "املت اسفناج: ۳ تا تخم مرغ...")
  const colonIdx = cleaned.search(/[:：؛;]/);
  if (colonIdx > 0 && colonIdx < 80) {
    titlePart = cleaned.slice(0, colonIdx).trim();
    ingredientsPart = cleaned.slice(colonIdx + 1).trim();
  } else {
    // 2. Conversational Persian intro ("برای درست کردن قورمه سبزی ما ۲ قاشق روغن می‌خوایم...")
    const faIntroMatch = cleaned.match(
      /^(?:برای\s+(?:درست\s+کردن|پختن|پخت|تهیه|ساختن|آماده\s+کردن)\s+|می\s*خوام\s+|میخواهم\s+|غذای\s+)(.+?)(?:\s+(?:درست\s+کنم|بپزم|اضافه\s+کنم))?\s+(?:(?:ما\s+)?(?:لازم\s+داریم|نیاز\s+داریم|می\s*خوایم|میخواهیم|شامل|مواد\s+لازم|با)|ما\s+(?=\d|یک|یه|دو|سه|چهار|پنج|نصف|نیم|ربع)|(?=\d+\s*(?:قاشق|گرم|کیلو|پیمانه|لیوان|عدد|تا|بسته|مشت|حبه|لیتر|g|kg|ml|l|cup|tbsp|tsp)))\s*(.+)$/i
    );

    // 3. Conversational English intro ("To make ghormeh sabzi we need 2 tbsp oil ...")
    const enIntroMatch = cleaned.match(
      /^(?:to\s+make|for\s+making|for|making|how\s+to\s+make|i\s+want\s+to\s+(?:make|add|cook)|add(?:\s+a)?\s+(?:new\s+)?(?:food|meal))?\s*(.{2,55}?)\s+(?:we\s+need|i\s+need|you\s+need|needs|with|using|made\s+with|ingredients|takes|has)\s+(.+)$/i
    );

    if (faIntroMatch) {
      titlePart = faIntroMatch[1].trim();
      ingredientsPart = faIntroMatch[2].trim();
    } else if (enIntroMatch) {
      titlePart = enIntroMatch[1].trim();
      ingredientsPart = enIntroMatch[2].trim();
    } else {
      const firstSep = cleaned.search(/[,،\n]/);
      if (firstSep > 0 && firstSep < 60) {
        titlePart = cleaned.slice(0, firstSep).trim();
        ingredientsPart = cleaned.slice(firstSep + 1).trim();
      } else {
        // Last resort: split right before the first quantity number if there's text before it
        const firstQtyIdx = cleaned.search(/\s+\d+\s*(?:قاشق|گرم|کیلو|پیمانه|لیوان|عدد|تا|بسته|مشت|حبه|لیتر|g|kg|ml|l|cup|tbsp|tsp|oz|lb)/i);
        if (firstQtyIdx > 2 && firstQtyIdx < 60) {
          titlePart = cleaned.slice(0, firstQtyIdx).trim();
          ingredientsPart = cleaned.slice(firstQtyIdx).trim();
        } else {
          titlePart = cleaned.slice(0, 45).trim();
        }
      }
    }
  }

  // Strip conversational wrapper words from title
  titlePart = titlePart
    .replace(
      /^(i\s+want\s+to\s+add|to\s+make|for\s+making|for|add\s+a\s+new\s+food|add\s+food|add\s+meal|new\s+meal|new\s+food|برای\s+(?:درست\s+کردن|پختن|پخت|تهیه|ساختن)|می\s*خوام|میخواهم|اضافه\s+کن|یه\s+غذا|یک\s+غذا|غذای\s+جدید)\s+/i,
      ''
    )
    .replace(
      /\s+(?:ما|اضافه\s+کنم|اضافه\s+کن|درست\s+کنم|بپزم|توی\s+\S+|در\s+\S+|\d+\s*دقیقه)$/gi,
      ''
    )
    .trim();

  // Turn conversational verb phrases inside the ingredient stream into hard separators!
  let stream = ingredientsPart
    .replace(
      /\s+(?:می\s*خوایم|میخواهیم|لازم\s+داریم|نیاز\s+داریم|می\s*ریزیم|میریزیم|اضافه\s+می\s*کنیم|اضافه\s+میکنیم|استفاده\s+می\s*کنیم|نیاز\s+داره|لازم\s+داره|و\s+همینطور|همینطور|بعدش|بعد)\s*/gi,
      ' | '
    )
    .replace(
      /\s+(?:we\s+need|i\s+need|you\s+need|then\s+add|and\s+add|also\s+add|plus)\s+/gi,
      ' | '
    );

  // Also split before inline numeric OR spoken-word quantities in unpunctuated speech
  // (e.g., "200g chicken 1 cup broccoli 2 tbsp soy sauce" or "نصف لیوان لپه دو قاشق رب گوجه")
  stream = stream.replace(
    /([^\s|,،\n])\s+(?=(?:\d+(?:\.\d+)?|\d+\/\d+|نصف|نیم|ربع|یک|یه|دو|دوتا|سه|چهار|پنج|شش|half|quarter|one|two|three|four|five|six)\s+(?:a\s+|an\s+)?(?:kg|kilograms?|g|grams?|ml|l|liters?|litres?|oz|lbs?|cups?|tbsp|tablespoons?|tsp|teaspoons?|slices?|pieces?|fillets?|bags?|cans?|packs?|handfuls?|bunches?|cloves?|گرم|کیلوگرم|کیلو|لیتر|میلی\s*لیتر|پیمانه|لیوان|قاشق|عدد|تا|بسته|مشت|حبه|ورق)(?=\s|$)|\d+(?:g|kg|ml|l|oz|lb)\b)/gi,
    '$1 | '
  );

  // Split on explicit delimiters, pipe separators, and conjunctions ("و" / "and")
  const rawClauses = stream
    .split(/\s*[|،,\n]+\s*|\s+(?:and|و)\s+/i)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2)
    .filter(
      (s) =>
        !/^(\d+\s*(min|mins|minutes|دقیقه|ساعت)|in\s+(the\s+)?(air\s*fryer|oven|pan|instant\s*pot|blender)|توی\s+(ایرفرایر|فر|تابه|زودپز|قابلمه))/i.test(
          normalizeBilingualText(s)
        )
    );

  return { rawTitle: titlePart, clauses: rawClauses };
}

/**
 * Smart offline / local-demo fallback parser for natural conversational English & Farsi voice transcripts.
 * Handles unpunctuated speech, extracts clean EN/FA dish name + ingredient amounts, matches existing kitchen
 * items across languages, and fills bilingual EN/FA defaults for missing items.
 */
export function parseVoiceFoodLocally(
  rawTranscript: string,
  inventory: InventoryItem[],
  defaultStoreId: string,
  cuisines: string[]
): VoiceParsedFood {
  const transcript = rawTranscript.trim();
  const hasPersian = isPersianText(transcript);
  const { rawTitle, clauses } = splitSpokenFoodAndIngredients(transcript);

  // Match known Persian/Western dish names to populate both English Name and Persian Alias cleanly
  const normTitle = normalizeBilingualText(rawTitle || transcript);
  const matchedDish = KNOWN_DISHES.find((d) =>
    d.patterns.some((p) => normTitle.includes(normalizeBilingualText(p)))
  );

  const foodName = matchedDish
    ? matchedDish.en
    : rawTitle || (hasPersian ? 'غذای جدید' : 'New Voice Meal');
  const foodAlias = matchedDish
    ? matchedDish.fa
    : hasPersian && rawTitle && rawTitle !== foodName
    ? rawTitle
    : '';

  const ingredients: VoiceParsedIngredient[] = clauses.map((clause, idx) => {
    const { qty, unitLabel, cleanedName } = parseLeadingQuantityAndUnit(clause);
    const zoneHint = detectZoneHintFromText(clause);
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

    // Not in kitchen — enrich with bilingual concept ontology so EN name + FA alias + category + zone are accurate!
    const matchedConcepts = findMatchingConcepts(normalizeBilingualText(cleanedName));
    const concept = matchedConcepts[0];
    const inferred = inferProductDefaultsFromText(concept ? `${concept.en} ${cleanedName}` : cleanedName);
    const cat = concept?.category ?? inferred?.category ?? 'produce';
    const prof = getCategoryProfile(cat);
    const trackingMode = concept?.trackingMode ?? inferred?.trackingMode ?? prof.defaultTrackingMode;
    const zone = zoneHint ?? concept?.defaultZone ?? inferred?.zone ?? prof.defaultZone;
    const measured = parseMeasuredQuantity(clause);

    const displayName = concept
      ? concept.en
      : isPersianText(cleanedName)
      ? cleanedName
      : cleanedName.charAt(0).toUpperCase() + cleanedName.slice(1);
    const displayAlias = concept
      ? isPersianText(cleanedName)
        ? cleanedName
        : concept.fa
      : isPersianText(cleanedName)
      ? cleanedName
      : '';

    return {
      id: `ving-${idx}-${Date.now()}`,
      spokenText: clause,
      matchedItemId: undefined,
      matchConfidence: 'new',
      name: displayName,
      alias: displayAlias,
      portionsNeeded: qty,
      portionLabel: unitLabel !== '1 portion' ? unitLabel : prof.defaultPortionLabel,
      suggestedCategory: cat,
      suggestedZone: zone,
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

  const defaultCuisine = matchedDish
    ? matchedDish.cuisine
    : hasPersian
    ? cuisines.find((c) => c.toLowerCase() === 'persian') || cuisines[0] || 'Persian'
    : cuisines[0] || 'Western';

  return {
    transcript,
    name: foodName,
    alias: foodAlias,
    cuisine: defaultCuisine,
    mealType: detectMealType(transcript),
    prepMinutes: detectPrepMinutes(transcript),
    tools: detectToolsFromTranscript(transcript),
    quickSteps: ['Prepare ingredients and cook until done.'],
    ingredients,
    source: 'local_fallback',
  };
}
