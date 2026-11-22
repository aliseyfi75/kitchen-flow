import React, { useMemo, useState } from 'react';
import {
  Check,
  CheckCircle2,
  PackageCheck,
  Plus,
  Receipt,
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
  UILanguage,
  UIMode,
} from '../types/kitchen';
import { computeItemForecast, formatShoppingDayName } from '../utils/forecasting';
import { t, ZONE_META } from '../i18n/translations';

interface ShoppingViewProps {
  items: InventoryItem[];
  stores: Store[];
  shoppingList: ShoppingItem[];
  shoppingDay: number;
  lang: UILanguage;
  uiMode: UIMode;
  onSyncForecast: () => void;
  onOpenReceiptScanner: () => void;
  onAddShoppingItem: (entry: Omit<ShoppingItem, 'id' | 'addedAt' | 'checked'>) => void;
  onToggleChecked: (id: string) => void;
  onUpdateShoppingItem: (id: string, patch: Partial<ShoppingItem>) => void;
  onRemoveShoppingItem: (id: string) => void;
  onCompleteTrip: (
    overrides: Record<string, { targetPortions: number; targetZone: StorageZone; storeId: string }>
  ) => void;
}

const REASON_LABELS: Record<ShoppingItem['reason'], { en: string; fa: string; cls: string }> = {
  finished: { en: 'Finished / Empty', fa: 'تمام شد', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  forecast_weekend: {
    en: 'Projected Run-Out',
    fa: 'پیش‌بینی اتمام',
    cls: 'bg-amber-50 text-amber-800 border-amber-200',
  },
  meal_plan: { en: 'For Meal Plan', fa: 'برنامه غذایی', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  manual: { en: 'Added Manually', fa: 'دستی', cls: 'bg-stone-100 text-stone-600 border-stone-200' },
};

export const ShoppingView: React.FC<ShoppingViewProps> = ({
  items,
  stores,
  shoppingList,
  shoppingDay,
  lang,
  uiMode,
  onSyncForecast,
  onOpenReceiptScanner,
  onAddShoppingItem,
  onToggleChecked,
  onUpdateShoppingItem,
  onRemoveShoppingItem,
  onCompleteTrip,
}) => {
  const isDetailed = uiMode === 'detailed';
  const [showAddForm, setShowAddForm] = useState(false);
  const [showRestockModal, setShowRestockModal] = useState(false);

  // Add item form state
  const [newName, setNewName] = useState('');
  const [newAlias, setNewAlias] = useState('');
  const [newStoreId, setNewStoreId] = useState(stores[0]?.id ?? '');
  const [newQty, setNewQty] = useState('1 pack');
  const [newPortions, setNewPortions] = useState(6);
  const [newZone, setNewZone] = useState<StorageZone>('fridge');
  const [newPriority, setNewPriority] = useState<'essential' | 'optional'>('essential');

  // Restock check-in overrides
  const [restockOverrides, setRestockOverrides] = useState<
    Record<string, { targetPortions: number; targetZone: StorageZone; storeId: string }>
  >({});

  const checkedItems = useMemo(() => shoppingList.filter((s) => s.checked), [shoppingList]);

  const groupedByStore = useMemo(() => {
    return stores
      .map((store) => {
        const list = shoppingList.filter((s) => s.storeId === store.id);
        const essentialCount = list.filter((s) => s.priority === 'essential').length;
        const optionalCount = list.filter((s) => s.priority === 'optional').length;
        return { store, list, essentialCount, optionalCount };
      })
      .filter((g) => g.list.length > 0);
  }, [stores, shoppingList]);

  const essentialStores = groupedByStore.filter((g) => g.essentialCount > 0);
  const optionalOnlyStores = groupedByStore.filter((g) => g.essentialCount === 0 && g.optionalCount > 0);

  // Forecast Radar: items NOT yet on shopping list that are borderline or projected to run out
  const forecastRadar = useMemo(() => {
    const listedIds = new Set(shoppingList.map((s) => s.inventoryItemId).filter(Boolean));
    return items
      .map((item) => ({ item, forecast: computeItemForecast(item, shoppingDay) }))
      .filter(({ item, forecast }) => !listedIds.has(item.id) && (forecast.verdict === 'out' || forecast.verdict === 'buy_this_weekend' || forecast.verdict === 'borderline'))
      .sort((a, b) => a.forecast.estimatedDaysLeft - b.forecast.estimatedDaysLeft);
  }, [items, shoppingList, shoppingDay]);

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

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    onAddShoppingItem({
      name: newName.trim(),
      alias: newAlias.trim() || undefined,
      storeId: newStoreId || stores[0]?.id || '',
      quantityLabel: newQty.trim() || '1 pack',
      targetPortions: Math.max(1, Number(newPortions) || 1),
      targetZone: newZone,
      priority: newPriority,
      reason: 'manual',
    });
    setNewName('');
    setNewAlias('');
    setNewQty('1 pack');
    setShowAddForm(false);
  };

  const shoppingDayName = formatShoppingDayName(shoppingDay, lang);

  return (
    <div className="space-y-5">
      {/* Weekend Trip Recommendation Hero */}
      <div className="rounded-3xl bg-gradient-to-br from-teal-800 via-teal-700 to-emerald-700 text-white p-5 sm:p-6 shadow-md">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-teal-100 bg-white/10 px-2.5 py-1 rounded-full">
              <ShoppingBag className="w-3.5 h-3.5" />
              {t(lang, 'weekendTripTitle')} • {shoppingDayName}
            </div>

            {essentialStores.length > 0 ? (
              <h2 className="text-xl sm:text-2xl font-bold leading-snug">
                {lang === 'fa' ? 'این آخر هفته باید برید: ' : 'This weekend, visit: '}
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
                {t(lang, 'noTripNeeded')}
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
            <button
              type="button"
              onClick={onOpenReceiptScanner}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white text-teal-900 hover:bg-teal-50 px-3.5 py-2 text-xs font-bold shadow-xs transition"
            >
              <Receipt className="w-4 h-4" />
              {t(lang, 'scanReceipt')}
            </button>
            <button
              type="button"
              onClick={onSyncForecast}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white/15 hover:bg-white/25 backdrop-blur px-3.5 py-2 text-xs font-semibold text-white transition"
            >
              <Sparkles className="w-4 h-4" />
              {t(lang, 'addSmartSuggestions')}
            </button>
            <button
              type="button"
              onClick={() => setShowAddForm((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white/15 hover:bg-white/25 backdrop-blur px-3.5 py-2 text-xs font-semibold text-white transition"
            >
              <Plus className="w-4 h-4" />
              Add Item
            </button>
          </div>
        </div>
      </div>

      {/* Forecast Radar: Unlisted items that may run out */}
      {forecastRadar.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-bold uppercase tracking-wider text-amber-900 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-amber-600" />
              Consumption Forecast Radar ({forecastRadar.length})
            </div>
            <span className="text-[11px] text-amber-800">Not on your list yet</span>
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
                    quantityLabel: `${item.packDescription} (${item.totalPortions} portions)`,
                    targetPortions: item.totalPortions,
                    targetZone: item.zone,
                    priority: forecast.verdict === 'borderline' ? 'optional' : 'essential',
                    reason: 'forecast_weekend',
                  })
                }
                className="inline-flex items-center gap-1.5 rounded-xl bg-white border border-amber-200 hover:border-amber-400 px-3 py-1.5 text-xs text-stone-800 shadow-2xs transition"
              >
                <Plus className="w-3.5 h-3.5 text-teal-700" />
                <span dir="auto" className="font-semibold">
                  {item.name}
                </span>
                {item.alias && (
                  <span dir="auto" className="text-stone-500">
                    ({item.alias})
                  </span>
                )}
                <span className="text-[11px] text-amber-700 font-medium">
                  • ~{forecast.estimatedDaysLeft}d left
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Quick Add Shopping Item Form */}
      {showAddForm && (
        <form
          onSubmit={handleAddSubmit}
          className="rounded-2xl border border-stone-200 bg-white p-4 shadow-xs space-y-3"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-stone-900">Add to Shopping List</h3>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="text-stone-400 hover:text-stone-700"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              dir="auto"
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Item name (e.g. Avocados)"
              className="rounded-xl border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            <input
              dir="auto"
              value={newAlias}
              onChange={(e) => setNewAlias(e.target.value)}
              placeholder="Alias (مثلاً آووکادو)"
              className="rounded-xl border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <select
              value={newStoreId}
              onChange={(e) => setNewStoreId(e.target.value)}
              className="rounded-xl border border-stone-200 px-3 py-2 text-xs bg-white"
            >
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <input
              dir="auto"
              value={newQty}
              onChange={(e) => setNewQty(e.target.value)}
              placeholder="Pack / Qty"
              className="rounded-xl border border-stone-200 px-3 py-2 text-xs"
            />
            <input
              type="number"
              min="1"
              value={newPortions}
              onChange={(e) => setNewPortions(Number(e.target.value))}
              placeholder="Portions"
              className="rounded-xl border border-stone-200 px-3 py-2 text-xs"
              title="Portions when restocked"
            />
            <select
              value={newZone}
              onChange={(e) => setNewZone(e.target.value as StorageZone)}
              className="rounded-xl border border-stone-200 px-3 py-2 text-xs bg-white"
            >
              {(['fridge', 'freezer', 'pantry'] as StorageZone[]).map((z) => (
                <option key={z} value={z}>
                  → {ZONE_META[z][lang]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => setNewPriority('essential')}
                className={`px-3 py-1 rounded-full font-semibold border ${
                  newPriority === 'essential'
                    ? 'bg-amber-100 border-amber-300 text-amber-900'
                    : 'bg-stone-50 border-stone-200 text-stone-600'
                }`}
              >
                {t(lang, 'essential')}
              </button>
              <button
                type="button"
                onClick={() => setNewPriority('optional')}
                className={`px-3 py-1 rounded-full font-semibold border ${
                  newPriority === 'optional'
                    ? 'bg-stone-800 border-stone-800 text-white'
                    : 'bg-stone-50 border-stone-200 text-stone-600'
                }`}
              >
                {t(lang, 'optional')}
              </button>
            </div>
            <button
              type="submit"
              className="rounded-xl bg-teal-700 hover:bg-teal-800 text-white px-4 py-2 text-xs font-semibold"
            >
              Add to List
            </button>
          </div>
        </form>
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
            {t(lang, 'completeTrip')}
          </button>
        </div>
      )}

      {/* Store-Grouped Lists */}
      {groupedByStore.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-10 text-center space-y-2">
          <CheckCircle2 className="w-8 h-8 text-teal-600 mx-auto" />
          <div className="text-sm font-semibold text-stone-800">Shopping list is empty!</div>
          <p className="text-xs text-stone-500">
            Mark items finished in your Kitchen tab or tap "Sync Forecast to List" to populate weekend essentials.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {groupedByStore.map(({ store, list, essentialCount, optionalCount }) => (
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
                </div>
              </div>

              {/* Store Items */}
              <div className="divide-y divide-stone-100">
                {list.map((s) => {
                  const reasonMeta = REASON_LABELS[s.reason];
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
                            <span
                              className={`px-1.5 py-0.5 rounded border font-medium ${reasonMeta.cls}`}
                            >
                              {reasonMeta[lang]}
                            </span>
                          </div>
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
                              {s.priority === 'essential' ? t(lang, 'essential') : t(lang, 'optional')}
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
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
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
                const ov = restockOverrides[s.id] || {
                  targetPortions: s.targetPortions,
                  targetZone: s.targetZone,
                  storeId: s.storeId,
                };
                return (
                  <div
                    key={s.id}
                    className="rounded-xl border border-stone-200 p-3.5 space-y-2.5 bg-stone-50/50"
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-semibold text-sm text-stone-900">
                        <span dir="auto">{s.name}</span>{' '}
                        {s.alias && (
                          <span dir="auto" className="text-xs text-teal-700 font-normal">
                            ({s.alias})
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="block text-[10px] font-semibold uppercase text-stone-500 mb-1">
                          Portions Packed
                        </label>
                        <input
                          type="number"
                          min="1"
                          value={ov.targetPortions}
                          onChange={(e) =>
                            setRestockOverrides((prev) => ({
                              ...prev,
                              [s.id]: { ...ov, targetPortions: Math.max(1, Number(e.target.value) || 1) },
                            }))
                          }
                          className="w-full rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-semibold"
                        />
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
                          className="w-full rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-xs"
                        >
                          {(['fridge', 'freezer', 'pantry'] as StorageZone[]).map((z) => (
                            <option key={z} value={z}>
                              {ZONE_META[z][lang]}
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
                          className="w-full rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-xs"
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
