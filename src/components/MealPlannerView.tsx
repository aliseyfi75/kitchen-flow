import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChefHat,
  Clock,
  Code2,
  Flame,
  Heart,
  Plus,
  ShoppingCart,
  Sparkles,
  Utensils,
  X,
} from 'lucide-react';
import {
  CookingTool,
  EffortLevel,
  InventoryItem,
  MealRecipe,
  PlannedMeal,
  ShoppingItem,
  UILanguage,
} from '../types/kitchen';
import { EFFORT_META, t, TOOL_META } from '../i18n/translations';
import { computeItemForecast } from '../utils/forecasting';
import {
  buildGeminiPromptPreview,
  generateSmartWeeklyPlan,
  scoreRecipeAgainstInventory,
} from '../utils/mealEngine';

interface MealPlannerViewProps {
  items: InventoryItem[];
  recipes: MealRecipe[];
  weeklyPlan: PlannedMeal[];
  defaultTools: CookingTool[];
  dailyProteinTarget: number;
  shoppingDay: number;
  lang: UILanguage;
  onSetWeeklyPlan: (plan: PlannedMeal[]) => void;
  onMarkMealCooked: (plannedMealId: string, deductInventory: boolean) => void;
  onAddRecipe: (recipe: Omit<MealRecipe, 'id'>) => void;
  onToggleFavorite: (recipeId: string) => void;
  onAddMissingToShopping: (entry: Omit<ShoppingItem, 'id' | 'addedAt' | 'checked'>) => void;
}

const ALL_TOOLS: CookingTool[] = [
  'air_fryer',
  'oven',
  'pan',
  'grill',
  'instant_pot',
  'slow_cooker',
  'blender',
  'no_cook',
];

