import React, { useMemo, useState } from 'react';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  PackageCheck,
  Plus,
  Share2,
  ShoppingBag,
  Sparkles,
  Store as StoreIcon,
  Trash2,
  X,
} from 'lucide-react';
import {
  InventoryItem,
  ShoppingItem,
  StorageZone,
  Store,
  UIMode,
} from '../types/kitchen';
import { computeItemForecast, formatShoppingDayName, getLearnedStoreId } from '../utils/forecasting';
import { UI_LABELS, ZONE_META } from '../i18n/translations';
import {
  formatItemStockSummary,
  formatRestockLabel,
  formatShoppingQuantityLabel,
} from '../utils/inventoryDisplay';
import { inferProductDefaultsFromText } from '../utils/productCategories';

interface ShoppingViewProps {
  items: InventoryItem[];
  stores: Store[];
  shoppingList: ShoppingItem[];
  shoppingDay: number;
  forecastHorizonDays: number;
  uiMode: UIMode;
  onSyncForecast: () => void;
  onAddShoppingItem: (entry: Omit<ShoppingItem, 'id' | 'addedAt' | 'checked'>) => void;
  onToggleChecked: (id: string) => void;
  onUpdateShoppingItem: (id: string, patch: Partial<ShoppingItem>) => void;
  onRemoveShoppingItem: (id: string) => void;
  onCompleteTrip: (
    overrides: Record<string, { targetPortions: number; targetZone: StorageZone; storeId: string }>
  ) => void;
  onNotify?: (text: string, tone?: 'teal' | 'amber' | 'rose') => void;
}

