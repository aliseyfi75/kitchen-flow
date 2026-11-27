import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Bell,
  ChevronDown,
  ChevronRight,
  History,
  PlayCircle,
  Plus,
  Receipt,
  Search,
  SlidersHorizontal,
  Store as StoreIcon,
  Trash2,
} from 'lucide-react';
import { HouseholdSettings, InventoryItem, Store, TripReceipt, UsageEvent } from '../types/kitchen';
import { computeItemForecast, formatShoppingDayName } from '../utils/forecasting';
import { UI_LABELS } from '../i18n/translations';
import { formatItemStockSummary } from '../utils/inventoryDisplay';
import {
  computeMultiStorePriceComparisons,
  computeStoreSpendSummary,
  formatCurrency,
} from '../utils/priceInsights';
import { computeHouseholdActivitySummary } from '../utils/personalInsights';

interface SettingsViewProps {
  items: InventoryItem[];
  stores: Store[];
  events?: UsageEvent[];
  tripReceipts?: TripReceipt[];
  settings: HouseholdSettings;
  onUpdateSettings: (patch: Partial<HouseholdSettings>) => void;
  onUpdateItemLearning: (
    itemId: string,
    patch: { avgDaysPerFullPack?: number; dailyBurnRate?: number; storeId?: string }
  ) => void;
  onAddStore: (store: Omit<Store, 'id'>) => void;
  onUpdateStore: (storeId: string, patch: Partial<Omit<Store, 'id'>>) => void;
  onDeleteStore: (storeId: string) => void;
  onReplayTour: () => void;
}

const LearnedRhythmRow: React.FC<{
  item: InventoryItem;
  stores: Store[];
  shoppingDay: number;
  onUpdate: (patch: { avgDaysPerFullPack?: number; dailyBurnRate?: number; storeId?: string }) => void;
}> = ({ item, stores, shoppingDay, onUpdate }) => {
  const fc = computeItemForecast(item, shoppingDay);
  const [cycleDraft, setCycleDraft] = useState(String(item.avgDaysPerFullPack));
  const [rateDraft, setRateDraft] = useState(String(fc.dailyBurnRate));
  const isPercentScale = item.trackingMode === 'continuous' && item.totalPortions === 100;

  useEffect(() => {
    setCycleDraft(String(item.avgDaysPerFullPack));
    setRateDraft(String(fc.dailyBurnRate));
  }, [item.avgDaysPerFullPack, fc.dailyBurnRate]);

  const commitCycle = () => {
    const parsed = parseFloat(cycleDraft);
    if (Number.isFinite(parsed) && parsed > 0 && parsed !== item.avgDaysPerFullPack) {
      onUpdate({ avgDaysPerFullPack: parsed });
    } else {
      setCycleDraft(String(item.avgDaysPerFullPack));
    }
  };

  const commitRate = () => {
    const parsed = parseFloat(rateDraft);
    if (Number.isFinite(parsed) && parsed > 0 && Math.abs(parsed - fc.dailyBurnRate) >= 0.01) {
      onUpdate({ dailyBurnRate: parsed });
    } else {
      setRateDraft(String(fc.dailyBurnRate));
    }
  };

  const activeStore = stores.find((s) => s.id === fc.learnedStoreId);

  return (
    <tr className="hover:bg-stone-50/70">
      <td className="py-2.5 pr-3">
        <span dir="auto" className="font-semibold text-stone-900">
          {item.name}
        </span>{' '}
        {item.alias && (
          <span dir="auto" className="text-stone-400">
            ({item.alias})
          </span>
        )}
        <div className="text-[10px] text-stone-400">{formatItemStockSummary(item)}</div>
      </td>

      <td className="py-2.5 px-2">
        <div className="inline-flex items-center gap-1">
          <input
            type="number"
            step="0.5"
            min="1"
            max="180"
            value={cycleDraft}
            onChange={(e) => setCycleDraft(e.target.value)}
            onBlur={commitCycle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            aria-label={`Learned cycle days for ${item.name}`}
            className="w-16 rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs font-semibold text-stone-800 focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
          <span className="text-[11px] text-stone-500 whitespace-nowrap">
            {item.trackingMode === 'continuous' ? 'd / unit' : 'd / pack'}
          </span>
        </div>
      </td>

      <td className="py-2.5 px-2">
        <div className="inline-flex items-center gap-1">
          <input
            type="number"
            step="0.1"
            min="0.05"
            max={isPercentScale ? 100 : 50}
            value={rateDraft}
            onChange={(e) => setRateDraft(e.target.value)}
            onBlur={commitRate}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            aria-label={`Burn rate for ${item.name}`}
            className="w-16 rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs font-semibold text-teal-800 focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
          <span className="text-[11px] text-stone-500 whitespace-nowrap">
            {isPercentScale ? '% / day' : '/ day'}
          </span>
        </div>
      </td>

      <td className="py-2.5 px-2">
        <div className="inline-flex items-center gap-1.5">
          {activeStore && (
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: activeStore.color }}
            />
          )}
          <select
            value={fc.learnedStoreId}
            onChange={(e) => onUpdate({ storeId: e.target.value })}
            aria-label={`Learned store for ${item.name}`}
            className="rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs font-medium text-stone-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
          >
            {stores.map((st) => (
              <option key={st.id} value={st.id}>
                {st.name}
              </option>
            ))}
          </select>
        </div>
      </td>

      <td className="py-2.5 pl-3 text-right font-bold text-stone-800 whitespace-nowrap">
        {fc.estimatedDaysLeft === 0 ? (
          <span className="text-rose-600">Out</span>
        ) : (
          `${fc.estimatedDaysLeft}d`
        )}
      </td>
    </tr>
  );
};

