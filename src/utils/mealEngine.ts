import {
  CookingTool,
  EffortLevel,
  InventoryItem,
  MealRecipe,
  PlannedMeal,
} from '../types/kitchen';
import { computeItemForecast } from './forecasting';

export interface MealPlanRequest {
  days: number;
  effort: EffortLevel;
  selectedTools: CookingTool[];
  mustUseItemIds: string[];
  excludedItemIds: string[];
  cuisineFilter: 'all' | 'persian' | 'western' | 'fusion';
  dailyProteinTarget: number;
  shoppingDay: number;
}

export interface ScoredRecipe {
  recipe: MealRecipe;
  score: number;
  matchedCount: number;
  totalIngredients: number;
  missingIngredients: { name: string; alias?: string; itemId?: string }[];
  usesExpiringItems: string[];
  usesMustUseItems: string[];
  toolsCompatible: boolean;
  reasonNote: string;
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
    if (invItem && invItem.remainingPortions >= Math.min(ing.portionsNeeded, 0.5)) {
      matchedCount += 1;
      const fc = computeItemForecast(invItem, request.shoppingDay);
      if (fc.expiringSoon) {
        usesExpiringItems.push(invItem.name);
      }
      if (mustUseSet.has(invItem.id)) {
        usesMustUseItems.push(invItem.name);
      }
    } else if (!ing.itemId) {
      // Pantry seasoning / spice assumed available
      matchedCount += 1;
    } else {
      missingIngredients.push({
        name: ing.name,
        alias: ing.alias,
        itemId: ing.itemId,
      });
    }
  }

  const toolsCompatible =
    request.selectedTools.length === 0 ||
    recipe.tools.every((tool) => request.selectedTools.includes(tool)) ||
    recipe.tools.some((tool) => request.selectedTools.includes(tool));

  const strictToolsMatch =
    request.selectedTools.length === 0 ||
    recipe.tools.every((tool) => request.selectedTools.includes(tool));

  const coverageRatio =
    recipe.ingredients.length > 0 ? matchedCount / recipe.ingredients.length : 1;

  let score = coverageRatio * 55;
  // Protein bonus (protein-maxing!)
  score += Math.min(recipe.proteinGrams, 65) * 0.55;
  // Expiring ingredients urgency bonus
  score += usesExpiringItems.length * 18;
  // Explicitly requested ingredients bonus
  score += usesMustUseItems.length * 24;

  // Effort alignment
  if (request.effort === 'exhausted') {
    if (recipe.effort === 'exhausted' || recipe.prepMinutes <= 20) score += 20;
    else if (recipe.prepMinutes > 35) score -= 22;
  } else if (request.effort === 'batch_prep') {
    if (recipe.effort === 'batch_prep') score += 16;
  }

  // Tool match bonus/penalty
  if (strictToolsMatch) score += 12;
  else if (!toolsCompatible) score -= 40;

  // Cuisine match
  if (request.cuisineFilter !== 'all' && recipe.cuisine !== request.cuisineFilter) {
    score -= 28;
  }

  // Excluded item penalty
  if (hitsExcluded) {
    score -= 80;
  }

  // Favorite small boost
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
    missingIngredients,
    usesExpiringItems,
    usesMustUseItems,
    toolsCompatible,
    reasonNote: reasons.slice(0, 2).join(' • '),
  };
}

/**
 * Generates a balanced multi-day meal plan (Lunch + Dinner) from available recipes,
 * avoiding back-to-back repetition while maximizing inventory use & daily protein.
 */
export function generateSmartWeeklyPlan(
  recipes: MealRecipe[],
  items: InventoryItem[],
  request: MealPlanRequest
): PlannedMeal[] {
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const scored = recipes
    .filter((r) => r.mealType === 'lunch' || r.mealType === 'dinner')
    .map((r) => scoreRecipeAgainstInventory(r, items, request))
    .filter((s) => s.score > -20)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return [];

  const plan: PlannedMeal[] = [];
  const usedCount = new Map<string, number>();

  for (let d = 0; d < request.days; d++) {
    const slots: ('lunch' | 'dinner')[] = ['lunch', 'dinner'];
    for (const slot of slots) {
      // Pick highest-scoring recipe with variety penalty for already-scheduled recipes
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
        servings: slot === 'lunch' ? 1 : 2, // Lunch defaults to Solo (1x), Dinner to Together (2x) — 1-tap editable!
        cooked: false,
        source: pick.recipe.isFavorite ? 'library' : 'ai_suggested',
        reasonNote: pick.reasonNote,
      });
    }
  }

  return plan;
}

/**
 * Builds the exact structured JSON payload that Phase 2 will send to the
 * Supabase Edge Function -> Gemini API (keeping the API key server-side).
 */
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
      mustUse: request.mustUseItemIds.includes(i.id),
      expiresAt: i.expiresAt ?? null,
    }));

  return JSON.stringify(
    {
      endpoint: 'POST /functions/v1/gemini-meal-planner (Supabase Edge Function)',
      auth: 'Bearer <Authenticated Household Member JWT>',
      preferences: {
        days: request.days,
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
