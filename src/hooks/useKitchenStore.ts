import { useCallback, useEffect, useRef, useState } from 'react';
import {
  HouseholdSettings,
  InventoryItem,
  KitchenState,
  MealRecipe,
  PlannedMeal,
  ReceiptParsedItem,
  ShoppingItem,
  ShoppingReason,
  StorageZone,
  Store,
} from '../types/kitchen';
import { kitchenRepo } from '../services/storage';
import { computeItemForecast, getLearnedStoreId, updateEmaCycleDays } from '../utils/forecasting';

export interface ToastMessage {
  id: string;
  text: string;
  tone?: 'teal' | 'amber' | 'rose';
}

export function useKitchenStore() {
  const [state, setState] = useState<KitchenState>(() => kitchenRepo.load());
  const stateRef = useRef(state);
  stateRef.current = state;
  const [toast, setToast] = useState<ToastMessage | null>(null);

  useEffect(() => {
    kitchenRepo.save(state);
  }, [state]);

  const notify = useCallback((text: string, tone: ToastMessage['tone'] = 'teal') => {
    const id = String(Date.now());
    setToast({ id, text, tone });
    window.setTimeout(() => {
      setToast((curr) => (curr?.id === id ? null : curr));
    }, 3400);
  }, []);

  const ensureOnShoppingList = (
    shoppingList: ShoppingItem[],
    item: InventoryItem,
    reason: ShoppingReason,
    priority: 'essential' | 'optional' = 'essential',
    note?: string
  ): { list: ShoppingItem[]; added: boolean } => {
    const existing = shoppingList.find((s) => s.inventoryItemId === item.id);
    if (existing) {
      return {
        added: false,
        list: shoppingList.map((s) =>
          s.id === existing.id
            ? {
                ...s,
                priority: priority === 'essential' ? 'essential' : s.priority,
                note: note ?? s.note,
                checked: false,
              }
            : s
        ),
      };
    }

    const storeId = getLearnedStoreId(item);
    const newEntry: ShoppingItem = {
      id: `shop-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      inventoryItemId: item.id,
      name: item.name,
      alias: item.alias,
      storeId,
      quantityLabel: `${item.packDescription} (${item.totalPortions} portions)`,
      targetPortions: item.totalPortions,
      targetZone: item.zone,
      priority,
      reason,
      note,
      checked: false,
      addedAt: new Date().toISOString(),
    };
    return { added: true, list: [newEntry, ...shoppingList] };
  };

  const usePortion = useCallback(
    (itemId: string, amount = 1) => {
      const curr = stateRef.current;
      const target = curr.items.find((i) => i.id === itemId);
      if (!target || target.remainingPortions <= 0) return;

      const nextRemaining = Math.max(0, Number((target.remainingPortions - amount).toFixed(2)));
      const storeName =
        curr.stores.find((s) => s.id === getLearnedStoreId(target))?.name ?? 'Shopping List';

      setState((prev) => {
        const prevTarget = prev.items.find((i) => i.id === itemId);
        if (!prevTarget || prevTarget.remainingPortions <= 0) return prev;

        const computedRem = Math.max(0, Number((prevTarget.remainingPortions - amount).toFixed(2)));
        const nowIso = new Date().toISOString();
        let nextShopping = prev.shoppingList;
        let avgDaysPerFullPack = prevTarget.avgDaysPerFullPack;
        let cycleCount = prevTarget.cycleCount;

        if (computedRem === 0) {
          const ema = updateEmaCycleDays(
            prevTarget.avgDaysPerFullPack,
            prevTarget.lastRestockedAt,
            prevTarget.cycleCount
          );
          avgDaysPerFullPack = ema.avgDaysPerFullPack;
          cycleCount = ema.cycleCount;
          if (prevTarget.autoAddOnEmpty) {
            nextShopping = ensureOnShoppingList(prev.shoppingList, prevTarget, 'finished', 'essential').list;
          }
        }

        return {
          ...prev,
          items: prev.items.map((i) =>
            i.id === itemId
              ? {
                  ...i,
                  remainingPortions: computedRem,
                  lastUsedAt: nowIso,
                  avgDaysPerFullPack,
                  cycleCount,
                }
              : i
          ),
          shoppingList: nextShopping,
          events: [
            {
              id: `ev-${Date.now()}`,
              itemId,
              type: computedRem === 0 ? 'finished' : 'use_portion',
              deltaPortions: -amount,
              timestamp: nowIso,
              actor: prev.settings.activeUser,
            },
            ...prev.events.slice(0, 199),
          ],
        };
      });

      if (nextRemaining === 0 && target.autoAddOnEmpty) {
        notify(`${target.name} finished → auto-added to ${storeName}!`, 'amber');
      } else {
        notify(`Logged -${amount} portion of ${target.name} (${nextRemaining} left)`, 'teal');
      }
    },
    [notify]
  );

  const setContinuousLevel = useCallback(
    (itemId: string, percent: number) => {
      const curr = stateRef.current;
      const target = curr.items.find((i) => i.id === itemId);
      if (!target) return;

      const nextRemaining =
        percent === 0 ? 0 : Math.max(0.5, Number(((target.totalPortions * percent) / 100).toFixed(1)));
      const storeName =
        curr.stores.find((s) => s.id === getLearnedStoreId(target))?.name ?? 'Shopping List';

      setState((prev) => {
        const prevTarget = prev.items.find((i) => i.id === itemId);
        if (!prevTarget) return prev;
        const computedRem =
          percent === 0 ? 0 : Math.max(0.5, Number(((prevTarget.totalPortions * percent) / 100).toFixed(1)));
        const nowIso = new Date().toISOString();
        let nextShopping = prev.shoppingList;
        let avgDaysPerFullPack = prevTarget.avgDaysPerFullPack;
        let cycleCount = prevTarget.cycleCount;

        if (computedRem === 0) {
          const ema = updateEmaCycleDays(
            prevTarget.avgDaysPerFullPack,
            prevTarget.lastRestockedAt,
            prevTarget.cycleCount
          );
          avgDaysPerFullPack = ema.avgDaysPerFullPack;
          cycleCount = ema.cycleCount;
          if (prevTarget.autoAddOnEmpty) {
            nextShopping = ensureOnShoppingList(prev.shoppingList, prevTarget, 'finished', 'essential').list;
          }
        }

        return {
          ...prev,
          items: prev.items.map((i) =>
            i.id === itemId
              ? {
                  ...i,
                  remainingPortions: computedRem,
                  lastUsedAt: nowIso,
                  avgDaysPerFullPack,
                  cycleCount,
                }
              : i
          ),
          shoppingList: nextShopping,
          events: [
            {
              id: `ev-${Date.now()}`,
              itemId,
              type: computedRem === 0 ? 'finished' : 'level_adjust',
              deltaPortions: computedRem - prevTarget.remainingPortions,
              timestamp: nowIso,
              actor: prev.settings.activeUser,
            },
            ...prev.events.slice(0, 199),
          ],
        };
      });

      if (nextRemaining === 0 && target.autoAddOnEmpty) {
        notify(`${target.name} marked empty → added to ${storeName}!`, 'amber');
      } else {
        notify(`${target.name} set to ${percent}%`, 'teal');
      }
    },
    [notify]
  );

  const markFinished = useCallback(
    (itemId: string) => {
      const curr = stateRef.current;
      const target = curr.items.find((i) => i.id === itemId);
      if (!target) return;
      const storeName =
        curr.stores.find((s) => s.id === getLearnedStoreId(target))?.name ?? 'Shopping List';

      setState((prev) => {
        const prevTarget = prev.items.find((i) => i.id === itemId);
        if (!prevTarget) return prev;
        const nowIso = new Date().toISOString();
        const ema = updateEmaCycleDays(
          prevTarget.avgDaysPerFullPack,
          prevTarget.lastRestockedAt,
          prevTarget.cycleCount
        );
        const res = ensureOnShoppingList(prev.shoppingList, prevTarget, 'finished', 'essential');

        return {
          ...prev,
          items: prev.items.map((i) =>
            i.id === itemId
              ? {
                  ...i,
                  remainingPortions: 0,
                  lastUsedAt: nowIso,
                  avgDaysPerFullPack: ema.avgDaysPerFullPack,
                  cycleCount: ema.cycleCount,
                }
              : i
          ),
          shoppingList: res.list,
          events: [
            {
              id: `ev-${Date.now()}`,
              itemId,
              type: 'finished',
              deltaPortions: -prevTarget.remainingPortions,
              timestamp: nowIso,
              actor: prev.settings.activeUser,
            },
            ...prev.events.slice(0, 199),
          ],
        };
      });
      notify(`${target.name} finished → added to ${storeName} for next trip!`, 'amber');
    },
    [notify]
  );

  const quickRestock = useCallback(
    (itemId: string, storeId?: string, portions?: number) => {
      const curr = stateRef.current;
      const target = curr.items.find((i) => i.id === itemId);
      if (!target) return;
      const newPortions = portions ?? target.totalPortions;

      setState((prev) => {
        const prevTarget = prev.items.find((i) => i.id === itemId);
        if (!prevTarget) return prev;
        const usedStoreId = storeId || getLearnedStoreId(prevTarget);
        const restockQty = portions ?? prevTarget.totalPortions;
        const nowIso = new Date().toISOString();
        const counts = { ...(prevTarget.storePurchaseCounts || {}) };
        counts[usedStoreId] = (counts[usedStoreId] || 0) + 1;

        return {
          ...prev,
          items: prev.items.map((i) =>
            i.id === itemId
              ? {
                  ...i,
                  remainingPortions: restockQty,
                  totalPortions: Math.max(i.totalPortions, restockQty),
                  defaultStoreId: usedStoreId,
                  storePurchaseCounts: counts,
                  lastRestockedAt: nowIso,
                }
              : i
          ),
          shoppingList: prev.shoppingList.filter((s) => s.inventoryItemId !== itemId),
          events: [
            {
              id: `ev-${Date.now()}`,
              itemId,
              type: 'restock',
              deltaPortions: restockQty,
              storeId: usedStoreId,
              timestamp: nowIso,
              actor: prev.settings.activeUser,
            },
            ...prev.events.slice(0, 199),
          ],
        };
      });
      notify(`Restocked ${target.name} (+${newPortions} portions)`, 'teal');
    },
    [notify]
  );

  const saveItem = useCallback(
    (item: InventoryItem, isNew: boolean) => {
      setState((prev) => ({
        ...prev,
        items: isNew ? [item, ...prev.items] : prev.items.map((i) => (i.id === item.id ? item : i)),
      }));
      notify(isNew ? `Added ${item.name} to ${item.zone}` : `Updated ${item.name}`, 'teal');
    },
    [notify]
  );

  const deleteItem = useCallback(
    (itemId: string) => {
      setState((prev) => ({
        ...prev,
        items: prev.items.filter((i) => i.id !== itemId),
        shoppingList: prev.shoppingList.filter((s) => s.inventoryItemId !== itemId),
      }));
      notify('Removed item from kitchen', 'rose');
    },
    [notify]
  );

  const syncForecastToShoppingList = useCallback(() => {
    const curr = stateRef.current;
    let addedCount = 0;
    for (const item of curr.items) {
      const fc = computeItemForecast(item, curr.settings.shoppingDay);
      const needsThisTrip =
        fc.verdict === 'out' ||
        fc.verdict === 'buy_this_weekend' ||
        fc.verdict === 'runs_out_next_week';
      const alreadyListed = curr.shoppingList.some((s) => s.inventoryItemId === item.id);
      if (needsThisTrip && !alreadyListed) addedCount += 1;
    }

    setState((prev) => {
      let nextList = [...prev.shoppingList];
      for (const item of prev.items) {
        const fc = computeItemForecast(item, prev.settings.shoppingDay);
        if (
          fc.verdict === 'out' ||
          fc.verdict === 'buy_this_weekend' ||
          fc.verdict === 'runs_out_next_week'
        ) {
          const reason: ShoppingReason =
            fc.verdict === 'out'
              ? 'finished'
              : fc.verdict === 'runs_out_next_week'
              ? 'forecast_midweek'
              : 'forecast_weekend';
          const res = ensureOnShoppingList(
            nextList,
            item,
            reason,
            'essential',
            fc.forecastDescription
          );
          nextList = res.list;
        }
      }
      return { ...prev, shoppingList: nextList };
    });

    if (addedCount > 0) {
      notify(
        `Added ${addedCount} projected item(s) (including mid-week run-outs) to this weekend's list`,
        'teal'
      );
    } else {
      notify('Shopping list is already synced with your weekend & next-week forecast!', 'teal');
    }
  }, [notify]);

  const addKitchenItemToShoppingManually = useCallback(
    (itemId: string) => {
      const curr = stateRef.current;
      const item = curr.items.find((i) => i.id === itemId);
      if (!item) return;
      const storeName =
        curr.stores.find((s) => s.id === getLearnedStoreId(item))?.name ?? 'Shopping List';
      const note =
        item.remainingPortions > 0
          ? `Added manually — currently have ${item.remainingPortions}/${item.totalPortions} left`
          : 'Added manually (out of stock)';

      setState((prev) => {
        const target = prev.items.find((i) => i.id === itemId);
        if (!target) return prev;
        const res = ensureOnShoppingList(
          prev.shoppingList,
          target,
          'manual_from_kitchen',
          'essential',
          note
        );
        return { ...prev, shoppingList: res.list };
      });
      notify(`Added ${item.name} manually to ${storeName} (stock noted)`, 'teal');
    },
    [notify]
  );

  const addShoppingItem = useCallback(
    (entry: Omit<ShoppingItem, 'id' | 'addedAt' | 'checked'>) => {
      setState((prev) => ({
        ...prev,
        shoppingList: [
          {
            ...entry,
            id: `shop-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            checked: false,
            addedAt: new Date().toISOString(),
          },
          ...prev.shoppingList,
        ],
      }));
      notify(`Added ${entry.name} to shopping list`, 'teal');
    },
    [notify]
  );

  const toggleShoppingChecked = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      shoppingList: prev.shoppingList.map((s) => (s.id === id ? { ...s, checked: !s.checked } : s)),
    }));
  }, []);

  const updateShoppingItem = useCallback((id: string, patch: Partial<ShoppingItem>) => {
    setState((prev) => ({
      ...prev,
      shoppingList: prev.shoppingList.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }));
  }, []);

  const removeShoppingItem = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      shoppingList: prev.shoppingList.filter((s) => s.id !== id),
    }));
  }, []);

  const completeShoppingTrip = useCallback(
    (
      overrides: Record<string, { targetPortions: number; targetZone: StorageZone; storeId: string }>
    ) => {
      let restockedCount = 0;
      setState((prev) => {
        const checkedItems = prev.shoppingList.filter((s) => s.checked);
        if (checkedItems.length === 0) return prev;
        restockedCount = checkedItems.length;

        const nowIso = new Date().toISOString();
        let nextItems = [...prev.items];
        const newEvents = [...prev.events];

        for (const s of checkedItems) {
          const ov = overrides[s.id] || {
            targetPortions: s.targetPortions,
            targetZone: s.targetZone,
            storeId: s.storeId,
          };

          if (s.inventoryItemId) {
            nextItems = nextItems.map((item) => {
              if (item.id !== s.inventoryItemId) return item;
              const counts = { ...(item.storePurchaseCounts || {}) };
              counts[ov.storeId] = (counts[ov.storeId] || 0) + 1;
              return {
                ...item,
                remainingPortions: Number((item.remainingPortions + ov.targetPortions).toFixed(1)),
                totalPortions: Math.max(item.totalPortions, ov.targetPortions),
                zone: ov.targetZone,
                defaultStoreId: ov.storeId,
                storePurchaseCounts: counts,
                lastRestockedAt: nowIso,
              };
            });
            newEvents.unshift({
              id: `ev-${Date.now()}-${s.id}`,
              itemId: s.inventoryItemId,
              type: 'restock',
              deltaPortions: ov.targetPortions,
              storeId: ov.storeId,
              timestamp: nowIso,
              actor: prev.settings.activeUser,
            });
          } else {
            const newId = `item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            nextItems.unshift({
              id: newId,
              name: s.name,
              alias: s.alias || '',
              category: 'pantry_staple',
              zone: ov.targetZone,
              trackingMode: 'portioned',
              totalPortions: ov.targetPortions,
              remainingPortions: ov.targetPortions,
              portionLabel: '1 portion',
              packDescription: s.quantityLabel || `${ov.targetPortions} portions`,
              proteinPerPortion: 0,
              defaultStoreId: ov.storeId,
              storePurchaseCounts: { [ov.storeId]: 1 },
              avgDaysPerFullPack: 10,
              cycleCount: 0,
              lastRestockedAt: nowIso,
              autoAddOnEmpty: true,
            });
          }
        }

        return {
          ...prev,
          items: nextItems,
          shoppingList: prev.shoppingList.filter((s) => !s.checked),
          events: newEvents.slice(0, 200),
        };
      });

      if (restockedCount > 0) {
        notify(`Restocked ${restockedCount} item(s) & updated learned store preferences!`, 'teal');
      }
    },
    [notify]
  );

  const addStore = useCallback(
    (store: Omit<Store, 'id'>) => {
      setState((prev) => ({
        ...prev,
        stores: [...prev.stores, { ...store, id: `store-${Date.now()}` }],
      }));
      notify(`Added store: ${store.name}`, 'teal');
    },
    [notify]
  );

  const deleteStore = useCallback(
    (storeId: string) => {
      setState((prev) => {
        if (prev.stores.length <= 1) return prev;
        const fallbackId = prev.stores.find((s) => s.id !== storeId)!.id;
        return {
          ...prev,
          stores: prev.stores.filter((s) => s.id !== storeId),
          items: prev.items.map((i) =>
            i.defaultStoreId === storeId ? { ...i, defaultStoreId: fallbackId } : i
          ),
          shoppingList: prev.shoppingList.map((s) =>
            s.storeId === storeId ? { ...s, storeId: fallbackId } : s
          ),
        };
      });
      notify('Store removed', 'amber');
    },
    [notify]
  );

  const addRecipeWithNewIngredients = useCallback(
    (recipe: Omit<MealRecipe, 'id'>, newInventoryItems: InventoryItem[] = []) => {
      setState((prev) => {
        const existingCuisines = prev.settings.cuisines || [];
        const hasCuisine = existingCuisines.some(
          (c) => c.toLowerCase() === recipe.cuisine.toLowerCase()
        );
        return {
          ...prev,
          items: newInventoryItems.length > 0 ? [...newInventoryItems, ...prev.items] : prev.items,
          recipes: [{ ...recipe, id: `rec-${Date.now()}` }, ...prev.recipes],
          settings: hasCuisine
            ? prev.settings
            : { ...prev.settings, cuisines: [...existingCuisines, recipe.cuisine] },
        };
      });
      notify(
        newInventoryItems.length > 0
          ? `Saved "${recipe.name}" & added ${newInventoryItems.length} new ingredient(s) to Kitchen!`
          : `Saved "${recipe.name}" to your food library`,
        'teal'
      );
    },
    [notify]
  );

  const addCuisine = useCallback(
    (cuisineName: string) => {
      const clean = cuisineName.trim();
      if (!clean) return;
      setState((prev) => {
        const existing = prev.settings.cuisines || [];
        if (existing.some((c) => c.toLowerCase() === clean.toLowerCase())) return prev;
        return {
          ...prev,
          settings: { ...prev.settings, cuisines: [...existing, clean] },
        };
      });
      notify(`Added cuisine: ${clean}`, 'teal');
    },
    [notify]
  );

  const cookRecipeDirect = useCallback(
    (recipeId: string, servings: number) => {
      const curr = stateRef.current;
      const recipe = curr.recipes.find((r) => r.id === recipeId);
      if (!recipe) return;
      const mult = Math.max(1, servings);

      setState((prev) => {
        const rec = prev.recipes.find((r) => r.id === recipeId);
        if (!rec) return prev;
        const nowIso = new Date().toISOString();
        let nextShopping = prev.shoppingList;
        const newEvents = [...prev.events];

        const nextItems = prev.items.map((item) => {
          const ing = rec.ingredients.find((x) => x.itemId === item.id);
          if (!ing) return item;
          const deducted = Number((ing.portionsNeeded * mult).toFixed(2));
          const nextRem = Math.max(0, Number((item.remainingPortions - deducted).toFixed(2)));
          newEvents.unshift({
            id: `ev-${Date.now()}-${item.id}`,
            itemId: item.id,
            type: nextRem === 0 ? 'finished' : 'use_portion',
            deltaPortions: -deducted,
            timestamp: nowIso,
            actor: prev.settings.activeUser,
          });
          if (nextRem === 0 && item.autoAddOnEmpty) {
            nextShopping = ensureOnShoppingList(
              nextShopping,
              item,
              'finished',
              'essential',
              'Ran out while cooking'
            ).list;
          }
          return { ...item, remainingPortions: nextRem, lastUsedAt: nowIso };
        });

        return {
          ...prev,
          items: nextItems,
          shoppingList: nextShopping,
          events: newEvents.slice(0, 200),
        };
      });

      notify(`Cooked "${recipe.name}" (${mult}×) & deducted exact ingredients from Kitchen!`, 'teal');
    },
    [notify]
  );

  const toggleFavoriteRecipe = useCallback((recipeId: string) => {
    setState((prev) => ({
      ...prev,
      recipes: prev.recipes.map((r) =>
        r.id === recipeId ? { ...r, isFavorite: !r.isFavorite } : r
      ),
    }));
  }, []);

  const setWeeklyPlan = useCallback((plan: PlannedMeal[]) => {
    setState((prev) => ({ ...prev, weeklyPlan: plan }));
  }, []);

  const updatePlannedMealServings = useCallback((plannedMealId: string, servings: number) => {
    setState((prev) => ({
      ...prev,
      weeklyPlan: prev.weeklyPlan.map((m) =>
        m.id === plannedMealId ? { ...m, servings: Math.max(1, Math.min(12, servings)) } : m
      ),
    }));
  }, []);

  const markMealCooked = useCallback(
    (plannedMealId: string, deductFromInventory: boolean) => {
      const curr = stateRef.current;
      const targetMeal = curr.weeklyPlan.find((m) => m.id === plannedMealId);
      if (!targetMeal) return;
      const targetRecipe = curr.recipes.find((r) => r.id === targetMeal.recipeId);
      const cookedTitle = targetRecipe?.name || 'Meal';
      const servingCount = targetMeal.servings || 1;

      setState((prev) => {
        const meal = prev.weeklyPlan.find((m) => m.id === plannedMealId);
        if (!meal) return prev;
        const recipe = prev.recipes.find((r) => r.id === meal.recipeId);
        const mult = meal.servings || 1;

        let nextItems = prev.items;
        let nextShopping = prev.shoppingList;
        const nowIso = new Date().toISOString();

        if (deductFromInventory && recipe && !meal.cooked) {
          nextItems = prev.items.map((item) => {
            const ing = recipe.ingredients.find((x) => x.itemId === item.id);
            if (!ing) return item;
            const totalNeeded = Number((ing.portionsNeeded * mult).toFixed(1));
            const nextRem = Math.max(0, Number((item.remainingPortions - totalNeeded).toFixed(1)));
            if (nextRem === 0 && item.autoAddOnEmpty) {
              const res = ensureOnShoppingList(nextShopping, item, 'finished', 'essential');
              nextShopping = res.list;
            }
            return { ...item, remainingPortions: nextRem, lastUsedAt: nowIso };
          });
        }

        return {
          ...prev,
          items: nextItems,
          shoppingList: nextShopping,
          weeklyPlan: prev.weeklyPlan.map((m) =>
            m.id === plannedMealId ? { ...m, cooked: !m.cooked } : m
          ),
        };
      });
      notify(
        deductFromInventory
          ? `Cooked "${cookedTitle}" (${servingCount}× servings) & deducted from kitchen!`
          : `Updated "${cookedTitle}" status`,
        'teal'
      );
    },
    [notify]
  );

  const applyReceiptItems = useCallback(
    (storeId: string, parsedItems: ReceiptParsedItem[]) => {
      if (parsedItems.length === 0) return;
      const curr = stateRef.current;
      const storeName = curr.stores.find((s) => s.id === storeId)?.name ?? 'Store';

      setState((prev) => {
        const nowIso = new Date().toISOString();
        let nextItems = [...prev.items];
        const matchedIds = new Set<string>();
        const newEvents = [...prev.events];

        for (const line of parsedItems) {
          if (line.matchedItemId) {
            matchedIds.add(line.matchedItemId);
            nextItems = nextItems.map((item) => {
              if (item.id !== line.matchedItemId) return item;
              const counts = { ...(item.storePurchaseCounts || {}) };
              counts[storeId] = (counts[storeId] || 0) + 1;
              return {
                ...item,
                remainingPortions: Number((item.remainingPortions + line.portionsToAdd).toFixed(1)),
                totalPortions: Math.max(item.totalPortions, line.portionsToAdd),
                zone: line.zone,
                defaultStoreId: storeId,
                storePurchaseCounts: counts,
                lastRestockedAt: nowIso,
              };
            });
            newEvents.unshift({
              id: `ev-${Date.now()}-${line.id}`,
              itemId: line.matchedItemId,
              type: 'restock',
              deltaPortions: line.portionsToAdd,
              storeId,
              timestamp: nowIso,
              actor: prev.settings.activeUser,
            });
          } else {
            const newId = `item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            nextItems.unshift({
              id: newId,
              name: line.name.trim(),
              alias: line.alias.trim(),
              category: line.category,
              zone: line.zone,
              trackingMode: 'portioned',
              totalPortions: line.portionsToAdd,
              remainingPortions: line.portionsToAdd,
              portionLabel: line.portionLabel || '1 portion',
              packDescription: line.packDescription || `${line.portionsToAdd} portions`,
              proteinPerPortion: 0,
              defaultStoreId: storeId,
              storePurchaseCounts: { [storeId]: 1 },
              avgDaysPerFullPack: 10,
              cycleCount: 0,
              lastRestockedAt: nowIso,
              autoAddOnEmpty: true,
            });
            newEvents.unshift({
              id: `ev-${Date.now()}-${newId}`,
              itemId: newId,
              type: 'restock',
              deltaPortions: line.portionsToAdd,
              storeId,
              timestamp: nowIso,
              actor: prev.settings.activeUser,
            });
          }
        }

        // Clear any matching items from shopping list
        const parsedNames = new Set(parsedItems.map((p) => p.name.toLowerCase()));
        const nextShopping = prev.shoppingList.filter((s) => {
          if (s.inventoryItemId && matchedIds.has(s.inventoryItemId)) return false;
          if (parsedNames.has(s.name.toLowerCase())) return false;
          return true;
        });

        return {
          ...prev,
          items: nextItems,
          shoppingList: nextShopping,
          events: newEvents.slice(0, 200),
        };
      });

      notify(`Receipt scanned! Restocked ${parsedItems.length} item(s) from ${storeName}.`, 'teal');
    },
    [notify]
  );

  const updateSettings = useCallback((patch: Partial<HouseholdSettings>) => {
    setState((prev) => ({
      ...prev,
      settings: { ...prev.settings, ...patch },
    }));
  }, []);

  const resetDemo = useCallback(() => {
    const fresh = kitchenRepo.reset();
    setState(fresh);
    notify('Reset to fresh sample household data', 'teal');
  }, [notify]);

  return {
    state,
    toast,
    usePortion,
    setContinuousLevel,
    markFinished,
    quickRestock,
    saveItem,
    deleteItem,
    syncForecastToShoppingList,
    addKitchenItemToShoppingManually,
    addShoppingItem,
    toggleShoppingChecked,
    updateShoppingItem,
    removeShoppingItem,
    completeShoppingTrip,
    applyReceiptItems,
    addStore,
    deleteStore,
    addRecipe: addRecipeWithNewIngredients,
    addCuisine,
    cookRecipeDirect,
    toggleFavoriteRecipe,
    setWeeklyPlan,
    updatePlannedMealServings,
    markMealCooked,
    updateSettings,
    resetDemo,
    notify,
  };
}
