import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChefHat,
  ChevronDown,
  ChevronUp,
  Clock,
  Flame,
  Heart,
  PackageCheck,
  Plus,
  Search,
  ShoppingCart,
  Sparkles,
  Trash2,
  User,
  Users,
  Utensils,
  X,
} from 'lucide-react';
import {
  CookingTool,
  EffortLevel,
  InventoryItem,
  MealRecipe,
  PlannedMeal,
  RecipeIngredient,
  ShoppingItem,
  StorageZone,
  Store,
  UILanguage,
  UIMode,
} from '../types/kitchen';
import { EFFORT_META, t, TOOL_META, ZONE_META } from '../i18n/translations';
import { computeItemForecast } from '../utils/forecasting';
import {
  estimateRecipeNutrition,
  generateSmartWeeklyPlan,
  scoreRecipeAgainstInventory,
} from '../utils/mealEngine';
import { generateMealsWithGemini } from '../services/geminiEdge';
import { getCategoryProfile, inferProductDefaultsFromText } from '../utils/productCategories';

interface MealPlannerViewProps {
  items: InventoryItem[];
  stores: Store[];
  recipes: MealRecipe[];
  weeklyPlan: PlannedMeal[];
  cuisines: string[];
  defaultTools: CookingTool[];
  dailyProteinTarget: number;
  dailySugarLimit: number;
  shoppingDay: number;
  lang: UILanguage;
  uiMode: UIMode;
  onSetWeeklyPlan: (plan: PlannedMeal[]) => void;
  onUpdateMealServings: (plannedMealId: string, servings: number) => void;
  onMarkMealCooked: (plannedMealId: string, deductInventory: boolean) => void;
  onCookRecipeDirect: (recipeId: string, servings: number) => void;
  onAddRecipe: (
    recipe: Omit<MealRecipe, 'id'> & { id?: string },
    newInventoryItems?: InventoryItem[]
  ) => void;
  onAddCuisine: (cuisine: string) => void;
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

interface DraftIngredientRow {
  key: string;
  itemId?: string; // undefined if brand-new ingredient not yet in inventory
  name: string;
  alias: string;
  portionsNeeded: number;
  portionLabel: string;
  isNewToInventory: boolean;
  addToInventory: boolean;
  newZone: StorageZone;
  newRemainingStock: number;
}

export const MealPlannerView: React.FC<MealPlannerViewProps> = ({
  items,
  stores,
  recipes,
  weeklyPlan,
  cuisines,
  defaultTools,
  dailyProteinTarget,
  dailySugarLimit,
  shoppingDay,
  lang,
  uiMode,
  onSetWeeklyPlan,
  onUpdateMealServings,
  onMarkMealCooked,
  onCookRecipeDirect,
  onAddRecipe,
  onAddCuisine,
  onToggleFavorite,
  onAddMissingToShopping,
}) => {
  const isDetailed = uiMode === 'detailed';

  // Planner controls (0 = Single Meal, 3, 5, 7 days)
  const [days, setDays] = useState<number>(0);
  const [effort, setEffort] = useState<EffortLevel>('exhausted');
  const [selectedTools, setSelectedTools] = useState<CookingTool[]>(defaultTools);
  const [cuisineFilter, setCuisineFilter] = useState<string>('all');
  const [ingredientPrefs, setIngredientPrefs] = useState<Record<string, 'must' | 'exclude'>>({});
  const [expandedRecipeId, setExpandedRecipeId] = useState<string | null>(null);
  const [isCallingGemini, setIsCallingGemini] = useState(false);
  const [geminiNotice, setGeminiNotice] = useState<string | null>(null);

  // Food Library controls (search, filter by Ready-to-Cook, per-card serving selector)
  const [librarySearch, setLibrarySearch] = useState('');
  const [libraryFilter, setLibraryFilter] = useState<'all' | 'ready' | 'favorites'>('all');
  const [libraryServings, setLibraryServings] = useState<Record<string, number>>({});
  const [expandedLibraryId, setExpandedLibraryId] = useState<string | null>(null);

  // Add Meal form state
  const [showAddRecipe, setShowAddRecipe] = useState(false);
  const [recName, setRecName] = useState('');
  const [recAlias, setRecAlias] = useState('');
  const [recMinutes, setRecMinutes] = useState(20);
  const [recCuisine, setRecCuisine] = useState<string>(cuisines[0] || 'Persian');
  const [newCuisineInput, setNewCuisineInput] = useState('');
  const [showNewCuisineBox, setShowNewCuisineBox] = useState(false);
  const [recTools, setRecTools] = useState<CookingTool[]>(['air_fryer']);
  const [draftIngredients, setDraftIngredients] = useState<DraftIngredientRow[]>([]);

  // Inline "Add brand-new ingredient not in inventory" fields
  const [newIngName, setNewIngName] = useState('');
  const [newIngAlias, setNewIngAlias] = useState('');
  const [newIngPortions, setNewIngPortions] = useState(1);
  const [newIngUnitLabel, setNewIngUnitLabel] = useState('1 portion');
  const [newIngZone, setNewIngZone] = useState<StorageZone>('fridge');
  const [newIngAddToInventory, setNewIngAddToInventory] = useState(true);
  const [newIngCurrentStock, setNewIngCurrentStock] = useState(0);

  // Optional custom nutrition override (collapsed by default — auto-estimated!)
  const [showCustomNutrition, setShowCustomNutrition] = useState(false);
  const [customProtein, setCustomProtein] = useState<string>('');
  const [customSugar, setCustomSugar] = useState<string>('');
  const [customFiber, setCustomFiber] = useState<string>('');
  const [customCalories, setCustomCalories] = useState<string>('');

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

  const readyToCookCount = useMemo(
    () => scoredRecipes.filter((s) => s.allIngredientsInStock).length,
    [scoredRecipes]
  );

  const favoriteCount = useMemo(
    () => scoredRecipes.filter((s) => s.recipe.isFavorite).length,
    [scoredRecipes]
  );

  const filteredLibrary = useMemo(() => {
    const q = librarySearch.trim().toLowerCase();
    return scoredRecipes.filter((entry) => {
      if (libraryFilter === 'ready' && !entry.allIngredientsInStock) return false;
      if (libraryFilter === 'favorites' && !entry.recipe.isFavorite) return false;
      if (q) {
        const hay = [
          entry.recipe.name,
          entry.recipe.alias || '',
          entry.recipe.cuisine,
          ...entry.recipe.ingredients.flatMap((ing) => [ing.name, ing.alias || '']),
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [scoredRecipes, libraryFilter, librarySearch]);

  const recipeMap = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes]);
  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  // Live auto-estimated nutrition for the meal being created!
  const estimatedDraftNutrition = useMemo(() => {
    const asRecipeIngs: RecipeIngredient[] = draftIngredients.map((d) => ({
      itemId: d.itemId,
      name: d.name,
      alias: d.alias || undefined,
      portionsNeeded: d.portionsNeeded,
      portionLabel: d.portionLabel,
    }));
    return estimateRecipeNutrition(asRecipeIngs, recTools, items);
  }, [draftIngredients, recTools, items]);

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
    setGeminiNotice(null);
    const generated = generateSmartWeeklyPlan(recipes, items, request, 2);
    onSetWeeklyPlan(generated);
  };

  const handleGenerateWithGemini = async () => {
    setIsCallingGemini(true);
    setGeminiNotice(null);
    try {
      const aiRecipes = await generateMealsWithGemini(items, request);
      if (aiRecipes.length === 0) {
        setGeminiNotice('No new meal ideas returned — try adding a few items to your Kitchen first.');
        handleGeneratePlan();
        return;
      }

      const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      const createdIds: { id: string; recipe: Omit<MealRecipe, 'id'> & { reasonNote?: string } }[] = [];
      for (const r of aiRecipes) {
        const id = `rec-ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        onAddRecipe({ ...r, id }, []);
        createdIds.push({ id, recipe: r });
      }

      const latestRecipes: MealRecipe[] = [
        ...createdIds.map(({ id, recipe }) => ({ ...recipe, id })),
        ...recipes,
      ];
      if (request.days === 0 && createdIds[0]) {
        onSetWeeklyPlan([
          {
            id: `plan-ai-single-${Date.now()}`,
            dayIndex: 0,
            dayLabel: 'Next Meal',
            slot: 'dinner',
            recipeId: latestRecipes[0].id,
            servings: 2,
            cooked: false,
            source: 'ai_suggested',
            reasonNote: createdIds[0].recipe.reasonNote || 'Suggested by Gemini AI',
          },
        ]);
      } else {
        const generated = generateSmartWeeklyPlan(latestRecipes, items, request, 2);
        onSetWeeklyPlan(
          generated.map((m, idx) => ({
            ...m,
            dayLabel: dayNames[m.dayIndex % 7],
            source: idx < createdIds.length ? 'ai_suggested' : m.source,
          }))
        );
      }
      setGeminiNotice(`Generated ${aiRecipes.length} meal idea(s) with Gemini AI!`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not reach Gemini AI';
      setGeminiNotice(`Gemini AI unavailable (${msg}).`);
      if (recipes.length > 0) handleGeneratePlan();
    } finally {
      setIsCallingGemini(false);
    }
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

  // Toggle existing inventory ingredient into draft recipe
  const toggleDraftInventoryItem = (invItem: InventoryItem) => {
    setDraftIngredients((prev) => {
      const exists = prev.some((d) => d.itemId === invItem.id);
      if (exists) return prev.filter((d) => d.itemId !== invItem.id);
      return [
        ...prev,
        {
          key: `inv-${invItem.id}`,
          itemId: invItem.id,
          name: invItem.name,
          alias: invItem.alias,
          portionsNeeded: 1,
          portionLabel: invItem.portionLabel,
          isNewToInventory: false,
          addToInventory: false,
          newZone: invItem.zone,
          newRemainingStock: invItem.remainingPortions,
        },
      ];
    });
  };

  const handleAddBrandNewIngredient = () => {
    if (!newIngName.trim()) return;
    setDraftIngredients((prev) => [
      ...prev,
      {
        key: `new-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        name: newIngName.trim(),
        alias: newIngAlias.trim(),
        portionsNeeded: Math.max(0.25, Number(newIngPortions) || 1),
        portionLabel: newIngUnitLabel.trim() || '1 portion',
        isNewToInventory: true,
        addToInventory: newIngAddToInventory,
        newZone: newIngZone,
        newRemainingStock: Math.max(0, Number(newIngCurrentStock) || 0),
      },
    ]);
    setNewIngName('');
    setNewIngAlias('');
    setNewIngPortions(1);
    setNewIngUnitLabel('1 portion');
    setNewIngCurrentStock(0);
  };

  const handleCreateCustomCuisine = () => {
    const clean = newCuisineInput.trim();
    if (!clean) return;
    onAddCuisine(clean);
    setRecCuisine(clean);
    setNewCuisineInput('');
    setShowNewCuisineBox(false);
  };

  const handleAddRecipeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!recName.trim()) return;

    const newInventoryItems: InventoryItem[] = [];
    const finalIngredients: RecipeIngredient[] = draftIngredients.map((d) => {
      if (d.isNewToInventory && d.addToInventory) {
        const newId = `item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const inferred = inferProductDefaultsFromText(`${d.name} ${d.alias}`);
        const cat = inferred?.category ?? 'pantry_staple';
        const prof = getCategoryProfile(cat);
        const mode = inferred?.trackingMode ?? prof.defaultTrackingMode;
        const isCont = mode === 'continuous';
        const totalQty = isCont ? 100 : Math.max(4, d.newRemainingStock || 4);
        const remQty = isCont ? (d.newRemainingStock > 0 ? 100 : 0) : d.newRemainingStock;

        newInventoryItems.push({
          id: newId,
          name: d.name,
          alias: d.alias,
          category: cat,
          zone: d.newZone,
          trackingMode: mode,
          continuousStyle: isCont ? inferred?.continuousStyle ?? prof.defaultContinuousStyle : undefined,
          totalPortions: totalQty,
          remainingPortions: remQty,
          portionLabel: d.portionLabel || (isCont ? 'container' : prof.defaultPortionLabel),
          packDescription: `Added via meal: ${recName.trim()}`,
          proteinPerPortion: 0,
          defaultStoreId: stores[0]?.id ?? 'store-superstore',
          storePurchaseCounts: { [stores[0]?.id ?? 'store-superstore']: 1 },
          avgDaysPerFullPack: prof.defaultAvgDays,
          cycleCount: 0,
          lastRestockedAt: new Date().toISOString(),
          autoAddOnEmpty: prof.defaultAutoAdd,
        });
        return {
          itemId: newId,
          name: d.name,
          alias: d.alias || undefined,
          portionsNeeded: d.portionsNeeded,
          portionLabel: d.portionLabel,
        };
      }
      return {
        itemId: d.itemId,
        name: d.name,
        alias: d.alias || undefined,
        portionsNeeded: d.portionsNeeded,
        portionLabel: d.portionLabel,
      };
    });

    const finalProtein =
      customProtein.trim() !== '' ? Math.max(0, Number(customProtein)) : estimatedDraftNutrition.proteinGrams;
    const finalSugar =
      customSugar.trim() !== '' ? Math.max(0, Number(customSugar)) : estimatedDraftNutrition.sugarGrams;
    const finalFiber =
      customFiber.trim() !== '' ? Math.max(0, Number(customFiber)) : estimatedDraftNutrition.fiberGrams;
    const finalCalories =
      customCalories.trim() !== '' ? Math.max(0, Number(customCalories)) : estimatedDraftNutrition.calories;

    const isAutoEstimated =
      customProtein.trim() === '' &&
      customSugar.trim() === '' &&
      customFiber.trim() === '' &&
      customCalories.trim() === '';

    onAddRecipe(
      {
        name: recName.trim(),
        alias: recAlias.trim() || undefined,
        cuisine: recCuisine || 'Persian',
        mealType: 'dinner',
        prepMinutes: Math.max(5, Number(recMinutes) || 20),
        effort: recMinutes <= 20 ? 'exhausted' : 'normal',
        tools: recTools.length > 0 ? recTools : ['pan'],
        proteinGrams: finalProtein,
        sugarGrams: finalSugar,
        fiberGrams: finalFiber,
        calories: finalCalories,
        micronutrients:
          estimatedDraftNutrition.micronutrients.length > 0
            ? estimatedDraftNutrition.micronutrients
            : ['Whole Foods'],
        nutritionHighlight: `${finalProtein}g Protein • ${finalSugar}g Sugar • ${finalCalories} kcal${
          isAutoEstimated ? ' (Auto-estimated)' : ''
        }`,
        nutritionEstimated: isAutoEstimated,
        ingredients: finalIngredients,
        quickSteps: ['Prep the selected ingredients and cook using your chosen tool until ready.'],
        isFavorite: true,
      },
      newInventoryItems
    );

    // Reset form
    setRecName('');
    setRecAlias('');
    setDraftIngredients([]);
    setCustomProtein('');
    setCustomSugar('');
    setCustomFiber('');
    setCustomCalories('');
    setShowCustomNutrition(false);
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
              Hybrid Meal &amp; Protein Planner
            </div>
            <h2 className="mt-1.5 text-lg font-bold text-stone-900">
              Decide What to Eat From What You Have
            </h2>
            <p className="text-xs text-stone-500">
              Prioritizes soon-expiring fridge items &amp; healthy nutrition • Goal:{' '}
              <span className="font-semibold text-indigo-700">{dailyProteinTarget}g protein/day</span>
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs font-semibold text-stone-700"
              aria-label="Plan scope"
            >
              <option value={0}>Single Meal (1)</option>
              <option value={3}>3 Days</option>
              <option value={5}>5 Workdays</option>
              <option value={7}>Full 7 Days</option>
            </select>
            <select
              value={cuisineFilter}
              onChange={(e) => setCuisineFilter(e.target.value)}
              className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs font-semibold text-stone-700"
              aria-label="Cuisine filter"
            >
              <option value="all">All Cuisines</option>
              {cuisines.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Energy / Effort Mode */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-stone-600">Energy &amp; Prep Style</label>
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
          <span className="text-xs text-stone-400">
            {days === 0
              ? 'Suggests the best single meal right now from your stock'
              : 'Lunch defaults to Solo (1×) • Dinner to Together (2×)'}
          </span>

          <div className="flex items-center flex-wrap gap-2">
            <button
              type="button"
              onClick={handleGeneratePlan}
              className="inline-flex items-center gap-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white px-4 py-2.5 text-xs sm:text-sm font-bold shadow-xs transition"
            >
              <ChefHat className="w-4 h-4" />
              {days === 0 ? 'Suggest 1 Meal Now' : t(lang, 'generatePlan')}
            </button>
            <button
              type="button"
              disabled={isCallingGemini}
              onClick={handleGenerateWithGemini}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-700 to-violet-700 hover:from-indigo-800 hover:to-violet-800 disabled:opacity-50 text-white px-4 py-2.5 text-xs sm:text-sm font-bold shadow-xs transition"
            >
              <Sparkles className={`w-4 h-4 ${isCallingGemini ? 'animate-spin' : ''}`} />
              {isCallingGemini ? 'Asking Gemini...' : 'Ask Gemini AI'}
            </button>
          </div>
        </div>

        {geminiNotice && (
          <div className="rounded-xl bg-indigo-50 border border-indigo-200 px-3.5 py-2.5 text-xs text-indigo-900">
            {geminiNotice}
          </div>
        )}
      </div>

      {/* Generated Plan (Single Meal OR Multi-Day) */}
      {groupedDays.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-base font-bold text-stone-900 flex items-center gap-2">
              <ChefHat className="w-5 h-5 text-teal-700" />
              {weeklyPlan.length === 1
                ? 'Recommended Meal Right Now'
                : `Your ${groupedDays.length}-Day Balanced Plan`}
            </h3>
            <span className="text-xs text-stone-500">
              Tap 1× / 2× / + to scale exact ingredient deduction
            </span>
          </div>

          <div
            className={`grid grid-cols-1 ${
              groupedDays.length > 1 ? 'lg:grid-cols-2' : ''
            } gap-3.5`}
          >
            {groupedDays.map(([dayIdx, group]) => {
              const dayProtein = group.meals.reduce(
                (sum, m) => sum + (recipeMap.get(m.recipeId)?.proteinGrams ?? 0),
                0
              );
              const daySugar = group.meals.reduce(
                (sum, m) => sum + (recipeMap.get(m.recipeId)?.sugarGrams ?? 0),
                0
              );
              const dayFiber = group.meals.reduce(
                (sum, m) => sum + (recipeMap.get(m.recipeId)?.fiberGrams ?? 0),
                0
              );
              const dayMicros = Array.from(
                new Set(
                  group.meals.flatMap((m) => recipeMap.get(m.recipeId)?.micronutrients ?? [])
                )
              );

              return (
                <div
                  key={dayIdx}
                  className="rounded-2xl border border-stone-200 bg-white overflow-hidden shadow-2xs"
                >
                  <div className="px-4 py-2.5 bg-stone-50 border-b border-stone-100 space-y-1.5">
                    <div className="flex items-center justify-between flex-wrap gap-1.5">
                      <span className="font-bold text-sm text-stone-900">{group.dayLabel}</span>
                      <div className="flex items-center flex-wrap gap-1.5 text-[11px] font-semibold">
                        <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800">
                          {dayProtein}g Pro
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full ${
                            daySugar <= dailySugarLimit * 0.5
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {daySugar}g Sugar
                        </span>
                        {isDetailed && (
                          <span className="px-2 py-0.5 rounded-full bg-teal-50 text-teal-800">
                            {dayFiber}g Fiber
                          </span>
                        )}
                      </div>
                    </div>

                    {isDetailed && dayMicros.length > 0 && (
                      <div className="flex items-center flex-wrap gap-1 text-[10px] text-stone-600">
                        <span className="font-semibold text-stone-400">Micros:</span>
                        {dayMicros.slice(0, 6).map((mic) => (
                          <span
                            key={mic}
                            className="px-1.5 py-0.5 rounded bg-white border border-stone-200 font-medium"
                          >
                            {mic}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="divide-y divide-stone-100">
                    {group.meals.map((meal) => {
                      const rec = recipeMap.get(meal.recipeId);
                      if (!rec) return null;
                      const scored = scoreRecipeAgainstInventory(rec, items, request);
                      const isExpanded = expandedRecipeId === meal.id;
                      const servings = meal.servings || 1;

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

                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <div className="flex items-center flex-wrap gap-2 text-[11px] text-stone-500">
                              <span className="inline-flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {rec.prepMinutes}m
                              </span>
                              <span>•</span>
                              <span>{rec.sugarGrams}g sugar</span>
                              <span>•</span>
                              <span>
                                {rec.tools.map((tl) => `${TOOL_META[tl].emoji} ${TOOL_META[tl].en}`).join(', ')}
                              </span>
                            </div>

                            <div className="inline-flex items-center gap-1 bg-stone-100 p-0.5 rounded-lg text-[11px] font-bold">
                              <button
                                type="button"
                                onClick={() => onUpdateMealServings(meal.id, 1)}
                                className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md transition ${
                                  servings === 1
                                    ? 'bg-white text-teal-800 shadow-2xs'
                                    : 'text-stone-500 hover:text-stone-800'
                                }`}
                              >
                                <User className="w-3 h-3" />
                                1×
                              </button>
                              <button
                                type="button"
                                onClick={() => onUpdateMealServings(meal.id, 2)}
                                className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md transition ${
                                  servings === 2
                                    ? 'bg-white text-teal-800 shadow-2xs'
                                    : 'text-stone-500 hover:text-stone-800'
                                }`}
                              >
                                <Users className="w-3 h-3" />
                                2×
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  onUpdateMealServings(meal.id, servings >= 3 ? servings + 1 : 4)
                                }
                                className={`px-2 py-0.5 rounded-md transition ${
                                  servings >= 3
                                    ? 'bg-indigo-700 text-white shadow-2xs'
                                    : 'text-stone-500 hover:text-stone-800'
                                }`}
                              >
                                {servings >= 3 ? `${servings}×` : '+'}
                              </button>
                            </div>
                          </div>

                          {/* Exact deduction preview */}
                          <div className="flex flex-wrap gap-1 text-[11px]">
                            {rec.ingredients.map((ing, idx) => (
                              <span
                                key={idx}
                                className="px-2 py-0.5 rounded-md bg-stone-50 border border-stone-200/80 text-stone-700"
                              >
                                <strong>{Number((ing.portionsNeeded * servings).toFixed(1))}×</strong>{' '}
                                {ing.name}
                              </span>
                            ))}
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
                                      storeId: inv?.defaultStoreId ?? stores[0]?.id ?? 'store-superstore',
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
                              {meal.cooked
                                ? t(lang, 'cookedDone')
                                : `${t(lang, 'cookedBtn')} (${servings}×)`}
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

      {/* Searchable & Filterable Food Library — Cook & Deduct Any Meal Directly */}
      <div className="space-y-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-stone-900 flex items-center gap-2">
              <Utensils className="w-4 h-4 text-teal-700" />
              Food Library ({recipes.length})
            </h3>
            <p className="text-xs text-stone-500">
              Search any meal, filter by what you can cook right now, or mark one cooked to deduct exact ingredients
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowAddRecipe((v) => !v)}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white px-4 py-2 text-xs font-bold shadow-xs shrink-0"
          >
            <Plus className="w-4 h-4" />
            {t(lang, 'addRecipe')}
          </button>
        </div>

        {/* Add New Meal Form (Custom Cuisine + New Ingredients -> Inventory + Exact Quantities + Auto-Nutrition!) */}
        {showAddRecipe && (
          <form
            onSubmit={handleAddRecipeSubmit}
            className="rounded-3xl border border-teal-200 bg-white p-5 space-y-4 shadow-sm"
          >
            <div className="flex items-center justify-between border-b border-stone-100 pb-3">
              <div>
                <h4 className="text-sm font-bold text-stone-900">Add Meal to Food Library</h4>
                <p className="text-[11px] text-stone-500">
                  Nutrition is auto-estimated from your ingredients &amp; cooking tool.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddRecipe(false)}
                className="p-1.5 rounded-full hover:bg-stone-100"
              >
                <X className="w-4 h-4 text-stone-500" />
              </button>
            </div>

            {/* Name + Alias */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                dir="auto"
                required
                value={recName}
                onChange={(e) => setRecName(e.target.value)}
                placeholder="Meal name (e.g. Air Fryer Kabab Tabei)"
                className="rounded-xl border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
              <input
                dir="auto"
                value={recAlias}
                onChange={(e) => setRecAlias(e.target.value)}
                placeholder="Persian/English alias (مثلاً کباب تابه‌ای)"
                className="rounded-xl border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>

            {/* Cuisine (with inline "+ New Cuisine") + Prep Time */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="block text-[11px] font-semibold text-stone-600">Cuisine</label>
                <div className="flex items-center gap-1.5">
                  <select
                    value={recCuisine}
                    onChange={(e) => setRecCuisine(e.target.value)}
                    className="flex-1 rounded-xl border border-stone-200 px-3 py-2 text-xs font-semibold bg-white"
                  >
                    {cuisines.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setShowNewCuisineBox((v) => !v)}
                    className="inline-flex items-center gap-1 rounded-xl border border-teal-200 bg-teal-50 hover:bg-teal-100 text-teal-800 px-3 py-2 text-xs font-bold shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    New
                  </button>
                </div>

                {showNewCuisineBox && (
                  <div className="flex items-center gap-1.5 pt-1">
                    <input
                      dir="auto"
                      value={newCuisineInput}
                      onChange={(e) => setNewCuisineInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleCreateCustomCuisine();
                        }
                      }}
                      placeholder="e.g. Mexican, Italian, Japanese..."
                      className="flex-1 rounded-xl border border-teal-300 px-2.5 py-1.5 text-xs"
                    />
                    <button
                      type="button"
                      onClick={handleCreateCustomCuisine}
                      className="rounded-xl bg-teal-700 text-white px-3 py-1.5 text-xs font-bold"
                    >
                      Add
                    </button>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-stone-600 mb-1.5">
                  Prep &amp; Cook Time (minutes)
                </label>
                <input
                  type="number"
                  min={5}
                  value={recMinutes}
                  onChange={(e) => setRecMinutes(Number(e.target.value))}
                  className="w-full rounded-xl border border-stone-200 px-3 py-2 text-xs font-semibold"
                />
              </div>
            </div>

            {/* Tools Used */}
            <div>
              <label className="block text-[11px] font-semibold text-stone-600 mb-1.5">
                Cooking Tools Used (affects nutrition estimate)
              </label>
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
                      className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition ${
                        active
                          ? 'bg-stone-900 text-white border-stone-900'
                          : 'bg-stone-50 text-stone-600 border-stone-200'
                      }`}
                    >
                      {TOOL_META[tl].emoji} {TOOL_META[tl].en}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Pick Existing Inventory Ingredients */}
            <div className="space-y-2">
              <label className="block text-[11px] font-semibold text-stone-600">
                1. Pick from Kitchen Inventory
              </label>
              <div className="flex flex-wrap gap-1.5">
                {items.map((it) => {
                  const sel = draftIngredients.some((d) => d.itemId === it.id);
                  return (
                    <button
                      key={it.id}
                      type="button"
                      onClick={() => toggleDraftInventoryItem(it)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition ${
                        sel
                          ? 'bg-teal-700 text-white border-teal-700'
                          : 'bg-white text-stone-700 border-stone-200 hover:bg-stone-50'
                      }`}
                    >
                      <span dir="auto">{it.name}</span>
                      {it.alias ? ` (${it.alias})` : ''}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Add New Ingredient NOT in Inventory (and optionally add to inventory too!) */}
            <div className="rounded-2xl border border-stone-200 bg-stone-50/80 p-3.5 space-y-2.5">
              <div className="text-[11px] font-bold text-stone-700">
                2. Add Ingredient Not in Inventory Yet
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  dir="auto"
                  value={newIngName}
                  onChange={(e) => setNewIngName(e.target.value)}
                  placeholder="Ingredient name (e.g. Sweet Potato)"
                  className="rounded-xl border border-stone-200 bg-white px-2.5 py-1.5 text-xs"
                />
                <input
                  dir="auto"
                  value={newIngAlias}
                  onChange={(e) => setNewIngAlias(e.target.value)}
                  placeholder="Alias (مثلاً سیب‌زمینی شیرین)"
                  className="rounded-xl border border-stone-200 bg-white px-2.5 py-1.5 text-xs"
                />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div>
                  <label className="block text-[10px] text-stone-500 mb-0.5">Qty / Serving</label>
                  <input
                    type="number"
                    step="0.25"
                    min="0.25"
                    value={newIngPortions}
                    onChange={(e) => setNewIngPortions(Number(e.target.value))}
                    className="w-full rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-stone-500 mb-0.5">Portion Label</label>
                  <input
                    dir="auto"
                    value={newIngUnitLabel}
                    onChange={(e) => setNewIngUnitLabel(e.target.value)}
                    placeholder="1 medium"
                    className="w-full rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-stone-500 mb-0.5">Zone</label>
                  <select
                    value={newIngZone}
                    onChange={(e) => setNewIngZone(e.target.value as StorageZone)}
                    className="w-full rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs"
                  >
                    {(['fridge', 'freezer', 'pantry'] as StorageZone[]).map((z) => (
                      <option key={z} value={z}>
                        {ZONE_META[z][lang]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-stone-500 mb-0.5">Have Now</label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={newIngCurrentStock}
                    onChange={(e) => setNewIngCurrentStock(Number(e.target.value))}
                    className="w-full rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs"
                  />
                </div>
              </div>
              <div className="flex items-center justify-between flex-wrap gap-2 pt-0.5">
                <label className="inline-flex items-center gap-2 text-xs text-stone-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newIngAddToInventory}
                    onChange={(e) => setNewIngAddToInventory(e.target.checked)}
                    className="rounded border-stone-300 text-teal-600"
                  />
                  Also add this ingredient to my Kitchen Inventory
                </label>
                <button
                  type="button"
                  onClick={handleAddBrandNewIngredient}
                  disabled={!newIngName.trim()}
                  className="inline-flex items-center gap-1 rounded-xl bg-stone-900 hover:bg-stone-800 disabled:opacity-40 text-white px-3 py-1.5 text-xs font-semibold"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Ingredient
                </button>
              </div>
            </div>

            {/* Selected Ingredients with Exact Per-Serving Quantities */}
            {draftIngredients.length > 0 && (
              <div className="space-y-1.5">
                <label className="block text-[11px] font-semibold text-stone-600">
                  Selected Ingredients — Exact Amount Used Per Serving (deducted when cooked)
                </label>
                <div className="space-y-1.5">
                  {draftIngredients.map((ing) => (
                    <div
                      key={ing.key}
                      className="flex items-center justify-between gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs"
                    >
                      <div className="min-w-0">
                        <span dir="auto" className="font-semibold text-stone-900">
                          {ing.name}
                        </span>{' '}
                        {ing.alias && (
                          <span dir="auto" className="text-stone-400">
                            ({ing.alias})
                          </span>
                        )}
                        {ing.isNewToInventory && (
                          <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700">
                            {ing.addToInventory ? 'New → Inventory' : 'New'}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <input
                          type="number"
                          step="0.25"
                          min="0.25"
                          value={ing.portionsNeeded}
                          onChange={(e) =>
                            setDraftIngredients((prev) =>
                              prev.map((row) =>
                                row.key === ing.key
                                  ? { ...row, portionsNeeded: Math.max(0.25, Number(e.target.value) || 0.25) }
                                  : row
                              )
                            )
                          }
                          className="w-16 rounded-lg border border-stone-200 px-2 py-1 text-xs font-bold text-center"
                        />
                        <span className="text-[11px] text-stone-500 max-w-[90px] truncate">
                          × {ing.portionLabel}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setDraftIngredients((prev) => prev.filter((r) => r.key !== ing.key))
                          }
                          className="p-1 rounded text-stone-400 hover:text-rose-600"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Auto-Estimated Nutrition Card + Optional Collapsible Custom Override */}
            <div className="rounded-2xl border border-indigo-200/80 bg-indigo-50/40 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <div className="text-xs font-bold text-indigo-950 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                    Auto-Estimated Nutrition (Per Serving)
                  </div>
                  <div className="text-[11px] text-indigo-800/80">
                    {estimatedDraftNutrition.toolAdjustmentNote}
                  </div>
                </div>
                <div className="flex items-center flex-wrap gap-1.5 text-xs font-bold">
                  <span className="px-2 py-0.5 rounded-lg bg-white text-indigo-800 border border-indigo-200">
                    ~{estimatedDraftNutrition.proteinGrams}g Pro
                  </span>
                  <span className="px-2 py-0.5 rounded-lg bg-white text-rose-700 border border-rose-200">
                    ~{estimatedDraftNutrition.sugarGrams}g Sugar
                  </span>
                  <span className="px-2 py-0.5 rounded-lg bg-white text-teal-800 border border-teal-200">
                    ~{estimatedDraftNutrition.fiberGrams}g Fiber
                  </span>
                  <span className="px-2 py-0.5 rounded-lg bg-white text-stone-700 border border-stone-200">
                    ~{estimatedDraftNutrition.calories} kcal
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowCustomNutrition((v) => !v)}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-700 hover:text-indigo-950"
              >
                {showCustomNutrition ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
                {showCustomNutrition
                  ? 'Hide custom nutrition values'
                  : 'Detailed: Enter custom nutrition values (optional)'}
              </button>

              {showCustomNutrition && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                  <div>
                    <label className="block text-[10px] font-semibold text-stone-600 mb-0.5">
                      Protein (g)
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={customProtein}
                      onChange={(e) => setCustomProtein(e.target.value)}
                      placeholder={String(estimatedDraftNutrition.proteinGrams)}
                      className="w-full rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-stone-600 mb-0.5">
                      Sugar (g)
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={customSugar}
                      onChange={(e) => setCustomSugar(e.target.value)}
                      placeholder={String(estimatedDraftNutrition.sugarGrams)}
                      className="w-full rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-stone-600 mb-0.5">
                      Fiber (g)
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={customFiber}
                      onChange={(e) => setCustomFiber(e.target.value)}
                      placeholder={String(estimatedDraftNutrition.fiberGrams)}
                      className="w-full rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-stone-600 mb-0.5">
                      Calories
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={customCalories}
                      onChange={(e) => setCustomCalories(e.target.value)}
                      placeholder={String(estimatedDraftNutrition.calories)}
                      className="w-full rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowAddRecipe(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-stone-600 hover:bg-stone-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-xl bg-teal-700 hover:bg-teal-800 text-white px-5 py-2 text-xs font-bold shadow-xs"
              >
                Save Meal to Library
              </button>
            </div>
          </form>
        )}

        {/* Library Search + "Ready to Cook (All Ingredients In Stock)" Filter */}
        <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center justify-between">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-stone-400 absolute top-1/2 -translate-y-1/2 left-3.5 pointer-events-none" />
            <input
              dir="auto"
              value={librarySearch}
              onChange={(e) => setLibrarySearch(e.target.value)}
              placeholder="Search foods in English or Persian (e.g. Jujeh, سالمون, spinach)..."
              className="w-full rounded-xl border border-stone-200 bg-white pl-10 pr-4 py-2 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto">
            <button
              type="button"
              onClick={() => setLibraryFilter('all')}
              className={`px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition ${
                libraryFilter === 'all'
                  ? 'bg-stone-900 text-white'
                  : 'bg-white border border-stone-200 text-stone-600 hover:bg-stone-50'
              }`}
            >
              All ({recipes.length})
            </button>
            <button
              type="button"
              onClick={() => setLibraryFilter('ready')}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition ${
                libraryFilter === 'ready'
                  ? 'bg-emerald-700 text-white shadow-2xs'
                  : 'bg-white border border-emerald-200 text-emerald-800 hover:bg-emerald-50'
              }`}
            >
              <PackageCheck className="w-3.5 h-3.5" />
              All Ingredients In Stock ({readyToCookCount})
            </button>
            <button
              type="button"
              onClick={() => setLibraryFilter('favorites')}
              className={`px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition ${
                libraryFilter === 'favorites'
                  ? 'bg-rose-600 text-white'
                  : 'bg-white border border-stone-200 text-stone-600 hover:bg-stone-50'
              }`}
            >
              Favorites ({favoriteCount})
            </button>
          </div>
        </div>

        {/* Food Library Cards — Direct Cook & Deduct */}
        {filteredLibrary.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-8 text-center text-xs text-stone-500">
            No foods match this filter or search. Try switching back to &ldquo;All&rdquo; or add a new meal!
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {filteredLibrary.map(
              ({
                recipe,
                matchedCount,
                totalIngredients,
                allIngredientsInStock,
                missingIngredients,
              }) => {
                const servings = libraryServings[recipe.id] ?? 2;
                const showIngs = expandedLibraryId === recipe.id;

                return (
                  <div
                    key={recipe.id}
                    className={`rounded-2xl border bg-white p-4 flex flex-col justify-between gap-3 shadow-2xs ${
                      allIngredientsInStock ? 'border-emerald-200/90' : 'border-stone-200/90'
                    }`}
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 dir="auto" className="font-semibold text-sm text-stone-900">
                              {recipe.name}
                            </h4>
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-stone-100 text-stone-600">
                              {recipe.cuisine}
                            </span>
                          </div>
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
                            recipe.isFavorite
                              ? 'text-rose-500 bg-rose-50'
                              : 'text-stone-300 hover:text-rose-400'
                          }`}
                        >
                          <Heart className={`w-4 h-4 ${recipe.isFavorite ? 'fill-current' : ''}`} />
                        </button>
                      </div>

                      <div className="flex items-center flex-wrap gap-1.5 text-[11px]">
                        <span className="font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md">
                          {recipe.proteinGrams}g Pro
                        </span>
                        <span className="font-medium text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-md">
                          {recipe.sugarGrams}g Sugar
                        </span>
                        <span className="text-stone-500">{recipe.calories} kcal</span>
                        <span className="text-stone-400">•</span>
                        <span className="text-stone-500">
                          {recipe.tools.map((tl) => `${TOOL_META[tl].emoji} ${TOOL_META[tl].en}`).join(', ')}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-[11px]">
                        <span
                          className={`font-semibold ${
                            allIngredientsInStock ? 'text-emerald-700' : 'text-amber-700'
                          }`}
                        >
                          {allIngredientsInStock
                            ? `✓ All ${totalIngredients} ingredients in stock`
                            : `In stock: ${matchedCount}/${totalIngredients} (missing ${missingIngredients
                                .map((m) => m.name)
                                .join(', ')})`}
                        </span>
                        <button
                          type="button"
                          onClick={() => setExpandedLibraryId(showIngs ? null : recipe.id)}
                          className="font-semibold text-stone-500 hover:text-stone-900 shrink-0 ml-2"
                        >
                          {showIngs ? 'Hide items' : 'Ingredients'}
                        </button>
                      </div>

                      {showIngs && (
                        <div className="flex flex-wrap gap-1 pt-1">
                          {recipe.ingredients.map((ing, idx) => (
                            <span
                              key={idx}
                              className="text-[11px] px-2 py-0.5 rounded-md bg-stone-50 border border-stone-200 text-stone-700"
                            >
                              <strong>{Number((ing.portionsNeeded * servings).toFixed(1))}×</strong>{' '}
                              {ing.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Direct Cook & Deduct Controls on Every Library Card */}
                    <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-stone-100">
                      <div className="inline-flex items-center gap-0.5 bg-stone-100 p-0.5 rounded-lg text-[11px] font-bold">
                        <button
                          type="button"
                          onClick={() =>
                            setLibraryServings((prev) => ({ ...prev, [recipe.id]: 1 }))
                          }
                          className={`px-2 py-1 rounded-md transition ${
                            servings === 1
                              ? 'bg-white text-teal-800 shadow-2xs'
                              : 'text-stone-500'
                          }`}
                        >
                          1×
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setLibraryServings((prev) => ({ ...prev, [recipe.id]: 2 }))
                          }
                          className={`px-2 py-1 rounded-md transition ${
                            servings === 2
                              ? 'bg-white text-teal-800 shadow-2xs'
                              : 'text-stone-500'
                          }`}
                        >
                          2×
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setLibraryServings((prev) => ({
                              ...prev,
                              [recipe.id]: servings >= 3 ? servings + 1 : 4,
                            }))
                          }
                          className={`px-2 py-1 rounded-md transition ${
                            servings >= 3
                              ? 'bg-indigo-700 text-white shadow-2xs'
                              : 'text-stone-500'
                          }`}
                        >
                          {servings >= 3 ? `${servings}×` : '+'}
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => onCookRecipeDirect(recipe.id, servings)}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-stone-900 hover:bg-teal-800 text-white px-3.5 py-1.5 text-xs font-semibold transition"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Cooked &amp; Deduct ({servings}×)
                      </button>
                    </div>
                  </div>
                );
              }
            )}
          </div>
        )}
      </div>
    </div>
  );
};
