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
import { clearTombstones, mergeKitchenStates, recordTombstones } from '../utils/stateSync';
import { ProposedInventoryUpdate } from '../utils/voiceInventoryParser';
import { appendPriceRecord, formatCurrency } from '../utils/priceInsights';

export interface ToastMessage {
  id: string;
  text: string;
  tone?: 'teal' | 'amber' | 'rose';
  undoLabel?: string;
  onUndo?: () => void;
}

export type SyncStatus = 'local_demo' | 'loading' | 'synced' | 'saving' | 'offline';

export interface CloudSyncContext {
  householdId: string;
  displayName: string;
}

const CLIENT_INSTANCE_ID = Math.random().toString(36).slice(2, 10);

function normalizeRemoteState(remote: Partial<KitchenState>): KitchenState {
  const defaults = createCleanState();
  return {
    ...defaults,
    ...remote,
    settings: {
      ...defaults.settings,
      ...(remote.settings || {}),
    },
    syncMeta: remote.syncMeta ?? {},
  };
}

function stampRestoredSnapshot(snapshot: KitchenState, restoredIds: string[]): KitchenState {
  const nowIso = new Date().toISOString();
  const idSet = new Set(restoredIds);
  return {
    ...snapshot,
    items: snapshot.items.map((i) => (idSet.has(i.id) ? { ...i, updatedAt: nowIso } : i)),
    stores: snapshot.stores.map((s) => (idSet.has(s.id) ? { ...s, updatedAt: nowIso } : s)),
    shoppingList: snapshot.shoppingList.map((s) =>
      idSet.has(s.id) ? { ...s, updatedAt: nowIso } : s
    ),
    recipes: snapshot.recipes.map((r) => (idSet.has(r.id) ? { ...r, updatedAt: nowIso } : r)),
    weeklyPlan: snapshot.weeklyPlan.map((m) =>
      idSet.has(m.id) ? { ...m, updatedAt: nowIso } : m
    ),
    syncMeta: clearTombstones(snapshot.syncMeta, restoredIds),
  };
}

