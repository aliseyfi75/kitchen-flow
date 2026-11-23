import {
  CookingTool,
  EffortLevel,
  InventoryItem,
  MealRecipe,
  PlannedMeal,
  RecipeIngredient,
} from '../types/kitchen';
import { computeItemForecast } from './forecasting';

export interface MealPlanRequest {
  days: number; // 0 = Single Meal, 3, 5, or 7 days
  singleSlot?: 'lunch' | 'dinner';
  effort: EffortLevel;
  selectedTools: CookingTool[];
  mustUseItemIds: string[];
  excludedItemIds: string[];
  cuisineFilter: string; // 'all' or any cuisine name
  dailyProteinTarget: number;
  shoppingDay: number;
}

export interface ScoredRecipe {
  recipe: MealRecipe;
  score: number;
  matchedCount: number;
  totalIngredients: number;
  allIngredientsInStock: boolean;
  missingIngredients: { name: string; alias?: string; itemId?: string }[];
  usesExpiringItems: string[];
  usesMustUseItems: string[];
  toolsCompatible: boolean;
  reasonNote: string;
}

export interface EstimatedMealNutrition {
  calories: number;
  proteinGrams: number;
  sugarGrams: number;
  fiberGrams: number;
  micronutrients: string[];
  toolAdjustmentNote: string;
}

/**
 * Estimates meal nutrition automatically from its ingredients (using live inventory NutritionFacts)
 * plus cooking-tool oil/prep adjustments, so users never have to guess macros manually.
 */