const STORE_COLORS = ['#DC2626', '#2563EB', '#0F766E', '#D97706', '#7C3AED', '#DB2777'];

export const SettingsView: React.FC<SettingsViewProps> = ({
  items,
  stores,
  events = [],
  tripReceipts = [],
  settings,
  onUpdateSettings,
  onUpdateItemLearning,
  onAddStore,
  onUpdateStore,
  onDeleteStore,
  onReplayTour,
}) => {
  const [storeName, setStoreName] = useState('');
  const [storeAlias, setStoreAlias] = useState('');
  const [storeColor, setStoreColor] = useState(STORE_COLORS[0]);
  const [editingColorStoreId, setEditingColorStoreId] = useState<string | null>(null);
  const [confirmDeleteStoreId, setConfirmDeleteStoreId] = useState<string | null>(null);
  const [rhythmSearch, setRhythmSearch] = useState('');
  const [spendExpanded, setSpendExpanded] = useState(false);
  const [activityExpanded, setActivityExpanded] = useState(false);
  const [reminderHint, setReminderHint] = useState<string | null>(null);

  const spendSummary = useMemo(
    () => computeStoreSpendSummary(tripReceipts, stores, 30),
    [tripReceipts, stores]
  );
  const priceComparisons = useMemo(
    () => computeMultiStorePriceComparisons(items, stores),
    [items, stores]
  );
  const activitySummary = useMemo(
    () => computeHouseholdActivitySummary(events, items, stores, 30),
    [events, items, stores]
  );
  const pricedItemsCount = useMemo(
    () => items.filter((i) => typeof i.lastPrice === 'number' && i.lastPrice > 0).length,
    [items]
  );
  const storeMap = useMemo(() => new Map(stores.map((s) => [s.id, s])), [stores]);

  const handleToggleBrowserReminders = async () => {
    setReminderHint(null);
    if (settings.browserRemindersEnabled) {
      onUpdateSettings({ browserRemindersEnabled: false });
      return;
    }
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setReminderHint('Browser notifications are not supported on this device.');
      return;
    }
    if (Notification.permission === 'granted') {
      onUpdateSettings({ browserRemindersEnabled: true });
      return;
    }
    if (Notification.permission === 'denied') {
      setReminderHint('Notifications are blocked in your browser settings for this site.');
      return;
    }
    try {
      const result = await Notification.requestPermission();
      if (result === 'granted') {
        onUpdateSettings({ browserRemindersEnabled: true });
      } else {
        setReminderHint('Permission was not granted — keeping reminders off.');
      }
    } catch {
      setReminderHint('Could not request notification permission on this browser.');
    }
  };

  const filteredRhythmItems = useMemo(() => {
    const q = rhythmSearch.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => `${i.name} ${i.alias}`.toLowerCase().includes(q));
  }, [items, rhythmSearch]);

  const handleAddStore = (e: React.FormEvent) => {
    e.preventDefault();
    if (!storeName.trim()) return;
    onAddStore({
      name: storeName.trim(),
      alias: storeAlias.trim() || undefined,
      color: storeColor,
    });
    setStoreName('');
    setStoreAlias('');
  };

  return (
    <div className="space-y-6">
      {/* Household Preferences */}
      <div className="rounded-3xl border border-stone-200 bg-white p-5 space-y-4 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-teal-50 text-teal-700 flex items-center justify-center shrink-0">
              <SlidersHorizontal className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-stone-900">Household Preferences</h2>
              <p className="text-xs text-stone-500">
                Customize your shopping cadence, forecast radar window, and daily nutrition targets
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onReplayTour}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-teal-50 hover:bg-teal-100 border border-teal-200 text-teal-800 px-3.5 py-2 text-xs font-bold transition shrink-0"
          >
            <PlayCircle className="w-4 h-4" />
            Replay Feature Tour
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          <div className="rounded-2xl bg-stone-50 border border-stone-200/80 p-3.5">
            <label className="block text-[11px] font-semibold text-stone-500 mb-1.5">
              Shopping Day &amp; Forecast Radar Window
            </label>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={settings.shoppingDay}
                onChange={(e) => onUpdateSettings({ shoppingDay: Number(e.target.value) })}
                className="w-full rounded-lg border border-stone-200 bg-white px-2.5 py-2 text-xs font-semibold"
              >
                {[6, 0, 5, 1, 2, 3, 4].map((d) => (
                  <option key={d} value={d}>
                    {formatShoppingDayName(d)}
                  </option>
                ))}
              </select>
              <div className="relative">
                <input
                  type="number"
                  min={3}
                  max={30}
                  value={settings.forecastHorizonDays}
                  onChange={(e) =>
                    onUpdateSettings({
                      forecastHorizonDays: Math.max(3, Math.min(30, Number(e.target.value) || 10)),
                    })
                  }
                  title="Consumption Forecast Radar horizon (days)"
                  className="w-full rounded-lg border border-stone-200 bg-white px-2.5 pr-11 py-2 text-xs font-bold text-amber-800"
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-stone-400">
                  days
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-stone-50 border border-stone-200/80 p-3.5">
            <label className="block text-[11px] font-semibold text-stone-500 mb-1.5">
              Daily Protein Goal / Sugar Limit (g per person)
            </label>
            <div className="grid grid-cols-2 gap-2">
              <div className="relative">
                <input
                  type="number"
                  min={60}
                  max={250}
                  step={5}
                  value={settings.dailyProteinTarget}
                  onChange={(e) =>
                    onUpdateSettings({
                      dailyProteinTarget: Math.max(60, Number(e.target.value) || 120),
                    })
                  }
                  className="w-full rounded-lg border border-stone-200 bg-white px-2.5 pr-14 py-2 text-xs font-bold text-indigo-700"
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-stone-400">
                  g pro
                </span>
              </div>
              <div className="relative">
                <input
                  type="number"
                  min={10}
                  max={100}
                  step={2}
                  value={settings.dailySugarLimit}
                  onChange={(e) =>
                    onUpdateSettings({
                      dailySugarLimit: Math.max(10, Number(e.target.value) || 36),
                    })
                  }
                  className="w-full rounded-lg border border-stone-200 bg-white px-2.5 pr-16 py-2 text-xs font-bold text-rose-700"
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-stone-400">
                  g sugar
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Quiet Optional Browser Reminders (Off by Default) */}
        <div className="rounded-2xl bg-stone-50 border border-stone-200/80 px-3.5 py-3 flex items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <Bell className="w-4 h-4 text-teal-700 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <div className="text-xs font-semibold text-stone-800">
                Quiet Browser Alerts (Optional, max 1/day)
              </div>
              <p className="text-[11px] text-stone-500">
                Only notifies when an item expires within 48h or on Shopping Day with essentials waiting.
              </p>
              {reminderHint && (
                <p className="text-[11px] text-amber-700 font-medium mt-1">{reminderHint}</p>
              )}
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={Boolean(settings.browserRemindersEnabled)}
            onClick={() => void handleToggleBrowserReminders()}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
              settings.browserRemindersEnabled ? 'bg-teal-700' : 'bg-stone-300'
            }`}
            aria-label="Toggle quiet browser reminders"
          >
            <span
              className={`inline-block h-4.5 w-4.5 transform rounded-full bg-white shadow-xs transition ${
                settings.browserRemindersEnabled ? 'translate-x-5.5' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Stores Manager */}
      <div className="rounded-3xl border border-stone-200 bg-white p-5 space-y-4 shadow-2xs">
        <div className="flex items-center gap-2">
          <StoreIcon className="w-5 h-5 text-teal-700" />
          <h3 className="font-bold text-stone-900">{UI_LABELS.storesManager}</h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          {stores.map((st) => {
            const picking = editingColorStoreId === st.id;
            const confirmingDel = confirmDeleteStoreId === st.id;
            return (
              <div key={st.id} className="rounded-2xl border border-stone-200 p-3 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <button
                      type="button"
                      onClick={() => setEditingColorStoreId(picking ? null : st.id)}
                      className="w-5 h-5 rounded-full shrink-0 ring-2 ring-offset-2 ring-stone-200 hover:ring-stone-400 transition cursor-pointer"
                      style={{ backgroundColor: st.color }}
                      title="Click to change store color"
                      aria-label={`Change color for ${st.name}`}
                    />
                    <div className="min-w-0">
                      <div className="font-semibold text-sm text-stone-900 truncate">{st.name}</div>
                      {st.alias && (
                        <div dir="auto" className="text-xs text-stone-500 truncate">
                          {st.alias}
                        </div>
                      )}
                    </div>
                  </div>
                  {stores.length > 1 && (
                    confirmingDel ? (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            onDeleteStore(st.id);
                            setConfirmDeleteStoreId(null);
                          }}
                          className="px-2 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-bold"
                        >
                          Remove
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteStoreId(null)}
                          className="px-1.5 py-1 rounded-lg text-[10px] font-semibold text-stone-500 hover:bg-stone-100"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteStoreId(st.id)}
                        className="p-1.5 rounded-lg text-stone-400 hover:text-rose-600 hover:bg-rose-50"
                        aria-label={`Remove ${st.name}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )
                  )}
                </div>

                {picking && (
                  <div className="flex items-center justify-between gap-1.5 pt-2 border-t border-stone-100">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {STORE_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => {
                            onUpdateStore(st.id, { color: c });
                            setEditingColorStoreId(null);
                          }}
                          className={`w-5 h-5 rounded-full border-2 transition ${
                            st.color.toLowerCase() === c.toLowerCase()
                              ? 'border-stone-900 scale-110'
                              : 'border-transparent hover:scale-110'
                          }`}
                          style={{ backgroundColor: c }}
                          aria-label={`Set ${st.name} color to ${c}`}
                        />
                      ))}
                    </div>
                    <label
                      className="text-[10px] font-semibold text-stone-500 hover:text-stone-800 inline-flex items-center gap-1 cursor-pointer shrink-0"
                      title="Pick any custom color"
                    >
                      <span>Custom</span>
                      <input
                        type="color"
                        value={st.color}
                        onChange={(e) => onUpdateStore(st.id, { color: e.target.value })}
                        className="w-5 h-5 rounded cursor-pointer border-0 bg-transparent p-0"
                      />
                    </label>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <form onSubmit={handleAddStore} className="flex flex-col sm:flex-row gap-2 pt-1">
          <input
            dir="auto"
            required
            value={storeName}
            onChange={(e) => setStoreName(e.target.value)}
            placeholder="New store name (e.g. No Frills, Trader Joe's)"
            className="flex-1 rounded-xl border border-stone-200 px-3 py-2 text-xs"
          />
          <input
            dir="auto"
            value={storeAlias}
            onChange={(e) => setStoreAlias(e.target.value)}
            placeholder="Alias (optional)"
            className="sm:w-40 rounded-xl border border-stone-200 px-3 py-2 text-xs"
          />
          <div className="flex items-center gap-1.5">
            {STORE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setStoreColor(c)}
                className={`w-6 h-6 rounded-full border-2 ${
                  storeColor === c ? 'border-stone-900 scale-110' : 'border-transparent'
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <button
            type="submit"
            className="inline-flex items-center justify-center gap-1 rounded-xl bg-teal-700 hover:bg-teal-800 text-white px-4 py-2 text-xs font-semibold"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Store
          </button>
        </form>
      </div>

      {/* Grocery Spend & Store Price Notes (Calm, Collapsed by Default) */}
      <div className="rounded-3xl border border-stone-200 bg-white overflow-hidden shadow-2xs">
        <button
          type="button"
          onClick={() => setSpendExpanded((v) => !v)}
          className="w-full px-5 py-4 flex items-center justify-between gap-3 hover:bg-stone-50/80 transition text-left"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
              <Receipt className="w-4.5 h-4.5" />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-stone-900 text-sm">Grocery Spend &amp; Price Notes</h3>
              <p className="text-[11px] text-stone-500 truncate">
                {spendSummary.totalSpent > 0
                  ? `${formatCurrency(spendSummary.totalSpent)} across ${spendSummary.tripCount} scanned trip(s) in last 30 days`
                  : pricedItemsCount > 0
                  ? `${pricedItemsCount} item(s) have saved prices for Shopping List estimates`
                  : 'Scan receipts or add item prices to see store estimates & comparisons'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {spendSummary.totalSpent > 0 && (
              <span className="hidden sm:inline-flex px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-bold">
                30d: {formatCurrency(spendSummary.totalSpent)}
              </span>
            )}
            {spendExpanded ? (
              <ChevronDown className="w-4 h-4 text-stone-400" />
            ) : (
              <ChevronRight className="w-4 h-4 text-stone-400" />
            )}
          </div>
        </button>

        {spendExpanded && (
          <div className="px-5 pb-5 pt-1 border-t border-stone-100 space-y-4">
            {/* 30-Day Store Spend Breakdown */}
            {spendSummary.byStore.length > 0 ? (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-stone-700">Last 30 Days by Store</span>
                  <span className="font-bold text-emerald-800">
                    Total: {formatCurrency(spendSummary.totalSpent)}
                  </span>
                </div>
                <div className="space-y-2">
                  {spendSummary.byStore.map((st) => {
                    const sharePct =
                      spendSummary.totalSpent > 0
                        ? Math.round((st.totalSpent / spendSummary.totalSpent) * 100)
                        : 0;
                    return (
                      <div key={st.storeId} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="inline-flex items-center gap-1.5 font-semibold text-stone-800">
                            <span
                              className="w-2.5 h-2.5 rounded-full"
                              style={{ backgroundColor: st.storeColor }}
                            />
                            {st.storeName}
                            <span className="text-[11px] font-normal text-stone-400">
                              ({st.tripCount} {st.tripCount === 1 ? 'trip' : 'trips'})
                            </span>
                          </span>
                          <span className="font-bold text-stone-900">
                            {formatCurrency(st.totalSpent)}{' '}
                            <span className="text-[10px] font-medium text-stone-400">
                              ({sharePct}%)
                            </span>
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-stone-100 overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.max(4, sharePct)}%`,
                              backgroundColor: st.storeColor,
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="rounded-2xl bg-stone-50 border border-dashed border-stone-200 p-4 text-xs text-stone-500">
                No scanned receipts in the last 30 days yet. Scanning receipts in the Kitchen tab automatically tracks store totals and per-item prices.
              </div>
            )}

            {/* Multi-Store Price Comparisons (only when an item has prices at 2+ stores) */}
            {priceComparisons.length > 0 && (
              <div className="space-y-2 pt-1">
                <h4 className="text-xs font-bold text-stone-700">
                  Store Price Comparisons ({priceComparisons.length})
                </h4>
                <div className="divide-y divide-stone-100 rounded-2xl border border-stone-200/80 overflow-hidden">
                  {priceComparisons.slice(0, 8).map((cmp) => (
                    <div
                      key={cmp.itemId}
                      className="px-3.5 py-2.5 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <span dir="auto" className="font-semibold text-stone-900">
                          {cmp.itemName}
                        </span>
                        {cmp.itemAlias && (
                          <span dir="auto" className="text-stone-400 ml-1">
                            ({cmp.itemAlias})
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {cmp.storePrices.map((sp) => {
                          const isBest = sp.storeId === cmp.cheapestStoreId;
                          return (
                            <span
                              key={sp.storeId}
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border text-[11px] font-semibold ${
                                isBest
                                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                  : 'bg-stone-50 text-stone-600 border-stone-200'
                              }`}
                            >
                              <span
                                className="w-2 h-2 rounded-full"
                                style={{ backgroundColor: sp.storeColor }}
                              />
                              {sp.storeName}: {formatCurrency(sp.price)}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent Scanned Receipts */}
            {spendSummary.recentReceipts.length > 0 && (
              <div className="space-y-1.5 pt-1">
                <h4 className="text-xs font-bold text-stone-700">Recent Scanned Receipts</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {spendSummary.recentReceipts.map((r) => {
                    const st = storeMap.get(r.storeId);
                    return (
                      <div
                        key={r.id}
                        className="rounded-xl border border-stone-200/80 bg-stone-50/70 px-3 py-2 flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-stone-800 truncate">
                            {st?.name ?? 'Store'}
                          </div>
                          <div className="text-[10px] text-stone-500">
                            {new Date(r.date).toLocaleDateString()} • {r.itemCount} item(s)
                          </div>
                        </div>
                        <span className="font-bold text-stone-900 shrink-0">
                          {formatCurrency(r.totalSpent)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Household Activity Feed & Waste-Saved Summary (Calm, Collapsed by Default) */}
      <div className="rounded-3xl border border-stone-200 bg-white overflow-hidden shadow-2xs">
        <button
          type="button"
          onClick={() => setActivityExpanded((v) => !v)}
          className="w-full px-5 py-4 flex items-center justify-between gap-3 hover:bg-stone-50/80 transition text-left"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-2xl bg-indigo-50 text-indigo-700 flex items-center justify-center shrink-0">
              <History className="w-4.5 h-4.5" />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-stone-900 text-sm">
                Household Activity &amp; Waste Saved
              </h3>
              <p className="text-[11px] text-stone-500 truncate">
                {activitySummary.recentRows.length > 0
                  ? `${activitySummary.usesCount} use(s) • ${activitySummary.restocksCount} restock(s)${
                      activitySummary.rescuedBeforeExpiryCount > 0
                        ? ` • ${activitySummary.rescuedBeforeExpiryCount} item(s) used before expiry`
                        : ''
                    } in last 30 days`
                  : 'Recent kitchen logs and partner activity will appear here'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {activitySummary.rescuedBeforeExpiryCount > 0 && (
              <span className="hidden sm:inline-flex px-2.5 py-1 rounded-full bg-teal-50 text-teal-800 border border-teal-200 text-xs font-bold">
                {activitySummary.rescuedBeforeExpiryCount} rescued
              </span>
            )}
            {activityExpanded ? (
              <ChevronDown className="w-4 h-4 text-stone-400" />
            ) : (
              <ChevronRight className="w-4 h-4 text-stone-400" />
            )}
          </div>
        </button>

        {activityExpanded && (
          <div className="px-5 pb-5 pt-2 border-t border-stone-100 space-y-4">
            {/* Quiet 30-day summary row */}
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-2xl bg-stone-50 border border-stone-200/80 p-3 text-center">
                <div className="text-lg font-bold text-teal-800">
                  {activitySummary.rescuedBeforeExpiryCount}
                </div>
                <div className="text-[10px] font-semibold text-stone-500">
                  Used before expiry
                </div>
              </div>
              <div className="rounded-2xl bg-stone-50 border border-stone-200/80 p-3 text-center">
                <div className="text-lg font-bold text-stone-900">
                  {activitySummary.usesCount}
                </div>
                <div className="text-[10px] font-semibold text-stone-500">
                  Portions logged (30d)
                </div>
              </div>
              <div className="rounded-2xl bg-stone-50 border border-stone-200/80 p-3 text-center">
                <div className="text-lg font-bold text-emerald-700">
                  {activitySummary.restocksCount}
                </div>
                <div className="text-[10px] font-semibold text-stone-500">
                  Restocks (30d)
                </div>
              </div>
            </div>

            {activitySummary.topUsedItems.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                <span className="font-semibold text-stone-500 mr-1">Most used (30d):</span>
                {activitySummary.topUsedItems.map((it) => (
                  <span
                    key={it.itemId}
                    className="px-2 py-0.5 rounded-full bg-stone-100 text-stone-700 font-medium"
                  >
                    {it.name} ({it.count})
                  </span>
                ))}
              </div>
            )}

            {/* Shared Activity Log */}
            {activitySummary.recentRows.length === 0 ? (
              <div className="rounded-2xl bg-stone-50 border border-dashed border-stone-200 p-4 text-xs text-stone-500">
                No recent kitchen activity yet.
              </div>
            ) : (
              <div className="divide-y divide-stone-100 rounded-2xl border border-stone-200/80 overflow-hidden max-h-72 overflow-y-auto">
                {activitySummary.recentRows.map((row) => (
                  <div
                    key={row.id}
                    className="px-3.5 py-2.5 bg-white flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0 flex items-center gap-2">
                      <span className="px-1.5 py-0.5 rounded-md bg-stone-100 text-stone-700 font-bold text-[10px] shrink-0">
                        {row.actor}
                      </span>
                      <span className="text-stone-600 truncate">
                        <span
                          className={`font-semibold ${
                            row.tone === 'emerald'
                              ? 'text-emerald-700'
                              : row.tone === 'amber'
                              ? 'text-amber-700'
                              : row.tone === 'teal'
                              ? 'text-teal-800'
                              : 'text-stone-700'
                          }`}
                        >
                          {row.actionText}
                        </span>{' '}
                        <strong dir="auto" className="text-stone-900">
                          {row.itemName}
                        </strong>
                      </span>
                    </div>
                    <span className="text-[10px] font-medium text-stone-400 shrink-0">
                      {row.relativeTime}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Learned Consumption Rhythm Table — Inline Editable */}
      <div className="rounded-3xl border border-stone-200 bg-white p-5 space-y-3 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-teal-700" />
              <h3 className="font-bold text-stone-900">{UI_LABELS.velocityInsights}</h3>
            </div>
            <p className="text-[11px] text-stone-500 mt-0.5">
              Edit cycle days, daily burn rate, or preferred store inline — everything stays synced automatically.
            </p>
          </div>
          {items.length > 0 && (
            <div className="relative sm:w-56">
              <Search className="w-3.5 h-3.5 text-stone-400 absolute top-1/2 -translate-y-1/2 left-2.5 pointer-events-none" />
              <input
                dir="auto"
                value={rhythmSearch}
                onChange={(e) => setRhythmSearch(e.target.value)}
                placeholder="Filter items..."
                className="w-full rounded-xl border border-stone-200 pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
          )}
        </div>

        {items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-stone-200 p-8 text-center text-xs text-stone-500">
            No items tracked yet. Add items or scan a receipt on the Kitchen tab to start tracking consumption cycles.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-stone-100 text-stone-500">
                  <th className="py-2 pr-3 font-semibold">Item</th>
                  <th className="py-2 px-2 font-semibold">Learned Cycle</th>
                  <th className="py-2 px-2 font-semibold">Burn Rate</th>
                  <th className="py-2 px-2 font-semibold">Learned Store</th>
                  <th className="py-2 pl-3 font-semibold text-right">Est. Left</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filteredRhythmItems.map((item) => (
                  <LearnedRhythmRow
                    key={item.id}
                    item={item}
                    stores={stores}
                    shoppingDay={settings.shoppingDay}
                    onUpdate={(patch) => onUpdateItemLearning(item.id, patch)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
