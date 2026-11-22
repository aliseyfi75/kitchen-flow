import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Clock,
  Edit3,
  Flame,
  Minus,
  Plus,
  RefreshCw,
  Search,
  Snowflake,
  Thermometer,
  Trash2,
} from 'lucide-react';
import { InventoryItem, StorageZone, Store, UILanguage } from '../types/kitchen';
import { computeItemForecast } from '../utils/forecasting';
import { CATEGORY_META, t, ZONE_META } from '../i18n/translations';
import { ItemModal } from './ItemModal';

interface KitchenViewProps {
  items: InventoryItem[];
  stores: Store[];
  shoppingDay: number;
  lang: UILanguage;
  onUsePortion: (itemId: string, amount?: number) => void;
  onSetLevel: (itemId: string, percent: number) => void;
  onMarkFinished: (itemId: string) => void;
  onQuickRestock: (itemId: string) => void;
  onSaveItem: (item: InventoryItem, isNew: boolean) => void;
  onDeleteItem: (itemId: string) => void;
}

const ZONE_ICONS: Record<StorageZone, React.ReactNode> = {
  fridge: <Thermometer className="w-4 h-4" />,
  freezer: <Snowflake className="w-4 h-4" />,
  pantry: <Archive className="w-4 h-4" />,
};

