export type StorageZone = 'freezer' | 'fridge' | 'pantry';

export type FoodCategory =
  | 'protein'
  | 'dairy'
  | 'produce'
  | 'beverages'
  | 'grains'
  | 'condiments'
  | 'spices'
  | 'pantry_staple'
  | 'snacks'
  | 'prepared';

export type TrackingMode = 'portioned' | 'continuous';

export type ContinuousTrackingStyle = 'measured' | 'level_only';

export type MeasureUnit =
  | 'L'
  | 'ml'
  | 'gal'
  | 'fl_oz'
  | 'kg'
  | 'g'
  | 'lb'
  | 'oz'
  | 'cups';

export type CookingTool =
  | 'air_fryer'
  | 'oven'
  | 'pan'
  | 'grill'
  | 'instant_pot'
  | 'slow_cooker'
  | 'blender'
  | 'no_cook';

export type EffortLevel = 'exhausted' | 'normal' | 'batch_prep';

export type UILanguage = 'en' | 'fa';

export type UIMode = 'simple' | 'detailed';

export type EatingMode = 'solo' | 'together' | 'guests';

export interface MicronutrientProfile {
  ironPct?: number; // % Daily Value per portion
  calciumPct?: number; // % DV
  potassiumPct?: number; // % DV
  vitaminDPct?: number; // % DV
  vitaminCPct?: number; // % DV
  omega3?: boolean;
  highlights?: string[];
}

export interface NutritionFacts {
  servingSizeLabel?: string;
  calories: number;
  protein: number; // g
  sugar: number; // g
  fiber: number; // g
  carbs: number; // g
  fat: number; // g
  sodiumMg?: number;
  micronutrients: MicronutrientProfile;
  source?: 'manual' | 'label_scan' | 'estimated';
  lastScannedAt?: string;
}

export interface Store {
  id: string;
  name: string;
  alias?: string;
  color: string;
  notes?: string;
}

export interface InventoryItem {
  id: string;
  name: string;
  alias: string;
  category: FoodCategory;
  zone: StorageZone;
  trackingMode: TrackingMode;
  /** For continuous items: 'measured' tracks a container size/unit (e.g. 4 L milk); 'level_only' tracks simple fill level (e.g. jar of spice). */
  continuousStyle?: ContinuousTrackingStyle;
  /** Total capacity of one full container (e.g. 4 for 4L milk, 750 for 750g yogurt). */
  containerSize?: number;
  /** Measurement unit for containerSize (e.g. 'L', 'ml', 'g', 'kg'). */
  containerUnit?: MeasureUnit;
  totalPortions: number;
  remainingPortions: number;
  portionLabel: string;
  packDescription: string;
  proteinPerPortion: number;
  nutrition?: NutritionFacts;
  defaultStoreId: string;
  storePurchaseCounts: Record<string, number>;
  avgDaysPerFullPack: number;
  cycleCount: number;
  lastRestockedAt: string;
  lastUsedAt?: string;
  expiresAt?: string;
  notes?: string;
  autoAddOnEmpty: boolean;
}

export type ShoppingReason =
  | 'finished'
  | 'forecast_weekend'
  | 'forecast_midweek'
  | 'manual_from_kitchen'
  | 'manual'
  | 'meal_plan';

export interface ShoppingItem {
  id: string;
  inventoryItemId?: string;
  name: string;
  alias?: string;
  storeId: string;
  quantityLabel: string;
  targetPortions: number;
  targetZone: StorageZone;
  priority: 'essential' | 'optional';
  reason: ShoppingReason;
  note?: string; // e.g., "Projected to run out mid-week next week (~Wed)" or "Added manually — have 5/8 left"
  checked: boolean;
  addedAt: string;
}

export interface UsageEvent {
  id: string;
  itemId: string;
  type: 'use_portion' | 'finished' | 'restock' | 'level_adjust';
  deltaPortions: number;
  storeId?: string;
  timestamp: string;
  actor: string;
}

export interface RecipeIngredient {
  itemId?: string;
  name: string;
  alias?: string;
  portionsNeeded: number; // per 1 person serving
  portionLabel?: string;
}

export interface MealRecipe {
  id: string;
  name: string;
  alias?: string;
  cuisine: string; // Flexible so users can add custom cuisines anytime (e.g. 'Persian', 'Western', 'Fusion', 'Mediterranean')
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  prepMinutes: number;
  effort: EffortLevel;
  tools: CookingTool[];
  proteinGrams: number;
  sugarGrams: number;
  fiberGrams: number;
  calories: number;
  micronutrients: string[];
  nutritionHighlight: string;
  nutritionEstimated?: boolean;
  ingredients: RecipeIngredient[];
  quickSteps: string[];
  isFavorite: boolean;
}

export interface PlannedMeal {
  id: string;
  dayIndex: number;
  dayLabel: string;
  slot: 'lunch' | 'dinner';
  recipeId: string;
  servings: number; // 1 = solo, 2 = together, 3+ = guests
  cooked: boolean;
  source: 'library' | 'ai_suggested';
  reasonNote: string;
}

export interface ReceiptParsedItem {
  id: string;
  rawReceiptText: string;
  matchedItemId?: string;
  name: string;
  alias: string;
  portionsToAdd: number;
  portionLabel: string;
  packDescription: string;
  zone: StorageZone;
  category: FoodCategory;
  trackingMode?: TrackingMode;
  price?: number;
  included: boolean;
  confidence: 'high' | 'medium' | 'new';
}

export interface HouseholdSettings {
  language: UILanguage;
  uiMode: UIMode;
  eatingMode: EatingMode;
  guestCount: number;
  shoppingDay: number; // 0 = Sun, 6 = Sat
  forecastHorizonDays: number; // Default 10 days for Consumption Forecast Radar
  cuisines: string[]; // User-extensible list of cuisines
  dailyProteinTarget: number;
  dailySugarLimit: number;
  householdSize: number;
  activeUser: 'Ali' | 'Keemia';
  defaultTools: CookingTool[];
  householdName: string;
}

export interface KitchenState {
  items: InventoryItem[];
  stores: Store[];
  shoppingList: ShoppingItem[];
  events: UsageEvent[];
  recipes: MealRecipe[];
  weeklyPlan: PlannedMeal[];
  settings: HouseholdSettings;
}

export type ForecastVerdict =
  | 'out'
  | 'buy_this_weekend'
  | 'runs_out_next_week'
  | 'borderline'
  | 'good_until_next_week';

export interface ItemForecast {
  stockPercent: number;
  stockState: 'good' | 'low' | 'critical';
  estimatedDaysLeft: number;
  daysUntilNextShopping: number;
  daysUntilFollowingShopping: number;
  verdict: ForecastVerdict;
  runOutDayLabel: string;
  forecastDescription: string;
  daysUntilExpiry: number | null;
  expiringSoon: boolean;
  learnedStoreId: string;
  dailyBurnRate: number;
}