export function useKitchenStore(cloudContext?: CloudSyncContext | null) {
  const [state, setState] = useState<KitchenState>(() => kitchenRepo.load());
  const stateRef = useRef(state);
  stateRef.current = state;
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(
    cloudContext ? 'loading' : 'local_demo'
  );

  // Track whether the latest state change came from remote Realtime sync so we don't write it back
  const skipNextCloudSaveRef = useRef(false);
  const cloudReadyRef = useRef(false);
  const lastCloudUpdatedAtRef = useRef<string>('');
  const pendingOfflinePushRef = useRef(false);
  const hasUnsavedLocalEditRef = useRef(false);

  const actorNameRef = useRef(cloudContext?.displayName || '');
  actorNameRef.current = cloudContext?.displayName || '';

  const resolveActor = useCallback((fallback: string) => {
    return actorNameRef.current || fallback || 'Household';
  }, []);

  const dismissToast = useCallback(() => {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setToast(null);
  }, []);

  const notify = useCallback(
    (
      text: string,
      tone: ToastMessage['tone'] = 'teal',
      undo?: { label?: string; onUndo: () => void }
    ) => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
      setToast({
        id,
        text,
        tone,
        undoLabel: undo ? undo.label || 'Undo' : undefined,
        onUndo: undo
          ? () => {
              undo.onUndo();
              dismissToast();
            }
          : undefined,
      });
      toastTimerRef.current = window.setTimeout(
        () => {
          setToast((curr) => (curr?.id === id ? null : curr));
          toastTimerRef.current = null;
        },
        undo ? 5200 : 3400
      );
    },
    [dismissToast]
  );

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  // Always cache locally for instant startup & offline resilience
  useEffect(() => {
    kitchenRepo.save(state);
  }, [state]);

  // Initial load + Supabase Realtime + wake-up / reconnect auto-sync with entity-level merge
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
      const normalizedRemote = normalizeRemoteState(row.state);

      if (hasUnsavedLocalEditRef.current || pendingOfflinePushRef.current) {
        // Merge concurrent local edits with incoming remote state instead of clobbering either side
        const merged = mergeKitchenStates(stateRef.current, normalizedRemote, {
          preferRemoteOnTie: true,
        });
        setState(merged);
      } else {
        skipNextCloudSaveRef.current = true;
        setState(normalizedRemote);
        setSyncStatus('synced');
      }

      if (showBanner) {
        const who = row.updated_by?.split(':')[0] || 'Household';
        notify(`Synced latest changes from ${who}`, 'teal');
      }
    };

    const pushStateToCloud = async (stateToPush: KitchenState) => {
      if (!supabase) return;
      const nowIso = new Date().toISOString();
      setSyncStatus('saving');
      const { error } = await supabase.from('household_state').upsert({
        household_id: householdId,
        state: stateToPush,
        updated_at: nowIso,
        updated_by: actorTag,
      });
      if (!active) return;
      if (error) {
        pendingOfflinePushRef.current = true;
        setSyncStatus('offline');
      } else {
        pendingOfflinePushRef.current = false;
        hasUnsavedLocalEditRef.current = false;
        lastCloudUpdatedAtRef.current = nowIso;
        setSyncStatus('synced');
      }
    };

    const pullLatestFromCloud = async (showBanner: boolean) => {
      if (!supabase || !active) return;

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

      // If we made offline edits, merge them with latest remote state BEFORE pushing!
      if (pendingOfflinePushRef.current) {
        let stateToPush = stateRef.current;
        if (data?.state) {
          const normalizedRemote = normalizeRemoteState(data.state as Partial<KitchenState>);
          stateToPush = mergeKitchenStates(stateRef.current, normalizedRemote, {
            preferRemoteOnTie: false,
          });
          skipNextCloudSaveRef.current = true;
          setState(stateToPush);
        }
        await pushStateToCloud(stateToPush);
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
        const merged = normalizeRemoteState(data.state as Partial<KitchenState>);
        const { cleaned, changed } = stripLegacyDemoData(merged);
        if (changed) {
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

    // 3. Lightweight 25s fallback poll while active in foreground
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

    hasUnsavedLocalEditRef.current = true;
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
        hasUnsavedLocalEditRef.current = false;
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
    note?: string,
    nowIso = new Date().toISOString()
  ): { list: ShoppingItem[]; added: boolean; id: string } => {
    const existing = shoppingList.find((s) => s.inventoryItemId === item.id);
    if (existing) {
      return {
        added: false,
        id: existing.id,
        list: shoppingList.map((s) =>
          s.id === existing.id
            ? {
                ...s,
                priority: priority === 'essential' ? 'essential' : s.priority,
                note: note ?? s.note,
                checked: false,
                updatedAt: nowIso,
              }
            : s
        ),
      };
    }

    const storeId = getLearnedStoreId(item);
    const id = `shop-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const newEntry: ShoppingItem = {
      id,
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
      addedAt: nowIso,
      updatedAt: nowIso,
    };
    return { added: true, id, list: [newEntry, ...shoppingList] };
  };

  const restoreSnapshot = useCallback(
    (snapshot: KitchenState, restoredIds: string[], message = 'Undone') => {
      setState(stampRestoredSnapshot(snapshot, restoredIds));
      notify(message, 'teal');
    },
    [notify]
  );

  const usePortion = useCallback(
    (itemId: string, amount = 1) => {
      const snapshot = stateRef.current;
      const target = snapshot.items.find((i) => i.id === itemId);
      if (!target || target.remainingPortions <= 0) return;

      const nextRemaining = Math.max(0, Number((target.remainingPortions - amount).toFixed(2)));
      const storeName =
        snapshot.stores.find((s) => s.id === getLearnedStoreId(target))?.name ?? 'Shopping List';

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
            nextShopping = ensureOnShoppingList(
              prev.shoppingList,
              prevTarget,
              'finished',
              'essential',
              undefined,
              nowIso
            ).list;
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
                  updatedAt: nowIso,
                  avgDaysPerFullPack,
                  cycleCount,
                }
              : i
          ),
          shoppingList: nextShopping,
          events: [
            {
              id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
              itemId,
              type: computedRem === 0 ? 'finished' : 'use_portion',
              deltaPortions: -amount,
              timestamp: nowIso,
              actor: resolveActor(prev.settings.activeUser),
            },
            ...prev.events.slice(0, 199),
          ],
        };
      });

      const undo = {
        onUndo: () => restoreSnapshot(snapshot, [itemId], `Restored ${target.name}`),
      };

      if (nextRemaining === 0 && target.autoAddOnEmpty) {
        notify(`${target.name} finished → auto-added to ${storeName}!`, 'amber', undo);
      } else if (target.trackingMode === 'continuous') {
        const updatedPreview = { ...target, remainingPortions: nextRemaining };
        notify(
          `Logged -${amount} × ${target.portionLabel} of ${target.name} (${formatItemStockSummary(updatedPreview)})`,
          'teal',
          undo
        );
      } else {
        notify(`Logged -${amount} of ${target.name} (${nextRemaining} left)`, 'teal', undo);
      }
    },
    [notify, resolveActor, restoreSnapshot]
  );

  const setContinuousLevel = useCallback(
    (itemId: string, percent: number) => {
      const snapshot = stateRef.current;
      const target = snapshot.items.find((i) => i.id === itemId);
      if (!target) return;

      const clampedPct = Math.max(0, Math.min(100, Math.round(percent)));
      const nextRemaining =
        clampedPct === 0
          ? 0
          : Math.max(0.01, Number(((target.totalPortions * clampedPct) / 100).toFixed(2)));
      const storeName =
        snapshot.stores.find((s) => s.id === getLearnedStoreId(target))?.name ?? 'Shopping List';

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
            nextShopping = ensureOnShoppingList(
              prev.shoppingList,
              prevTarget,
              'finished',
              'essential',
              undefined,
              nowIso
            ).list;
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
                  updatedAt: nowIso,
                  avgDaysPerFullPack,
                  cycleCount,
                }
              : i
          ),
          shoppingList: nextShopping,
          events: [
            {
              id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
              itemId,
              type: computedRem === 0 ? 'finished' : 'level_adjust',
              deltaPortions: Number((computedRem - prevTarget.remainingPortions).toFixed(2)),
              timestamp: nowIso,
              actor: resolveActor(prev.settings.activeUser),
            },
            ...prev.events.slice(0, 199),
          ],
        };
      });

      const undo = {
        onUndo: () => restoreSnapshot(snapshot, [itemId], `Restored ${target.name} level`),
      };

      if (nextRemaining === 0 && target.autoAddOnEmpty) {
        notify(`${target.name} marked empty → added to ${storeName}!`, 'amber', undo);
      } else if (nextRemaining === 0) {
        notify(`${target.name} marked empty`, 'amber', undo);
      } else if (target.containerSize && target.containerUnit) {
        const approx = formatMeasuredAmount(
          (target.containerSize * clampedPct) / 100,
          target.containerUnit
        );
        notify(`${target.name} set to ${clampedPct}% (~${approx} left)`, 'teal', undo);
      } else {
        notify(`${target.name} set to ${clampedPct}% (${getLevelWord(clampedPct)})`, 'teal', undo);
      }
    },
    [notify, resolveActor, restoreSnapshot]
  );

  const markFinished = useCallback(
    (itemId: string) => {
      const snapshot = stateRef.current;
      const target = snapshot.items.find((i) => i.id === itemId);
      if (!target) return;
      const storeName =
        snapshot.stores.find((s) => s.id === getLearnedStoreId(target))?.name ?? 'Shopping List';

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
          ? ensureOnShoppingList(prev.shoppingList, prevTarget, 'finished', 'essential', undefined, nowIso)
          : { list: prev.shoppingList, added: false };

        return {
          ...prev,
          items: prev.items.map((i) =>
            i.id === itemId
              ? {
                  ...i,
                  remainingPortions: 0,
                  lastUsedAt: nowIso,
                  updatedAt: nowIso,
                  avgDaysPerFullPack: ema.avgDaysPerFullPack,
                  cycleCount: ema.cycleCount,
                }
              : i
          ),
          shoppingList: res.list,
          events: [
            {
              id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
              itemId,
              type: 'finished',
              deltaPortions: -prevTarget.remainingPortions,
              timestamp: nowIso,
              actor: resolveActor(prev.settings.activeUser),
            },
            ...prev.events.slice(0, 199),
          ],
        };
      });

      const undo = {
        onUndo: () => restoreSnapshot(snapshot, [itemId], `Restored ${target.name}`),
      };
      if (target.autoAddOnEmpty) {
        notify(`${target.name} finished → added to ${storeName}!`, 'amber', undo);
      } else {
        notify(`${target.name} marked finished`, 'amber', undo);
      }
    },
    [notify, resolveActor, restoreSnapshot]
  );

  const quickRestock = useCallback(
    (itemId: string, storeId?: string, portions?: number) => {
      const snapshot = stateRef.current;
      const target = snapshot.items.find((i) => i.id === itemId);
      if (!target) return;

      setState((prev) => {
        const prevTarget = prev.items.find((i) => i.id === itemId);
        if (!prevTarget) return prev;
        const usedStoreId = storeId || getLearnedStoreId(prevTarget);
        const restockQty = portions ?? prevTarget.totalPortions;
        const nowIso = new Date().toISOString();
        const counts = { ...(prevTarget.storePurchaseCounts || {}) };
        counts[usedStoreId] = (counts[usedStoreId] || 0) + 1;
        const removedShopIds = prev.shoppingList
          .filter((s) => s.inventoryItemId === itemId)
          .map((s) => s.id);

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
                  updatedAt: nowIso,
                }
              : i
          ),
          shoppingList: prev.shoppingList.filter((s) => s.inventoryItemId !== itemId),
          syncMeta:
            removedShopIds.length > 0
              ? recordTombstones(prev.syncMeta, removedShopIds, nowIso)
              : prev.syncMeta,
          events: [
            {
              id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
              itemId,
              type: 'restock',
              deltaPortions: restockQty,
              storeId: usedStoreId,
              timestamp: nowIso,
              actor: resolveActor(prev.settings.activeUser),
            },
            ...prev.events.slice(0, 199),
          ],
        };
      });
      notify(`Restocked ${target.name} (${formatRestockLabel(target)})`, 'teal', {
        onUndo: () => restoreSnapshot(snapshot, [itemId], `Undid restock of ${target.name}`),
      });
    },
    [notify, resolveActor, restoreSnapshot]
  );

  const saveItem = useCallback(
    (item: InventoryItem, isNew: boolean) => {
      const nowIso = new Date().toISOString();
      const stamped: InventoryItem = { ...item, updatedAt: nowIso };
      setState((prev) => ({
        ...prev,
        items: isNew
          ? [stamped, ...prev.items]
          : prev.items.map((i) => (i.id === stamped.id ? stamped : i)),
        syncMeta: clearTombstones(prev.syncMeta, [stamped.id]),
      }));
      notify(isNew ? `Added ${item.name} to ${item.zone}` : `Updated ${item.name}`, 'teal');
    },
    [notify]
  );

  const addItemsBatch = useCallback(
    (newItems: InventoryItem[]) => {
      if (newItems.length === 0) return;
      const snapshot = stateRef.current;
      const nowIso = new Date().toISOString();
      const stamped = newItems.map((it) => ({ ...it, updatedAt: nowIso }));
      const addedIds = stamped.map((it) => it.id);

      setState((prev) => ({
        ...prev,
        items: [...stamped, ...prev.items],
        syncMeta: clearTombstones(prev.syncMeta, addedIds),
      }));

      notify(`Added ${stamped.length} staple(s) to your Kitchen!`, 'teal', {
        onUndo: () => {
          setState({
            ...snapshot,
            syncMeta: recordTombstones(snapshot.syncMeta, addedIds, new Date().toISOString()),
          });
          notify('Undid starter staples', 'amber');
        },
      });
    },
    [notify]
  );

  const deleteItem = useCallback(
    (itemId: string) => {
      const snapshot = stateRef.current;
      const target = snapshot.items.find((i) => i.id === itemId);
      const removedShopIds = snapshot.shoppingList
        .filter((s) => s.inventoryItemId === itemId)
        .map((s) => s.id);
      const nowIso = new Date().toISOString();

      setState((prev) => ({
        ...prev,
        items: prev.items.filter((i) => i.id !== itemId),
        shoppingList: prev.shoppingList.filter((s) => s.inventoryItemId !== itemId),
        syncMeta: recordTombstones(prev.syncMeta, [itemId, ...removedShopIds], nowIso),
      }));

      notify(`Removed ${target?.name ?? 'item'} from kitchen`, 'rose', {
        onUndo: () =>
          restoreSnapshot(
            snapshot,
            [itemId, ...removedShopIds],
            `Restored ${target?.name ?? 'item'}`
          ),
      });
    },
    [notify, restoreSnapshot]
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
        const nowIso = new Date().toISOString();
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
            nextShopping = nextShopping.map((s) =>
              s.inventoryItemId === itemId && !s.checked
                ? { ...s, storeId: patch.storeId!, updatedAt: nowIso }
                : s
            );
          }

          return {
            ...item,
            avgDaysPerFullPack: avgDays,
            defaultStoreId,
            storePurchaseCounts,
            updatedAt: nowIso,
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
      const nowIso = new Date().toISOString();
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
            fc.forecastDescription,
            nowIso
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
      const nowIso = new Date().toISOString();
      setState((prev) => ({
        ...prev,
        shoppingList: [
          {
            ...entry,
            id: `shop-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            checked: false,
            addedAt: nowIso,
            updatedAt: nowIso,
          },
          ...prev.shoppingList,
        ],
      }));
      notify(`Added ${entry.name} to shopping list`, 'teal');
    },
    [notify]
  );

  const toggleShoppingChecked = useCallback((id: string) => {
    const nowIso = new Date().toISOString();
    setState((prev) => ({
      ...prev,
      shoppingList: prev.shoppingList.map((s) =>
        s.id === id ? { ...s, checked: !s.checked, updatedAt: nowIso } : s
      ),
    }));
  }, []);

  const updateShoppingItem = useCallback((id: string, patch: Partial<ShoppingItem>) => {
    const nowIso = new Date().toISOString();
    setState((prev) => ({
      ...prev,
      shoppingList: prev.shoppingList.map((s) =>
        s.id === id ? { ...s, ...patch, updatedAt: nowIso } : s
      ),
    }));
  }, []);

  const removeShoppingItem = useCallback(
    (id: string) => {
      const snapshot = stateRef.current;
      const target = snapshot.shoppingList.find((s) => s.id === id);
      const nowIso = new Date().toISOString();

      setState((prev) => ({
        ...prev,
        shoppingList: prev.shoppingList.filter((s) => s.id !== id),
        syncMeta: recordTombstones(prev.syncMeta, [id], nowIso),
      }));

      notify(`Removed ${target?.name ?? 'item'} from shopping list`, 'amber', {
        onUndo: () => restoreSnapshot(snapshot, [id], `Restored ${target?.name ?? 'item'}`),
      });
    },
    [notify, restoreSnapshot]
  );

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
        const actor = resolveActor(prev.settings.activeUser);
        const removedShopIds = checkedItems.map((s) => s.id);

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
                updatedAt: nowIso,
              };
            });
            newEvents.unshift({
              id: `ev-${Date.now()}-${s.id}`,
              itemId: s.inventoryItemId,
              type: 'restock',
              deltaPortions: ov.targetPortions,
              storeId: ov.storeId,
              timestamp: nowIso,
              actor,
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
              updatedAt: nowIso,
              autoAddOnEmpty: profile.defaultAutoAdd,
            });
            newEvents.unshift({
              id: `ev-${Date.now()}-${newId}`,
              itemId: newId,
              type: 'restock',
              deltaPortions: totalQty,
              storeId: ov.storeId,
              timestamp: nowIso,
              actor,
            });
          }
        }

        return {
          ...prev,
          items: nextItems,
          shoppingList: prev.shoppingList.filter((s) => !s.checked),
          syncMeta: recordTombstones(prev.syncMeta, removedShopIds, nowIso),
          events: newEvents.slice(0, 200),
        };
      });

      if (restockedCount > 0) {
        notify(`Restocked ${restockedCount} item(s) & updated learned store preferences!`, 'teal');
      }
    },
    [notify, resolveActor]
  );

  const addStore = useCallback(
    (store: Omit<Store, 'id'>) => {
      const nowIso = new Date().toISOString();
      setState((prev) => ({
        ...prev,
        stores: [...prev.stores, { ...store, id: `store-${Date.now()}`, updatedAt: nowIso }],
      }));
      notify(`Added store: ${store.name}`, 'teal');
    },
    [notify]
  );

  const updateStore = useCallback((storeId: string, patch: Partial<Omit<Store, 'id'>>) => {
    const nowIso = new Date().toISOString();
    setState((prev) => ({
      ...prev,
      stores: prev.stores.map((s) => (s.id === storeId ? { ...s, ...patch, updatedAt: nowIso } : s)),
    }));
  }, []);

  const deleteStore = useCallback(
    (storeId: string) => {
      const snapshot = stateRef.current;
      if (snapshot.stores.length <= 1) return;
      const target = snapshot.stores.find((s) => s.id === storeId);
      const nowIso = new Date().toISOString();

      setState((prev) => {
        if (prev.stores.length <= 1) return prev;
        const fallbackId = prev.stores.find((s) => s.id !== storeId)!.id;
        return {
          ...prev,
          stores: prev.stores.filter((s) => s.id !== storeId),
          items: prev.items.map((i) =>
            i.defaultStoreId === storeId ? { ...i, defaultStoreId: fallbackId, updatedAt: nowIso } : i
          ),
          shoppingList: prev.shoppingList.map((s) =>
            s.storeId === storeId ? { ...s, storeId: fallbackId, updatedAt: nowIso } : s
          ),
          syncMeta: recordTombstones(prev.syncMeta, [storeId], nowIso),
        };
      });

      notify(`Removed store: ${target?.name ?? 'Store'}`, 'amber', {
        onUndo: () => restoreSnapshot(snapshot, [storeId], `Restored ${target?.name ?? 'store'}`),
      });
    },
    [notify, restoreSnapshot]
  );

  const addRecipeWithNewIngredients = useCallback(
    (
      recipe: Omit<MealRecipe, 'id'> & { id?: string },
      newInventoryItems: InventoryItem[] = []
    ) => {
      const nowIso = new Date().toISOString();
      const assignedId = recipe.id || `rec-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
      const stampedItems = newInventoryItems.map((it) => ({ ...it, updatedAt: nowIso }));
      setState((prev) => {
        const existingCuisines = prev.settings.cuisines || [];
        const hasCuisine = existingCuisines.some(
          (c) => c.toLowerCase() === recipe.cuisine.toLowerCase()
        );
        return {
          ...prev,
          items: stampedItems.length > 0 ? [...stampedItems, ...prev.items] : prev.items,
          recipes: [{ ...recipe, id: assignedId, updatedAt: nowIso }, ...prev.recipes],
          settings: hasCuisine
            ? prev.settings
            : { ...prev.settings, cuisines: [...existingCuisines, recipe.cuisine] },
          syncMeta: hasCuisine
            ? prev.syncMeta
            : { ...prev.syncMeta, settingsUpdatedAt: nowIso },
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

  const updateRecipe = useCallback(
    (recipe: MealRecipe, newInventoryItems: InventoryItem[] = []) => {
      const nowIso = new Date().toISOString();
      const stampedItems = newInventoryItems.map((it) => ({ ...it, updatedAt: nowIso }));
      setState((prev) => {
        const existingCuisines = prev.settings.cuisines || [];
        const hasCuisine = existingCuisines.some(
          (c) => c.toLowerCase() === recipe.cuisine.toLowerCase()
        );
        return {
          ...prev,
          items: stampedItems.length > 0 ? [...stampedItems, ...prev.items] : prev.items,
          recipes: prev.recipes.map((r) =>
            r.id === recipe.id ? { ...recipe, updatedAt: nowIso } : r
          ),
          settings: hasCuisine
            ? prev.settings
            : { ...prev.settings, cuisines: [...existingCuisines, recipe.cuisine] },
          syncMeta: hasCuisine
            ? prev.syncMeta
            : { ...prev.syncMeta, settingsUpdatedAt: nowIso },
        };
      });
      notify(`Updated "${recipe.name}"`, 'teal');
    },
    [notify]
  );

  const deleteRecipe = useCallback(
    (recipeId: string) => {
      const snapshot = stateRef.current;
      const target = snapshot.recipes.find((r) => r.id === recipeId);
      const removedPlanIds = snapshot.weeklyPlan
        .filter((m) => m.recipeId === recipeId)
        .map((m) => m.id);
      const nowIso = new Date().toISOString();

      setState((prev) => ({
        ...prev,
        recipes: prev.recipes.filter((r) => r.id !== recipeId),
        weeklyPlan: prev.weeklyPlan.filter((m) => m.recipeId !== recipeId),
        syncMeta: recordTombstones(prev.syncMeta, [recipeId, ...removedPlanIds], nowIso),
      }));

      notify(`Deleted "${target?.name ?? 'meal'}" from library`, 'rose', {
        onUndo: () =>
          restoreSnapshot(
            snapshot,
            [recipeId, ...removedPlanIds],
            `Restored "${target?.name ?? 'meal'}"`
          ),
      });
    },
    [notify, restoreSnapshot]
  );

  const addCuisine = useCallback(
    (cuisineName: string) => {
      const clean = cuisineName.trim();
      if (!clean) return;
      const nowIso = new Date().toISOString();
      setState((prev) => {
        const existing = prev.settings.cuisines || [];
        if (existing.some((c) => c.toLowerCase() === clean.toLowerCase())) return prev;
        return {
          ...prev,
          settings: { ...prev.settings, cuisines: [...existing, clean] },
          syncMeta: { ...prev.syncMeta, settingsUpdatedAt: nowIso },
        };
      });
      notify(`Added cuisine: ${clean}`, 'teal');
    },
    [notify]
  );

  const cookRecipeDirect = useCallback(
    (recipeId: string, servings: number) => {
      const snapshot = stateRef.current;
      const recipe = snapshot.recipes.find((r) => r.id === recipeId);
      if (!recipe) return;
      const mult = Math.max(1, servings);
      const touchedIds: string[] = [];

      setState((prev) => {
        const rec = prev.recipes.find((r) => r.id === recipeId);
        if (!rec) return prev;
        const nowIso = new Date().toISOString();
        const actor = resolveActor(prev.settings.activeUser);
        let nextShopping = prev.shoppingList;
        const newEvents = [...prev.events];

        const nextItems = prev.items.map((item) => {
          const ing = rec.ingredients.find((x) => x.itemId === item.id);
          if (!ing) return item;
          touchedIds.push(item.id);
          const deducted = Number((ing.portionsNeeded * mult).toFixed(2));
          const nextRem = Math.max(0, Number((item.remainingPortions - deducted).toFixed(2)));
          let avgDaysPerFullPack = item.avgDaysPerFullPack;
          let cycleCount = item.cycleCount;

          if (nextRem === 0 && item.remainingPortions > 0) {
            const ema = updateEmaCycleDays(
              item.avgDaysPerFullPack,
              item.lastRestockedAt,
              item.cycleCount
            );
            avgDaysPerFullPack = ema.avgDaysPerFullPack;
            cycleCount = ema.cycleCount;
            if (item.autoAddOnEmpty) {
              nextShopping = ensureOnShoppingList(
                nextShopping,
                item,
                'finished',
                'essential',
                'Ran out while cooking',
                nowIso
              ).list;
            }
          }

          newEvents.unshift({
            id: `ev-${Date.now()}-${item.id}`,
            itemId: item.id,
            type: nextRem === 0 ? 'finished' : 'use_portion',
            deltaPortions: -deducted,
            timestamp: nowIso,
            actor,
          });
          return {
            ...item,
            remainingPortions: nextRem,
            lastUsedAt: nowIso,
            updatedAt: nowIso,
            avgDaysPerFullPack,
            cycleCount,
          };
        });

        return {
          ...prev,
          items: nextItems,
          shoppingList: nextShopping,
          events: newEvents.slice(0, 200),
        };
      });

      notify(`Cooked "${recipe.name}" (${mult}×) & deducted ingredients from Kitchen!`, 'teal', {
        onUndo: () => restoreSnapshot(snapshot, touchedIds, `Undid cooking "${recipe.name}"`),
      });
    },
    [notify, resolveActor, restoreSnapshot]
  );

  const toggleFavoriteRecipe = useCallback((recipeId: string) => {
    const nowIso = new Date().toISOString();
    setState((prev) => ({
      ...prev,
      recipes: prev.recipes.map((r) =>
        r.id === recipeId ? { ...r, isFavorite: !r.isFavorite, updatedAt: nowIso } : r
      ),
    }));
  }, []);

  const setWeeklyPlan = useCallback((plan: PlannedMeal[]) => {
    const nowIso = new Date().toISOString();
    setState((prev) => {
      const newIds = new Set(plan.map((m) => m.id));
      const removedIds = prev.weeklyPlan.filter((m) => !newIds.has(m.id)).map((m) => m.id);
      return {
        ...prev,
        weeklyPlan: plan.map((m) => ({ ...m, updatedAt: nowIso })),
        syncMeta:
          removedIds.length > 0
            ? recordTombstones(prev.syncMeta, removedIds, nowIso)
            : prev.syncMeta,
      };
    });
  }, []);

  const updatePlannedMealServings = useCallback((plannedMealId: string, servings: number) => {
    const nowIso = new Date().toISOString();
    setState((prev) => ({
      ...prev,
      weeklyPlan: prev.weeklyPlan.map((m) =>
        m.id === plannedMealId
          ? { ...m, servings: Math.max(1, Math.min(12, servings)), updatedAt: nowIso }
          : m
      ),
    }));
  }, []);

  const markMealCooked = useCallback(
    (plannedMealId: string, deductFromInventory: boolean) => {
      const snapshot = stateRef.current;
      const targetMeal = snapshot.weeklyPlan.find((m) => m.id === plannedMealId);
      if (!targetMeal) return;
      const targetRecipe = snapshot.recipes.find((r) => r.id === targetMeal.recipeId);
      const cookedTitle = targetRecipe?.name || 'Meal';
      const servingCount = targetMeal.servings || 1;
      const wasCooked = targetMeal.cooked;

      setState((prev) => {
        const meal = prev.weeklyPlan.find((m) => m.id === plannedMealId);
        if (!meal) return prev;
        const recipe = prev.recipes.find((r) => r.id === meal.recipeId);
        const mult = meal.servings || 1;
        const nowIso = new Date().toISOString();
        const actor = resolveActor(prev.settings.activeUser);

        let nextItems = prev.items;
        let nextShopping = prev.shoppingList;
        const newEvents = [...prev.events];
        let nextDeductedItems: { itemId: string; amount: number }[] | undefined = meal.deductedItems;

        if (!meal.cooked && deductFromInventory && recipe) {
          // Marking cooked: deduct ingredients, record exact amounts, log UsageEvents & EMA
          const applied: { itemId: string; amount: number }[] = [];
          nextItems = prev.items.map((item) => {
            const ing = recipe.ingredients.find((x) => x.itemId === item.id);
            if (!ing) return item;
            const totalNeeded = Number((ing.portionsNeeded * mult).toFixed(2));
            const actualDeducted = Number(
              Math.min(item.remainingPortions, totalNeeded).toFixed(2)
            );
            const nextRem = Math.max(0, Number((item.remainingPortions - totalNeeded).toFixed(2)));
            if (actualDeducted > 0) {
              applied.push({ itemId: item.id, amount: actualDeducted });
            }

            let avgDaysPerFullPack = item.avgDaysPerFullPack;
            let cycleCount = item.cycleCount;
            if (nextRem === 0 && item.remainingPortions > 0) {
              const ema = updateEmaCycleDays(
                item.avgDaysPerFullPack,
                item.lastRestockedAt,
                item.cycleCount
              );
              avgDaysPerFullPack = ema.avgDaysPerFullPack;
              cycleCount = ema.cycleCount;
              if (item.autoAddOnEmpty) {
                nextShopping = ensureOnShoppingList(
                  nextShopping,
                  item,
                  'finished',
                  'essential',
                  'Ran out while cooking',
                  nowIso
                ).list;
              }
            }

            newEvents.unshift({
              id: `ev-${Date.now()}-${item.id}`,
              itemId: item.id,
              type: nextRem === 0 ? 'finished' : 'use_portion',
              deltaPortions: -actualDeducted,
              timestamp: nowIso,
              actor,
            });

            return {
              ...item,
              remainingPortions: nextRem,
              lastUsedAt: nowIso,
              updatedAt: nowIso,
              avgDaysPerFullPack,
              cycleCount,
            };
          });
          nextDeductedItems = applied;
        } else if (meal.cooked) {
          // Un-marking cooked: restore exact previously deducted amounts so re-checking never double-deducts
          const toRestore = meal.deductedItems || [];
          if (toRestore.length > 0) {
            const restoreMap = new Map(toRestore.map((d) => [d.itemId, d.amount]));
            nextItems = prev.items.map((item) => {
              const amt = restoreMap.get(item.id);
              if (!amt) return item;
              return {
                ...item,
                remainingPortions: Number((item.remainingPortions + amt).toFixed(2)),
                updatedAt: nowIso,
              };
            });
          }
          nextDeductedItems = undefined;
        }

        return {
          ...prev,
          items: nextItems,
          shoppingList: nextShopping,
          events: newEvents.slice(0, 200),
          weeklyPlan: prev.weeklyPlan.map((m) =>
            m.id === plannedMealId
              ? { ...m, cooked: !m.cooked, deductedItems: nextDeductedItems, updatedAt: nowIso }
              : m
          ),
        };
      });

      if (!wasCooked && deductFromInventory) {
        notify(`Cooked "${cookedTitle}" (${servingCount}×) & deducted from kitchen!`, 'teal', {
          onUndo: () => restoreSnapshot(snapshot, [plannedMealId], `Undid cooking "${cookedTitle}"`),
        });
      } else if (wasCooked) {
        notify(`Unmarked "${cookedTitle}" & restored deducted ingredients`, 'amber');
      } else {
        notify(`Updated "${cookedTitle}" status`, 'teal');
      }
    },
    [notify, resolveActor, restoreSnapshot]
  );

  const applyReceiptItems = useCallback(
    (storeId: string, parsedItems: ReceiptParsedItem[]) => {
      if (parsedItems.length === 0) return;
      const curr = stateRef.current;
      const storeName = curr.stores.find((s) => s.id === storeId)?.name ?? 'Store';
      const receiptTotal = Number(
        parsedItems
          .reduce((sum, p) => sum + (typeof p.price === 'number' && p.price > 0 ? p.price : 0), 0)
          .toFixed(2)
      );

      setState((prev) => {
        const nowIso = new Date().toISOString();
        const actor = resolveActor(prev.settings.activeUser);
        let nextItems = [...prev.items];
        const matchedIds = new Set<string>();
        const newEvents = [...prev.events];

        for (const line of parsedItems) {
          const validPrice =
            typeof line.price === 'number' && Number.isFinite(line.price) && line.price > 0
              ? Number(line.price.toFixed(2))
              : undefined;

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
                ...(validPrice !== undefined
                  ? {
                      lastPrice: validPrice,
                      lastPriceStoreId: storeId,
                      priceHistory: appendPriceRecord(item.priceHistory, {
                        price: validPrice,
                        storeId,
                        date: nowIso,
                        packDescription: line.packDescription || item.packDescription,
                      }),
                    }
                  : {}),
                updatedAt: nowIso,
              };
            });
            newEvents.unshift({
              id: `ev-${Date.now()}-${line.id}`,
              itemId: line.matchedItemId,
              type: 'restock',
              deltaPortions: line.portionsToAdd,
              storeId,
              timestamp: nowIso,
              actor,
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
              ...(validPrice !== undefined
                ? {
                    lastPrice: validPrice,
                    lastPriceStoreId: storeId,
                    priceHistory: [
                      {
                        price: validPrice,
                        storeId,
                        date: nowIso,
                        packDescription: line.packDescription || `${totalQty} portions`,
                      },
                    ],
                  }
                : {}),
              updatedAt: nowIso,
              autoAddOnEmpty: profile.defaultAutoAdd,
            });
            newEvents.unshift({
              id: `ev-${Date.now()}-${newId}`,
              itemId: newId,
              type: 'restock',
              deltaPortions: totalQty,
              storeId,
              timestamp: nowIso,
              actor,
            });
          }
        }

        const parsedNames = new Set(parsedItems.map((p) => p.name.toLowerCase()));
        const removedShopIds: string[] = [];
        const nextShopping = prev.shoppingList.filter((s) => {
          const shouldClear =
            (s.inventoryItemId && matchedIds.has(s.inventoryItemId)) ||
            parsedNames.has(s.name.toLowerCase());
          if (shouldClear) removedShopIds.push(s.id);
          return !shouldClear;
        });

        const nextReceipts =
          receiptTotal > 0
            ? [
                {
                  id: `rcpt-${Date.now()}`,
                  storeId,
                  date: nowIso,
                  totalSpent: receiptTotal,
                  itemCount: parsedItems.length,
                },
                ...(prev.tripReceipts || []),
              ].slice(0, 100)
            : prev.tripReceipts || [];

        return {
          ...prev,
          items: nextItems,
          shoppingList: nextShopping,
          tripReceipts: nextReceipts,
          syncMeta:
            removedShopIds.length > 0
              ? recordTombstones(prev.syncMeta, removedShopIds, nowIso)
              : prev.syncMeta,
          events: newEvents.slice(0, 200),
        };
      });

      const priceNote = receiptTotal > 0 ? ` (${formatCurrency(receiptTotal)})` : '';
      notify(
        `Receipt scanned! Restocked ${parsedItems.length} item(s) from ${storeName}${priceNote}.`,
        'teal'
      );
    },
    [notify, resolveActor]
  );

  const applyVoiceInventoryUpdates = useCallback(
    (updates: ProposedInventoryUpdate[]) => {
      const selected = updates.filter((u) => u.included);
      if (selected.length === 0) return;

      const snapshot = stateRef.current;
      const nowIso = new Date().toISOString();
      const addedItemIds: string[] = [];
      const touchedItemIds: string[] = [];
      const clearedShopIds: string[] = [];
      let autoAddedCount = 0;

      setState((prev) => {
        const nextItems = [...prev.items];
        let nextShopping = [...prev.shoppingList];
        const newEvents = [...prev.events];
        const actor = resolveActor(prev.settings.activeUser);
        const fallbackStoreId = prev.stores[0]?.id ?? 'store-superstore';

        selected.forEach((upd, idx) => {
          if (upd.action === 'add_new' || !upd.matchedItemId) {
            const newId = `item-voice-${Date.now()}-${idx}`;
            addedItemIds.push(newId);
            const prof = getCategoryProfile(upd.suggestedCategory);
            const measured =
              upd.suggestedTrackingMode === 'continuous'
                ? parseMeasuredQuantity(upd.suggestedPackDescription)
                : null;
            const totalQty =
              upd.suggestedTrackingMode === 'continuous'
                ? Math.max(100, Math.round(upd.initialTotalPortions || 100))
                : Math.max(1, Number((upd.targetRemainingPortions || upd.initialTotalPortions || 1).toFixed(2)));
            const storeId = upd.storeId || fallbackStoreId;

            const created: InventoryItem = {
              id: newId,
              name: upd.name.trim() || 'New Kitchen Item',
              alias: upd.alias.trim(),
              zone: upd.suggestedZone,
              category: upd.suggestedCategory,
              trackingMode: upd.suggestedTrackingMode,
              continuousStyle:
                upd.suggestedTrackingMode === 'continuous'
                  ? measured
                    ? 'measured'
                    : 'level_only'
                  : undefined,
              containerSize: measured?.size,
              containerUnit: measured?.unit,
              totalPortions: totalQty,
              remainingPortions: Math.max(
                0,
                Number((upd.targetRemainingPortions || totalQty).toFixed(2))
              ),
              portionLabel: upd.portionLabel || prof.defaultPortionLabel,
              packDescription: upd.suggestedPackDescription || `${totalQty} portions`,
              proteinPerPortion: 0,
              defaultStoreId: storeId,
              storePurchaseCounts: { [storeId]: 1 },
              avgDaysPerFullPack: prof.defaultAvgDays,
              cycleCount: 0,
              lastRestockedAt: nowIso,
              updatedAt: nowIso,
              autoAddOnEmpty: prof.defaultAutoAdd,
            };

            nextItems.unshift(created);
            newEvents.unshift({
              id: `ev-${Date.now()}-vn-${idx}`,
              itemId: newId,
              type: 'restock',
              deltaPortions: created.remainingPortions,
              storeId,
              timestamp: nowIso,
              actor,
            });
            return;
          }

          const existingIdx = nextItems.findIndex((i) => i.id === upd.matchedItemId);
          if (existingIdx < 0) return;
          const prevTarget = nextItems[existingIdx];
          touchedItemIds.push(prevTarget.id);

          const nextRemaining = Math.max(0, Number(upd.targetRemainingPortions.toFixed(2)));
          const delta = Number((nextRemaining - prevTarget.remainingPortions).toFixed(2));

          if (upd.action === 'restock') {
            const usedStoreId = upd.storeId || getLearnedStoreId(prevTarget);
            const counts = { ...(prevTarget.storePurchaseCounts || {}) };
            counts[usedStoreId] = (counts[usedStoreId] || 0) + 1;

            nextItems[existingIdx] = {
              ...prevTarget,
              remainingPortions: nextRemaining,
              totalPortions:
                prevTarget.trackingMode === 'portioned'
                  ? Math.max(prevTarget.totalPortions, nextRemaining)
                  : prevTarget.totalPortions,
              defaultStoreId: usedStoreId,
              storePurchaseCounts: counts,
              lastRestockedAt: nowIso,
              updatedAt: nowIso,
            };

            const shopToRemove = nextShopping.filter((s) => s.inventoryItemId === prevTarget.id);
            if (shopToRemove.length > 0) {
              shopToRemove.forEach((s) => clearedShopIds.push(s.id));
              nextShopping = nextShopping.filter((s) => s.inventoryItemId !== prevTarget.id);
            }

            newEvents.unshift({
              id: `ev-${Date.now()}-vr-${idx}`,
              itemId: prevTarget.id,
              type: 'restock',
              deltaPortions: Math.max(0, delta),
              storeId: usedStoreId,
              timestamp: nowIso,
              actor,
            });
            return;
          }

          // 'use' | 'finish' | 'set_level'
          let avgDaysPerFullPack = prevTarget.avgDaysPerFullPack;
          let cycleCount = prevTarget.cycleCount;

          if (nextRemaining === 0 && prevTarget.remainingPortions > 0) {
            const ema = updateEmaCycleDays(
              prevTarget.avgDaysPerFullPack,
              prevTarget.lastRestockedAt,
              prevTarget.cycleCount
            );
            avgDaysPerFullPack = ema.avgDaysPerFullPack;
            cycleCount = ema.cycleCount;
            if (prevTarget.autoAddOnEmpty) {
              const res = ensureOnShoppingList(
                nextShopping,
                prevTarget,
                'finished',
                'essential',
                undefined,
                nowIso
              );
              nextShopping = res.list;
              if (res.added) autoAddedCount += 1;
            }
          }

          nextItems[existingIdx] = {
            ...prevTarget,
            remainingPortions: nextRemaining,
            lastUsedAt: nowIso,
            updatedAt: nowIso,
            avgDaysPerFullPack,
            cycleCount,
          };

          newEvents.unshift({
            id: `ev-${Date.now()}-vu-${idx}`,
            itemId: prevTarget.id,
            type:
              nextRemaining === 0
                ? 'finished'
                : upd.action === 'set_level'
                ? 'level_adjust'
                : 'use_portion',
            deltaPortions: delta,
            timestamp: nowIso,
            actor,
          });
        });

        let nextSyncMeta = prev.syncMeta;
        if (addedItemIds.length > 0) {
          nextSyncMeta = clearTombstones(nextSyncMeta, addedItemIds);
        }
        if (clearedShopIds.length > 0) {
          nextSyncMeta = recordTombstones(nextSyncMeta, clearedShopIds, nowIso);
        }

        return {
          ...prev,
          items: nextItems,
          shoppingList: nextShopping,
          syncMeta: nextSyncMeta,
          events: newEvents.slice(0, 200),
        };
      });

      const summary =
        autoAddedCount > 0
          ? `Applied ${selected.length} voice update(s) • ${autoAddedCount} auto-added to Shopping`
          : `Applied ${selected.length} kitchen update(s)`;

      notify(summary, autoAddedCount > 0 ? 'amber' : 'teal', {
        onUndo: () => {
          const undoIso = new Date().toISOString();
          const touchedSet = new Set(touchedItemIds);
          let undoSyncMeta = snapshot.syncMeta;
          if (addedItemIds.length > 0) {
            undoSyncMeta = recordTombstones(undoSyncMeta, addedItemIds, undoIso);
          }
          if (clearedShopIds.length > 0) {
            undoSyncMeta = clearTombstones(undoSyncMeta, clearedShopIds);
          }
          setState({
            ...snapshot,
            items: snapshot.items.map((it) =>
              touchedSet.has(it.id) ? { ...it, updatedAt: undoIso } : it
            ),
            syncMeta: undoSyncMeta,
          });
          notify(`Undid ${selected.length} voice update(s)`, 'amber');
        },
      });
    },
    [notify, resolveActor]
  );

  const updateSettings = useCallback((patch: Partial<HouseholdSettings>) => {
    const nowIso = new Date().toISOString();
    setState((prev) => ({
      ...prev,
      settings: { ...prev.settings, ...patch },
      syncMeta: { ...prev.syncMeta, settingsUpdatedAt: nowIso },
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
    addItemsBatch,
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
    applyVoiceInventoryUpdates,
    addStore,
    updateStore,
    deleteStore,
    addRecipe: addRecipeWithNewIngredients,
    updateRecipe,
    deleteRecipe,
    addCuisine,
    cookRecipeDirect,
    toggleFavoriteRecipe,
    setWeeklyPlan,
    updatePlannedMealServings,
    markMealCooked,
    updateSettings,
    notify,
    dismissToast,
  };
}
