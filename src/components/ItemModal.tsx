import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Barcode,
  Camera,
  CheckCircle2,
  Loader2,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  FoodCategory,
  InventoryItem,
  NutritionFacts,
  StorageZone,
  Store,
  TrackingMode,
  UILanguage,
} from '../types/kitchen';
import { CATEGORY_META, ZONE_META } from '../i18n/translations';
import { lookupBarcodeFromOpenFoodFacts } from '../utils/barcodeLookup';
import { scanNutritionLabelWithGemini } from '../services/geminiEdge';

interface ItemModalProps {
  item: InventoryItem | null;
  initialTab?: 'basics' | 'nutrition';
  stores: Store[];
  lang: UILanguage;
  onClose: () => void;
  onSave: (item: InventoryItem, isNew: boolean) => void;
  onDelete?: (itemId: string) => void;
}

export const ItemModal: React.FC<ItemModalProps> = ({
  item,
  initialTab = 'basics',
  stores,
  lang,
  onClose,
  onSave,
  onDelete,
}) => {
  const isNew = !item;
  const labelInputRef = useRef<HTMLInputElement>(null);

  // New items open directly on the fast Barcode-First step; editing opens the form directly
  const [step, setStep] = useState<'barcode_first' | 'form'>(
    isNew ? 'barcode_first' : 'form'
  );
  const [activeTab, setActiveTab] = useState<'basics' | 'nutrition'>(initialTab);

  // Basics state
  const [name, setName] = useState(item?.name ?? '');
  const [alias, setAlias] = useState(item?.alias ?? '');
  const [zone, setZone] = useState<StorageZone>(item?.zone ?? 'fridge');
  const [category, setCategory] = useState<FoodCategory>(item?.category ?? 'protein');
  const [trackingMode, setTrackingMode] = useState<TrackingMode>(item?.trackingMode ?? 'portioned');
  const [totalPortions, setTotalPortions] = useState(item?.totalPortions ?? 6);
  const [remainingPortions, setRemainingPortions] = useState(item?.remainingPortions ?? 6);
  const [portionLabel, setPortionLabel] = useState(item?.portionLabel ?? '1 portion');
  const [packDescription, setPackDescription] = useState(item?.packDescription ?? '1 pack');
  const [defaultStoreId, setDefaultStoreId] = useState(
    item?.defaultStoreId ?? stores[0]?.id ?? 'store-costco'
  );
  const [avgDaysPerFullPack, setAvgDaysPerFullPack] = useState(item?.avgDaysPerFullPack ?? 10);
  const [expiresAt, setExpiresAt] = useState(item?.expiresAt ? item.expiresAt.slice(0, 10) : '');
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [autoAddOnEmpty, setAutoAddOnEmpty] = useState(item?.autoAddOnEmpty ?? true);

  // Nutrition Facts state
  const initNut = item?.nutrition;
  const [servingSizeLabel, setServingSizeLabel] = useState(initNut?.servingSizeLabel ?? portionLabel);
  const [calories, setCalories] = useState(initNut?.calories ?? 0);
  const [protein, setProtein] = useState(initNut?.protein ?? item?.proteinPerPortion ?? 0);
  const [sugar, setSugar] = useState(initNut?.sugar ?? 0);
  const [fiber, setFiber] = useState(initNut?.fiber ?? 0);
  const [carbs, setCarbs] = useState(initNut?.carbs ?? 0);
  const [fat, setFat] = useState(initNut?.fat ?? 0);
  const [sodiumMg, setSodiumMg] = useState(initNut?.sodiumMg ?? 0);
  const [ironPct, setIronPct] = useState(initNut?.micronutrients.ironPct ?? 0);
  const [calciumPct, setCalciumPct] = useState(initNut?.micronutrients.calciumPct ?? 0);
  const [potassiumPct, setPotassiumPct] = useState(initNut?.micronutrients.potassiumPct ?? 0);
  const [vitaminDPct, setVitaminDPct] = useState(initNut?.micronutrients.vitaminDPct ?? 0);
  const [vitaminCPct, setVitaminCPct] = useState(initNut?.micronutrients.vitaminCPct ?? 0);
  const [omega3, setOmega3] = useState(Boolean(initNut?.micronutrients.omega3));
  const [highlightsText, setHighlightsText] = useState(
    (initNut?.micronutrients.highlights ?? []).join(', ')
  );
  const [nutritionSource, setNutritionSource] = useState<NutritionFacts['source']>(
    initNut?.source ?? 'manual'
  );
  const [labelPreviewUrl, setLabelPreviewUrl] = useState<string | null>(null);
  const [isScanningLabel, setIsScanningLabel] = useState(false);
  const [scanSuccessMsg, setScanSuccessMsg] = useState<string | null>(null);

  // Barcode scan & Open Food Facts lookup state
  const [barcodeInput, setBarcodeInput] = useState('');
  const [isLookingUpBarcode, setIsLookingUpBarcode] = useState(false);
  const [barcodeError, setBarcodeError] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((tr) => tr.stop());
      }
    };
  }, []);

  const applyScannedNutrition = (scanned: NutritionFacts) => {
    setServingSizeLabel(scanned.servingSizeLabel ?? portionLabel);
    setCalories(scanned.calories);
    setProtein(scanned.protein);
    setSugar(scanned.sugar);
    setFiber(scanned.fiber);
    setCarbs(scanned.carbs);
    setFat(scanned.fat);
    setSodiumMg(scanned.sodiumMg ?? 0);
    setIronPct(scanned.micronutrients.ironPct ?? 0);
    setCalciumPct(scanned.micronutrients.calciumPct ?? 0);
    setPotassiumPct(scanned.micronutrients.potassiumPct ?? 0);
    setVitaminDPct(scanned.micronutrients.vitaminDPct ?? 0);
    setVitaminCPct(scanned.micronutrients.vitaminCPct ?? 0);
    setOmega3(Boolean(scanned.micronutrients.omega3));
    setHighlightsText((scanned.micronutrients.highlights ?? []).join(', '));
    setNutritionSource('label_scan');
  };

  const runBarcodeLookup = async (code: string, advanceToForm = false) => {
    setIsLookingUpBarcode(true);
    setBarcodeError(null);
    setScanSuccessMsg(null);
    const result = await lookupBarcodeFromOpenFoodFacts(code);
    setIsLookingUpBarcode(false);

    if (result.found && result.nutrition) {
      applyScannedNutrition(result.nutrition);
      if (result.productName && (!name.trim() || advanceToForm)) {
        setName(result.productName);
      }
      if (result.quantity && (packDescription === '1 pack' || advanceToForm)) {
        setPackDescription(result.quantity);
      }
      if (result.nutrition.servingSizeLabel && (portionLabel === '1 portion' || advanceToForm)) {
        setPortionLabel(result.nutrition.servingSizeLabel);
      }
      setScanSuccessMsg(
        `Loaded from Open Food Facts${result.productName ? `: ${result.productName}` : ''} (${result.nutrition.protein}g protein, ${result.nutrition.sugar}g sugar, ${result.nutrition.calories} kcal). Review details & save!`
      );
      if (advanceToForm) {
        setStep('form');
        setActiveTab('basics');
      }
    } else {
      setBarcodeError(
        result.error || 'Product not found — you can skip to enter manually or scan the nutrition label.'
      );
    }
  };

  const startLiveBarcodeCamera = async (advanceToForm = false) => {
    setBarcodeError(null);
    const BarcodeDetectorCtor = (
      window as unknown as {
        BarcodeDetector?: new (opts?: { formats: string[] }) => {
          detect: (src: HTMLVideoElement) => Promise<{ rawValue: string }[]>;
        };
      }
    ).BarcodeDetector;

    if (!BarcodeDetectorCtor || !navigator.mediaDevices?.getUserMedia) {
      setBarcodeError(
        'Live camera barcode detection requires Chrome/Android or Safari with BarcodeDetector — enter the barcode below or skip to fill manually.'
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      setCameraActive(true);
      window.setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      }, 80);

      const detector = new BarcodeDetectorCtor({
        formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'],
      });

      const poll = async () => {
        if (!streamRef.current || !videoRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes.length > 0 && codes[0].rawValue) {
            const detected = codes[0].rawValue;
            setBarcodeInput(detected);
            stopCamera();
            await runBarcodeLookup(detected, advanceToForm);
            return;
          }
        } catch {
          // keep polling
        }
        if (streamRef.current) {
          window.setTimeout(poll, 350);
        }
      };
      window.setTimeout(poll, 500);
    } catch {
      setBarcodeError('Camera permission denied or unavailable. Type the barcode number below or skip.');
    }
  };

  const handleLabelPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLabelPreviewUrl(URL.createObjectURL(file));
    setIsScanningLabel(true);
    setScanSuccessMsg(null);
    setBarcodeError(null);

    try {
      const scanned = await scanNutritionLabelWithGemini(file, name || alias || 'food item');
      applyScannedNutrition(scanned);
      setScanSuccessMsg(
        'Nutrition Facts extracted from label! Review any field below and tap Save.'
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Label scan failed';
      setBarcodeError(`Could not read label automatically (${msg}). You can enter values below.`);
    } finally {
      setIsScanningLabel(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const highlights = highlightsText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const hasNutrition =
      calories > 0 || protein > 0 || sugar > 0 || fiber > 0 || carbs > 0 || fat > 0;

    const nutrition: NutritionFacts | undefined = hasNutrition
      ? {
          servingSizeLabel: servingSizeLabel.trim() || portionLabel,
          calories: Math.max(0, Number(calories) || 0),
          protein: Math.max(0, Number(protein) || 0),
          sugar: Math.max(0, Number(sugar) || 0),
          fiber: Math.max(0, Number(fiber) || 0),
          carbs: Math.max(0, Number(carbs) || 0),
          fat: Math.max(0, Number(fat) || 0),
          sodiumMg: Math.max(0, Number(sodiumMg) || 0),
          micronutrients: {
            ironPct: ironPct > 0 ? ironPct : undefined,
            calciumPct: calciumPct > 0 ? calciumPct : undefined,
            potassiumPct: potassiumPct > 0 ? potassiumPct : undefined,
            vitaminDPct: vitaminDPct > 0 ? vitaminDPct : undefined,
            vitaminCPct: vitaminCPct > 0 ? vitaminCPct : undefined,
            omega3: omega3 || undefined,
            highlights: highlights.length > 0 ? highlights : undefined,
          },
          source: nutritionSource,
          lastScannedAt:
            nutritionSource === 'label_scan' ? new Date().toISOString() : initNut?.lastScannedAt,
        }
      : undefined;

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
      proteinPerPortion: Math.max(0, Number(protein) || 0),
      nutrition,
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
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-stone-950/50 backdrop-blur-xs p-0 sm:p-4">
      <div className="w-full max-w-lg max-h-[92dvh] flex flex-col rounded-t-3xl sm:rounded-3xl bg-white shadow-2xl border border-stone-200 overflow-hidden safe-bottom">
        {/* Modal Header */}
        <div className="px-5 pt-4 pb-3 bg-white border-b border-stone-100 space-y-3 shrink-0">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-stone-900">
              {step === 'barcode_first'
                ? lang === 'fa'
                  ? 'اسکن بارکد کالا'
                  : 'Scan Barcode to Add Item'
                : isNew
                ? lang === 'fa'
                  ? 'افزودن ماده غذایی'
                  : 'Add Kitchen Item'
                : item.name}
            </h2>
            <button
              type="button"
              onClick={() => {
                stopCamera();
                onClose();
              }}
              className="p-2 rounded-full text-stone-500 hover:bg-stone-100"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {step === 'form' && (
            <div className="grid grid-cols-2 gap-1.5 bg-stone-100 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setActiveTab('basics')}
                className={`py-1.5 rounded-lg text-xs font-bold transition ${
                  activeTab === 'basics'
                    ? 'bg-white text-stone-900 shadow-2xs'
                    : 'text-stone-500 hover:text-stone-800'
                }`}
              >
                Stock & Portions
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('nutrition')}
                className={`py-1.5 rounded-lg text-xs font-bold transition inline-flex items-center justify-center gap-1.5 ${
                  activeTab === 'nutrition'
                    ? 'bg-white text-teal-800 shadow-2xs'
                    : 'text-stone-500 hover:text-stone-800'
                }`}
              >
                <Camera className="w-3.5 h-3.5" />
                Nutrition Facts & Scan
              </button>
            </div>
          )}
        </div>

        {/* STEP 1 FOR NEW ITEMS: BARCODE SCANNER FIRST */}
        {step === 'barcode_first' ? (
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            <div className="rounded-3xl border-2 border-dashed border-indigo-200 bg-indigo-50/45 p-5 text-center space-y-3.5">
              <div className="w-14 h-14 rounded-2xl bg-indigo-700 text-white flex items-center justify-center mx-auto shadow-sm">
                <Barcode className="w-7 h-7" />
              </div>
              <div>
                <h3 className="text-base font-bold text-stone-900">
                  Scan product barcode to auto-fill everything
                </h3>
                <p className="text-xs text-stone-600 mt-1">
                  Loads product name, serving size, protein, sugar, fiber & micronutrients automatically from Open Food Facts.
                </p>
              </div>

              {cameraActive && (
                <div className="rounded-2xl overflow-hidden border border-indigo-300 bg-black relative">
                  <video ref={videoRef} playsInline muted className="w-full h-48 object-cover" />
                  <div className="absolute inset-x-6 top-1/2 h-0.5 bg-teal-400 shadow" />
                </div>
              )}

              <button
                type="button"
                onClick={() =>
                  cameraActive ? stopCamera() : startLiveBarcodeCamera(true)
                }
                className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-indigo-700 hover:bg-indigo-800 text-white py-3 px-4 text-sm font-bold shadow-xs transition"
              >
                <Camera className="w-4 h-4" />
                {cameraActive ? 'Stop Camera' : 'Open Camera Barcode Scanner'}
              </button>

              {/* Manual UPC input */}
              <div className="flex items-center gap-2 pt-1">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-stone-400 absolute top-1/2 -translate-y-1/2 left-3" />
                  <input
                    value={barcodeInput}
                    onChange={(e) => setBarcodeInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        runBarcodeLookup(barcodeInput, true);
                      }
                    }}
                    placeholder="Or type / paste UPC barcode..."
                    className="w-full rounded-xl border border-indigo-200 bg-white pl-9 pr-3 py-2.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <button
                  type="button"
                  disabled={isLookingUpBarcode || !barcodeInput.trim()}
                  onClick={() => runBarcodeLookup(barcodeInput, true)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-stone-900 hover:bg-stone-800 disabled:opacity-45 text-white px-4 py-2.5 text-xs font-bold shrink-0"
                >
                  {isLookingUpBarcode ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    'Lookup'
                  )}
                </button>
              </div>
            </div>

            {barcodeError && (
              <div className="rounded-2xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 space-y-2">
                <div>{barcodeError}</div>
                <button
                  type="button"
                  onClick={() => {
                    stopCamera();
                    setStep('form');
                    setActiveTab('basics');
                  }}
                  className="inline-flex items-center gap-1 font-bold text-amber-950 underline"
                >
                  Continue to manual entry →
                </button>
              </div>
            )}

            {/* Clear Skip to Manual Form */}
            <div className="flex items-center justify-between gap-3 pt-2 border-t border-stone-100">
              <button
                type="button"
                onClick={() => {
                  stopCamera();
                  onClose();
                }}
                className="px-4 py-2.5 rounded-xl text-xs font-semibold text-stone-500 hover:bg-stone-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  stopCamera();
                  setStep('form');
                  setActiveTab('basics');
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-900 px-4 py-2.5 text-xs font-bold transition"
              >
                Skip — Fill Manually
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : (
          /* STEP 2 (OR EDIT): FULL ITEM FORM + NUTRITION TAB */
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
            {scanSuccessMsg && (
              <div className="flex items-start gap-2 text-xs font-semibold text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-2xl px-3.5 py-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                <span>{scanSuccessMsg}</span>
              </div>
            )}

            {activeTab === 'basics' ? (
              <>
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
                      className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm bg-white"
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
                      className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm bg-white"
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
                      className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm bg-white"
                    >
                      {stores.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setTrackingMode('portioned')}
                    className={`rounded-xl border p-2.5 text-left text-xs transition ${
                      trackingMode === 'portioned'
                        ? 'border-teal-600 bg-teal-50 text-teal-900 font-medium'
                        : 'border-stone-200 text-stone-600'
                    }`}
                  >
                    <div className="font-semibold">Portioned Packs / Count</div>
                    <div className="text-[11px] opacity-80">Freezer bags, eggs, fillets</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTrackingMode('continuous')}
                    className={`rounded-xl border p-2.5 text-left text-xs transition ${
                      trackingMode === 'continuous'
                        ? 'border-teal-600 bg-teal-50 text-teal-900 font-medium'
                        : 'border-stone-200 text-stone-600'
                    }`}
                  >
                    <div className="font-semibold">Continuous / Level Bar</div>
                    <div className="text-[11px] opacity-80">Milk, spinach, rice, oil</div>
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-stone-600 mb-1">Full Pack Portions</label>
                    <input
                      type="number"
                      step="0.5"
                      min="1"
                      value={totalPortions}
                      onChange={(e) => setTotalPortions(Number(e.target.value))}
                      className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm"
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
                      className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm"
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
                      className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm"
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
                      placeholder="e.g. 180g serving, 1 cup"
                      className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-600 mb-1">Pack Description</label>
                    <input
                      dir="auto"
                      value={packDescription}
                      onChange={(e) => setPackDescription(e.target.value)}
                      placeholder="e.g. 1.5 kg Costco pack"
                      className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-stone-600 mb-1">Best-By Date (Optional)</label>
                    <input
                      type="date"
                      value={expiresAt}
                      onChange={(e) => setExpiresAt(e.target.value)}
                      className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-600 mb-1">Quick Note</label>
                    <input
                      dir="auto"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Optional note"
                      className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm"
                    />
                  </div>
                </div>

                <label className="flex items-center gap-2.5 text-xs text-stone-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={autoAddOnEmpty}
                    onChange={(e) => setAutoAddOnEmpty(e.target.checked)}
                    className="rounded border-stone-300 text-teal-600"
                  />
                  Automatically add to Shopping List when finished
                </label>
              </>
            ) : (
              /* Barcode Lookup + Nutrition Facts Label Scanner Tab */
              <div className="space-y-4">
                <input
                  ref={labelInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleLabelPhoto}
                  className="hidden"
                />

                {/* Barcode Lookup */}
                <div className="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-3.5 space-y-2.5">
                  <div className="text-xs font-bold text-indigo-950 flex items-center gap-1.5">
                    <Barcode className="w-4 h-4 text-indigo-700" />
                    Scan Barcode → Load Nutrition From Web (Open Food Facts)
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      value={barcodeInput}
                      onChange={(e) => setBarcodeInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          runBarcodeLookup(barcodeInput, false);
                        }
                      }}
                      placeholder="Enter or scan UPC / EAN barcode..."
                      className="flex-1 rounded-xl border border-indigo-200 bg-white px-3 py-2 text-xs font-mono"
                    />
                    <button
                      type="button"
                      disabled={isLookingUpBarcode || !barcodeInput.trim()}
                      onClick={() => runBarcodeLookup(barcodeInput, false)}
                      className="rounded-xl bg-indigo-700 hover:bg-indigo-800 disabled:opacity-45 text-white px-3.5 py-2 text-xs font-bold"
                    >
                      {isLookingUpBarcode ? '...' : 'Lookup'}
                    </button>
                    <button
                      type="button"
                      onClick={() => (cameraActive ? stopCamera() : startLiveBarcodeCamera(false))}
                      className="inline-flex items-center gap-1 rounded-xl bg-white border border-indigo-200 px-3 py-2 text-xs font-bold text-indigo-800"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      {cameraActive ? 'Stop' : 'Scan'}
                    </button>
                  </div>

                  {cameraActive && (
                    <div className="rounded-xl overflow-hidden border border-indigo-300 bg-black relative">
                      <video ref={videoRef} playsInline muted className="w-full h-36 object-cover" />
                    </div>
                  )}

                  {barcodeError && (
                    <div className="text-[11px] font-medium text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                      {barcodeError}
                    </div>
                  )}
                </div>

                {/* Fallback: Snap Nutrition Label */}
                <div className="rounded-2xl border border-teal-200 bg-teal-50/50 p-3.5 space-y-2">
                  <div className="text-xs font-bold text-teal-950">
                    Fallback: Snap Nutrition Facts Label Photo
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => labelInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white px-3.5 py-2 text-xs font-bold"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      Upload / Take Label Photo
                    </button>
                  </div>
                  {isScanningLabel && (
                    <div className="text-xs font-semibold text-teal-700 animate-pulse">
                      Reading Nutrition Facts table...
                    </div>
                  )}
                  {labelPreviewUrl && (
                    <img
                      src={labelPreviewUrl}
                      alt="Nutrition label preview"
                      className="w-12 h-14 object-cover rounded-lg border border-teal-200"
                    />
                  )}
                </div>

                {/* Macros Grid */}
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-stone-600 mb-1">
                      Label Serving Size
                    </label>
                    <input
                      value={servingSizeLabel}
                      onChange={(e) => setServingSizeLabel(e.target.value)}
                      className="w-full rounded-xl border border-stone-200 px-3 py-2 text-xs font-medium"
                    />
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                    <div>
                      <label className="block text-[10px] font-bold text-stone-500 mb-1">Calories</label>
                      <input
                        type="number"
                        min="0"
                        value={calories}
                        onChange={(e) => setCalories(Number(e.target.value))}
                        className="w-full rounded-xl border border-stone-200 px-2 py-1.5 text-xs font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-indigo-700 mb-1">Protein (g)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        value={protein}
                        onChange={(e) => setProtein(Number(e.target.value))}
                        className="w-full rounded-xl border border-indigo-200 bg-indigo-50/40 px-2 py-1.5 text-xs font-bold text-indigo-900"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-rose-700 mb-1">Sugar (g)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        value={sugar}
                        onChange={(e) => setSugar(Number(e.target.value))}
                        className="w-full rounded-xl border border-rose-200 bg-rose-50/40 px-2 py-1.5 text-xs font-bold text-rose-900"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-emerald-700 mb-1">Fiber (g)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        value={fiber}
                        onChange={(e) => setFiber(Number(e.target.value))}
                        className="w-full rounded-xl border border-stone-200 px-2 py-1.5 text-xs font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-stone-500 mb-1">Carbs (g)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        value={carbs}
                        onChange={(e) => setCarbs(Number(e.target.value))}
                        className="w-full rounded-xl border border-stone-200 px-2 py-1.5 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-stone-500 mb-1">Fat (g)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        value={fat}
                        onChange={(e) => setFat(Number(e.target.value))}
                        className="w-full rounded-xl border border-stone-200 px-2 py-1.5 text-xs"
                      />
                    </div>
                  </div>
                </div>

                {/* Micronutrients */}
                <div className="rounded-2xl border border-stone-200 bg-stone-50/70 p-3.5 space-y-3">
                  <div className="text-xs font-bold text-stone-800">
                    Micronutrients (% Daily Value per serving)
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                    {[
                      ['Iron %', ironPct, setIronPct],
                      ['Calcium %', calciumPct, setCalciumPct],
                      ['Potassium %', potassiumPct, setPotassiumPct],
                      ['Vit D %', vitaminDPct, setVitaminDPct],
                      ['Vit C %', vitaminCPct, setVitaminCPct],
                      ['Sodium mg', sodiumMg, setSodiumMg],
                    ].map(([label, val, setter]) => (
                      <div key={label as string}>
                        <label className="block text-[10px] font-semibold text-stone-500 mb-1">
                          {label as string}
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={val as number}
                          onChange={(e) =>
                            (setter as React.Dispatch<React.SetStateAction<number>>)(
                              Number(e.target.value)
                            )
                          }
                          className="w-full rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-xs"
                        />
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-1">
                    <label className="inline-flex items-center gap-2 text-xs font-semibold text-stone-700 cursor-pointer shrink-0">
                      <input
                        type="checkbox"
                        checked={omega3}
                        onChange={(e) => setOmega3(e.target.checked)}
                        className="rounded border-stone-300 text-teal-600"
                      />
                      Omega-3 Rich
                    </label>
                    <input
                      value={highlightsText}
                      onChange={(e) => setHighlightsText(e.target.value)}
                      placeholder="Other micronutrients (e.g. B12, Folate, Zinc)"
                      className="flex-1 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Footer */}
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
              ) : isNew ? (
                <button
                  type="button"
                  onClick={() => setStep('barcode_first')}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-indigo-700 hover:bg-indigo-50"
                >
                  <Barcode className="w-4 h-4" />
                  Back to Barcode
                </button>
              ) : (
                <span />
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    stopCamera();
                    onClose();
                  }}
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
        )}
      </div>
    </div>
  );
};
