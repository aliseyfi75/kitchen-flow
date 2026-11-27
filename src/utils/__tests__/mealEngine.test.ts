import { describe, expect, it } from 'vitest';
import {
  estimateRecipeNutrition,
  generateSmartWeeklyPlan,
  scoreRecipeAgainstInventory,
} from '../mealEngine';
import { createTourDemoState } from '../../data/tourDemoData';

describe('mealEngine', () => {
  it('estimates nutrition from inventory nutrition facts plus cooking tool oil adjustment', () => {
    const demo = createTourDemoState();
    const chicken = demo.items.find((i) => i.id === 'tour-chicken')!;
    const result = estimateRecipeNutrition(
      [{ itemId: chicken.id, name: chicken.name, portionsNeeded: 1 }],
      ['air_fryer'],
      demo.items
    );

    expect(result.proteinGrams).toBe(46);
    expect(result.calories).toBe(215 + 15); // air fryer light oil spray
  });

  it('boosts recipes using Must-Use and soon-expiring ingredients and penalizes excluded ones', () => {
    const demo = createTourDemoState();
    const jujeh = demo.recipes.find((r) => r.id === 'tour-rec-jujeh')!;

    const baseReq = {
      days: 0,
      effort: 'exhausted' as const,
      selectedTools: ['air_fryer', 'oven'] as ('air_fryer' | 'oven')[],
      mustUseItemIds: [] as string[],
      excludedItemIds: [] as string[],
      cuisineFilter: 'all',
      dailyProteinTarget: 130,
      shoppingDay: 6,
    };

    const normal = scoreRecipeAgainstInventory(jujeh, demo.items, baseReq);
    const boosted = scoreRecipeAgainstInventory(jujeh, demo.items, {
      ...baseReq,
      mustUseItemIds: ['tour-chicken'],
    });
    const excluded = scoreRecipeAgainstInventory(jujeh, demo.items, {
      ...baseReq,
      excludedItemIds: ['tour-chicken'],
    });

    expect(normal.allIngredientsInStock).toBe(true);
    expect(boosted.score).toBeGreaterThan(normal.score);
    expect(excluded.score).toBeLessThan(normal.score - 50);
  });

  it('generates a single meal when days === 0 and multi-day plan when days > 0', () => {
    const demo = createTourDemoState();
    const single = generateSmartWeeklyPlan(demo.recipes, demo.items, {
      days: 0,
      effort: 'exhausted',
      selectedTools: ['air_fryer', 'oven', 'no_cook'],
      mustUseItemIds: [],
      excludedItemIds: [],
      cuisineFilter: 'all',
      dailyProteinTarget: 130,
      shoppingDay: 6,
    });
    expect(single).toHaveLength(1);
    expect(single[0].dayLabel).toBe('Next Meal');

    const threeDay = generateSmartWeeklyPlan(demo.recipes, demo.items, {
      days: 3,
      effort: 'normal',
      selectedTools: ['air_fryer', 'oven', 'no_cook'],
      mustUseItemIds: [],
      excludedItemIds: [],
      cuisineFilter: 'all',
      dailyProteinTarget: 130,
      shoppingDay: 6,
    });
    expect(threeDay).toHaveLength(6); // 3 days * (lunch + dinner)
  });
});