export const KitchenView: React.FC<KitchenViewProps> = ({
  items,
  stores,
  shoppingDay,
  lang,
  onUsePortion,
  onSetLevel,
  onMarkFinished,
  onQuickRestock,
  onSaveItem,
  onDeleteItem,
}) => {
  const [zoneFilter, setZoneFilter] = useState<'all' | StorageZone>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'attention' | 'expiring'>('all');
  const [search, setSearch] = useState('');
  const [editingItem, setEditingItem] = useState<InventoryItem | null | undefined>(undefined);

  const storeMap = useMemo(() => new Map(stores.map((s) => [s.id, s])), [stores]);

  const enriched = useMemo(() => {
    return items.map((item) => ({
      item,
      forecast: computeItemForecast(item, shoppingDay),
    }));
  }, [items, shoppingDay]);

  const stats = useMemo(() => {
    let buyThisWeekend = 0;
    let expiringSoon = 0;
    let outCount = 0;
    for (const { forecast } of enriched) {
      if (forecast.verdict === 'out') outCount += 1;
      if (forecast.verdict === 'out' || forecast.verdict === 'buy_this_weekend') buyThisWeekend += 1;
      if (forecast.expiringSoon) expiringSoon += 1;
    }
    return { total: items.length, buyThisWeekend, expiringSoon, outCount };
  }, [enriched, items.length]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enriched
      .filter(({ item, forecast }) => {
        if (zoneFilter !== 'all' && item.zone !== zoneFilter) return false;
        if (statusFilter === 'attention') {
          if (forecast.verdict !== 'out' && forecast.verdict !== 'buy_this_weekend') return false;
        }
        if (statusFilter === 'expiring' && !forecast.expiringSoon) return false;

        if (q) {
          const store = storeMap.get(forecast.learnedStoreId);
          const hay = [
            item.name,
            item.alias,
            item.packDescription,
            store?.name ?? '',
            store?.alias ?? '',
          ]
            .join(' ')
            .toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        // Sort out / expiring / low items first for quick kitchen action
        const priority = (v: typeof a.forecast.verdict, exp: boolean) => {
          if (v === 'out') return 0;
          if (exp) return 1;
          if (v === 'buy_this_weekend') return 2;
          if (v === 'borderline') return 3;
          return 4;
        };
        const diff =
          priority(a.forecast.verdict, a.forecast.expiringSoon) -
          priority(b.forecast.verdict, b.forecast.expiringSoon);
        if (diff !== 0) return diff;
        return a.forecast.estimatedDaysLeft - b.forecast.estimatedDaysLeft;
      });
  }, [enriched, zoneFilter, statusFilter, search, storeMap]);

  return (
    <div className="space-y-5">
      {/* Top KPI summary cards */}
      <div className="grid grid-cols-3 gap-2.5 sm:gap-4">
        <button
          type="button"
          onClick={() => setStatusFilter('all')}
          className={`rounded-2xl border p-3.5 text-left transition ${
            statusFilter === 'all'
              ? 'border-teal-600 bg-teal-50/70 shadow-xs'
              : 'border-stone-200/80 bg-white hover:border-stone-300'
          }`}
        >
          <div className="text-[11px] font-medium uppercase tracking-wider text-stone-500">
            {lang === 'fa' ? 'کل اقلام' : 'Tracked Items'}
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-2xl font-bold text-stone-900">{stats.total}</span>
            <span className="text-xs text-stone-500">{lang === 'fa' ? 'قلم' : 'staples'}</span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter(statusFilter === 'attention' ? 'all' : 'attention')}
          className={`rounded-2xl border p-3.5 text-left transition ${
            statusFilter === 'attention'
              ? 'border-amber-500 bg-amber-50 shadow-xs'
              : 'border-stone-200/80 bg-white hover:border-stone-300'
          }`}
        >
          <div className="text-[11px] font-medium uppercase tracking-wider text-amber-700">
            {lang === 'fa' ? 'نیاز این آخر هفته' : 'Need This Weekend'}
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-2xl font-bold text-amber-700">{stats.buyThisWeekend}</span>
            <span className="text-xs text-amber-600">
              {stats.outCount > 0 ? `(${stats.outCount} out)` : ''}
            </span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter(statusFilter === 'expiring' ? 'all' : 'expiring')}
          className={`rounded-2xl border p-3.5 text-left transition ${
            statusFilter === 'expiring'
              ? 'border-rose-500 bg-rose-50 shadow-xs'
              : 'border-stone-200/80 bg-white hover:border-stone-300'
          }`}
        >
          <div className="text-[11px] font-medium uppercase tracking-wider text-rose-700">
            {lang === 'fa' ? 'زود مصرف شود' : 'Use Soon'}
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-2xl font-bold text-rose-600">{stats.expiringSoon}</span>
            <span className="text-xs text-rose-500">{lang === 'fa' ? 'تازه' : 'fresh'}</span>
          </div>
        </button>
      </div>

      {/* Search + Zone Tabs + Add Button */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-stone-400 absolute top-1/2 -translate-y-1/2 left-3.5 pointer-events-none" />
          <input
            dir="auto"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t(lang, 'searchPlaceholder')}
            className="w-full rounded-xl border border-stone-200 bg-white pl-10 pr-4 py-2.5 text-sm shadow-2xs focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>

        <button
          type="button"
          onClick={() => setEditingItem(null)}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white px-4 py-2.5 text-sm font-semibold shadow-xs transition shrink-0"
        >
          <Plus className="w-4 h-4" />
          {t(lang, 'addItem')}
        </button>
      </div>

      {/* Zone Pill Filter */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {(['all', 'fridge', 'freezer', 'pantry'] as const).map((z) => {
          const count = z === 'all' ? items.length : items.filter((i) => i.zone === z).length;
          const active = zoneFilter === z;
          return (
            <button
              key={z}
              type="button"
              onClick={() => setZoneFilter(z)}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold transition shrink-0 ${
                active
                  ? 'bg-stone-900 text-white shadow-xs'
                  : 'bg-white border border-stone-200 text-stone-600 hover:bg-stone-50'
              }`}
            >
              {z !== 'all' && ZONE_ICONS[z]}
              <span>{z === 'all' ? t(lang, 'allZones') : ZONE_META[z][lang]}</span>
              <span
                className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                  active ? 'bg-white/20 text-white' : 'bg-stone-100 text-stone-500'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Inventory Cards Grid */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-10 text-center text-sm text-stone-500">
          No matching items found. Try clearing your filter or add a new item.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {filtered.map(({ item, forecast }) => {
            const store = storeMap.get(forecast.learnedStoreId);
            const barColor =
              forecast.stockState === 'critical'
                ? 'bg-rose-500'
                : forecast.stockState === 'low'
                ? 'bg-amber-500'
                : 'bg-teal-600';

            const verdictBadge =
              forecast.verdict === 'out'
                ? { label: t(lang, 'outOfStock'), cls: 'bg-rose-100 text-rose-800 border-rose-200' }
                : forecast.verdict === 'buy_this_weekend'
                ? { label: t(lang, 'buyThisWeekend'), cls: 'bg-amber-100 text-amber-800 border-amber-200' }
                : forecast.verdict === 'borderline'
                ? { label: t(lang, 'borderline'), cls: 'bg-sky-50 text-sky-800 border-sky-200' }
                : { label: t(lang, 'goodNextWeek'), cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' };

            return (
              <div
                key={item.id}
                className={`rounded-2xl border bg-white p-4 shadow-2xs transition hover:shadow-sm flex flex-col justify-between gap-3 ${
                  forecast.verdict === 'out'
                    ? 'border-rose-200 bg-rose-50/20'
                    : forecast.expiringSoon
                    ? 'border-amber-200'
                    : 'border-stone-200/80'
                }`}
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 dir="auto" className="font-semibold text-stone-900 text-base leading-tight">
                        {item.name}
                      </h3>
                      {item.alias && (
                        <span
                          dir="auto"
                          className="text-xs font-medium text-teal-800 bg-teal-50 border border-teal-100 px-2 py-0.5 rounded-md"
                        >
                          {item.alias}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center flex-wrap gap-x-2.5 gap-y-1 text-xs text-stone-500">
                      <span className="inline-flex items-center gap-1 font-medium text-stone-600">
                        {ZONE_ICONS[item.zone]}
                        {ZONE_META[item.zone][lang]}
                      </span>
                      <span>•</span>
                      <span>{CATEGORY_META[item.category][lang]}</span>
                      {store && (
                        <>
                          <span>•</span>
                          <span className="inline-flex items-center gap-1 font-medium text-stone-700">
                            <span
                              className="w-2 h-2 rounded-full inline-block"
                              style={{ backgroundColor: store.color }}
                            />
                            {store.name}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setEditingItem(item)}
                    className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 shrink-0"
                    title="Edit item"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                </div>

                {/* Portion progress + status badges */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-stone-800">
                      {item.remainingPortions} / {item.totalPortions}{' '}
                      <span className="font-normal text-stone-500">× {item.portionLabel}</span>
                    </span>
                    <span className="font-medium text-stone-500">{forecast.stockPercent}%</span>
                  </div>

                  <div className="h-2 w-full rounded-full bg-stone-100 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${barColor}`}
                      style={{ width: `${forecast.stockPercent}%` }}
                    />
                  </div>

                  {/* Quick level taps for continuous items (milk, spinach, rice) */}
                  {item.trackingMode === 'continuous' && (
                    <div className="flex items-center gap-1 pt-0.5">
                      {[100, 75, 50, 25, 0].map((pct) => {
                        const isNear = Math.abs(forecast.stockPercent - pct) <= 10;
                        return (
                          <button
                            key={pct}
                            type="button"
                            onClick={() => onSetLevel(item.id, pct)}
                            className={`flex-1 py-1 rounded-lg text-[11px] font-medium transition border ${
                              isNear
                                ? 'bg-stone-800 text-white border-stone-800'
                                : 'bg-stone-50 text-stone-600 border-stone-200 hover:bg-stone-100'
                            }`}
                          >
                            {pct === 0 ? 'Empty' : `${pct}%`}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Badges Row */}
                  <div className="flex items-center flex-wrap gap-1.5 pt-0.5">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${verdictBadge.cls}`}
                    >
                      {forecast.verdict === 'good_until_next_week' ? (
                        <CheckCircle2 className="w-3 h-3" />
                      ) : (
                        <Clock className="w-3 h-3" />
                      )}
                      {verdictBadge.label}
                    </span>

                    {item.remainingPortions > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-stone-100 text-stone-700">
                        ~{forecast.estimatedDaysLeft}{' '}
                        {forecast.estimatedDaysLeft === 1 ? t(lang, 'dayLeft') : t(lang, 'daysLeft')}
                      </span>
                    )}

                    {item.proteinPerPortion > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-indigo-50 text-indigo-700">
                        <Flame className="w-3 h-3" />
                        {item.proteinPerPortion}g protein
                      </span>
                    )}

                    {forecast.expiringSoon && forecast.daysUntilExpiry !== null && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                        <AlertTriangle className="w-3 h-3" />
                        {forecast.daysUntilExpiry <= 0
                          ? 'Check freshness!'
                          : `${t(lang, 'expiringSoon')} (${forecast.daysUntilExpiry}d)`}
                      </span>
                    )}
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center gap-2 pt-2 border-t border-stone-100">
                  {item.remainingPortions > 0 ? (
                    <>
                      <button
                        type="button"
                        onClick={() => onUsePortion(item.id, 1)}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-teal-700 hover:bg-teal-800 active:scale-[0.98] text-white py-2 px-3 text-xs font-semibold transition"
                      >
                        <Minus className="w-3.5 h-3.5" />
                        {t(lang, 'usePortion')}
                      </button>
                      <button
                        type="button"
                        onClick={() => onMarkFinished(item.id)}
                        className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 active:scale-[0.98] text-amber-900 border border-amber-200 py-2 px-3 text-xs font-semibold transition"
                        title="Empty & auto-add to shopping list"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        {t(lang, 'finishedBtn')}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onQuickRestock(item.id)}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-stone-900 hover:bg-stone-800 text-white py-2 px-3 text-xs font-semibold transition"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      {t(lang, 'restockBtn')} ({item.totalPortions} portions)
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editingItem !== undefined && (
        <ItemModal
          item={editingItem}
          stores={stores}
          lang={lang}
          onClose={() => setEditingItem(undefined)}
          onSave={onSaveItem}
          onDelete={onDeleteItem}
        />
      )}
    </div>
  );
};
