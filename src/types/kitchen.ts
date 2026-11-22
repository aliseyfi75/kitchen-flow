export type StorageZone = 'freezer' | 'fridge' | 'pantry';

export type FoodCategory =
  | 'protein'
  | 'dairy'
  | 'produce'
  | 'grains'
  | 'pantry_staple'
  | 'snacks';

export type TrackingMode = 'portioned' | 'continuous';

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
  totalPortions: number;
  remainingPortions: number;
  portionLabel: string;
  packDescription: string;
  proteinPerPortion: number;
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

export type ShoppingReason = 'finished' | 'forecast_weekend' | 'manual' | 'meal_plan';

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
  portionsNeeded: number;
}

export interface MealRecipe {
  id: string;
  name: string;
  alias?: string;
  cuisine: 'persian' | 'western' | 'fusion';
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  prepMinutes: number;
  effort: EffortLevel;
  tools: CookingTool[];
  proteinGrams: number;
  calories: number;
  nutritionHighlight: string;
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
  cooked: boolean;
  source: 'library' | 'ai_suggested';
  reasonNote: string;
}

export interface HouseholdSettings {
  language: UILanguage;
  shoppingDay: number; // 0 = Sun, 6 = Sat
  dailyProteinTarget: number;
  householdSize: number;
  activeUser: 'Ali' | 'Partner';
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

export type ForecastVerdict = 'out' | 'buy_this_weekend' | 'borderline' | 'good_until_next_week';

export interface ItemForecast {
  stockPercent: number;
  stockState: 'good' | 'low' | 'critical';
  estimatedDaysLeft: number;
  daysUntilNextShopping: number;
  daysUntilFollowingShopping: number;
  verdict: ForecastVerdict;
  daysUntilExpiry: number | null;
  expiringSoon: boolean;
  learnedStoreId: string;
  dailyBurnRate: number;
}