export function estimateRecipeNutrition(
  ingredients: RecipeIngredient[],
  tools: CookingTool[],
  items: InventoryItem[]
): EstimatedMealNutrition {
  const itemMap = new Map(items.map((i) => [i.id, i]));
  let calories = 0;
  let protein = 0;
  let sugar = 0;
  let fiber = 0;
  const microSet = new Set<string>();
  let hasExplicitOil = false;

  for (const ing of ingredients) {
    const qty = Math.max(0.1, Number(ing.portionsNeeded) || 1);
    const inv = ing.itemId ? itemMap.get(ing.itemId) : undefined;
    const lowerName = `${ing.name} ${ing.alias || ''}`.toLowerCase();

    if (lowerName.includes('oil') || lowerName.includes('butter') || lowerName.includes('روغن')) {
      hasExplicitOil = true;
    }

    if (inv?.nutrition) {
      calories += inv.nutrition.calories * qty;
      protein += inv.nutrition.protein * qty;
      sugar += inv.nutrition.sugar * qty;
      fiber += inv.nutrition.fiber * qty;
      if (inv.nutrition.micronutrients.omega3) microSet.add('Omega-3');
      if ((inv.nutrition.micronutrients.ironPct ?? 0) >= 8) microSet.add('Iron');
      if ((inv.nutrition.micronutrients.calciumPct ?? 0) >= 8) microSet.add('Calcium');
      if ((inv.nutrition.micronutrients.vitaminDPct ?? 0) >= 10) microSet.add('Vitamin D');
      if ((inv.nutrition.micronutrients.vitaminCPct ?? 0) >= 15) microSet.add('Vitamin C');
      if ((inv.nutrition.micronutrients.potassiumPct ?? 0) >= 8) microSet.add('Potassium');
      for (const h of inv.nutrition.micronutrients.highlights ?? []) {
        microSet.add(h);
      }
    } else if (inv) {
      // Fallback when inventory item doesn't have full nutrition facts scanned yet
      protein += inv.proteinPerPortion * qty;
      if (inv.category === 'spices') {
        calories += 5 * qty;
      } else if (inv.category === 'condiments') {
        calories += 45 * qty;
      } else {
        calories += (inv.proteinPerPortion * 5 + 60) * qty;
      }
      if (inv.category === 'produce') {
        fiber += 2.5 * qty;
        sugar += 2 * qty;
        microSet.add('Vitamin C');
      } else if (inv.category === 'grains') {
        calories += 140 * qty;
        fiber += 1.5 * qty;
      } else if (inv.category === 'beverages') {
        sugar += 4 * qty;
      }
    } else {
      // Newly typed ingredient not yet in inventory — smart keyword heuristics
      if (/chicken|turkey|beef|lamb|fish|salmon|tuna|shrimp|steak|مرغ|گوشت|ماهی|میگو/.test(lowerName)) {
        calories += 220 * qty;
        protein += 34 * qty;
        microSet.add('B12');
      } else if (/egg|تخم/.test(lowerName)) {
        calories += 145 * qty;
        protein += 12 * qty;
        microSet.add('Choline');
      } else if (/yogurt|cheese|milk|paneer|ماست|پنیر|شیر/.test(lowerName)) {
        calories += 110 * qty;
        protein += 10 * qty;
        sugar += 4 * qty;
        microSet.add('Calcium');
      } else if (/rice|pasta|bread|oat|quinoa|potato|برنج|نان|سیب‌زمینی|ماکارونی/.test(lowerName)) {
        calories += 190 * qty;
        protein += 5 * qty;
        fiber += 2 * qty;
      } else if (/lentil|bean|chickpea|tofu|عدس|لوبیا|نخود/.test(lowerName)) {
        calories += 160 * qty;
        protein += 12 * qty;
        fiber += 6 * qty;
        microSet.add('Iron');
      } else if (/spinach|broccoli|herb|salad|tomato|pepper|onion|zucchini|سبزی|اسفناج|گوجه|فلفل/.test(lowerName)) {
        calories += 30 * qty;
        protein += 2 * qty;
        sugar += 2 * qty;
        fiber += 2.5 * qty;
        microSet.add('Vitamin C');
      } else {
        calories += 75 * qty;
        protein += 3 * qty;
        sugar += 1.5 * qty;
        fiber += 1 * qty;
      }
    }
  }

  // Cooking tool oil / prep adjustment (if user didn't explicitly add olive oil)
  let toolAdjustmentNote = 'Calculated directly from ingredient nutrition';
  if (!hasExplicitOil && ingredients.length > 0) {
    if (tools.includes('pan')) {
      calories += 55;
      toolAdjustmentNote = 'Includes ~1/2 tbsp pan cooking oil estimate (+55 kcal)';
    } else if (tools.includes('oven')) {
      calories += 35;
      toolAdjustmentNote = 'Includes light roasting oil estimate (+35 kcal)';
    } else if (tools.includes('air_fryer')) {
      calories += 15;
      toolAdjustmentNote = 'Includes light Air Fryer oil spray (+15 kcal)';
    } else if (tools.includes('grill')) {
      calories += 15;
      toolAdjustmentNote = 'Includes light grill brush/marinade (+15 kcal)';
    } else if (tools.includes('no_cook')) {
      toolAdjustmentNote = 'No cooking oil added (No-Cook)';
    }
  }

  return {
    calories: Math.round(calories),
    proteinGrams: Math.round(protein),
    sugarGrams: Math.round(sugar),
    fiberGrams: Math.round(fiber),
    micronutrients: Array.from(microSet).slice(0, 6),
    toolAdjustmentNote,
  };
}