export const MealPlannerView: React.FC<MealPlannerViewProps> = ({
  items,
  recipes,
  weeklyPlan,
  defaultTools,
  dailyProteinTarget,
  shoppingDay,
  lang,
  onSetWeeklyPlan,
  onMarkMealCooked,
  onAddRecipe,
  onToggleFavorite,
  onAddMissingToShopping,
}) => {
  const [days, setDays] = useState<number>(5);
  const [effort, setEffort] = useState<EffortLevel>('exhausted');
  const [selectedTools, setSelectedTools] = useState<CookingTool[]>(defaultTools);
  const [cuisineFilter, setCuisineFilter] = useState<'all' | 'persian' | 'western' | 'fusion'>('all');
  const [ingredientPrefs, setIngredientPrefs] = useState<Record<string, 'must' | 'exclude'>>({});
  const [expandedRecipeId, setExpandedRecipeId] = useState<string | null>(null);
  const [showAiPayload, setShowAiPayload] = useState(false);
  const [showAddRecipe, setShowAddRecipe] = useState(false);

  // Add Recipe form
  const [recName, setRecName] = useState('');
  const [recAlias, setRecAlias] = useState('');
  const [recProtein, setRecProtein] = useState(45);
  const [recCalories, setRecCalories] = useState(500);
  const [recMinutes, setRecMinutes] = useState(20);
  const [recCuisine, setRecCuisine] = useState<'persian' | 'western' | 'fusion'>('persian');
  const [recTools, setRecTools] = useState<CookingTool[]>(['air_fryer']);
  const [recIngIds, setRecIngIds] = useState<string[]>([]);

  const stockedItems = useMemo(
    () =>
      items
        .filter((i) => i.remainingPortions > 0)
        .map((item) => ({ item, forecast: computeItemForecast(item, shoppingDay) }))
        .sort((a, b) => Number(b.forecast.expiringSoon) - Number(a.forecast.expiringSoon)),
    [items, shoppingDay]
  );

  const mustUseItemIds = useMemo(
    () => Object.entries(ingredientPrefs).filter(([, v]) => v === 'must').map(([k]) => k),
    [ingredientPrefs]
  );

  const excludedItemIds = useMemo(
    () => Object.entries(ingredientPrefs).filter(([, v]) => v === 'exclude').map(([k]) => k),
    [ingredientPrefs]
  );

  const request = useMemo(
    () => ({
      days,
      effort,
      selectedTools,
      mustUseItemIds,
      excludedItemIds,
      cuisineFilter,
      dailyProteinTarget,
      shoppingDay,
    }),
    [days, effort, selectedTools, mustUseItemIds, excludedItemIds, cuisineFilter, dailyProteinTarget, shoppingDay]
  );

  const scoredRecipes = useMemo(
    () =>
      recipes
        .map((r) => scoreRecipeAgainstInventory(r, items, request))
        .sort((a, b) => b.score - a.score),
    [recipes, items, request]
  );

  const recipeMap = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes]);
  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const toggleTool = (tool: CookingTool) => {
    setSelectedTools((prev) =>
      prev.includes(tool) ? prev.filter((x) => x !== tool) : [...prev, tool]
    );
  };

  const cycleIngredientPref = (itemId: string) => {
    setIngredientPrefs((prev) => {
      const curr = prev[itemId];
      const next = { ...prev };
      if (!curr) next[itemId] = 'must';
      else if (curr === 'must') next[itemId] = 'exclude';
      else delete next[itemId];
      return next;
    });
  };

  const handleGeneratePlan = () => {
    const generated = generateSmartWeeklyPlan(recipes, items, request);
    onSetWeeklyPlan(generated);
  };

  const groupedDays = useMemo(() => {
    const map = new Map<number, { dayLabel: string; meals: PlannedMeal[] }>();
    for (const m of weeklyPlan) {
      if (!map.has(m.dayIndex)) {
        map.set(m.dayIndex, { dayLabel: m.dayLabel, meals: [] });
      }
      map.get(m.dayIndex)!.meals.push(m);
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [weeklyPlan]);

  const handleAddRecipeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!recName.trim()) return;
    onAddRecipe({
      name: recName.trim(),
      alias: recAlias.trim() || undefined,
      cuisine: recCuisine,
      mealType: 'dinner',
      prepMinutes: Math.max(5, Number(recMinutes) || 20),
      effort: recMinutes <= 20 ? 'exhausted' : 'normal',
      tools: recTools.length > 0 ? recTools : ['pan'],
      proteinGrams: Math.max(5, Number(recProtein) || 35),
      calories: Math.max(100, Number(recCalories) || 450),
      nutritionHighlight: `${recProtein}g Protein • Household Custom Recipe`,
      ingredients: recIngIds.map((id) => {
        const it = itemMap.get(id);
        return {
          itemId: id,
          name: it?.name ?? 'Ingredient',
          alias: it?.alias,
          portionsNeeded: 1,
        };
      }),
      quickSteps: ['Prep ingredients and cook using selected tool until done.'],
      isFavorite: true,
    });
    setRecName('');
    setRecAlias('');
    setRecIngIds([]);
    setShowAddRecipe(false);
  };

  return (
    <div className="space-y-6">
      {/* Interactive Planner Controls */}
      <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-full">
              <Sparkles className="w-3.5 h-3.5" />
              Hybrid Protein-Max Planner
            </div>
            <h2 className="mt-1.5 text-lg font-bold text-stone-900">
              Plan Healthy Meals From What You Have
            </h2>
            <p className="text-xs text-stone-500">
              Prioritizes soon-expiring fridge produce & high-protein staples • Goal:{' '}
              <span className="font-semibold text-indigo-700">{dailyProteinTarget}g protein/day</span>
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs font-semibold text-stone-700"
            >
              <option value={3}>3 Days</option>
              <option value={5}>5 Workdays</option>
              <option value={7}>Full 7 Days</option>
            </select>
            <select
              value={cuisineFilter}
              onChange={(e) => setCuisineFilter(e.target.value as typeof cuisineFilter)}
              className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs font-semibold text-stone-700"
            >
              <option value="all">All Cuisines</option>
              <option value="persian">Persian (ایرانی)</option>
              <option value="western">Western</option>
              <option value="fusion">Fusion</option>
            </select>
          </div>
        </div>

        {/* Energy / Effort Mode */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-stone-600">Energy & Prep Style</label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {(['exhausted', 'normal', 'batch_prep'] as EffortLevel[]).map((lvl) => {
              const active = effort === lvl;
              return (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => setEffort(lvl)}
                  className={`rounded-xl border p-2.5 text-left transition ${
                    active
                      ? 'border-teal-600 bg-teal-50/80 text-teal-950 shadow-2xs'
                      : 'border-stone-200 hover:bg-stone-50 text-stone-700'
                  }`}
                >
                  <div className="text-xs font-bold">{EFFORT_META[lvl][lang]}</div>
                  <div className="text-[11px] text-stone-500 mt-0.5">
                    {lang === 'fa' ? EFFORT_META[lvl].descFa : EFFORT_META[lvl].descEn}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Selectable Cooking Tools */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-stone-600">
              {t(lang, 'cookingTools')}
            </label>
            <span className="text-[11px] text-stone-400">Tap to include / exclude</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {ALL_TOOLS.map((tool) => {
              const active = selectedTools.includes(tool);
              return (
                <button
                  key={tool}
                  type="button"
                  onClick={() => toggleTool(tool)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
                    active
                      ? 'bg-stone-900 text-white border-stone-900 shadow-2xs'
                      : 'bg-white text-stone-600 border-stone-200 hover:border-stone-300'
                  }`}
                >
                  <span>{TOOL_META[tool].emoji}</span>
                  <span>{TOOL_META[tool][lang]}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Selectable Inventory Ingredients */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs font-semibold text-stone-600">
              {t(lang, 'ingredientFocus')}
            </label>
            <span className="text-[11px] text-stone-400">
              1 tap = <span className="text-teal-700 font-semibold">Must Use</span> • 2 taps ={' '}
              <span className="text-rose-600 font-semibold">Skip</span>
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {stockedItems.map(({ item, forecast }) => {
              const pref = ingredientPrefs[item.id];
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => cycleIngredientPref(item.id)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs border transition ${
                    pref === 'must'
                      ? 'bg-teal-700 text-white border-teal-700 font-semibold shadow-2xs'
                      : pref === 'exclude'
                      ? 'bg-rose-50 text-rose-500 border-rose-200 line-through'
                      : forecast.expiringSoon
                      ? 'bg-amber-50/80 text-stone-800 border-amber-300 hover:border-amber-400'
                      : 'bg-stone-50 text-stone-700 border-stone-200 hover:bg-stone-100'
                  }`}
                >
                  <span dir="auto">{item.name}</span>
                  {item.alias && (
                    <span dir="auto" className="opacity-75 text-[11px]">
                      ({item.alias})
                    </span>
                  )}
                  {forecast.expiringSoon && !pref && (
                    <span className="text-[10px] font-bold text-amber-800 bg-amber-200/70 px-1 rounded">
                      Use soon
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-stone-100">
          <button
            type="button"
            onClick={() => setShowAiPayload((v) => !v)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-700 hover:text-indigo-900"
          >
            <Code2 className="w-4 h-4" />
            {showAiPayload ? 'Hide Gemini Edge Payload' : 'Inspect Phase 2 Gemini Payload'}
          </button>

          <button
            type="button"
            onClick={handleGeneratePlan}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-teal-700 to-indigo-700 hover:from-teal-800 hover:to-indigo-800 text-white px-5 py-2.5 text-sm font-bold shadow-sm transition"
          >
            <Sparkles className="w-4 h-4" />
            {t(lang, 'generatePlan')}
          </button>
        </div>

        {showAiPayload && (
          <div className="rounded-2xl bg-stone-950 text-teal-200 p-4 text-[11px] font-mono overflow-x-auto max-h-64">
            <div className="text-stone-400 mb-2 font-sans text-xs">
              In Phase 2, this authenticated payload goes to your Supabase Edge Function (Gemini API key stays encrypted server-side):
            </div>
            <pre>{buildGeminiPromptPreview(items, request)}</pre>
          </div>
        )}
      </div>

      {/* Generated Weekly Plan */}
      {groupedDays.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-stone-900 flex items-center gap-2">
              <ChefHat className="w-5 h-5 text-teal-700" />
              Your {groupedDays.length}-Day High-Protein Plan
            </h3>
            <span className="text-xs text-stone-500">
              Click "Mark Cooked" to auto-deduct from Kitchen
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
            {groupedDays.map(([dayIdx, group]) => {
              const dayProtein = group.meals.reduce(
                (sum, m) => sum + (recipeMap.get(m.recipeId)?.proteinGrams ?? 0),
                0
              );
              const proteinGap = Math.max(0, dailyProteinTarget - dayProtein);

              return (
                <div
                  key={dayIdx}
                  className="rounded-2xl border border-stone-200 bg-white overflow-hidden shadow-2xs"
                >
                  <div className="px-4 py-2.5 bg-stone-50 border-b border-stone-100 flex items-center justify-between">
                    <span className="font-bold text-sm text-stone-900">{group.dayLabel}</span>
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold">
                      <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800">
                        {dayProtein}g Lunch+Dinner
                      </span>
                      {proteinGap > 0 ? (
                        <span className="text-stone-500">+{proteinGap}g breakfast/shake</span>
                      ) : (
                        <span className="text-emerald-700">Goal hit!</span>
                      )}
                    </div>
                  </div>

                  <div className="divide-y divide-stone-100">
                    {group.meals.map((meal) => {
                      const rec = recipeMap.get(meal.recipeId);
                      if (!rec) return null;
                      const scored = scoreRecipeAgainstInventory(rec, items, request);
                      const isExpanded = expandedRecipeId === meal.id;

                      return (
                        <div key={meal.id} className="p-4 space-y-2.5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-stone-100 text-stone-600">
                                  {meal.slot}
                                </span>
                                <span dir="auto" className="font-semibold text-sm text-stone-900">
                                  {rec.name}
                                </span>
                              </div>
                              {rec.alias && (
                                <div>
                                  <span dir="auto" className="inline-block text-xs text-teal-800 font-medium mt-0.5">
                                    {rec.alias}
                                  </span>
                                </div>
                              )}
                            </div>
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-indigo-50 text-indigo-800 text-xs font-bold shrink-0">
                              <Flame className="w-3.5 h-3.5" />
                              {rec.proteinGrams}g
                            </span>
                          </div>

                          <div className="flex items-center flex-wrap gap-2 text-[11px] text-stone-500">
                            <span className="inline-flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {rec.prepMinutes}m
                            </span>
                            <span>•</span>
                            <span>{rec.calories} kcal</span>
                            <span>•</span>
                            <span>
                              {rec.tools.map((tl) => `${TOOL_META[tl].emoji} ${TOOL_META[tl].en}`).join(', ')}
                            </span>
                          </div>

                          <div className="text-[11px] text-teal-800 bg-teal-50/70 border border-teal-100 rounded-lg px-2.5 py-1.5">
                            {meal.reasonNote}
                          </div>

                          {scored.missingIngredients.length > 0 && (
                            <div className="flex items-center flex-wrap gap-1.5">
                              {scored.missingIngredients.map((mi, i) => (
                                <button
                                  key={i}
                                  type="button"
                                  onClick={() => {
                                    const inv = mi.itemId ? itemMap.get(mi.itemId) : undefined;
                                    onAddMissingToShopping({
                                      inventoryItemId: inv?.id,
                                      name: mi.name,
                                      alias: mi.alias,
                                      storeId: inv?.defaultStoreId ?? 'store-superstore',
                                      quantityLabel: inv?.packDescription ?? '1 pack',
                                      targetPortions: inv?.totalPortions ?? 4,
                                      targetZone: inv?.zone ?? 'fridge',
                                      priority: 'essential',
                                      reason: 'meal_plan',
                                    });
                                  }}
                                  className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md bg-amber-50 text-amber-900 border border-amber-200 hover:bg-amber-100"
                                >
                                  <ShoppingCart className="w-3 h-3" />
                                  Add missing: {mi.name}
                                </button>
                              ))}
                            </div>
                          )}

                          {isExpanded && (
                            <ol className="list-decimal list-inside text-xs text-stone-600 space-y-1 bg-stone-50 rounded-xl p-3">
                              {rec.quickSteps.map((st, idx) => (
                                <li key={idx}>{st}</li>
                              ))}
                            </ol>
                          )}

                          <div className="flex items-center justify-between gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => setExpandedRecipeId(isExpanded ? null : meal.id)}
                              className="text-xs font-semibold text-stone-500 hover:text-stone-800"
                            >
                              {isExpanded ? 'Hide steps' : 'Quick steps'}
                            </button>

                            <button
                              type="button"
                              onClick={() => onMarkMealCooked(meal.id, !meal.cooked)}
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
                                meal.cooked
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-stone-900 hover:bg-stone-800 text-white'
                              }`}
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              {meal.cooked ? t(lang, 'cookedDone') : t(lang, 'cookedBtn')}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Personal Favorites & Ranked Kitchen Library */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-stone-900 flex items-center gap-2">
              <Utensils className="w-4 h-4 text-teal-700" />
              {t(lang, 'favoritesLibrary')} ({recipes.length})
            </h3>
            <p className="text-xs text-stone-500">
              Ranked live by stock match, protein, expiring items, and selected tools
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowAddRecipe((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-white border border-stone-200 hover:bg-stone-50 px-3.5 py-2 text-xs font-semibold text-stone-800"
          >
            <Plus className="w-4 h-4" />
            {t(lang, 'addRecipe')}
          </button>
        </div>

        {showAddRecipe && (
          <form
            onSubmit={handleAddRecipeSubmit}
            className="rounded-2xl border border-stone-200 bg-white p-4 space-y-3 shadow-xs"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-stone-900">Add Household Favorite Meal</span>
              <button type="button" onClick={() => setShowAddRecipe(false)}>
                <X className="w-4 h-4 text-stone-400" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                dir="auto"
                required
                value={recName}
                onChange={(e) => setRecName(e.target.value)}
                placeholder="Meal name (e.g. Air Fryer Kabab Tabei)"
                className="rounded-xl border border-stone-200 px-3 py-2 text-sm"
              />
              <input
                dir="auto"
                value={recAlias}
                onChange={(e) => setRecAlias(e.target.value)}
                placeholder="Persian/English alias (مثلاً کباب تابه‌ای)"
                className="rounded-xl border border-stone-200 px-3 py-2 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div>
                <label className="block text-[10px] font-semibold text-stone-500 mb-1">Protein (g)</label>
                <input
                  type="number"
                  value={recProtein}
                  onChange={(e) => setRecProtein(Number(e.target.value))}
                  className="w-full rounded-xl border border-stone-200 px-2.5 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-stone-500 mb-1">Calories</label>
                <input
                  type="number"
                  value={recCalories}
                  onChange={(e) => setRecCalories(Number(e.target.value))}
                  className="w-full rounded-xl border border-stone-200 px-2.5 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-stone-500 mb-1">Prep (min)</label>
                <input
                  type="number"
                  value={recMinutes}
                  onChange={(e) => setRecMinutes(Number(e.target.value))}
                  className="w-full rounded-xl border border-stone-200 px-2.5 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-stone-500 mb-1">Cuisine</label>
                <select
                  value={recCuisine}
                  onChange={(e) => setRecCuisine(e.target.value as typeof recCuisine)}
                  className="w-full rounded-xl border border-stone-200 px-2.5 py-1.5 text-xs bg-white"
                >
                  <option value="persian">Persian</option>
                  <option value="western">Western</option>
                  <option value="fusion">Fusion</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-stone-500 mb-1">Tools Used</label>
              <div className="flex flex-wrap gap-1.5">
                {ALL_TOOLS.map((tl) => {
                  const active = recTools.includes(tl);
                  return (
                    <button
                      key={tl}
                      type="button"
                      onClick={() =>
                        setRecTools((prev) =>
                          prev.includes(tl) ? prev.filter((x) => x !== tl) : [...prev, tl]
                        )
                      }
                      className={`px-2.5 py-1 rounded-full text-[11px] border ${
                        active ? 'bg-stone-900 text-white border-stone-900' : 'bg-stone-50 text-stone-600 border-stone-200'
                      }`}
                    >
                      {TOOL_META[tl].emoji} {TOOL_META[tl].en}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-stone-500 mb-1">
                Key Ingredients (link to your inventory)
              </label>
              <div className="flex flex-wrap gap-1.5">
                {items.map((it) => {
                  const sel = recIngIds.includes(it.id);
                  return (
                    <button
                      key={it.id}
                      type="button"
                      onClick={() =>
                        setRecIngIds((prev) =>
                          prev.includes(it.id) ? prev.filter((x) => x !== it.id) : [...prev, it.id]
                        )
                      }
                      className={`px-2 py-1 rounded-lg text-[11px] border ${
                        sel ? 'bg-teal-700 text-white border-teal-700' : 'bg-white text-stone-600 border-stone-200'
                      }`}
                    >
                      {it.name}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                className="rounded-xl bg-teal-700 hover:bg-teal-800 text-white px-4 py-2 text-xs font-semibold"
              >
                Save to Library
              </button>
            </div>
          </form>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {scoredRecipes.map(({ recipe, matchedCount, totalIngredients, reasonNote, toolsCompatible }) => (
            <div
              key={recipe.id}
              className={`rounded-2xl border bg-white p-4 flex flex-col justify-between gap-2.5 ${
                toolsCompatible ? 'border-stone-200/90' : 'border-stone-200/60 opacity-65'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h4 dir="auto" className="font-semibold text-sm text-stone-900">
                    {recipe.name}
                  </h4>
                  {recipe.alias && (
                    <div>
                      <span dir="auto" className="inline-block text-xs text-teal-800 mt-0.5">
                        {recipe.alias}
                      </span>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => onToggleFavorite(recipe.id)}
                  className={`p-1.5 rounded-full transition ${
                    recipe.isFavorite ? 'text-rose-500 bg-rose-50' : 'text-stone-300 hover:text-rose-400'
                  }`}
                >
                  <Heart className={`w-4 h-4 ${recipe.isFavorite ? 'fill-current' : ''}`} />
                </button>
              </div>

              <div className="text-[11px] text-stone-600">{recipe.nutritionHighlight}</div>

              <div className="flex items-center justify-between flex-wrap gap-2 pt-2 border-t border-stone-100 text-[11px]">
                <span className="font-semibold text-teal-800">
                  Stock match: {matchedCount}/{totalIngredients}
                </span>
                <span className="text-stone-500 truncate">{reasonNote}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
