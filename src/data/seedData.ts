import { KitchenState } from '../types/kitchen';

export const LEGACY_DEMO_ITEM_IDS = new Set([
  'item-chicken',
  'item-beef',
  'item-salmon',
  'item-milk',
  'item-eggs',
  'item-yogurt',
  'item-spinach',
  'item-broccoli',
  'item-tomatoes',
  'item-sabzi',
  'item-rice',
  'item-olive-oil',
  'item-whey',
]);

export const LEGACY_DEMO_RECIPE_IDS = new Set([
  'rec-jujeh-af',
  'rec-salmon-oven',
  'rec-spinach-frittata',
  'rec-beef-bowl',
  'rec-chicken-broccoli-af',
  'rec-oven-chicken-herb',
  'rec-protein-yogurt',
]);

export const LEGACY_DEMO_SHOPPING_IDS = new Set([
  'shop-yogurt',
  'shop-milk',
  'shop-tomatoes',
  'shop-sangak',
]);

export function createCleanState(): KitchenState {
  return {
    stores: [
      {
        id: 'store-costco',
        name: 'Costco',
        alias: 'کاستکو',
        color: '#DC2626',
      },
      {
        id: 'store-superstore',
        name: 'Superstore',
        alias: 'سوپراستور',
        color: '#2563EB',
      },
      {
        id: 'store-persian',
        name: 'Persian Market',
        alias: 'سوپرمارکت ایرانی',
        color: '#0F766E',
      },
    ],
    items: [],
    shoppingList: [],
    events: [],
    recipes: [],
    weeklyPlan: [],
    settings: {
      language: 'en',
      uiMode: 'simple',
      eatingMode: 'together',
      guestCount: 4,
      shoppingDay: 6, // Saturday
      forecastHorizonDays: 10,
      cuisines: ['Persian', 'Western', 'Fusion', 'Mediterranean', 'Asian'],
      dailyProteinTarget: 130,
      dailySugarLimit: 36,
      householdSize: 2,
      activeUser: 'Ali',
      defaultTools: ['air_fryer', 'oven', 'pan'],
      householdName: 'Ali & Keemia Kitchen',
    },
  };
}

/**
 * Strips any legacy prototype demo rows if a household signed in before demo data was cleared,
 * while preserving any real user-created items, stores, or recipes.
 */
export function stripLegacyDemoData(state: KitchenState): { cleaned: KitchenState; changed: boolean } {
  const realItems = state.items.filter((i) => !LEGACY_DEMO_ITEM_IDS.has(i.id));
  const realShopping = state.shoppingList.filter(
    (s) => !LEGACY_DEMO_SHOPPING_IDS.has(s.id) && (!s.inventoryItemId || !LEGACY_DEMO_ITEM_IDS.has(s.inventoryItemId))
  );
  const realRecipes = state.recipes.filter((r) => !LEGACY_DEMO_RECIPE_IDS.has(r.id));
  const realRecipeIds = new Set(realRecipes.map((r) => r.id));
  const realPlan = state.weeklyPlan.filter((m) => realRecipeIds.has(m.recipeId));
  const realEvents = state.events.filter((e) => !LEGACY_DEMO_ITEM_IDS.has(e.itemId));

  const changed =
    realItems.length !== state.items.length ||
    realShopping.length !== state.shoppingList.length ||
    realRecipes.length !== state.recipes.length ||
    realPlan.length !== state.weeklyPlan.length ||
    realEvents.length !== state.events.length;

  return {
    changed,
    cleaned: {
      ...state,
      items: realItems,
      shoppingList: realShopping,
      recipes: realRecipes,
      weeklyPlan: realPlan,
      events: realEvents,
    },
  };
}
