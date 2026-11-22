import React, { useState } from 'react';
import {
  Activity,
  Globe,
  Lock,
  Plus,
  RotateCcw,
  ShieldCheck,
  Store as StoreIcon,
  Trash2,
  Users,
} from 'lucide-react';
import { HouseholdSettings, InventoryItem, Store, UILanguage } from '../types/kitchen';
import { computeItemForecast, formatShoppingDayName } from '../utils/forecasting';
import { t } from '../i18n/translations';

interface SettingsViewProps {
  items: InventoryItem[];
  stores: Store[];
  settings: HouseholdSettings;
  onUpdateSettings: (patch: Partial<HouseholdSettings>) => void;
  onAddStore: (store: Omit<Store, 'id'>) => void;
  onDeleteStore: (storeId: string) => void;
  onResetDemo: () => void;
  onOpenLoginPreview: () => void;
}

const STORE_COLORS = ['#DC2626', '#2563EB', '#0F766E', '#D97706', '#7C3AED', '#DB2777'];

export const SettingsView: React.FC<SettingsViewProps> = ({
  items,
  stores,
  settings,
  onUpdateSettings,
  onAddStore,
  onDeleteStore,
  onResetDemo,
  onOpenLoginPreview,
}) => {
  const lang: UILanguage = settings.language;
  const [storeName, setStoreName] = useState('');
  const [storeAlias, setStoreAlias] = useState('');
  const [storeColor, setStoreColor] = useState(STORE_COLORS[0]);

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
      {/* Household Profile & Private Auth Preview */}
      <div className="rounded-3xl border border-stone-200 bg-white p-5 space-y-4 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-teal-50 text-teal-700 flex items-center justify-center">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-stone-900">Household & Sync Settings</h2>
              <p className="text-xs text-stone-500">
                Phase 1 runs locally in your browser • Phase 2 connects Supabase Auth + Realtime Sync
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onOpenLoginPreview}
            className="inline-flex items-center gap-1.5 rounded-xl bg-stone-900 hover:bg-stone-800 text-white px-3.5 py-2 text-xs font-semibold shrink-0"
          >
            <Lock className="w-3.5 h-3.5" />
            Preview 2-User Login Gate
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
          <div className="rounded-2xl bg-stone-50 border border-stone-200/80 p-3">
            <label className="block text-[11px] font-semibold text-stone-500 mb-1.5">
              Active User (Demo Switcher)
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {(['Ali', 'Partner'] as const).map((user) => (
                <button
                  key={user}
                  type="button"
                  onClick={() => onUpdateSettings({ activeUser: user })}
                  className={`py-1.5 rounded-lg text-xs font-semibold transition ${
                    settings.activeUser === user
                      ? 'bg-teal-700 text-white shadow-2xs'
                      : 'bg-white text-stone-600 border border-stone-200'
                  }`}
                >
                  {user}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl bg-stone-50 border border-stone-200/80 p-3">
            <label className="block text-[11px] font-semibold text-stone-500 mb-1.5 flex items-center gap-1">
              <Globe className="w-3.5 h-3.5" />
              UI Language
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => onUpdateSettings({ language: 'en' })}
                className={`py-1.5 rounded-lg text-xs font-semibold transition ${
                  lang === 'en'
                    ? 'bg-stone-900 text-white'
                    : 'bg-white text-stone-600 border border-stone-200'
                }`}
              >
                English
              </button>
              <button
                type="button"
                onClick={() => onUpdateSettings({ language: 'fa' })}
                className={`py-1.5 rounded-lg text-xs font-semibold transition ${
                  lang === 'fa'
                    ? 'bg-stone-900 text-white'
                    : 'bg-white text-stone-600 border border-stone-200'
                }`}
              >
                فارسی (RTL)
              </button>
            </div>
          </div>

          <div className="rounded-2xl bg-stone-50 border border-stone-200/80 p-3">
            <label className="block text-[11px] font-semibold text-stone-500 mb-1.5">
              Usual Shopping Day
            </label>
            <select
              value={settings.shoppingDay}
              onChange={(e) => onUpdateSettings({ shoppingDay: Number(e.target.value) })}
              className="w-full rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-semibold"
            >
              {[6, 0, 5, 1, 2, 3, 4].map((d) => (
                <option key={d} value={d}>
                  {formatShoppingDayName(d, lang)}
                </option>
              ))}
            </select>
          </div>

          <div className="rounded-2xl bg-stone-50 border border-stone-200/80 p-3">
            <label className="block text-[11px] font-semibold text-stone-500 mb-1.5">
              Protein Goal / Sugar Limit (g)
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              <input
                type="number"
                min={60}
                max={250}
                step={5}
                value={settings.dailyProteinTarget}
                onChange={(e) =>
                  onUpdateSettings({ dailyProteinTarget: Math.max(60, Number(e.target.value) || 120) })
                }
                title="Daily protein goal (g)"
                className="w-full rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-xs font-bold text-indigo-700"
              />
              <input
                type="number"
                min={10}
                max={100}
                step={2}
                value={settings.dailySugarLimit}
                onChange={(e) =>
                  onUpdateSettings({ dailySugarLimit: Math.max(10, Number(e.target.value) || 36) })
                }
                title="Daily sugar limit (g)"
                className="w-full rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-xs font-bold text-rose-700"
              />
            </div>
          </div>
        </div>

        <div className="rounded-2xl bg-teal-50/70 border border-teal-100 p-3.5 flex items-start gap-2.5 text-xs text-teal-900">
          <ShieldCheck className="w-4 h-4 text-teal-700 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">Public Repo, Private Household Data:</span> Even though{' '}
            <code className="bg-white/80 px-1.5 py-0.5 rounded">kitchen-flow</code> is public for GitHub
            Pages, Phase 2 locks Supabase Postgres with Row Level Security exclusively to your two email
            accounts, and stores your Gemini API key server-side in a Supabase Edge Function.
          </div>
        </div>
      </div>

      {/* Stores Manager */}
      <div className="rounded-3xl border border-stone-200 bg-white p-5 space-y-4 shadow-2xs">
        <div className="flex items-center gap-2">
          <StoreIcon className="w-5 h-5 text-teal-700" />
          <h3 className="font-bold text-stone-900">{t(lang, 'storesManager')}</h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          {stores.map((st) => (
            <div
              key={st.id}
              className="rounded-2xl border border-stone-200 p-3 flex items-center justify-between gap-2"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className="w-3.5 h-3.5 rounded-full shrink-0"
                  style={{ backgroundColor: st.color }}
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
                <button
                  type="button"
                  onClick={() => onDeleteStore(st.id)}
                  className="p-1.5 rounded-lg text-stone-400 hover:text-rose-600 hover:bg-rose-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
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

      {/* Learned Consumption Rhythm Table */}
      <div className="rounded-3xl border border-stone-200 bg-white p-5 space-y-3 shadow-2xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-teal-700" />
            <h3 className="font-bold text-stone-900">{t(lang, 'velocityInsights')}</h3>
          </div>
          <span className="text-xs text-stone-400">EMA Adaptive Model</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-stone-100 text-stone-500">
                <th className="py-2 pr-3 font-semibold">Item</th>
                <th className="py-2 px-3 font-semibold">Learned Cycle</th>
                <th className="py-2 px-3 font-semibold">Burn Rate</th>
                <th className="py-2 px-3 font-semibold">Learned Store</th>
                <th className="py-2 pl-3 font-semibold text-right">Est. Days Left</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {items.map((item) => {
                const fc = computeItemForecast(item, settings.shoppingDay);
                const st = stores.find((s) => s.id === fc.learnedStoreId);
                return (
                  <tr key={item.id} className="hover:bg-stone-50/70">
                    <td className="py-2.5 pr-3">
                      <span dir="auto" className="font-semibold text-stone-900">
                        {item.name}
                      </span>{' '}
                      {item.alias && (
                        <span dir="auto" className="text-stone-400">
                          ({item.alias})
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-stone-600">
                      ~{item.avgDaysPerFullPack}d / pack{' '}
                      <span className="text-stone-400">({item.cycleCount} cycles)</span>
                    </td>
                    <td className="py-2.5 px-3 text-stone-600">{fc.dailyBurnRate} portions/day</td>
                    <td className="py-2.5 px-3">
                      {st && (
                        <span className="inline-flex items-center gap-1.5 font-medium text-stone-700">
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: st.color }}
                          />
                          {st.name}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 pl-3 text-right font-bold text-stone-800">
                      {fc.estimatedDaysLeft === 0 ? (
                        <span className="text-rose-600">Out</span>
                      ) : (
                        `${fc.estimatedDaysLeft}d`
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Reset Demo */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onResetDemo}
          className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200 bg-white hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 px-4 py-2 text-xs font-semibold text-stone-600 transition"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          {t(lang, 'resetDemo')}
        </button>
      </div>
    </div>
  );
};
