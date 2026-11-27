import React, { useMemo, useState } from 'react';
import { Check, PackagePlus, Sparkles, X } from 'lucide-react';
import { InventoryItem, Store } from '../types/kitchen';
import {
  buildInventoryItemFromPreset,
  PANTRY_STARTER_PRESETS,
} from '../data/pantryStarterPresets';
import { ZONE_META } from '../i18n/translations';
import { CategoryIcon } from './CategoryIcon';

interface PantryStarterModalProps {
  existingItems: InventoryItem[];
  stores: Store[];
  onClose: () => void;
  onAddItems: (newItems: InventoryItem[]) => void;
}

export const PantryStarterModal: React.FC<PantryStarterModalProps> = ({
  existingItems,
  stores,
  onClose,
  onAddItems,
}) => {
  const existingNames = useMemo(
    () => new Set(existingItems.map((i) => i.name.trim().toLowerCase())),
    [existingItems]
  );

  const availablePresets = useMemo(
    () => PANTRY_STARTER_PRESETS.filter((p) => !existingNames.has(p.name.toLowerCase())),
    [existingNames]
  );

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
    () => new Set(availablePresets.filter((p) => p.defaultSelected).map((p) => p.key))
  );
  const [defaultStoreId, setDefaultStoreId] = useState(stores[0]?.id ?? 'store-costco');

  const toggleKey = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleConfirm = () => {
    const chosen = availablePresets.filter((p) => selectedKeys.has(p.key));
    if (chosen.length === 0) return;
    const created = chosen.map((p) => buildInventoryItemFromPreset(p, defaultStoreId));
    onAddItems(created);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-stone-950/50 backdrop-blur-xs p-0 sm:p-4">
      <div className="w-full max-w-xl max-h-[90dvh] flex flex-col rounded-t-3xl sm:rounded-3xl bg-white shadow-2xl border border-stone-200 overflow-hidden safe-bottom">
        {/* Header */}
        <div className="px-5 py-4 bg-gradient-to-r from-teal-800 to-emerald-700 text-white flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-white/15 flex items-center justify-center shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-bold leading-tight">
                30-Second Pantry Starter
              </h2>
              <p className="text-xs text-teal-100">
                Tap staples you usually keep at home — zones &amp; units are pre-set
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full bg-white/15 hover:bg-white/25 text-white shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-semibold text-stone-600">Default store:</span>
              <select
                value={defaultStoreId}
                onChange={(e) => setDefaultStoreId(e.target.value)}
                className="rounded-xl border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-stone-800"
              >
                {stores.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setSelectedKeys(new Set(availablePresets.map((p) => p.key)))}
                className="text-teal-700 hover:text-teal-900"
              >
                Select all
              </button>
              <span className="text-stone-300">•</span>
              <button
                type="button"
                onClick={() => setSelectedKeys(new Set())}
                className="text-stone-500 hover:text-stone-800"
              >
                Clear
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {availablePresets.map((preset) => {
              const selected = selectedKeys.has(preset.key);
              return (
                <button
                  key={preset.key}
                  type="button"
                  onClick={() => toggleKey(preset.key)}
                  className={`rounded-2xl border p-3 text-left transition flex items-start gap-2.5 ${
                    selected
                      ? 'border-teal-600 bg-teal-50/60 shadow-2xs'
                      : 'border-stone-200 bg-white hover:bg-stone-50'
                  }`}
                >
                  <span
                    className={`mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition ${
                      selected
                        ? 'bg-teal-700 border-teal-700 text-white'
                        : 'border-stone-300 bg-white'
                    }`}
                  >
                    {selected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-bold text-stone-900">{preset.name}</span>
                      <span dir="auto" className="text-[11px] text-teal-800">
                        ({preset.alias})
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-[10px] text-stone-500">
                      <CategoryIcon category={preset.category} className="w-3 h-3 text-stone-400" />
                      <span>{ZONE_META[preset.zone].en}</span>
                      <span>•</span>
                      <span className="truncate">{preset.packDescription}</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-stone-100 bg-stone-50/80 flex items-center justify-between gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-stone-600 hover:bg-stone-200/70"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={selectedKeys.size === 0}
            onClick={handleConfirm}
            className="inline-flex items-center gap-1.5 rounded-xl bg-teal-700 hover:bg-teal-800 disabled:opacity-40 text-white px-5 py-2.5 text-xs font-bold shadow-xs transition"
          >
            <PackagePlus className="w-4 h-4" />
            Add {selectedKeys.size} Staple{selectedKeys.size === 1 ? '' : 's'} to Kitchen
          </button>
        </div>
      </div>
    </div>
  );
};
