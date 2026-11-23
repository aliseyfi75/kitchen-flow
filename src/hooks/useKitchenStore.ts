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
import { supabase } from '../services/supabaseClient';
import { createCleanState, stripLegacyDemoData } from '../data/seedData';
import { computeItemForecast, getLearnedStoreId, updateEmaCycleDays } from '../utils/forecasting';
import {
  formatItemStockSummary,
  formatMeasuredAmount,
  formatRestockLabel,
  formatShoppingQuantityLabel,
  getLevelWord,
} from '../utils/inventoryDisplay';
import {
  getCategoryProfile,
  inferProductDefaultsFromText,
  parseMeasuredQuantity,
} from '../utils/productCategories';

export interface ToastMessage {
  id: string;
  text: string;
  tone?: 'teal' | 'amber' | 'rose';
}

export type SyncStatus = 'local_demo' | 'loading' | 'synced' | 'saving' | 'offline';

export interface CloudSyncContext {
  householdId: string;
  displayName: string;
}

const CLIENT_INSTANCE_ID = Math.random().toString(36).slice(2, 10);

function mergeRemoteState(remote: Partial<KitchenState>): KitchenState {
  const defaults = createCleanState();
  return {
    ...defaults,
    ...remote,
    settings: {
      ...defaults.settings,
      ...(remote.settings || {}),
      language: 'en',
    },
  };
}

