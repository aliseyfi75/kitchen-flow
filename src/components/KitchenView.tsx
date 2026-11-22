import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  Camera,
  CheckCircle2,
  Clock,
  Edit3,
  Flame,
  Minus,
  Plus,
  Receipt,
  RefreshCw,
  Search,
  Snowflake,
  Thermometer,
  Trash2,
  User,
  Users,
  PartyPopper,
} from 'lucide-react';
import {
  EatingMode,
  InventoryItem,
  StorageZone,
  Store,
  UILanguage,
  UIMode,
} from '../types/kitchen';
import { computeItemForecast } from '../utils/forecasting';
import { CATEGORY_META, t, ZONE_META } from '../i18n/translations';
import { ItemModal } from './ItemModal';

interface KitchenViewProps {
  items: InventoryItem[];
  stores: Store[];
  shoppingDay: number;
  lang: UILanguage;
  uiMode: UIMode;
  eatingMode: EatingMode;
  guestCount: number;
  onChangeEatingMode: (mode: EatingMode, guestCount?: number) => void;
  onUsePortion: (itemId: string, amount?: number) => void;
  onSetLevel: (itemId: string, percent: number) => void;
  onMarkFinished: (itemId: string) => void;
  onQuickRestock: (itemId: string) => void;
  onSaveItem: (item: InventoryItem, isNew: boolean) => void;
  onDeleteItem: (itemId: string) => void;
  onOpenReceiptScanner: () => void;
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
  uiMode,
  eatingMode,
  guestCount,
  onChangeEatingMode,
  onUsePortion,
  onSetLevel,
  onMarkFinished,
  onQuickRestock,
  onSaveItem,
  onDeleteItem,
  onOpenReceiptScanner,
}) => {
  const [zoneFilter, setZoneFilter] = useState<'all' | StorageZone>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'attention' | 'expiring'>('all');
  const [search, setSearch] = useState('');
  const [modalState, setModalState] = useState<{
    item: InventoryItem | null;
    initialTab: 'basics' | 'nutrition';
  } | null>(null);

  const isDetailed = uiMode === 'detailed';
  const servingMultiplier =
    eatingMode === 'solo' ? 1 : eatingMode === 'together' ? 2 : Math.max(3, guestCount);

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
    <div className="space-y-4">
      {/* Who's Eating? Serving Multiplier Strip — Zero Mental Load */}
      <div className="rounded-2xl border border-stone-200/90 bg-white px-3.5 py-2.5 shadow-2xs flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2 text-xs font-semibold text-stone-700">
          <Users className="w-4 h-4 text-teal-700" />
          <span>{t(lang, 'whosEating')}</span>
        </div>

        <div className="flex items-center flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => onChangeEatingMode('solo')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
              eatingMode === 'solo'
                ? 'bg-teal-700 text-white shadow-2xs'
                : 'bg-stone-100 text-stone-600 hover:bg-stone-200/70'
            }`}
          >
            <User className="w-3.5 h-3.5" />
            {t(lang, 'solo')}
          </button>

          <button
            type="button"
            onClick={() => onChangeEatingMode('together')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
              eatingMode === 'together'
                ? 'bg-teal-700 text-white shadow-2xs'
                : 'bg-stone-100 text-stone-600 hover:bg-stone-200/70'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            {t(lang, 'together')}
          </button>

          <div
            className={`inline-flex items-center rounded-xl transition ${
              eatingMode === 'guests'
                ? 'bg-indigo-700 text-white shadow-2xs'
                : 'bg-stone-100 text-stone-600 hover:bg-stone-200/70'
            }`}
          >
            <button
              type="button"
              onClick={() => onChangeEatingMode('guests', Math.max(3, guestCount))}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold"
            >
              <PartyPopper className="w-3.5 h-3.5" />
              {t(lang, 'guests')} ({guestCount}×)
            </button>
            {eatingMode === 'guests' && (
              <div className="flex items-center border-l border-white/20 px-1 gap-0.5">
                <button
                  type="button"
                  onClick={() => onChangeEatingMode('guests', Math.max(3, guestCount - 1))}
                  className="p-1 rounded hover:bg-white/15"
                  aria-label="Decrease guests"
                >
                  <Minus className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => onChangeEatingMode('guests', Math.min(12, guestCount + 1))}
                  className="p-1 rounded hover:bg-white/15"
                  aria-label="Increase guests"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Top KPI summary cards */}
      <div className="grid grid-cols-3 gap-2.5 sm:gap-3.5">
        <button
          type="button"
          onClick={() => setStatusFilter('all')}
          className={`rounded-2xl border p-3 text-left transition ${
            statusFilter === 'all'
              ? 'border-teal-600 bg-teal-50/70 shadow-2xs'
              : 'border-stone-200/80 bg-white hover:border-stone-300'
          }`}
        >
          <div className="text-[11px] font-medium uppercase tracking-wider text-stone-500">
            {lang === 'fa' ? 'کل اقلام' : 'Tracked'}
          </div>
          <div className="mt-0.5 flex items-baseline gap-1.5">
            <span className="text-xl sm:text-2xl font-bold text-stone-900">{stats.total}</span>
            <span className="text-xs text-stone-500">{lang === 'fa' ? 'قلم' : 'items'}</span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter(statusFilter === 'attention' ? 'all' : 'attention')}
          className={`rounded-2xl border p-3 text-left transition ${
            statusFilter === 'attention'
              ? 'border-amber-500 bg-amber-50 shadow-2xs'
              : 'border-stone-200/80 bg-white hover:border-stone-300'
          }`}
        >
          <div className="text-[11px] font-medium uppercase tracking-wider text-amber-700">
            {lang === 'fa' ? 'نیاز آخر هفته' : 'Weekend Buy'}
          </div>
          <div className="mt-0.5 flex items-baseline gap-1.5">
            <span className="text-xl sm:text-2xl font-bold text-amber-700">{stats.buyThisWeekend}</span>
            {stats.outCount > 0 && (
              <span className="text-xs text-amber-600">({stats.outCount} out)</span>
            )}
          </div>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter(statusFilter === 'expiring' ? 'all' : 'expiring')}
          className={`rounded-2xl border p-3 text-left transition ${
            statusFilter === 'expiring'
              ? 'border-rose-500 bg-rose-50 shadow-2xs'
              : 'border-stone-200/80 bg-white hover:border-stone-300'
          }`}
        >
          <div className="text-[11px] font-medium uppercase tracking-wider text-rose-700">
            {lang === 'fa' ? 'زود مصرف شود' : 'Use Soon'}
          </div>
          <div className="mt-0.5 flex items-baseline gap-1.5">
            <span className="text-xl sm:text-2xl font-bold text-rose-600">{stats.expiringSoon}</span>
            <span className="text-xs text-rose-500">{lang === 'fa' ? 'تازه' : 'fresh'}</span>
          </div>
        </button>
      </div>

      {/* Search + Quick Actions (Scan Receipt + Add Item) */}
      <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center justify-between">
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

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onOpenReceiptScanner}
            className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 rounded-xl bg-white border border-teal-200 hover:bg-teal-50 text-teal-800 px-3.5 py-2.5 text-xs sm:text-sm font-semibold shadow-2xs transition"
          >
            <Receipt className="w-4 h-4" />
            {t(lang, 'scanReceipt')}
          </button>

          <button
            type="button"
            onClick={() => setModalState({ item: null, initialTab: 'basics' })}
            className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white px-4 py-2.5 text-xs sm:text-sm font-semibold shadow-xs transition"
          >
            <Plus className="w-4 h-4" />
            {t(lang, 'addItem')}
          </button>
        </div>
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
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition shrink-0 ${
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
          No matching items found. Try clearing your filter or scan a receipt to add items.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {filtered.map(({ item, forecast }) => {
            const store = storeMap.get(forecast.learnedStoreId);
            const nut = item.nutrition;
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

            const microChips: string[] = [];
            if (nut?.micronutrients.omega3) microChips.push('Omega-3');
            if ((nut?.micronutrients.vitaminDPct ?? 0) >= 15)
              microChips.push(`Vit D ${nut!.micronutrients.vitaminDPct}%`);
            if ((nut?.micronutrients.ironPct ?? 0) >= 10)
              microChips.push(`Iron ${nut!.micronutrients.ironPct}%`);
            if ((nut?.micronutrients.calciumPct ?? 0) >= 10)
              microChips.push(`Calcium ${nut!.micronutrients.calciumPct}%`);
            if ((nut?.micronutrients.vitaminCPct ?? 0) >= 20)
              microChips.push(`Vit C ${nut!.micronutrients.vitaminCPct}%`);

            const effectiveUseAmount = Math.min(servingMultiplier, item.remainingPortions);

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

                    {/* Metadata line — compact in Simple mode, full in Detailed mode */}
                    <div className="mt-1 flex items-center flex-wrap gap-x-2 gap-y-1 text-xs text-stone-500">
                      <span className="inline-flex items-center gap-1 font-medium text-stone-600">
                        {ZONE_ICONS[item.zone]}
                        {ZONE_META[item.zone][lang]}
                      </span>
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
                      {isDetailed && (
                        <>
                          <span>•</span>
                          <span>{CATEGORY_META[item.category][lang]}</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {isDetailed && (
                      <button
                        type="button"
                        onClick={() => setModalState({ item, initialTab: 'nutrition' })}
                        className="p-1.5 rounded-lg text-teal-700 hover:bg-teal-50"
                        title="Scan / edit Nutrition Facts label"
                      >
                        <Camera className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setModalState({ item, initialTab: 'basics' })}
                      className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100"
                      title="Edit item"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Portion progress + status */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-stone-800">
                      {item.remainingPortions} / {item.totalPortions}{' '}
                      <span className="font-normal text-stone-500">× {item.portionLabel}</span>
                    </span>
                    <span className="font-medium text-stone-500">
                      {item.remainingPortions > 0 ? `~${forecast.estimatedDaysLeft}d` : '0%'}
                    </span>
                  </div>

                  <div className="h-2 w-full rounded-full bg-stone-100 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${barColor}`}
                      style={{ width: `${forecast.stockPercent}%` }}
                    />
                  </div>

                  {/* Continuous quick level taps */}
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

                  {/* Status Pills */}
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

                    {forecast.expiringSoon && forecast.daysUntilExpiry !== null && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                        <AlertTriangle className="w-3 h-3" />
                        {forecast.daysUntilExpiry <= 0
                          ? 'Check freshness!'
                          : `${t(lang, 'expiringSoon')} (${forecast.daysUntilExpiry}d)`}
                      </span>
                    )}

                    {/* In Simple Mode, only show protein badge if it's a meaningful protein source */}
                    {!isDetailed && item.proteinPerPortion >= 12 && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-indigo-50 text-indigo-700">
                        <Flame className="w-3 h-3" />
                        {item.proteinPerPortion}g pro
                      </span>
                    )}
                  </div>

                  {/* Detailed Mode: Full Nutrition & Micronutrient Strip */}
                  {isDetailed && (
                    <div className="rounded-xl bg-stone-50/90 border border-stone-200/70 p-2.5 space-y-1.5">
                      {nut ? (
                        <>
                          <div className="flex items-center flex-wrap gap-1.5 text-[11px]">
                            <span className="font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">
                              {nut.protein}g Pro
                            </span>
                            <span
                              className={`font-semibold px-1.5 py-0.5 rounded ${
                                nut.sugar >= 10
                                  ? 'bg-rose-100 text-rose-800'
                                  : nut.sugar >= 5
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-emerald-50 text-emerald-800'
                              }`}
                            >
                              {nut.sugar}g Sugar
                            </span>
                            {nut.fiber > 0 && (
                              <span className="font-medium text-teal-800 bg-teal-50 px-1.5 py-0.5 rounded">
                                {nut.fiber}g Fiber
                              </span>
                            )}
                            <span className="text-stone-500 font-medium">{nut.calories} kcal</span>
                          </div>
                          {microChips.length > 0 && (
                            <div className="flex items-center flex-wrap gap-1 text-[10px] text-stone-600">
                              {microChips.slice(0, 4).map((chip) => (
                                <span
                                  key={chip}
                                  className="px-1.5 py-0.5 rounded bg-white border border-stone-200 font-medium"
                                >
                                  {chip}
                                </span>
                              ))}
                            </div>
                          )}
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setModalState({ item, initialTab: 'nutrition' })}
                          className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-teal-700 hover:text-teal-900"
                        >
                          <Camera className="w-3.5 h-3.5" />
                          Scan nutrition label to track protein, sugar & micronutrients
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Action Buttons — Scaled to Solo / Together / Guests! */}
                <div className="flex items-center gap-2 pt-2 border-t border-stone-100">
                  {item.remainingPortions > 0 ? (
                    <>
                      <button
                        type="button"
                        onClick={() => onUsePortion(item.id, effectiveUseAmount)}
                        className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl active:scale-[0.98] text-white py-2 px-3 text-xs font-semibold transition ${
                          eatingMode === 'guests'
                            ? 'bg-indigo-700 hover:bg-indigo-800'
                            : 'bg-teal-700 hover:bg-teal-800'
                        }`}
                      >
                        <Minus className="w-3.5 h-3.5" />
                        {effectiveUseAmount === 1
                          ? `${t(lang, 'usePortion')} 1`
                          : `${t(lang, 'usePortion')} ${effectiveUseAmount} (${
                              eatingMode === 'together' ? '2×' : `${servingMultiplier}×`
                            })`}
                      </button>

                      {/* Quick -1 fallback when in Together (2x) or Guests mode */}
                      {servingMultiplier > 1 && item.remainingPortions > 1 && (
                        <button
                          type="button"
                          onClick={() => onUsePortion(item.id, 1)}
                          className="inline-flex items-center justify-center rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-700 py-2 px-2.5 text-xs font-bold transition"
                          title="Deduct just 1 portion"
                        >
                          -1
                        </button>
                      )}

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

      {modalState && (
        <ItemModal
          item={modalState.item}
          initialTab={modalState.initialTab}
          stores={stores}
          lang={lang}
          onClose={() => setModalState(null)}
          onSave={onSaveItem}
          onDelete={onDeleteItem}
        />
      )}
    </div>
  );
};