export function scoreRecipeAgainstInventory(
  recipe: MealRecipe,
  items: InventoryItem[],
  request: MealPlanRequest
): ScoredRecipe {
  const itemMap = new Map(items.map((i) => [i.id, i]));
  const excludedSet = new Set(request.excludedItemIds);
  const mustUseSet = new Set(request.mustUseItemIds);

  let matchedCount = 0;
  const missingIngredients: { name: string; alias?: string; itemId?: string }[] = [];
  const usesExpiringItems: string[] = [];
  const usesMustUseItems: string[] = [];
  let hitsExcluded = false;

  for (const ing of recipe.ingredients) {
    if (ing.itemId && excludedSet.has(ing.itemId)) {
      hitsExcluded = true;
    }

    const invItem = ing.itemId ? itemMap.get(ing.itemId) : undefined;
    const hasEnough =
      invItem &&
      (invItem.trackingMode === 'continuous'
        ? invItem.remainingPortions > 0
        : invItem.remainingPortions >= Math.min(ing.portionsNeeded, 0.5));
    if (invItem && hasEnough) {
      matchedCount += 1;
      const fc = computeItemForecast(invItem, request.shoppingDay);
      if (fc.expiringSoon) {
        usesExpiringItems.push(invItem.name);
      }
      if (mustUseSet.has(invItem.id)) {
        usesMustUseItems.push(invItem.name);
      }
    } else if (!ing.itemId) {
      // Unlinked pantry spice/seasoning — check if a name match exists in inventory
      const byName = items.find(
        (it) =>
          it.name.toLowerCase() === ing.name.toLowerCase() &&
          (it.trackingMode === 'continuous'
            ? it.remainingPortions > 0
            : it.remainingPortions >= Math.min(ing.portionsNeeded, 0.5))
      );
      if (byName) {
        matchedCount += 1;
      } else {
        missingIngredients.push({ name: ing.name, alias: ing.alias });
      }
    } else {
      missingIngredients.push({
        name: ing.name,
        alias: ing.alias,
        itemId: ing.itemId,
      });
    }
  }

  const allIngredientsInStock =
    recipe.ingredients.length > 0 && missingIngredients.length === 0;

  const toolsCompatible =
    request.selectedTools.length === 0 ||
    recipe.tools.some((tool) => request.selectedTools.includes(tool));

  const strictToolsMatch =
    request.selectedTools.length === 0 ||
    recipe.tools.every((tool) => request.selectedTools.includes(tool));

  const coverageRatio =
    recipe.ingredients.length > 0 ? matchedCount / recipe.ingredients.length : 1;

  let score = coverageRatio * 55;
  score += Math.min(recipe.proteinGrams, 65) * 0.55;
  score += usesExpiringItems.length * 18;
  score += usesMustUseItems.length * 24;

  if (request.effort === 'exhausted') {
    if (recipe.effort === 'exhausted' || recipe.prepMinutes <= 20) score += 20;
    else if (recipe.prepMinutes > 35) score -= 22;
  } else if (request.effort === 'batch_prep') {
    if (recipe.effort === 'batch_prep') score += 16;
  }

  if (strictToolsMatch) score += 12;
  else if (!toolsCompatible) score -= 40;

  if (
    request.cuisineFilter !== 'all' &&
    recipe.cuisine.toLowerCase() !== request.cuisineFilter.toLowerCase()
  ) {
    score -= 28;
  }

  if (hitsExcluded) {
    score -= 80;
  }

  if (recipe.isFavorite) {
    score += 4;
  }

  const reasons: string[] = [];
  if (usesMustUseItems.length > 0) {
    reasons.push(`Uses your pick: ${usesMustUseItems.join(', ')}`);
  }
  if (usesExpiringItems.length > 0) {
    reasons.push(`Rescues soon-expiring: ${usesExpiringItems.join(', ')}`);
  }
  if (recipe.proteinGrams >= 40) {
    reasons.push(`High protein (${recipe.proteinGrams}g)`);
  }
  if (recipe.prepMinutes <= 20) {
    reasons.push(`Quick ${recipe.prepMinutes}m prep`);
  }
  if (missingIngredients.length === 0) {
    reasons.push('100% in stock');
  } else {
    reasons.push(`Needs ${missingIngredients.length} item(s)`);
  }

  return {
    recipe,
    score: Math.round(score),
    matchedCount,
    totalIngredients: recipe.ingredients.length,
    allIngredientsInStock,
    missingIngredients,
    usesExpiringItems,
    usesMustUseItems,
    toolsCompatible,
    reasonNote: reasons.slice(0, 2).join(' • '),
  };
}

