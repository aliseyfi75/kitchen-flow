import React, { useState } from 'react';
import { X, Trash2 } from 'lucide-react';
import {
  FoodCategory,
  InventoryItem,
  StorageZone,
  Store,
  TrackingMode,
  UILanguage,
} from '../types/kitchen';
import { CATEGORY_META, ZONE_META } from '../i18n/translations';

interface ItemModalProps {
  item: InventoryItem | null;
  stores: Store[];
  lang: UILanguage;
  onClose: () => void;
  onSave: (item: InventoryItem, isNew: boolean) => void;
  onDelete?: (itemId: string) => void;
}

export const ItemModal: React.FC<ItemModalProps> = ({
  item,
  stores,
  lang,
  onClose,
  onSave,
  onDelete,
}) => {
  const isNew = !item;
  const [name, setName] = useState(item?.name ?? '');
  const [alias, setAlias] = useState(item?.alias ?? '');
  const [zone, setZone] = useState<StorageZone>(item?.zone ?? 'fridge');
  const [category, setCategory] = useState<FoodCategory>(item?.category ?? 'protein');
  const [trackingMode, setTrackingMode] = useState<TrackingMode>(item?.trackingMode ?? 'portioned');
  const [totalPortions, setTotalPortions] = useState(item?.totalPortions ?? 6);
  const [remainingPortions, setRemainingPortions] = useState(item?.remainingPortions ?? 6);
  const [portionLabel, setPortionLabel] = useState(item?.portionLabel ?? '1 portion');
  const [packDescription, setPackDescription] = useState(item?.packDescription ?? '1 pack');
  const [proteinPerPortion, setProteinPerPortion] = useState(item?.proteinPerPortion ?? 0);
  const [defaultStoreId, setDefaultStoreId] = useState(
    item?.defaultStoreId ?? stores[0]?.id ?? 'store-costco'
  );
  const [avgDaysPerFullPack, setAvgDaysPerFullPack] = useState(item?.avgDaysPerFullPack ?? 10);
  const [expiresAt, setExpiresAt] = useState(
    item?.expiresAt ? item.expiresAt.slice(0, 10) : ''
  );
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [autoAddOnEmpty, setAutoAddOnEmpty] = useState(item?.autoAddOnEmpty ?? true);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const built: InventoryItem = {
      id: item?.id ?? `item-${Date.now()}`,
      name: name.trim(),
      alias: alias.trim(),
      zone,
      category,
      trackingMode,
      totalPortions: Math.max(1, Number(totalPortions) || 1),
      remainingPortions: Math.max(0, Number(remainingPortions) || 0),
      portionLabel: portionLabel.trim() || '1 portion',
      packDescription: packDescription.trim() || `${totalPortions} portions`,
      proteinPerPortion: Math.max(0, Number(proteinPerPortion) || 0),
      defaultStoreId,
      storePurchaseCounts: item?.storePurchaseCounts ?? { [defaultStoreId]: 1 },
      avgDaysPerFullPack: Math.max(1, Number(avgDaysPerFullPack) || 7),
      cycleCount: item?.cycleCount ?? 0,
      lastRestockedAt: item?.lastRestockedAt ?? new Date().toISOString(),
      lastUsedAt: item?.lastUsedAt,
      expiresAt: expiresAt ? new Date(`${expiresAt}T12:00:00`).toISOString() : undefined,
      notes: notes.trim() || undefined,
      autoAddOnEmpty,
    };
    onSave(built, isNew);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-stone-950/45 backdrop-blur-xs p-0 sm:p-4">
      <div className="w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl bg-white shadow-2xl border border-stone-200">
        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 bg-white/95 backdrop-blur border-b border-stone-100">
          <h2 className="text-lg font-semibold text-stone-900">
            {isNew
              ? lang === 'fa'
                ? 'افزودن ماده غذایی جدید'
                : 'Add Kitchen Item'
              : lang === 'fa'
              ? 'ویرایش ماده غذایی'
              : 'Edit Kitchen Item'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full text-stone-500 hover:bg-stone-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1">
                Primary Name (EN or FA) *
              </label>
              <input
                dir="auto"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Chicken Breast"
                className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1">
                Secondary Alias (Persian / English)
              </label>
              <input
                dir="auto"
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                placeholder="مثلاً سینه مرغ"
                className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1">Storage Zone</label>
              <select
                value={zone}
                onChange={(e) => setZone(e.target.value as StorageZone)}
                className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                {(Object.keys(ZONE_META) as StorageZone[]).map((z) => (
                  <option key={z} value={z}>
                    {ZONE_META[z][lang]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as FoodCategory)}
                className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                {(Object.keys(CATEGORY_META) as FoodCategory[]).map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_META[c][lang]}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs font-medium text-stone-600 mb-1">Preferred Store</label>
              <select
                value={defaultStoreId}
                onChange={(e) => setDefaultStoreId(e.target.value)}
                className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} {s.alias ? `(${s.alias})` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1.5">Tracking Style</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setTrackingMode('portioned')}
                className={`rounded-xl border p-2.5 text-left text-xs transition ${
                  trackingMode === 'portioned'
                    ? 'border-teal-600 bg-teal-50 text-teal-900 font-medium'
                    : 'border-stone-200 text-stone-600 hover:bg-stone-50'
                }`}
              >
                <div className="font-semibold">Portioned Packs / Count</div>
                <div className="text-[11px] opacity-80">e.g. freezer chicken bags, eggs</div>
              </button>
              <button
                type="button"
                onClick={() => setTrackingMode('continuous')}
                className={`rounded-xl border p-2.5 text-left text-xs transition ${
                  trackingMode === 'continuous'
                    ? 'border-teal-600 bg-teal-50 text-teal-900 font-medium'
                    : 'border-stone-200 text-stone-600 hover:bg-stone-50'
                }`}
              >
                <div className="font-semibold">Continuous / Level Bar</div>
                <div className="text-[11px] opacity-80">e.g. milk, rice, spinach, oil</div>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1">Full Pack Portions</label>
              <input
                type="number"
                step="0.5"
                min="1"
                value={totalPortions}
                onChange={(e) => setTotalPortions(Number(e.target.value))}
                className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1">Remaining Now</label>
              <input
                type="number"
                step="0.5"
                min="0"
                value={remainingPortions}
                onChange={(e) => setRemainingPortions(Number(e.target.value))}
                className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1">Protein / Portion (g)</label>
              <input
                type="number"
                min="0"
                value={proteinPerPortion}
                onChange={(e) => setProteinPerPortion(Number(e.target.value))}
                className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1">Avg Days / Pack</label>
              <input
                type="number"
                step="0.5"
                min="1"
                value={avgDaysPerFullPack}
                onChange={(e) => setAvgDaysPerFullPack(Number(e.target.value))}
                className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1">Portion Size Label</label>
              <input
                dir="auto"
                value={portionLabel}
                onChange={(e) => setPortionLabel(e.target.value)}
                placeholder="e.g. 250g bag, 1 cup, 2 eggs"
                className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1">Bought Pack Description</label>
              <input
                dir="auto"
                value={packDescription}
                onChange={(e) => setPackDescription(e.target.value)}
                placeholder="e.g. 2 kg Costco pack → 8 bags"
                className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1">
                Best-By / Freshness Date (Optional)
              </label>
              <input
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1">Notes</label>
              <input
                dir="auto"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional prep or storage note"
                className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
          </div>

          <label className="flex items-center gap-2.5 text-xs text-stone-700 cursor-pointer select-none pt-1">
            <input
              type="checkbox"
              checked={autoAddOnEmpty}
              onChange={(e) => setAutoAddOnEmpty(e.target.checked)}
              className="rounded border-stone-300 text-teal-600 focus:ring-teal-500"
            />
            Automatically add to Shopping List when finished / emptied
          </label>

          <div className="flex items-center justify-between gap-3 pt-3 border-t border-stone-100">
            {!isNew && onDelete ? (
              <button
                type="button"
                onClick={() => {
                  onDelete(item.id);
                  onClose();
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-rose-600 hover:bg-rose-50"
              >
                <Trash2 className="w-4 h-4" />
                Delete
              </button>
            ) : (
              <span />
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-sm font-medium text-stone-600 hover:bg-stone-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-xl text-sm font-semibold bg-teal-700 text-white hover:bg-teal-800 shadow-xs"
              >
                {isNew ? 'Save Item' : 'Save Changes'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