export function useKitchenStore(cloudContext?: CloudSyncContext | null) {
  const [state, setState] = useState<KitchenState>(() => kitchenRepo.load());
  const stateRef = useRef(state);
  stateRef.current = state;
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(
    cloudContext ? 'loading' : 'local_demo'
  );

  // Track whether the latest state change came from remote Realtime sync so we don't write it back
  const skipNextCloudSaveRef = useRef(false);
  const cloudReadyRef = useRef(false);
  const lastCloudUpdatedAtRef = useRef<string>('');
  const pendingOfflinePushRef = useRef(false);

  const notify = useCallback((text: string, tone: ToastMessage['tone'] = 'teal') => {
    const id = String(Date.now());
    setToast({ id, text, tone });
    window.setTimeout(() => {
      setToast((curr) => (curr?.id === id ? null : curr));
    }, 3400);
  }, []);

  // Always cache locally for instant startup & offline resilience
  useEffect(() => {
    kitchenRepo.save(state);
  }, [state]);

  // Initial load + Supabase Realtime + wake-up / reconnect auto-sync
  useEffect(() => {
    if (!cloudContext || !supabase) {
      cloudReadyRef.current = false;
      setSyncStatus('local_demo');
      return;
    }

    let active = true;
    const { householdId, displayName } = cloudContext;
    const actorTag = `${displayName}:${CLIENT_INSTANCE_ID}`;

    const applyRemoteRow = (
      row: { state?: Partial<KitchenState>; updated_at?: string; updated_by?: string },
      showBanner: boolean
    ) => {
      if (!row?.state) return;
      if (row.updated_by === actorTag) return;
      if (row.updated_at && row.updated_at <= lastCloudUpdatedAtRef.current) return;

      lastCloudUpdatedAtRef.current = row.updated_at || new Date().toISOString();
      skipNextCloudSaveRef.current = true;
      setState(mergeRemoteState(row.state));
      setSyncStatus('synced');

      if (showBanner) {
        const who = row.updated_by?.split(':')[0] || 'Household';
        notify(`Synced latest changes from ${who}`, 'teal');
      }
    };

    const pushLocalState = async () => {
      if (!supabase) return;
      const nowIso = new Date().toISOString();
      setSyncStatus('saving');
      const { error } = await supabase.from('household_state').upsert({
        household_id: householdId,
        state: stateRef.current,
        updated_at: nowIso,
        updated_by: actorTag,
      });
      if (!active) return;
      if (error) {
        pendingOfflinePushRef.current = true;
        setSyncStatus('offline');
      } else {
        pendingOfflinePushRef.current = false;
        lastCloudUpdatedAtRef.current = nowIso;
        setSyncStatus('synced');
      }
    };

    const pullLatestFromCloud = async (showBanner: boolean) => {
      if (!supabase || !active) return;
      if (pendingOfflinePushRef.current) {
        await pushLocalState();
        return;
      }
      const { data, error } = await supabase
        .from('household_state')
        .select('state, updated_at, updated_by')
        .eq('household_id', householdId)
        .maybeSingle();

      if (!active) return;
      if (error) {
        setSyncStatus('offline');
        return;
      }
      if (data?.state) {
        applyRemoteRow(
          data as { state: Partial<KitchenState>; updated_at?: string; updated_by?: string },
          showBanner
        );
      }
      setSyncStatus('synced');
    };

    const initCloud = async () => {
      setSyncStatus('loading');
      const { data, error } = await supabase!
        .from('household_state')
        .select('state, updated_at, updated_by')
        .eq('household_id', householdId)
        .maybeSingle();

      if (!active) return;

      if (error) {
        setSyncStatus('offline');
        return;
      }

      if (data?.state) {
        const merged = mergeRemoteState(data.state as Partial<KitchenState>);
        const { cleaned, changed } = stripLegacyDemoData(merged);
        if (changed) {
          // One-time cleanup of legacy prototype demo data in cloud
          const nowIso = new Date().toISOString();
          await supabase!.from('household_state').upsert({
            household_id: householdId,
            state: cleaned,
            updated_at: nowIso,
            updated_by: actorTag,
          });
          lastCloudUpdatedAtRef.current = nowIso;
        } else {
          lastCloudUpdatedAtRef.current = data.updated_at || '';
        }
        skipNextCloudSaveRef.current = true;
        setState(cleaned);
      } else {
        // First time ever for this household: initialize clean empty state in cloud
        const nowIso = new Date().toISOString();
        await supabase!.from('household_state').upsert({
          household_id: householdId,
          state: stateRef.current,
          updated_at: nowIso,
          updated_by: actorTag,
        });
        lastCloudUpdatedAtRef.current = nowIso;
      }

      cloudReadyRef.current = true;
      setSyncStatus('synced');
    };

    initCloud();

    // 1. Live WebSocket push (instant ~200ms sync when both phones are open)
    const channel = supabase
      .channel(`household-${householdId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'household_state',
          filter: `household_id=eq.${householdId}`,
        },
        (payload) => {
          const row = payload.new as {
            state?: Partial<KitchenState>;
            updated_at?: string;
            updated_by?: string;
          } | null;
          if (row) applyRemoteRow(row, true);
        }
      )
      .subscribe();

    // 2. Wake-up & reconnect sync (handles iOS/Android background sleep & grocery store dead zones)
    const handleResume = () => {
      if (document.visibilityState === 'visible') {
        pullLatestFromCloud(true);
      }
    };
    const handleOnline = () => {
      pullLatestFromCloud(true);
    };

    document.addEventListener('visibilitychange', handleResume);
    window.addEventListener('online', handleOnline);

    // 3. Lightweight 25s fallback poll while active in foreground (safety net if WebSocket sleeps)
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible' && cloudReadyRef.current) {
        pullLatestFromCloud(true);
      }
    }, 25000);

    return () => {
      active = false;
      cloudReadyRef.current = false;
      document.removeEventListener('visibilitychange', handleResume);
      window.removeEventListener('online', handleOnline);
      window.clearInterval(intervalId);
      supabase!.removeChannel(channel);
    };
  }, [cloudContext?.householdId, cloudContext?.displayName, notify]);

  // Debounced auto-save to cloud on any local edit
  useEffect(() => {
    if (!cloudContext || !supabase || !cloudReadyRef.current) return;
    if (skipNextCloudSaveRef.current) {
      skipNextCloudSaveRef.current = false;
      return;
    }

    setSyncStatus('saving');
    const actorTag = `${cloudContext.displayName}:${CLIENT_INSTANCE_ID}`;
    const timer = window.setTimeout(async () => {
      const nowIso = new Date().toISOString();
      const { error } = await supabase!.from('household_state').upsert({
        household_id: cloudContext.householdId,
        state: stateRef.current,
        updated_at: nowIso,
        updated_by: actorTag,
      });
      if (error) {
        pendingOfflinePushRef.current = true;
        setSyncStatus('offline');
      } else {
        pendingOfflinePushRef.current = false;
        lastCloudUpdatedAtRef.current = nowIso;
        setSyncStatus('synced');
      }
    }, 350);

    return () => window.clearTimeout(timer);
  }, [state, cloudContext?.householdId, cloudContext?.displayName]);

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
      quantityLabel: formatShoppingQuantityLabel(item),
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
      } else if (target.trackingMode === 'continuous') {
        const updatedPreview = { ...target, remainingPortions: nextRemaining };
        notify(
          `Logged -${amount} × ${target.portionLabel} of ${target.name} (${formatItemStockSummary(updatedPreview)})`,
          'teal'
        );
      } else {
        notify(`Logged -${amount} of ${target.name} (${nextRemaining} left)`, 'teal');
      }
    },
    [notify]
  );

  const setContinuousLevel = useCallback(
    (itemId: string, percent: number) => {
      const curr = stateRef.current;
      const target = curr.items.find((i) => i.id === itemId);
      if (!target) return;

      const clampedPct = Math.max(0, Math.min(100, Math.round(percent)));
      const nextRemaining =
        clampedPct === 0
          ? 0
          : Math.max(0.01, Number(((target.totalPortions * clampedPct) / 100).toFixed(2)));
      const storeName =
        curr.stores.find((s) => s.id === getLearnedStoreId(target))?.name ?? 'Shopping List';

      setState((prev) => {
        const prevTarget = prev.items.find((i) => i.id === itemId);
        if (!prevTarget) return prev;
        const computedRem =
          clampedPct === 0
            ? 0
            : Math.max(0.01, Number(((prevTarget.totalPortions * clampedPct) / 100).toFixed(2)));
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
      } else if (nextRemaining === 0) {
        notify(`${target.name} marked empty`, 'amber');
      } else if (target.containerSize && target.containerUnit) {
        const approx = formatMeasuredAmount((target.containerSize * clampedPct) / 100, target.containerUnit);
        notify(`${target.name} set to ${clampedPct}% (~${approx} left)`, 'teal');
      } else {
        notify(`${target.name} set to ${clampedPct}% (${getLevelWord(clampedPct)})`, 'teal');
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
        const res = prevTarget.autoAddOnEmpty
          ? ensureOnShoppingList(prev.shoppingList, prevTarget, 'finished', 'essential')
          : { list: prev.shoppingList, added: false };

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
      if (target.autoAddOnEmpty) {
        notify(`${target.name} finished → added to ${storeName} for next trip!`, 'amber');
      } else {
        notify(`${target.name} marked finished`, 'amber');
      }
    },
    [notify]
  );

  const quickRestock = useCallback(
    (itemId: string, storeId?: string, portions?: number) => {
      const curr = stateRef.current;
      const target = curr.items.find((i) => i.id === itemId);
      if (!target) return;

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
      notify(`Restocked ${target.name} (${formatRestockLabel(target)})`, 'teal');
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

  const updateItemLearning = useCallback(
    (
      itemId: string,
      patch: { avgDaysPerFullPack?: number; dailyBurnRate?: number; storeId?: string }
    ) => {
      const curr = stateRef.current;
      const target = curr.items.find((i) => i.id === itemId);
      if (!target) return;

      setState((prev) => {
        let nextShopping = prev.shoppingList;
        const nextItems = prev.items.map((item) => {
          if (item.id !== itemId) return item;
          let avgDays = item.avgDaysPerFullPack;

          if (patch.avgDaysPerFullPack !== undefined && Number.isFinite(patch.avgDaysPerFullPack)) {
            avgDays = Number(Math.max(1, Math.min(180, patch.avgDaysPerFullPack)).toFixed(1));
          } else if (patch.dailyBurnRate !== undefined && Number.isFinite(patch.dailyBurnRate)) {
            const safeRate = Math.max(0.05, Math.min(100, patch.dailyBurnRate));
            avgDays = Number(Math.max(1, Math.min(180, item.totalPortions / safeRate)).toFixed(1));
          }

          let defaultStoreId = item.defaultStoreId;
          let storePurchaseCounts = item.storePurchaseCounts;
          if (patch.storeId && patch.storeId !== defaultStoreId) {
            defaultStoreId = patch.storeId;
            const maxCount = Math.max(0, ...Object.values(item.storePurchaseCounts || {}));
            storePurchaseCounts = {
              ...(item.storePurchaseCounts || {}),
              [patch.storeId]: maxCount + 1,
            };
            // Keep any active unchecked shopping entry in sync with the updated preferred store
            nextShopping = nextShopping.map((s) =>
              s.inventoryItemId === itemId && !s.checked ? { ...s, storeId: patch.storeId! } : s
            );
          }

          return {
            ...item,
            avgDaysPerFullPack: avgDays,
            defaultStoreId,
            storePurchaseCounts,
          };
        });

        return {
          ...prev,
          items: nextItems,
          shoppingList: nextShopping,
        };
      });

      notify(`Updated learned forecast for ${target.name}`, 'teal');
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
          ? `Added manually — currently have ${formatItemStockSummary(item)}`
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
                remainingPortions: Number((item.remainingPortions + ov.targetPortions).toFixed(2)),
                totalPortions:
                  item.trackingMode === 'continuous'
                    ? item.totalPortions
                    : Math.max(item.totalPortions, ov.targetPortions),
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
            const inferred = inferProductDefaultsFromText(`${s.name} ${s.alias || ''}`);
            const category = inferred?.category ?? 'pantry_staple';
            const profile = getCategoryProfile(category);
            const trackingMode = inferred?.trackingMode ?? profile.defaultTrackingMode;
            const measured = parseMeasuredQuantity(s.quantityLabel);
            const isContinuous = trackingMode === 'continuous';
            const continuousStyle = isContinuous
              ? measured
                ? 'measured'
                : inferred?.continuousStyle ?? profile.defaultContinuousStyle
              : undefined;
            const totalQty = isContinuous && continuousStyle === 'level_only' ? 100 : ov.targetPortions;

            nextItems.unshift({
              id: newId,
              name: s.name,
              alias: s.alias || '',
              category,
              zone: ov.targetZone,
              trackingMode,
              continuousStyle,
              containerSize: isContinuous ? measured?.size : undefined,
              containerUnit: isContinuous ? measured?.unit : undefined,
              totalPortions: totalQty,
              remainingPortions: totalQty,
              portionLabel: isContinuous ? 'container' : profile.defaultPortionLabel,
              packDescription: s.quantityLabel || `${ov.targetPortions} portions`,
              proteinPerPortion: 0,
              defaultStoreId: ov.storeId,
              storePurchaseCounts: { [ov.storeId]: 1 },
              avgDaysPerFullPack: profile.defaultAvgDays,
              cycleCount: 0,
              lastRestockedAt: nowIso,
              autoAddOnEmpty: profile.defaultAutoAdd,
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

  const updateStore = useCallback((storeId: string, patch: Partial<Omit<Store, 'id'>>) => {
    setState((prev) => ({
      ...prev,
      stores: prev.stores.map((s) => (s.id === storeId ? { ...s, ...patch } : s)),
    }));
  }, []);

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
    (
      recipe: Omit<MealRecipe, 'id'> & { id?: string },
      newInventoryItems: InventoryItem[] = []
    ) => {
      const assignedId = recipe.id || `rec-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
      setState((prev) => {
        const existingCuisines = prev.settings.cuisines || [];
        const hasCuisine = existingCuisines.some(
          (c) => c.toLowerCase() === recipe.cuisine.toLowerCase()
        );
        return {
          ...prev,
          items: newInventoryItems.length > 0 ? [...newInventoryItems, ...prev.items] : prev.items,
          recipes: [{ ...recipe, id: assignedId }, ...prev.recipes],
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
      return assignedId;
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
                remainingPortions: Number((item.remainingPortions + line.portionsToAdd).toFixed(2)),
                totalPortions:
                  item.trackingMode === 'continuous'
                    ? item.totalPortions
                    : Math.max(item.totalPortions, line.portionsToAdd),
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
            const profile = getCategoryProfile(line.category);
            const inferred = inferProductDefaultsFromText(`${line.name} ${line.alias}`);
            const trackingMode = line.trackingMode ?? inferred?.trackingMode ?? profile.defaultTrackingMode;
            const measured = parseMeasuredQuantity(line.packDescription) ?? parseMeasuredQuantity(line.name);
            const isContinuous = trackingMode === 'continuous';
            const continuousStyle = isContinuous
              ? measured
                ? 'measured'
                : inferred?.continuousStyle ?? profile.defaultContinuousStyle
              : undefined;
            const totalQty =
              isContinuous && continuousStyle === 'level_only'
                ? 100
                : Math.max(1, line.portionsToAdd || profile.defaultPortionCount);

            nextItems.unshift({
              id: newId,
              name: line.name.trim(),
              alias: line.alias.trim(),
              category: line.category,
              zone: line.zone,
              trackingMode,
              continuousStyle,
              containerSize: isContinuous ? measured?.size : undefined,
              containerUnit: isContinuous ? measured?.unit : undefined,
              totalPortions: totalQty,
              remainingPortions: totalQty,
              portionLabel: line.portionLabel || (isContinuous ? 'container' : profile.defaultPortionLabel),
              packDescription: line.packDescription || `${totalQty} portions`,
              proteinPerPortion: 0,
              defaultStoreId: storeId,
              storePurchaseCounts: { [storeId]: 1 },
              avgDaysPerFullPack: profile.defaultAvgDays,
              cycleCount: 0,
              lastRestockedAt: nowIso,
              autoAddOnEmpty: profile.defaultAutoAdd,
            });
            newEvents.unshift({
              id: `ev-${Date.now()}-${newId}`,
              itemId: newId,
              type: 'restock',
              deltaPortions: totalQty,
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

  return {
    state,
    toast,
    syncStatus,
    usePortion,
    setContinuousLevel,
    markFinished,
    quickRestock,
    saveItem,
    deleteItem,
    updateItemLearning,
    syncForecastToShoppingList,
    addKitchenItemToShoppingManually,
    addShoppingItem,
    toggleShoppingChecked,
    updateShoppingItem,
    removeShoppingItem,
    completeShoppingTrip,
    applyReceiptItems,
    addStore,
    updateStore,
    deleteStore,
    addRecipe: addRecipeWithNewIngredients,
    addCuisine,
    cookRecipeDirect,
    toggleFavoriteRecipe,
    setWeeklyPlan,
    updatePlannedMealServings,
    markMealCooked,
    updateSettings,
    notify,
  };
}