/**
 * Generates either a Single Meal (days === 0) or a multi-day (3 / 5 / 7 day) meal plan.
 */
export function generateSmartWeeklyPlan(
  recipes: MealRecipe[],
  items: InventoryItem[],
  request: MealPlanRequest,
  defaultServingsForSingle = 2
): PlannedMeal[] {
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const scored = recipes
    .filter((r) => r.mealType === 'lunch' || r.mealType === 'dinner')
    .map((r) => scoreRecipeAgainstInventory(r, items, request))
    .filter((s) => s.score > -20)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return [];

  // Single Meal mode!
  if (request.days === 0) {
    const slot = request.singleSlot ?? 'dinner';
    const pick = scored[0];
    return [
      {
        id: `plan-single-${Date.now()}-${pick.recipe.id}`,
        dayIndex: 0,
        dayLabel: 'Next Meal',
        slot,
        recipeId: pick.recipe.id,
        servings: defaultServingsForSingle,
        cooked: false,
        source: pick.recipe.isFavorite ? 'library' : 'ai_suggested',
        reasonNote: pick.reasonNote,
      },
    ];
  }

  const plan: PlannedMeal[] = [];
  const usedCount = new Map<string, number>();

  for (let d = 0; d < request.days; d++) {
    const slots: ('lunch' | 'dinner')[] = ['lunch', 'dinner'];
    for (const slot of slots) {
      const candidates = [...scored].sort((a, b) => {
        const penaltyA = (usedCount.get(a.recipe.id) || 0) * 28;
        const penaltyB = (usedCount.get(b.recipe.id) || 0) * 28;
        const slotBonusA = a.recipe.mealType === slot ? 6 : 0;
        const slotBonusB = b.recipe.mealType === slot ? 6 : 0;
        return b.score + slotBonusB - penaltyB - (a.score + slotBonusA - penaltyA);
      });

      const pick = candidates[0];
      if (!pick) continue;

      usedCount.set(pick.recipe.id, (usedCount.get(pick.recipe.id) || 0) + 1);
      plan.push({
        id: `plan-${d}-${slot}-${pick.recipe.id}`,
        dayIndex: d,
        dayLabel: dayNames[d % 7],
        slot,
        recipeId: pick.recipe.id,
        servings: slot === 'lunch' ? 1 : 2,
        cooked: false,
        source: pick.recipe.isFavorite ? 'library' : 'ai_suggested',
        reasonNote: pick.reasonNote,
      });
    }
  }

  return plan;
}

export function buildGeminiPromptPreview(
  items: InventoryItem[],
  request: MealPlanRequest
): string {
  const stocked = items
    .filter((i) => i.remainingPortions > 0 && !request.excludedItemIds.includes(i.id))
    .map((i) => ({
      name: `${i.name}${i.alias ? ` (${i.alias})` : ''}`,
      zone: i.zone,
      remaining: `${i.remainingPortions} x ${i.portionLabel}`,
      proteinPerPortion: `${i.proteinPerPortion}g`,
      sugarPerPortion: `${i.nutrition?.sugar ?? 0}g`,
      mustUse: request.mustUseItemIds.includes(i.id),
      expiresAt: i.expiresAt ?? null,
    }));

  return JSON.stringify(
    {
      endpoint: 'POST /functions/v1/gemini-meal-planner (Supabase Edge Function)',
      auth: 'Bearer <Authenticated Household Member JWT>',
      preferences: {
        scope: request.days === 0 ? 'single_meal' : `${request.days}_days`,
        effort: request.effort,
        tools: request.selectedTools,
        dailyProteinTargetGrams: request.dailyProteinTarget,
        cuisine: request.cuisineFilter,
        bilingualOutput: 'English + Persian alias',
      },
      stockedInventory: stocked,
    },
    null,
    2
  );
}