const REASON_LABELS: Record<ShoppingItem['reason'], { label: string; cls: string }> = {
  finished: { label: 'Finished / Out', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  forecast_weekend: {
    label: 'Runs Out by Weekend',
    cls: 'bg-amber-50 text-amber-800 border-amber-200',
  },
  forecast_midweek: {
    label: 'Runs Out Mid-Week Next Wk',
    cls: 'bg-orange-50 text-orange-800 border-orange-200',
  },
  manual_from_kitchen: {
    label: 'Manual Add (Still Have Some)',
    cls: 'bg-sky-50 text-sky-800 border-sky-200',
  },
  meal_plan: { label: 'For Meal Plan', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  manual: { label: 'Added Manually', cls: 'bg-stone-100 text-stone-600 border-stone-200' },
};

export const ShoppingView: React.FC<ShoppingViewProps> = ({
  items,
  stores,
  shoppingList,
  shoppingDay,
  forecastHorizonDays,
  uiMode,
  onSyncForecast,
  onAddShoppingItem,
  onToggleChecked,
  onUpdateShoppingItem,
  onRemoveShoppingItem,
  onCompleteTrip,
  onNotify,
}) => {
  const isDetailed = uiMode === 'detailed';
  const [showRestockModal, setShowRestockModal] = useState(false);

  // Inline Quick-Add state
  const [quickName, setQuickName] = useState('');
  const [quickQty, setQuickQty] = useState('');
  const [quickStoreId, setQuickStoreId] = useState<string>(stores[0]?.id ?? 'store-costco');
  const [quickPriority, setQuickPriority] = useState<'essential' | 'optional'>('essential');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [copiedFeedback, setCopiedFeedback] = useState(false);

  // Per-store collapsible "In Cart" toggle (collapsed by default so unchecked items stay front & center)
  const [expandedInCartStores, setExpandedInCartStores] = useState<Record<string, boolean>>({});

  const [restockOverrides, setRestockOverrides] = useState<
    Record<string, { targetPortions: number; targetZone: StorageZone; storeId: string }>
  >({});

  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const checkedItems = useMemo(() => shoppingList.filter((s) => s.checked), [shoppingList]);
  const listedInvIds = useMemo(
    () => new Set(shoppingList.map((s) => s.inventoryItemId).filter(Boolean)),
    [shoppingList]
  );

  // Live bilingual autocomplete matches from kitchen inventory
  const quickMatches = useMemo(() => {
    const q = quickName.trim().toLowerCase();
    if (q.length < 1) return [];
    return items
      .filter((it) => {
        if (listedInvIds.has(it.id)) return false;
        return `${it.name} ${it.alias}`.toLowerCase().includes(q);
      })
      .slice(0, 5);
  }, [quickName, items, listedInvIds]);

  const groupedByStore = useMemo(() => {
    return stores
      .map((store) => {
        const list = shoppingList.filter((s) => s.storeId === store.id);
        const unchecked = list.filter((s) => !s.checked);
        const checked = list.filter((s) => s.checked);
        const essentialCount = unchecked.filter((s) => s.priority === 'essential').length;
        const optionalCount = unchecked.filter((s) => s.priority === 'optional').length;
        return { store, list, unchecked, checked, essentialCount, optionalCount };
      })
      .filter((g) => g.list.length > 0);
  }, [stores, shoppingList]);

  const essentialStores = groupedByStore.filter((g) => g.essentialCount > 0);
  const optionalOnlyStores = groupedByStore.filter((g) => g.essentialCount === 0 && g.optionalCount > 0);

  // Consumption Forecast Radar: ONLY items projected to NOT last the next `forecastHorizonDays` (default 10d)
  const forecastRadar = useMemo(() => {
    return items
      .map((item) => ({ item, forecast: computeItemForecast(item, shoppingDay) }))
      .filter(
        ({ item, forecast }) =>
          !listedInvIds.has(item.id) && forecast.estimatedDaysLeft <= forecastHorizonDays
      )
      .sort((a, b) => a.forecast.estimatedDaysLeft - b.forecast.estimatedDaysLeft);
  }, [items, listedInvIds, shoppingDay, forecastHorizonDays]);

  const handleQuickAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = quickName.trim();
    if (!clean) return;

    // Exact match against an existing inventory item if not already listed
    const exactMatch = items.find(
      (it) =>
        !listedInvIds.has(it.id) &&
        (it.name.toLowerCase() === clean.toLowerCase() ||
          (it.alias && it.alias.toLowerCase() === clean.toLowerCase()))
    );

    if (exactMatch) {
      handleSelectAutocomplete(exactMatch);
      return;
    }

    const inferred = inferProductDefaultsFromText(clean);
    onAddShoppingItem({
      name: clean,
      storeId: stores.some((s) => s.id === quickStoreId)
        ? quickStoreId
        : stores[0]?.id ?? 'store-costco',
      quantityLabel: quickQty.trim() || '1 pack',
      targetPortions: 4,
      targetZone: inferred?.zone ?? 'pantry',
      priority: quickPriority,
      reason: 'manual',
    });

    setQuickName('');
    setQuickQty('');
    setShowSuggestions(false);
  };

  const handleSelectAutocomplete = (inv: InventoryItem) => {
    const storeId = getLearnedStoreId(inv);
    const note =
      inv.remainingPortions > 0
        ? `Manually added — currently have ${formatItemStockSummary(inv)}`
        : 'Out of stock';

    onAddShoppingItem({
      inventoryItemId: inv.id,
      name: inv.name,
      alias: inv.alias,
      storeId: stores.some((s) => s.id === storeId) ? storeId : quickStoreId,
      quantityLabel: quickQty.trim() || formatShoppingQuantityLabel(inv),
      targetPortions: inv.totalPortions,
      targetZone: inv.zone,
      priority: quickPriority,
      reason: 'manual_from_kitchen',
      note,
    });

    setQuickName('');
    setQuickQty('');
    setShowSuggestions(false);
  };

  const buildShareText = (): string => {
    const lines: string[] = [`🛒 KitchenFlow Shopping List (${formatShoppingDayName(shoppingDay)})`];
    for (const g of groupedByStore) {
      if (g.unchecked.length === 0) continue;
      lines.push('');
      lines.push(`📍 ${g.store.name}${g.store.alias ? ` (${g.store.alias})` : ''}`);
      for (const s of g.unchecked) {
        const opt = s.priority === 'optional' ? ' [optional]' : '';
        const aliasPart = s.alias ? ` (${s.alias})` : '';
        lines.push(`- ${s.name}${aliasPart} — ${s.quantityLabel}${opt}`);
      }
    }
    return lines.join('\n');
  };

  const handleShareOrCopyList = async () => {
    const remainingCount = shoppingList.filter((s) => !s.checked).length;
    if (remainingCount === 0) {
      onNotify?.('No unchecked items to share.', 'amber');
      return;
    }
    const text = buildShareText();
    try {
      if (navigator.share) {
        await navigator.share({ title: 'KitchenFlow Shopping List', text });
        return;
      }
    } catch {
      // User dismissed share sheet or share failed; fall back to clipboard
    }

    try {
      await navigator.clipboard.writeText(text);
      setCopiedFeedback(true);
      onNotify?.('Shopping list copied — ready to paste in WhatsApp / Messages!', 'teal');
      window.setTimeout(() => setCopiedFeedback(false), 2000);
    } catch {
      onNotify?.('Could not copy automatically — please copy from the list.', 'amber');
    }
  };

  const handleOpenRestockModal = () => {
    const init: Record<string, { targetPortions: number; targetZone: StorageZone; storeId: string }> = {};
    for (const s of checkedItems) {
      init[s.id] = {
        targetPortions: s.targetPortions,
        targetZone: s.targetZone,
        storeId: s.storeId,
      };
    }
    setRestockOverrides(init);
    setShowRestockModal(true);
  };

  const shoppingDayName = formatShoppingDayName(shoppingDay);
  const totalUnchecked = shoppingList.filter((s) => !s.checked).length;

  const renderShoppingRow = (s: ShoppingItem) => {
    const reasonMeta = REASON_LABELS[s.reason];
    const linkedInv = s.inventoryItemId ? itemMap.get(s.inventoryItemId) : undefined;
    const liveForecast = linkedInv ? computeItemForecast(linkedInv, shoppingDay) : null;

    let helperNote = s.note;
    if (s.reason === 'manual_from_kitchen' && linkedInv) {
      helperNote =
        linkedInv.remainingPortions > 0
          ? `Manually added — you still have ${formatItemStockSummary(linkedInv)} at home (~${liveForecast?.estimatedDaysLeft}d left)`
          : 'Manually added — currently out of stock';
    } else if (
      (s.reason === 'forecast_midweek' || s.reason === 'forecast_weekend') &&
      liveForecast &&
      !helperNote
    ) {
      helperNote = liveForecast.forecastDescription;
    }

    return (
      <div
        key={s.id}
        className={`px-4 py-3 flex items-start sm:items-center justify-between gap-3 transition ${
          s.checked ? 'bg-teal-50/40' : 'hover:bg-stone-50/60'
        }`}
      >
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <button
            type="button"
            onClick={() => onToggleChecked(s.id)}
            aria-label={s.checked ? `Uncheck ${s.name}` : `Check ${s.name}`}
            className={`mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition ${
              s.checked
                ? 'bg-teal-600 border-teal-600 text-white'
                : 'border-stone-300 bg-white hover:border-teal-500'
            }`}
          >
            {s.checked && <Check className="w-3.5 h-3.5 stroke-[3]" />}
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                dir="auto"
                className={`text-sm font-semibold ${
                  s.checked ? 'line-through text-stone-400' : 'text-stone-900'
                }`}
              >
                {s.name}
              </span>
              {s.alias && (
                <span
                  dir="auto"
                  className="text-xs text-teal-800 bg-teal-50 px-1.5 py-0.5 rounded"
                >
                  {s.alias}
                </span>
              )}
            </div>
            <div className="mt-1 flex items-center flex-wrap gap-1.5 text-[11px] text-stone-500">
              <span>{s.quantityLabel}</span>
              <span>•</span>
              <span className={`px-1.5 py-0.5 rounded border font-medium ${reasonMeta.cls}`}>
                {reasonMeta.label}
              </span>
            </div>
            {helperNote && !s.checked && (
              <div className="mt-1 text-[11px] text-stone-600 bg-stone-50 border border-stone-200/70 rounded-lg px-2 py-1 inline-block">
                {helperNote}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {isDetailed && (
            <>
              <button
                type="button"
                onClick={() =>
                  onUpdateShoppingItem(s.id, {
                    priority: s.priority === 'essential' ? 'optional' : 'essential',
                  })
                }
                className={`px-2 py-1 rounded-lg text-[11px] font-semibold border transition ${
                  s.priority === 'essential'
                    ? 'bg-amber-50 text-amber-800 border-amber-200'
                    : 'bg-stone-50 text-stone-500 border-stone-200'
                }`}
                title="Toggle Essential / Optional"
              >
                {s.priority === 'essential' ? UI_LABELS.essential : UI_LABELS.optional}
              </button>

              <select
                value={s.storeId}
                onChange={(e) => onUpdateShoppingItem(s.id, { storeId: e.target.value })}
                className="rounded-lg border border-stone-200 bg-white px-2 py-1 text-[11px] text-stone-600 max-w-[105px]"
                title="Move to another store"
              >
                {stores.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.name}
                  </option>
                ))}
              </select>
            </>
          )}

          <button
            type="button"
            onClick={() => onRemoveShoppingItem(s.id)}
            className="p-1.5 rounded-lg text-stone-400 hover:text-rose-600 hover:bg-rose-50"
            aria-label={`Remove ${s.name}`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Weekend Trip Recommendation Hero */}
      <div className="rounded-3xl bg-gradient-to-br from-teal-800 via-teal-700 to-emerald-700 text-white p-5 sm:p-6 shadow-md">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-teal-100 bg-white/10 px-2.5 py-1 rounded-full">
              <ShoppingBag className="w-3.5 h-3.5" />
              {UI_LABELS.weekendTripTitle} • {shoppingDayName}
            </div>

            {essentialStores.length > 0 ? (
              <h2 className="text-xl sm:text-2xl font-bold leading-snug">
                This weekend, visit:{' '}
                {essentialStores.map((g, idx) => (
                  <span key={g.store.id}>
                    {idx > 0 ? ' & ' : ''}
                    <span className="underline decoration-teal-300 decoration-2 underline-offset-4">
                      {g.store.name}
                    </span>{' '}
                    <span className="text-teal-100 text-base font-medium">
                      ({g.essentialCount})
                    </span>
                  </span>
                ))}
              </h2>
            ) : (
              <h2 className="text-xl sm:text-2xl font-bold leading-snug">
                {UI_LABELS.noTripNeeded}
              </h2>
            )}

            {optionalOnlyStores.length > 0 && (
              <p className="text-xs sm:text-sm text-teal-100/90">
                Optional stop:{' '}
                {optionalOnlyStores
                  .map((g) => `${g.store.name} (${g.optionalCount} non-urgent)`)
                  .join(', ')}{' '}
                — easily skippable if you want a quick weekend.
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2 shrink-0">
            {totalUnchecked > 0 && (
              <button
                type="button"
                onClick={handleShareOrCopyList}
                className="inline-flex items-center gap-1.5 rounded-xl bg-white/15 hover:bg-white/25 text-white border border-white/20 px-3.5 py-2.5 text-xs font-bold transition"
                title="Copy or share unchecked list to WhatsApp / Messages"
              >
                {copiedFeedback ? (
                  <Check className="w-4 h-4" />
                ) : typeof navigator !== 'undefined' && 'share' in navigator ? (
                  <Share2 className="w-4 h-4" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
                {copiedFeedback ? 'Copied!' : 'Share List'}
              </button>
            )}
            <button
              type="button"
              onClick={onSyncForecast}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white text-teal-900 hover:bg-teal-50 px-4 py-2.5 text-xs font-bold shadow-xs transition"
            >
              <Sparkles className="w-4 h-4" />
              {UI_LABELS.addSmartSuggestions}
            </button>
          </div>
        </div>
      </div>

      {/* Inline Quick-Add Bar (Ad-Hoc OR Existing Kitchen Staple Autocomplete) */}
      <form
        onSubmit={handleQuickAddSubmit}
        className="relative rounded-2xl border border-stone-200 bg-white p-3 shadow-2xs space-y-2"
      >
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <input
              dir="auto"
              value={quickName}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => window.setTimeout(() => setShowSuggestions(false), 160)}
              onChange={(e) => {
                setQuickName(e.target.value);
                setShowSuggestions(true);
              }}
              placeholder="Quick-add anything (e.g. Sangak bread, paper towels, شیر)..."
              className="w-full rounded-xl border border-stone-200 bg-stone-50/70 focus:bg-white px-3.5 py-2 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />

            {/* Inventory Autocomplete Popover */}
            {showSuggestions && quickMatches.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 z-30 rounded-2xl border border-stone-200 bg-white shadow-lg overflow-hidden divide-y divide-stone-100">
                <div className="px-3 py-1.5 bg-stone-50 text-[10px] font-bold uppercase tracking-wider text-stone-400">
                  From your Kitchen Inventory (tap to link)
                </div>
                {quickMatches.map((inv) => {
                  const st = stores.find((s) => s.id === getLearnedStoreId(inv));
                  return (
                    <button
                      key={inv.id}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleSelectAutocomplete(inv);
                      }}
                      className="w-full px-3 py-2 text-left hover:bg-teal-50 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <span dir="auto" className="font-semibold text-stone-900">
                          {inv.name}
                        </span>
                        {inv.alias && (
                          <span dir="auto" className="text-teal-700 ml-1.5">
                            ({inv.alias})
                          </span>
                        )}
                        <div className="text-[10px] text-stone-500 truncate">
                          Have: {formatItemStockSummary(inv)}
                        </div>
                      </div>
                      {st && (
                        <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold text-stone-600 bg-stone-100 px-2 py-0.5 rounded-full">
                          <span
                            className="w-1.5 h-1.5 rounded-full"
                            style={{ backgroundColor: st.color }}
                          />
                          {st.name}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0 flex-wrap sm:flex-nowrap">
            <input
              dir="auto"
              value={quickQty}
              onChange={(e) => setQuickQty(e.target.value)}
              placeholder="Qty (opt.)"
              className="w-24 rounded-xl border border-stone-200 bg-white px-2.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            <select
              value={quickStoreId}
              onChange={(e) => setQuickStoreId(e.target.value)}
              aria-label="Store for quick add"
              className="rounded-xl border border-stone-200 bg-white px-2.5 py-2 text-xs font-semibold text-stone-700"
            >
              {stores.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() =>
                setQuickPriority((p) => (p === 'essential' ? 'optional' : 'essential'))
              }
              className={`px-2.5 py-2 rounded-xl text-[11px] font-bold border transition ${
                quickPriority === 'essential'
                  ? 'bg-amber-50 text-amber-800 border-amber-200'
                  : 'bg-stone-50 text-stone-500 border-stone-200'
              }`}
              title="Toggle Essential vs. Optional"
            >
              {quickPriority === 'essential' ? 'Essential' : 'Optional'}
            </button>
            <button
              type="submit"
              disabled={!quickName.trim()}
              className="inline-flex items-center gap-1 rounded-xl bg-teal-700 hover:bg-teal-800 disabled:opacity-40 text-white px-3.5 py-2 text-xs font-bold shadow-2xs transition"
            >
              <Plus className="w-3.5 h-3.5" />
              Add
            </button>
          </div>
        </div>
      </form>

      {/* Forecast Radar: ONLY items not lasting the next N days (configurable in Settings, default 10d) */}
      {forecastRadar.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 space-y-2.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-xs font-bold uppercase tracking-wider text-amber-900 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-amber-600" />
              Consumption Forecast Radar ({forecastRadar.length})
            </div>
            <span className="text-[11px] text-amber-800">
              Won&apos;t last the next <strong>{forecastHorizonDays} days</strong> (adjustable in Settings)
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {forecastRadar.map(({ item, forecast }) => (
              <button
                key={item.id}
                type="button"
                onClick={() =>
                  onAddShoppingItem({
                    inventoryItemId: item.id,
                    name: item.name,
                    alias: item.alias,
                    storeId: forecast.learnedStoreId,
                    quantityLabel: formatShoppingQuantityLabel(item),
                    targetPortions: item.totalPortions,
                    targetZone: item.zone,
                    priority: 'essential',
                    reason:
                      forecast.verdict === 'runs_out_next_week'
                        ? 'forecast_midweek'
                        : forecast.verdict === 'out'
                        ? 'finished'
                        : 'forecast_weekend',
                    note: forecast.forecastDescription,
                  })
                }
                className="inline-flex items-center gap-1.5 rounded-xl bg-white border border-amber-200 hover:border-amber-400 px-3 py-1.5 text-xs text-stone-800 shadow-2xs transition text-left"
              >
                <Plus className="w-3.5 h-3.5 text-teal-700 shrink-0" />
                <span dir="auto" className="font-semibold">
                  {item.name}
                </span>
                {item.alias && (
                  <span dir="auto" className="text-stone-500">
                    ({item.alias})
                  </span>
                )}
                <span className="text-[11px] text-amber-800 font-medium">
                  • ~{forecast.estimatedDaysLeft}d (~{forecast.runOutDayLabel})
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Checked items action bar */}
      {checkedItems.length > 0 && (
        <div className="sticky top-16 z-20 rounded-2xl bg-stone-900 text-white p-3.5 shadow-lg flex items-center justify-between gap-3">
          <div className="text-xs sm:text-sm font-medium">
            <span className="font-bold text-teal-300">{checkedItems.length}</span> item(s) in your cart
          </div>
          <button
            type="button"
            onClick={handleOpenRestockModal}
            className="inline-flex items-center gap-1.5 rounded-xl bg-teal-500 hover:bg-teal-400 text-stone-950 px-4 py-2 text-xs font-bold transition"
          >
            <PackageCheck className="w-4 h-4" />
            {UI_LABELS.completeTrip}
          </button>
        </div>
      )}

      {/* Store-Grouped Lists */}
      {groupedByStore.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-10 text-center space-y-2">
          <CheckCircle2 className="w-8 h-8 text-teal-600 mx-auto" />
          <div className="text-sm font-semibold text-stone-800">Shopping list is empty!</div>
          <p className="text-xs text-stone-500">
            Quick-add anything above, tap &ldquo;Sync Forecast&rdquo;, or use &ldquo;+ Shop&rdquo; on any item in Kitchen.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {groupedByStore.map(({ store, unchecked, checked, essentialCount, optionalCount }) => {
            const showCart = Boolean(expandedInCartStores[store.id]) || unchecked.length === 0;
            return (
              <div
                key={store.id}
                className="rounded-2xl border border-stone-200/90 bg-white overflow-hidden shadow-2xs"
              >
                {/* Store Header */}
                <div className="px-4 py-3 bg-stone-50/90 border-b border-stone-100 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: store.color }}
                    />
                    <StoreIcon className="w-4 h-4 text-stone-500" />
                    <span className="font-bold text-stone-900 text-sm">{store.name}</span>
                    {store.alias && (
                      <span dir="auto" className="text-xs text-stone-500">
                        ({store.alias})
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold">
                    {essentialCount > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900">
                        {essentialCount} essential
                      </span>
                    )}
                    {optionalCount > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-stone-200 text-stone-700">
                        {optionalCount} optional
                      </span>
                    )}
                    {checked.length > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-teal-100 text-teal-800">
                        {checked.length} in cart
                      </span>
                    )}
                  </div>
                </div>

                {/* Unchecked Aisle Items */}
                {unchecked.length > 0 && (
                  <div className="divide-y divide-stone-100">
                    {unchecked.map((s) => renderShoppingRow(s))}
                  </div>
                )}

                {/* Collapsible "In Cart" Section per Store */}
                {checked.length > 0 && (
                  <div className={unchecked.length > 0 ? 'border-t border-stone-200/80' : ''}>
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedInCartStores((prev) => ({
                          ...prev,
                          [store.id]: !showCart,
                        }))
                      }
                      className="w-full px-4 py-2 bg-teal-50/50 hover:bg-teal-50 flex items-center justify-between text-xs font-semibold text-teal-900 transition"
                    >
                      <span className="inline-flex items-center gap-1.5">
                        {showCart ? (
                          <ChevronDown className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5" />
                        )}
                        In Cart ({checked.length})
                      </span>
                      <span className="text-[11px] font-medium text-teal-700">
                        {showCart ? 'Hide' : 'Show'}
                      </span>
                    </button>
                    {showCart && (
                      <div className="divide-y divide-stone-100">
                        {checked.map((s) => renderShoppingRow(s))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Restock & Portion Check-In Modal */}
      {showRestockModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-stone-950/45 backdrop-blur-xs p-0 sm:p-4">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl bg-white shadow-2xl border border-stone-200">
            <div className="sticky top-0 bg-white px-5 py-4 border-b border-stone-100 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-stone-900">Unpack & Portion Check-In</h3>
                <p className="text-xs text-stone-500">
                  Confirm how you packed each item — KitchenFlow learns your store & portion habits.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowRestockModal(false)}
                className="p-2 rounded-full text-stone-400 hover:bg-stone-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-3">
              {checkedItems.map((s) => {
                const linkedInv = s.inventoryItemId ? itemMap.get(s.inventoryItemId) : undefined;
                const isContinuous = linkedInv?.trackingMode === 'continuous';
                const ov = restockOverrides[s.id] || {
                  targetPortions: s.targetPortions,
                  targetZone: s.targetZone,
                  storeId: s.storeId,
                };
                const containerCount =
                  isContinuous && linkedInv && linkedInv.totalPortions > 0
                    ? Math.max(1, Math.round(ov.targetPortions / linkedInv.totalPortions))
                    : 1;

                return (
                  <div
                    key={s.id}
                    className="rounded-xl border border-stone-200 p-3.5 space-y-2.5 bg-stone-50/50"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold text-sm text-stone-900">
                        <span dir="auto">{s.name}</span>{' '}
                        {s.alias && (
                          <span dir="auto" className="text-xs text-teal-700 font-normal">
                            ({s.alias})
                          </span>
                        )}
                      </div>
                      {isContinuous && linkedInv && (
                        <span className="text-[11px] font-medium text-teal-800 bg-teal-50 border border-teal-100 px-2 py-0.5 rounded-md">
                          {formatRestockLabel(linkedInv)}
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="block text-[10px] font-semibold uppercase text-stone-500 mb-1">
                          {isContinuous ? 'Containers' : 'Portions Packed'}
                        </label>
                        {isContinuous && linkedInv ? (
                          <input
                            type="number"
                            min="1"
                            max="20"
                            value={containerCount}
                            onChange={(e) => {
                              const count = Math.max(1, Number(e.target.value) || 1);
                              setRestockOverrides((prev) => ({
                                ...prev,
                                [s.id]: {
                                  ...ov,
                                  targetPortions: count * linkedInv.totalPortions,
                                },
                              }));
                            }}
                            className="w-full rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-semibold"
                          />
                        ) : (
                          <input
                            type="number"
                            min="1"
                            value={ov.targetPortions}
                            onChange={(e) =>
                              setRestockOverrides((prev) => ({
                                ...prev,
                                [s.id]: {
                                  ...ov,
                                  targetPortions: Math.max(1, Number(e.target.value) || 1),
                                },
                              }))
                            }
                            className="w-full rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-semibold"
                          />
                        )}
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold uppercase text-stone-500 mb-1">
                          Store In
                        </label>
                        <select
                          value={ov.targetZone}
                          onChange={(e) =>
                            setRestockOverrides((prev) => ({
                              ...prev,
                              [s.id]: { ...ov, targetZone: e.target.value as StorageZone },
                            }))
                          }
                          className="w-full rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs"
                        >
                          {(['fridge', 'freezer', 'pantry'] as StorageZone[]).map((z) => (
                            <option key={z} value={z}>
                              {ZONE_META[z].en}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold uppercase text-stone-500 mb-1">
                          Bought At
                        </label>
                        <select
                          value={ov.storeId}
                          onChange={(e) =>
                            setRestockOverrides((prev) => ({
                              ...prev,
                              [s.id]: { ...ov, storeId: e.target.value },
                            }))
                          }
                          className="w-full rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs"
                        >
                          {stores.map((st) => (
                            <option key={st.id} value={st.id}>
                              {st.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="p-4 border-t border-stone-100 flex items-center justify-end gap-2 bg-white">
              <button
                type="button"
                onClick={() => setShowRestockModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-stone-600 hover:bg-stone-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onCompleteTrip(restockOverrides);
                  setShowRestockModal(false);
                }}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold shadow-xs"
              >
                <PackageCheck className="w-4 h-4" />
                Save {checkedItems.length} Item(s) to Kitchen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
