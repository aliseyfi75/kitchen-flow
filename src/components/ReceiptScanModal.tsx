import React, { useRef, useState } from 'react';
import {
  Camera,
  Check,
  CheckCircle2,
  FileImage,
  PackageCheck,
  Plus,
  Receipt,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import {
  FoodCategory,
  InventoryItem,
  ReceiptParsedItem,
  StorageZone,
  Store,
  UILanguage,
} from '../types/kitchen';
import { scanReceiptWithGemini } from '../services/geminiEdge';
import { CATEGORY_META, ZONE_META } from '../i18n/translations';
import { PRODUCT_CATEGORY_ORDER } from '../utils/productCategories';

interface ReceiptScanModalProps {
  items: InventoryItem[];
  stores: Store[];
  lang: UILanguage;
  onClose: () => void;
  onApplyReceipt: (storeId: string, parsedItems: ReceiptParsedItem[]) => void;
}

export const ReceiptScanModal: React.FC<ReceiptScanModalProps> = ({
  items,
  stores,
  lang,
  onClose,
  onApplyReceipt,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [detectedStoreId, setDetectedStoreId] = useState<string>(stores[0]?.id ?? 'store-costco');
  const [parsedLines, setParsedLines] = useState<ReceiptParsedItem[]>([]);
  const [activeReceiptTitle, setActiveReceiptTitle] = useState<string>('');
  const [scanError, setScanError] = useState<string | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setImagePreviewUrl(url);
    setIsScanning(true);
    setScanError(null);
    setActiveReceiptTitle(file.name);

    try {
      const result = await scanReceiptWithGemini(file, stores, items);
      setDetectedStoreId(result.detectedStoreId);
      setParsedLines(result.items);
      if (result.items.length === 0) {
        setScanError('No grocery lines detected on this photo. You can add items manually below.');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not scan receipt';
      setScanError(`Could not parse receipt automatically (${msg}). You can add lines manually below.`);
    } finally {
      setIsScanning(false);
    }
  };

  const updateLine = (id: string, patch: Partial<ReceiptParsedItem>) => {
    setParsedLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

  const addManualLine = () => {
    setParsedLines((prev) => [
      ...prev,
      {
        id: `rcpt-manual-${Date.now()}`,
        rawReceiptText: 'MANUAL ENTRY',
        name: '',
        alias: '',
        portionsToAdd: 4,
        portionLabel: '1 portion',
        packDescription: '1 pack',
        zone: 'fridge',
        category: 'produce',
        included: true,
        confidence: 'new',
      },
    ]);
  };

  const selectedCount = parsedLines.filter((l) => l.included && l.name.trim()).length;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-stone-950/55 backdrop-blur-xs p-0 sm:p-4">
      <div className="w-full max-w-2xl max-h-[92dvh] flex flex-col rounded-t-3xl sm:rounded-3xl bg-white shadow-2xl border border-stone-200 overflow-hidden safe-bottom">
        {/* Header */}
        <div className="px-5 py-4 bg-gradient-to-r from-teal-800 to-emerald-700 text-white flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white/15 flex items-center justify-center">
              <Receipt className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold">Scan Grocery Receipt</h2>
              <p className="text-xs text-teal-100">
                Snap your receipt → auto-match kitchen items &amp; restock in 1 tap
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full bg-white/15 hover:bg-white/25 text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Upload / Camera Capture Box */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileChange}
            className="hidden"
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full rounded-2xl border-2 border-dashed border-teal-300 bg-teal-50/50 hover:bg-teal-50 p-5 text-left transition flex items-center gap-4"
          >
            <div className="w-12 h-12 rounded-2xl bg-teal-700 text-white flex items-center justify-center shrink-0">
              <Camera className="w-6 h-6" />
            </div>
            <div>
              <div className="text-sm font-bold text-teal-950">Take Photo or Upload Receipt</div>
              <div className="text-xs text-teal-800/80 mt-0.5 flex items-center gap-1">
                <Upload className="w-3.5 h-3.5" />
                Auto-detects store, matches existing staples &amp; adds bilingual aliases
              </div>
            </div>
          </button>

          {/* Photo preview if uploaded */}
          {imagePreviewUrl && (
            <div className="rounded-2xl border border-stone-200 bg-stone-50 p-3 flex items-center gap-3">
              <img
                src={imagePreviewUrl}
                alt="Uploaded receipt preview"
                className="w-16 h-20 object-cover rounded-xl border border-stone-200 shrink-0"
              />
              <div className="text-xs text-stone-600 space-y-1">
                <div className="font-semibold text-stone-900 flex items-center gap-1.5">
                  <FileImage className="w-4 h-4 text-teal-700" />
                  {activeReceiptTitle}
                </div>
                <p>Review or adjust any quantities and storage zones below before saving.</p>
              </div>
            </div>
          )}

          {scanError && (
            <div className="rounded-2xl bg-amber-50 border border-amber-200 px-3.5 py-2.5 text-xs text-amber-900">
              {scanError}
            </div>
          )}

          {/* Scanning Spinner */}
          {isScanning && (
            <div className="rounded-2xl border border-teal-100 bg-teal-50/40 p-8 text-center space-y-2">
              <Sparkles className="w-7 h-7 text-teal-700 mx-auto animate-pulse" />
              <div className="text-sm font-bold text-teal-900">
                Reading receipt &amp; matching your kitchen staples...
              </div>
              <div className="text-xs text-teal-700">
                Detecting store, portion sizes, and bilingual aliases
              </div>
            </div>
          )}

          {/* Parsed Items Review */}
          {!isScanning && (parsedLines.length > 0 || imagePreviewUrl) && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-1 border-b border-stone-100">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-stone-500">
                    Store:
                  </span>
                  <select
                    value={detectedStoreId}
                    onChange={(e) => setDetectedStoreId(e.target.value)}
                    className="rounded-xl border border-stone-200 bg-white px-3 py-1.5 text-xs font-bold text-stone-900"
                  >
                    {stores.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} {s.alias ? `(${s.alias})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  type="button"
                  onClick={addManualLine}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:text-teal-900"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Missed Line
                </button>
              </div>

              <div className="space-y-2.5">
                {parsedLines.map((line) => (
                  <div
                    key={line.id}
                    className={`rounded-2xl border p-3.5 transition space-y-2.5 ${
                      line.included
                        ? 'border-stone-200 bg-white shadow-2xs'
                        : 'border-stone-100 bg-stone-50 opacity-55'
                    }`}
                  >
                    <div className="flex items-start gap-2.5 min-w-0">
                      <button
                        type="button"
                        onClick={() => updateLine(line.id, { included: !line.included })}
                        className={`mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${
                          line.included
                            ? 'bg-teal-600 border-teal-600 text-white'
                            : 'border-stone-300 bg-white'
                        }`}
                      >
                        {line.included && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                      </button>

                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex items-center flex-wrap gap-1.5">
                          <span className="font-mono text-[10px] text-stone-400 bg-stone-100 px-1.5 py-0.5 rounded">
                            {line.rawReceiptText}
                          </span>
                          {line.matchedItemId ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded-full">
                              <CheckCircle2 className="w-3 h-3" />
                              Matched existing
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 px-1.5 py-0.5 rounded-full">
                              New item
                            </span>
                          )}
                          {line.price !== undefined && (
                            <span className="text-[11px] font-semibold text-stone-500">
                              ${line.price.toFixed(2)}
                            </span>
                          )}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <input
                            dir="auto"
                            value={line.name}
                            onChange={(e) => updateLine(line.id, { name: e.target.value })}
                            placeholder="Item name"
                            className="rounded-lg border border-stone-200 px-2.5 py-1.5 text-xs font-semibold text-stone-900"
                          />
                          <input
                            dir="auto"
                            value={line.alias}
                            onChange={(e) => updateLine(line.id, { alias: e.target.value })}
                            placeholder="Persian / secondary alias"
                            className="rounded-lg border border-stone-200 px-2.5 py-1.5 text-xs text-teal-800"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pl-7">
                      <div>
                        <label className="block text-[10px] font-semibold text-stone-400 mb-0.5">
                          + Qty / Pack
                        </label>
                        <input
                          type="number"
                          min="1"
                          value={line.portionsToAdd}
                          onChange={(e) =>
                            updateLine(line.id, {
                              portionsToAdd: Math.max(1, Number(e.target.value) || 1),
                            })
                          }
                          className="w-full rounded-lg border border-stone-200 px-2 py-1 text-xs font-bold"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-stone-400 mb-0.5">
                          Pack / Size
                        </label>
                        <input
                          dir="auto"
                          value={line.packDescription}
                          onChange={(e) => updateLine(line.id, { packDescription: e.target.value })}
                          placeholder="e.g. 4L jug, 1 kg"
                          className="w-full rounded-lg border border-stone-200 px-2 py-1 text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-stone-400 mb-0.5">
                          Category
                        </label>
                        <select
                          value={line.category}
                          onChange={(e) =>
                            updateLine(line.id, { category: e.target.value as FoodCategory })
                          }
                          className="w-full rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs"
                        >
                          {PRODUCT_CATEGORY_ORDER.map((c) => (
                            <option key={c} value={c}>
                              {CATEGORY_META[c][lang]}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-stone-400 mb-0.5">
                          Store In
                        </label>
                        <select
                          value={line.zone}
                          onChange={(e) =>
                            updateLine(line.id, { zone: e.target.value as StorageZone })
                          }
                          className="w-full rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs"
                        >
                          {(['fridge', 'freezer', 'pantry'] as StorageZone[]).map((z) => (
                            <option key={z} value={z}>
                              {ZONE_META[z][lang]}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-stone-100 bg-stone-50/80 flex items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-stone-500">
            {selectedCount > 0
              ? 'Updates inventory, learns store affinity & clears matching shopping items.'
              : 'Upload a receipt photo to extract items.'}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-stone-600 hover:bg-stone-200/70"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={selectedCount === 0}
              onClick={() => {
                onApplyReceipt(
                  detectedStoreId,
                  parsedLines.filter((l) => l.included && l.name.trim())
                );
                onClose();
              }}
              className="inline-flex items-center gap-1.5 rounded-xl bg-teal-700 hover:bg-teal-800 disabled:opacity-40 text-white px-4 py-2 text-xs font-bold shadow-xs transition"
            >
              <PackageCheck className="w-4 h-4" />
              Confirm &amp; Restock ({selectedCount})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
