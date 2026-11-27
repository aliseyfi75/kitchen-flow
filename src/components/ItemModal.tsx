import React, { useEffect, useRef, useState } from 'react';
import {
  Archive,
  ArrowRight,
  Barcode,
  Calendar,
  Camera,
  CheckCircle2,
  Droplets,
  Gauge,
  Hash,
  Loader2,
  Minus,
  Plus,
  Search,
  Snowflake,
  Thermometer,
  Trash2,
  X,
} from 'lucide-react';
import {
  FoodCategory,
  InventoryItem,
  MeasureUnit,
  NutritionFacts,
  StorageZone,
  Store,
} from '../types/kitchen';
import { CATEGORY_META, ZONE_META } from '../i18n/translations';
import { lookupBarcodeFromOpenFoodFacts } from '../utils/barcodeLookup';
import { scanNutritionLabelWithGemini } from '../services/geminiEdge';
import {
  ALL_MEASURE_UNITS,
  getCategoryProfile,
  isPerishableInZone,
  MEASURE_UNIT_META,
  MeasuredSizePreset,
  PRODUCT_CATEGORIES,
  PRODUCT_CATEGORY_ORDER,
} from '../utils/productCategories';
import {
  CONTINUOUS_LEVEL_PRESETS,
  formatMeasuredAmount,
  getActiveLevelPreset,
  getClampedStockPercent,
  getLevelWord,
  hasServingPourAction,
  inferContinuousStyle,
} from '../utils/inventoryDisplay';
import { CategoryIcon } from './CategoryIcon';

type EntryMode = 'portioned' | 'measured' | 'level_only';

interface ItemModalProps {
  item: InventoryItem | null;
  initialTab?: 'basics' | 'nutrition';
  initialCategory?: FoodCategory;
  stores: Store[];
  onClose: () => void;
  onSave: (item: InventoryItem, isNew: boolean) => void;
  onDelete?: (itemId: string) => void;
}

function getInitialEntryMode(
  item: InventoryItem | null,
  fallbackCategory?: FoodCategory
): EntryMode {
  if (!item) {
    if (!fallbackCategory) return 'portioned';
    const prof = getCategoryProfile(fallbackCategory);
    if (prof.defaultTrackingMode === 'portioned') return 'portioned';
    return prof.defaultContinuousStyle === 'measured' ? 'measured' : 'level_only';
  }
  if (item.trackingMode === 'portioned') return 'portioned';
  return inferContinuousStyle(item) === 'measured' ? 'measured' : 'level_only';
}

function addDaysToIsoDate(days: number): string {
  const d = new Date(Date.now() + days * 86400000);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export const ItemModal: React.FC<ItemModalProps> = ({
  item,
  initialTab = 'basics',
  initialCategory: presetCategory,
  stores,
  onClose,
  onSave,
  onDelete,
}) => {
  const isNew = !item;
  const labelInputRef = useRef<HTMLInputElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // New items open on Barcode + Category Quick-Start unless launched directly from a category section
  const [step, setStep] = useState<'barcode_first' | 'form'>(
    isNew && !presetCategory ? 'barcode_first' : 'form'
  );
  const [activeTab, setActiveTab] = useState<'basics' | 'nutrition'>(initialTab);

  const initialCategory: FoodCategory = item?.category ?? presetCategory ?? 'dairy';
  const initialProfile = getCategoryProfile(initialCategory);
  const initialPreset = initialProfile.measuredPresets[0];

  // Basics state
  const [name, setName] = useState(item?.name ?? '');
  const [alias, setAlias] = useState(item?.alias ?? '');
  const [zone, setZone] = useState<StorageZone>(item?.zone ?? initialProfile.defaultZone);
  const [category, setCategory] = useState<FoodCategory>(initialCategory);
  const [entryMode, setEntryMode] = useState<EntryMode>(() =>
    getInitialEntryMode(item, presetCategory)
  );

  // Portioned / Countable state
  const [totalPortions, setTotalPortions] = useState(
    item?.trackingMode === 'portioned' ? item.totalPortions : initialProfile.defaultPortionCount
  );
  const [remainingPortions, setRemainingPortions] = useState(
    item?.trackingMode === 'portioned' ? item.remainingPortions : initialProfile.defaultPortionCount
  );
  const [remainingManuallyEdited, setRemainingManuallyEdited] = useState(!isNew);
  const [portionLabel, setPortionLabel] = useState(
    item?.portionLabel && item.portionLabel !== 'container'
      ? item.portionLabel
      : presetCategory && initialPreset?.servingLabel
      ? initialPreset.servingLabel
      : initialProfile.defaultPortionLabel
  );

  // Continuous (Measured + Simple Level) state
  const [containerSize, setContainerSize] = useState<number>(
    item?.containerSize ?? initialPreset?.size ?? 1
  );
  const [containerUnit, setContainerUnit] = useState<MeasureUnit>(
    item?.containerUnit ?? initialPreset?.unit ?? initialProfile.defaultUnit
  );
  const [levelPercent, setLevelPercent] = useState<number>(() =>
    item ? getClampedStockPercent(item) : 100
  );
  const [levelEdited, setLevelEdited] = useState(false);
  const [trackServings, setTrackServings] = useState<boolean>(() =>
    item
      ? hasServingPourAction(item)
      : Boolean(presetCategory && initialPreset?.servingLabel && initialPreset?.servingsPerContainer)
  );
  const [servingsPerContainer, setServingsPerContainer] = useState<number>(() => {
    if (item && hasServingPourAction(item)) return item.totalPortions;
    return initialPreset?.servingsPerContainer ?? 8;
  });

  // Shared packaging, store, cadence & freshness state
  const [packDescription, setPackDescription] = useState(item?.packDescription ?? '');
  const [defaultStoreId, setDefaultStoreId] = useState(
    item?.defaultStoreId ?? stores[0]?.id ?? 'store-costco'
  );
  const [avgDaysPerFullPack, setAvgDaysPerFullPack] = useState(
    item?.avgDaysPerFullPack ?? initialProfile.defaultAvgDays
  );
  const [expiresAt, setExpiresAt] = useState(item?.expiresAt ? item.expiresAt.slice(0, 10) : '');
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [autoAddOnEmpty, setAutoAddOnEmpty] = useState(
    item?.autoAddOnEmpty ?? initialProfile.defaultAutoAdd
  );

  // Nutrition Facts state
  const initNut = item?.nutrition;
  const [servingSizeLabel, setServingSizeLabel] = useState(
    initNut?.servingSizeLabel ?? portionLabel
  );
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

  const profile = getCategoryProfile(category);
  const perishable = isPerishableInZone(category, zone);

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

  /** Applies category-tailored smart defaults (tracking style, presets, shelf life, zone). */
  const applyCategoryDefaults = (nextCat: FoodCategory, forceZoneAndMode = true) => {
    const prof = getCategoryProfile(nextCat);
    setCategory(nextCat);
    if (forceZoneAndMode) {
      setZone(prof.defaultZone);
      const nextMode: EntryMode =
        prof.defaultTrackingMode === 'portioned'
          ? 'portioned'
          : prof.defaultContinuousStyle === 'measured'
          ? 'measured'
          : 'level_only';
      setEntryMode(nextMode);
      setAvgDaysPerFullPack(prof.defaultAvgDays);
      setAutoAddOnEmpty(prof.defaultAutoAdd);

      if (nextMode === 'portioned') {
        setTotalPortions(prof.defaultPortionCount);
        setRemainingPortions(prof.defaultPortionCount);
        setRemainingManuallyEdited(false);
        setPortionLabel(prof.defaultPortionLabel);
        setPackDescription('');
      } else if (nextMode === 'measured') {
        const firstPreset = prof.measuredPresets[0];
        setContainerSize(firstPreset?.size ?? 1);
        setContainerUnit(firstPreset?.unit ?? prof.defaultUnit);
        setPackDescription(firstPreset?.packDesc ?? '');
        setLevelPercent(100);
        if (firstPreset?.servingLabel && firstPreset?.servingsPerContainer) {
          setTrackServings(true);
          setPortionLabel(firstPreset.servingLabel);
          setServingsPerContainer(firstPreset.servingsPerContainer);
        } else {
          setTrackServings(false);
          setPortionLabel(prof.defaultPortionLabel);
        }
      } else {
        setPackDescription(prof.levelPackPresets[0] ?? '1 container');
        setLevelPercent(100);
        setTrackServings(false);
      }
    }
  };

  const applyMeasuredPreset = (preset: MeasuredSizePreset) => {
    setContainerSize(preset.size);
    setContainerUnit(preset.unit);
    setPackDescription(preset.packDesc);
    if (preset.servingLabel && preset.servingsPerContainer) {
      setTrackServings(true);
      setPortionLabel(preset.servingLabel);
      setServingsPerContainer(preset.servingsPerContainer);
    }
  };

  const handleSwitchEntryMode = (nextMode: EntryMode) => {
    setEntryMode(nextMode);
    if (nextMode === 'portioned') {
      if (totalPortions === 100 || totalPortions < 1) {
        setTotalPortions(profile.defaultPortionCount);
        setRemainingPortions(profile.defaultPortionCount);
        setRemainingManuallyEdited(false);
      }
      if (!portionLabel || portionLabel === 'container') {
        setPortionLabel(profile.defaultPortionLabel);
      }
    } else if (nextMode === 'measured') {
      if (!containerSize || containerSize <= 0) {
        const first = profile.measuredPresets[0];
        setContainerSize(first?.size ?? 1);
        setContainerUnit(first?.unit ?? profile.defaultUnit);
      }
    } else {
      setTrackServings(false);
      if (!packDescription.trim()) {
        setPackDescription(profile.levelPackPresets[0] ?? '1 container');
      }
    }
  };

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

      if (result.suggestedCategory && advanceToForm) {
        applyCategoryDefaults(result.suggestedCategory, true);
      }
      if (result.suggestedZone && advanceToForm) {
        setZone(result.suggestedZone);
      }
      if (result.productName && (!name.trim() || advanceToForm)) {
        setName(result.productName);
      }
      if (result.quantity && (!packDescription.trim() || advanceToForm)) {
        setPackDescription(result.quantity);
      }
      if (result.measuredQuantity && advanceToForm) {
        setEntryMode('measured');
        setContainerSize(result.measuredQuantity.size);
        setContainerUnit(result.measuredQuantity.unit);
      } else if (result.suggestedTrackingMode && advanceToForm) {
        setEntryMode(
          result.suggestedTrackingMode === 'portioned'
            ? 'portioned'
            : result.suggestedContinuousStyle === 'measured'
            ? 'measured'
            : 'level_only'
        );
      }
      if (result.nutrition.servingSizeLabel) {
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
        result.error ||
          'Product not found — pick a category below to enter manually or scan the nutrition label.'
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
        'Live camera barcode detection requires Chrome/Android or Safari with BarcodeDetector — enter the barcode below or pick a category.'
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
      setBarcodeError(
        'Camera permission denied or unavailable. Type the barcode number below or pick a category.'
      );
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
          servingSizeLabel: servingSizeLabel.trim() || portionLabel || '1 serving',
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

    let finalTrackingMode: InventoryItem['trackingMode'] = 'portioned';
    let finalContinuousStyle: InventoryItem['continuousStyle'] = undefined;
    let finalContainerSize: number | undefined = undefined;
    let finalContainerUnit: MeasureUnit | undefined = undefined;
    let finalTotalPortions = 1;
    let finalRemainingPortions = 1;
    let finalPortionLabel = portionLabel.trim() || profile.defaultPortionLabel;
    let finalPackDescription = packDescription.trim();

    if (entryMode === 'portioned') {
      finalTrackingMode = 'portioned';
      finalTotalPortions = Math.max(1, Number(totalPortions) || 1);
      finalRemainingPortions = Math.max(0, Number(remainingPortions) || 0);
      if (!finalPackDescription) {
        finalPackDescription = `${finalTotalPortions} × ${finalPortionLabel}`;
      }
    } else if (entryMode === 'measured') {
      finalTrackingMode = 'continuous';
      finalContinuousStyle = 'measured';
      finalContainerSize = Math.max(0.05, Number(containerSize) || 1);
      finalContainerUnit = containerUnit;
      if (trackServings) {
        finalTotalPortions = Math.max(2, Number(servingsPerContainer) || 8);
        finalPortionLabel = portionLabel.trim() || '1 serving';
      } else {
        finalTotalPortions = 100;
        finalPortionLabel = 'container';
      }

      // Preserve over-stocked backup containers if editing other fields without touching the level slider
      if (
        !levelEdited &&
        item &&
        item.trackingMode === 'continuous' &&
        item.remainingPortions > item.totalPortions &&
        item.totalPortions === finalTotalPortions
      ) {
        finalRemainingPortions = item.remainingPortions;
      } else {
        finalRemainingPortions =
          levelPercent === 0
            ? 0
            : Math.max(0.01, Number(((finalTotalPortions * levelPercent) / 100).toFixed(2)));
      }

      if (!finalPackDescription) {
        finalPackDescription = formatMeasuredAmount(finalContainerSize, finalContainerUnit);
      }
    } else {
      // Simple Level (spices, sauces, herbs, bottles)
      finalTrackingMode = 'continuous';
      finalContinuousStyle = 'level_only';
      finalTotalPortions = 100;
      finalPortionLabel = 'container';
      if (
        !levelEdited &&
        item &&
        item.trackingMode === 'continuous' &&
        item.remainingPortions > item.totalPortions &&
        item.totalPortions === 100
      ) {
        finalRemainingPortions = item.remainingPortions;
      } else {
        finalRemainingPortions = Math.max(0, Math.min(100, Math.round(levelPercent)));
      }
      if (!finalPackDescription) {
        finalPackDescription = profile.levelPackPresets[0] ?? '1 container';
      }
    }

    const built: InventoryItem = {
      id: item?.id ?? `item-${Date.now()}`,
      name: name.trim(),
      alias: alias.trim(),
      zone,
      category,
      trackingMode: finalTrackingMode,
      continuousStyle: finalContinuousStyle,
      containerSize: finalContainerSize,
      containerUnit: finalContainerUnit,
      totalPortions: finalTotalPortions,
      remainingPortions: finalRemainingPortions,
      portionLabel: finalPortionLabel,
      packDescription: finalPackDescription,
      proteinPerPortion: Math.max(0, Number(protein) || 0),
      nutrition,
      defaultStoreId,
      storePurchaseCounts: item?.storePurchaseCounts ?? { [defaultStoreId]: 1 },
      avgDaysPerFullPack: Math.max(1, Number(avgDaysPerFullPack) || profile.defaultAvgDays),
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

  const activePresetPct = getActiveLevelPreset(levelPercent);
  const measuredRemainingNow = formatMeasuredAmount(
    Math.max(0, (Number(containerSize) || 0) * (levelPercent / 100)),
    containerUnit
  );
  const measuredTotalNow = formatMeasuredAmount(Math.max(0, Number(containerSize) || 0), containerUnit);

  const levelToneColor =
    levelPercent <= 15
      ? 'bg-rose-500'
      : levelPercent <= 38
      ? 'bg-amber-500'
      : 'bg-teal-600';

  const unitOptions: MeasureUnit[] = [
    ...profile.allowedUnits,
    ...ALL_MEASURE_UNITS.filter((u) => !profile.allowedUnits.includes(u)),
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-stone-950/50 backdrop-blur-xs p-0 sm:p-4">
      <div className="w-full max-w-xl max-h-[92dvh] flex flex-col rounded-t-3xl sm:rounded-3xl bg-white shadow-2xl border border-stone-200 overflow-hidden safe-bottom">
        {/* Modal Header */}
        <div className="px-5 pt-4 pb-3 bg-white border-b border-stone-100 space-y-3 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-bold text-stone-900 leading-tight">
                {step === 'barcode_first'
                  ? 'Add Kitchen Item'
                  : isNew
                  ? `${profile.en}`
                  : item.name}
              </h2>
              {step === 'barcode_first' && (
                <p className="text-xs text-stone-500 mt-0.5">
                  Scan a barcode or pick a product type for tailored fields
                </p>
              )}
            </div>
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
                Stock &amp; Tracking
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
                Nutrition Facts &amp; Scan
              </button>
            </div>
          )}
        </div>

        {/* STEP 1 FOR NEW ITEMS: FAST BARCODE + CATEGORY PICKER */}
        {step === 'barcode_first' ? (
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {/* Compact Barcode Scanner Box */}
            <div className="rounded-2xl border border-indigo-200/90 bg-indigo-50/45 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-indigo-700 text-white flex items-center justify-center shrink-0">
                    <Barcode className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-xs sm:text-sm font-bold text-stone-900 leading-tight">
                      Have a barcode? Auto-fill everything
                    </h3>
                    <p className="text-[11px] text-stone-600 truncate">
                      Loads name, container size &amp; nutrition from Open Food Facts
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    cameraActive ? stopCamera() : startLiveBarcodeCamera(true)
                  }
                  className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-700 hover:bg-indigo-800 text-white px-3 py-2 text-xs font-bold shadow-xs transition shrink-0"
                >
                  <Camera className="w-3.5 h-3.5" />
                  {cameraActive ? 'Stop' : 'Scan'}
                </button>
              </div>

              {cameraActive && (
                <div className="rounded-xl overflow-hidden border border-indigo-300 bg-black relative">
                  <video ref={videoRef} playsInline muted className="w-full h-44 object-cover" />
                  <div className="absolute inset-x-6 top-1/2 h-0.5 bg-teal-400 shadow" />
                </div>
              )}

              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 text-stone-400 absolute top-1/2 -translate-y-1/2 left-3" />
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
                    className="w-full rounded-xl border border-indigo-200 bg-white pl-8 pr-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <button
                  type="button"
                  disabled={isLookingUpBarcode || !barcodeInput.trim()}
                  onClick={() => runBarcodeLookup(barcodeInput, true)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-stone-900 hover:bg-stone-800 disabled:opacity-45 text-white px-3.5 py-2 text-xs font-bold shrink-0"
                >
                  {isLookingUpBarcode ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    'Lookup'
                  )}
                </button>
              </div>

              {barcodeError && (
                <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] text-amber-900">
                  {barcodeError}
                </div>
              )}
            </div>

            {/* Category Quick-Start Grid */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-stone-500">
                  Or pick what you&apos;re adding
                </h3>
                <span className="text-[11px] text-stone-400">Sets zone &amp; tracking style</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {PRODUCT_CATEGORY_ORDER.map((catKey) => {
                  const prof = PRODUCT_CATEGORIES[catKey];
                  const modeTag =
                    prof.defaultTrackingMode === 'portioned'
                      ? 'Count'
                      : prof.defaultContinuousStyle === 'measured'
                      ? 'Liquid / Bulk'
                      : 'Simple Level';
                  return (
                    <button
                      key={catKey}
                      type="button"
                      onClick={() => {
                        stopCamera();
                        applyCategoryDefaults(catKey, true);
                        setStep('form');
                        setActiveTab('basics');
                      }}
                      className="group rounded-2xl border border-stone-200/90 hover:border-teal-500 hover:bg-teal-50/40 bg-white p-3 text-left transition flex items-start gap-3 shadow-2xs"
                    >
                      <div className="w-9 h-9 rounded-xl bg-stone-100 group-hover:bg-teal-700 group-hover:text-white text-stone-700 flex items-center justify-center shrink-0 transition">
                        <CategoryIcon category={catKey} className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-xs font-bold text-stone-900 truncate">
                            {prof.en}
                          </span>
                          <ArrowRight className="w-3.5 h-3.5 text-stone-300 group-hover:text-teal-700 shrink-0 transition" />
                        </div>
                        <p className="text-[11px] text-stone-500 line-clamp-1 mt-0.5">
                          {prof.examplesEn}
                        </p>
                        <div className="flex items-center gap-1.5 mt-1.5 text-[10px] font-semibold">
                          <span className="px-1.5 py-0.5 rounded bg-stone-100 text-stone-600">
                            {ZONE_META[prof.defaultZone].en}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-teal-50 text-teal-800">
                            {modeTag}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          /* STEP 2 (OR EDIT): TAILORED MULTI-SECTION FORM + NUTRITION TAB */
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
            {scanSuccessMsg && (
              <div className="flex items-start gap-2 text-xs font-semibold text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-2xl px-3.5 py-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                <span>{scanSuccessMsg}</span>
              </div>
            )}

            {activeTab === 'basics' ? (
              <>
                {/* 1. Product Name & Alias */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-stone-700 mb-1">
                      Product Name *
                    </label>
                    <input
                      dir="auto"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={profile.namePlaceholder}
                      className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-stone-600 mb-1">
                      Secondary Alias (Persian / English)
                    </label>
                    <input
                      dir="auto"
                      value={alias}
                      onChange={(e) => setAlias(e.target.value)}
                      placeholder={profile.aliasPlaceholder}
                      className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                    />
                  </div>
                </div>

                {/* 2. Storage Zone Pills + Category + Store */}
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-stone-600 mb-1.5">
                      Storage Zone
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {(
                        [
                          { id: 'fridge', icon: <Thermometer className="w-3.5 h-3.5" /> },
                          { id: 'freezer', icon: <Snowflake className="w-3.5 h-3.5" /> },
                          { id: 'pantry', icon: <Archive className="w-3.5 h-3.5" /> },
                        ] as const
                      ).map((z) => {
                        const active = zone === z.id;
                        return (
                          <button
                            key={z.id}
                            type="button"
                            onClick={() => setZone(z.id)}
                            className={`inline-flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold border transition ${
                              active
                                ? 'bg-stone-900 text-white border-stone-900 shadow-2xs'
                                : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-50'
                            }`}
                          >
                            {z.icon}
                            {ZONE_META[z.id].en}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-stone-600 mb-1">
                        Category
                      </label>
                      <select
                        value={category}
                        onChange={(e) =>
                          applyCategoryDefaults(e.target.value as FoodCategory, isNew)
                        }
                        className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                      >
                        {PRODUCT_CATEGORY_ORDER.map((c) => (
                          <option key={c} value={c}>
                            {CATEGORY_META[c].en}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-stone-600 mb-1">
                        Preferred Store
                      </label>
                      <select
                        value={defaultStoreId}
                        onChange={(e) => setDefaultStoreId(e.target.value)}
                        className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                      >
                        {stores.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                {/* 3. How Do You Track This Product? — 3 Distinct Entry Modes */}
                <div className="space-y-2.5 pt-1">
                  <label className="block text-xs font-bold text-stone-700">
                    How do you track stock for this product?
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => handleSwitchEntryMode('portioned')}
                      className={`rounded-2xl border p-2.5 text-left transition ${
                        entryMode === 'portioned'
                          ? 'border-teal-600 bg-teal-50/80 text-teal-950 shadow-2xs'
                          : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 font-bold text-xs">
                        <Hash className="w-3.5 h-3.5 text-teal-700 shrink-0" />
                        <span>Count</span>
                      </div>
                      <div className="text-[10px] opacity-80 mt-0.5 leading-snug">
                        Bags, eggs, fillets, cans
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSwitchEntryMode('measured')}
                      className={`rounded-2xl border p-2.5 text-left transition ${
                        entryMode === 'measured'
                          ? 'border-teal-600 bg-teal-50/80 text-teal-950 shadow-2xs'
                          : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 font-bold text-xs">
                        <Droplets className="w-3.5 h-3.5 text-teal-700 shrink-0" />
                        <span>Liquid / Bulk</span>
                      </div>
                      <div className="text-[10px] opacity-80 mt-0.5 leading-snug">
                        Milk (4L), yogurt, rice, oil
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSwitchEntryMode('level_only')}
                      className={`rounded-2xl border p-2.5 text-left transition ${
                        entryMode === 'level_only'
                          ? 'border-teal-600 bg-teal-50/80 text-teal-950 shadow-2xs'
                          : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 font-bold text-xs">
                        <Gauge className="w-3.5 h-3.5 text-teal-700 shrink-0" />
                        <span>Simple Level</span>
                      </div>
                      <div className="text-[10px] opacity-80 mt-0.5 leading-snug">
                        Spices, sauces, herbs, jars
                      </div>
                    </button>
                  </div>

                  {/* ========================================================== */}
                  {/* ENTRY SECTION A: COUNT / PORTIONS                          */}
                  {/* ========================================================== */}
                  {entryMode === 'portioned' && (
                    <div className="rounded-2xl border border-stone-200 bg-stone-50/70 p-4 space-y-3.5">
                      {/* Quick Unit Chips */}
                      <div>
                        <div className="text-[11px] font-semibold text-stone-500 mb-1.5">
                          Quick unit for {profile.shortEn}:
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {profile.portionUnitPresets.map((preset) => (
                            <button
                              key={preset}
                              type="button"
                              onClick={() => setPortionLabel(preset)}
                              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition ${
                                portionLabel === preset
                                  ? 'bg-teal-700 text-white border-teal-700'
                                  : 'bg-white text-stone-700 border-stone-200 hover:border-teal-400'
                              }`}
                            >
                              {preset}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-semibold text-stone-700 mb-1">
                            Full Pack Count
                          </label>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                const next = Math.max(1, totalPortions - 1);
                                setTotalPortions(next);
                                if (!remainingManuallyEdited) setRemainingPortions(next);
                              }}
                              className="p-2 rounded-xl border border-stone-200 bg-white hover:bg-stone-100 text-stone-700"
                              aria-label="Decrease full pack count"
                            >
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <input
                              type="number"
                              step="0.5"
                              min="1"
                              value={totalPortions}
                              onChange={(e) => {
                                const next = Number(e.target.value);
                                setTotalPortions(next);
                                if (!remainingManuallyEdited) setRemainingPortions(next);
                              }}
                              className="w-full rounded-xl border border-stone-200 bg-white px-2.5 py-2 text-sm font-bold text-center"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const next = totalPortions + 1;
                                setTotalPortions(next);
                                if (!remainingManuallyEdited) setRemainingPortions(next);
                              }}
                              className="p-2 rounded-xl border border-stone-200 bg-white hover:bg-stone-100 text-stone-700"
                              aria-label="Increase full pack count"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-stone-700 mb-1">
                            In Stock Now
                          </label>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setRemainingManuallyEdited(true);
                                setRemainingPortions(Math.max(0, Number((remainingPortions - 1).toFixed(1))));
                              }}
                              className="p-2 rounded-xl border border-stone-200 bg-white hover:bg-stone-100 text-stone-700"
                              aria-label="Decrease in stock"
                            >
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <input
                              type="number"
                              step="0.5"
                              min="0"
                              value={remainingPortions}
                              onChange={(e) => {
                                setRemainingManuallyEdited(true);
                                setRemainingPortions(Number(e.target.value));
                              }}
                              className="w-full rounded-xl border border-stone-200 bg-white px-2.5 py-2 text-sm font-bold text-center text-teal-800"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                setRemainingManuallyEdited(true);
                                setRemainingPortions(Number((remainingPortions + 1).toFixed(1)));
                              }}
                              className="p-2 rounded-xl border border-stone-200 bg-white hover:bg-stone-100 text-stone-700"
                              aria-label="Increase in stock"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-semibold text-stone-600 mb-1">
                            Unit / Portion Label
                          </label>
                          <input
                            dir="auto"
                            value={portionLabel}
                            onChange={(e) => setPortionLabel(e.target.value)}
                            placeholder={`e.g. ${profile.defaultPortionLabel}`}
                            className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-stone-600 mb-1">
                            Pack Description (Optional)
                          </label>
                          <input
                            dir="auto"
                            value={packDescription}
                            onChange={(e) => setPackDescription(e.target.value)}
                            placeholder="e.g. 1.5 kg Costco pack → 8 bags"
                            className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm"
                          />
                        </div>
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-xs font-semibold text-stone-600">
                            How long does a full pack last?
                          </label>
                          <div className="flex items-center gap-1">
                            {profile.quickDaysPresets.map((d) => (
                              <button
                                key={d}
                                type="button"
                                onClick={() => setAvgDaysPerFullPack(d)}
                                className={`px-2 py-0.5 rounded-md text-[10px] font-bold border transition ${
                                  avgDaysPerFullPack === d
                                    ? 'bg-stone-900 text-white border-stone-900'
                                    : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-100'
                                }`}
                              >
                                {d}d
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="relative">
                          <input
                            type="number"
                            step="0.5"
                            min="1"
                            value={avgDaysPerFullPack}
                            onChange={(e) => setAvgDaysPerFullPack(Number(e.target.value))}
                            className="w-full rounded-xl border border-stone-200 bg-white px-3 pr-14 py-2 text-sm font-semibold"
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-stone-400">
                            days
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ========================================================== */}
                  {/* ENTRY SECTION B: MEASURED LIQUID / BULK CONTAINER          */}
                  {/* ========================================================== */}
                  {entryMode === 'measured' && (
                    <div className="rounded-2xl border border-teal-200/90 bg-teal-50/35 p-4 space-y-4">
                      {/* Quick Container Presets */}
                      {profile.measuredPresets.length > 0 && (
                        <div>
                          <div className="text-[11px] font-semibold text-teal-900/75 mb-1.5">
                            Common {profile.shortEn} sizes:
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {profile.measuredPresets.map((preset) => {
                              const isSelected =
                                containerSize === preset.size && containerUnit === preset.unit;
                              return (
                                <button
                                  key={preset.label}
                                  type="button"
                                  onClick={() => applyMeasuredPreset(preset)}
                                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition ${
                                    isSelected
                                      ? 'bg-teal-700 text-white border-teal-700 shadow-2xs'
                                      : 'bg-white text-stone-700 border-stone-200 hover:border-teal-400'
                                  }`}
                                >
                                  {preset.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Container Size + Unit + Label */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-semibold text-stone-700 mb-1">
                            Full Container Size *
                          </label>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              step="any"
                              min="0.05"
                              value={containerSize}
                              onChange={(e) => setContainerSize(Number(e.target.value))}
                              className="flex-1 rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-bold"
                            />
                            <select
                              value={containerUnit}
                              onChange={(e) => setContainerUnit(e.target.value as MeasureUnit)}
                              className="w-24 rounded-xl border border-stone-200 bg-white px-2.5 py-2 text-sm font-semibold"
                            >
                              {unitOptions.map((u) => (
                                <option key={u} value={u}>
                                  {MEASURE_UNIT_META[u].label}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-stone-600 mb-1">
                            Container / Pack Label
                          </label>
                          <input
                            dir="auto"
                            value={packDescription}
                            onChange={(e) => setPackDescription(e.target.value)}
                            placeholder={`e.g. ${measuredTotalNow} jug / bag`}
                            className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm"
                          />
                        </div>
                      </div>

                      {/* Interactive Visual Fill Level Control */}
                      <div className="rounded-xl border border-stone-200/90 bg-white p-3.5 space-y-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-stone-800">
                            How much is left right now?
                          </span>
                          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-teal-900 bg-teal-50 border border-teal-200 px-2.5 py-0.5 rounded-full">
                            <span>{levelPercent}%</span>
                            <span className="text-teal-700 font-medium">
                              ({levelPercent === 0 ? 'Empty' : `~${measuredRemainingNow}`})
                            </span>
                          </span>
                        </div>

                        {/* Visual Fill Bar */}
                        <div className="relative h-2.5 w-full rounded-full bg-stone-100 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-150 ${levelToneColor}`}
                            style={{ width: `${levelPercent}%` }}
                          />
                        </div>

                        {/* Preset Level Pills */}
                        <div className="grid grid-cols-5 gap-1.5">
                          {CONTINUOUS_LEVEL_PRESETS.map((p) => {
                            const active = activePresetPct === p.pct && levelPercent > 0;
                            return (
                              <button
                                key={p.pct}
                                type="button"
                                onClick={() => {
                                  setLevelEdited(true);
                                  setLevelPercent(p.pct);
                                }}
                                className={`py-1.5 rounded-xl text-xs font-bold border transition ${
                                  active
                                    ? 'bg-stone-900 text-white border-stone-900 shadow-2xs'
                                    : 'bg-stone-50 text-stone-700 border-stone-200 hover:bg-stone-100'
                                }`}
                              >
                                {p.shortLabel}
                              </button>
                            );
                          })}
                        </div>

                        {/* Smooth Range Slider for Exact Level */}
                        <div className="flex items-center gap-2.5 pt-0.5">
                          <span className="text-[10px] font-semibold text-stone-400">0%</span>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            step={5}
                            value={levelPercent}
                            onChange={(e) => {
                              setLevelEdited(true);
                              setLevelPercent(Number(e.target.value));
                            }}
                            aria-label="Current fill level percentage"
                            className="flex-1 accent-teal-700 h-2 cursor-pointer"
                          />
                          <span className="text-[10px] font-semibold text-stone-400">100%</span>
                        </div>
                      </div>

                      {/* Typical Lifespan */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-xs font-semibold text-stone-700">
                            How long does one full {measuredTotalNow} last?
                          </label>
                          <div className="flex items-center gap-1">
                            {profile.quickDaysPresets.map((d) => (
                              <button
                                key={d}
                                type="button"
                                onClick={() => setAvgDaysPerFullPack(d)}
                                className={`px-2 py-0.5 rounded-md text-[10px] font-bold border transition ${
                                  avgDaysPerFullPack === d
                                    ? 'bg-stone-900 text-white border-stone-900'
                                    : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-100'
                                }`}
                              >
                                {d}d
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="relative">
                          <input
                            type="number"
                            step="0.5"
                            min="1"
                            value={avgDaysPerFullPack}
                            onChange={(e) => setAvgDaysPerFullPack(Number(e.target.value))}
                            className="w-full rounded-xl border border-stone-200 bg-white px-3 pr-14 py-2 text-sm font-semibold"
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-stone-400">
                            days
                          </span>
                        </div>
                      </div>

                      {/* Optional Serving Pour Tracking */}
                      <div className="rounded-xl border border-stone-200/80 bg-white/80 p-3 space-y-2.5">
                        <label className="flex items-center gap-2 text-xs font-semibold text-stone-700 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={trackServings}
                            onChange={(e) => setTrackServings(e.target.checked)}
                            className="rounded border-stone-300 text-teal-600"
                          />
                          Enable quick &ldquo;-1 serving&rdquo; button (e.g. 1 cup milk, 1 scoop whey)
                        </label>
                        {trackServings && (
                          <div className="grid grid-cols-2 gap-2.5 pt-1">
                            <div>
                              <label className="block text-[11px] font-semibold text-stone-500 mb-1">
                                Serving Label
                              </label>
                              <input
                                dir="auto"
                                value={portionLabel}
                                onChange={(e) => setPortionLabel(e.target.value)}
                                placeholder="e.g. 1 cup (250ml)"
                                className="w-full rounded-xl border border-stone-200 bg-white px-2.5 py-1.5 text-xs"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] font-semibold text-stone-500 mb-1">
                                Servings / Container
                              </label>
                              <input
                                type="number"
                                min="2"
                                step="1"
                                value={servingsPerContainer}
                                onChange={(e) => setServingsPerContainer(Number(e.target.value))}
                                className="w-full rounded-xl border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-bold"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ========================================================== */}
                  {/* ENTRY SECTION C: SIMPLE LEVEL (SPICES, SAUCES, HERBS)      */}
                  {/* ========================================================== */}
                  {entryMode === 'level_only' && (
                    <div className="rounded-2xl border border-amber-200/80 bg-amber-50/35 p-4 space-y-4">
                      {/* Visual Fill Level Gauge */}
                      <div className="rounded-xl border border-stone-200/90 bg-white p-3.5 space-y-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-stone-800">Current Level</span>
                          <span className="inline-flex items-center gap-1 text-xs font-bold text-stone-900 bg-stone-100 px-2.5 py-0.5 rounded-full">
                            {getLevelWord(levelPercent)} ({levelPercent}%)
                          </span>
                        </div>

                        <div className="relative h-2.5 w-full rounded-full bg-stone-100 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-150 ${levelToneColor}`}
                            style={{ width: `${levelPercent}%` }}
                          />
                        </div>

                        <div className="grid grid-cols-5 gap-1.5">
                          {CONTINUOUS_LEVEL_PRESETS.map((p) => {
                            const active = activePresetPct === p.pct && levelPercent > 0;
                            return (
                              <button
                                key={p.pct}
                                type="button"
                                onClick={() => {
                                  setLevelEdited(true);
                                  setLevelPercent(p.pct);
                                }}
                                className={`py-1.5 rounded-xl text-xs font-bold border transition ${
                                  active
                                    ? 'bg-stone-900 text-white border-stone-900 shadow-2xs'
                                    : 'bg-stone-50 text-stone-700 border-stone-200 hover:bg-stone-100'
                                }`}
                              >
                                {p.shortLabel}
                              </button>
                            );
                          })}
                        </div>

                        <div className="flex items-center gap-2.5 pt-0.5">
                          <span className="text-[10px] font-semibold text-stone-400">0%</span>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            step={5}
                            value={levelPercent}
                            onChange={(e) => {
                              setLevelEdited(true);
                              setLevelPercent(Number(e.target.value));
                            }}
                            aria-label="Simple level percentage"
                            className="flex-1 accent-teal-700 h-2 cursor-pointer"
                          />
                          <span className="text-[10px] font-semibold text-stone-400">100%</span>
                        </div>
                      </div>

                      {/* Container Type Chips + Optional Label */}
                      <div className="space-y-2">
                        <label className="block text-xs font-semibold text-stone-700">
                          Container / Pack Type (Optional)
                        </label>
                        <div className="flex flex-wrap gap-1.5">
                          {profile.levelPackPresets.map((preset) => (
                            <button
                              key={preset}
                              type="button"
                              onClick={() => setPackDescription(preset)}
                              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition ${
                                packDescription === preset
                                  ? 'bg-teal-700 text-white border-teal-700'
                                  : 'bg-white text-stone-700 border-stone-200 hover:border-teal-400'
                              }`}
                            >
                              {preset}
                            </button>
                          ))}
                        </div>
                        <input
                          dir="auto"
                          value={packDescription}
                          onChange={(e) => setPackDescription(e.target.value)}
                          placeholder="e.g. 1 jar, 1 bottle, 1 bunch"
                          className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm"
                        />
                      </div>

                      {/* Typical Lifespan */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-xs font-semibold text-stone-700">
                            Roughly how long does one last?
                          </label>
                          <div className="flex items-center gap-1">
                            {profile.quickDaysPresets.map((d) => (
                              <button
                                key={d}
                                type="button"
                                onClick={() => setAvgDaysPerFullPack(d)}
                                className={`px-2 py-0.5 rounded-md text-[10px] font-bold border transition ${
                                  avgDaysPerFullPack === d
                                    ? 'bg-stone-900 text-white border-stone-900'
                                    : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-100'
                                }`}
                              >
                                {d}d
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="relative">
                          <input
                            type="number"
                            step="1"
                            min="1"
                            value={avgDaysPerFullPack}
                            onChange={(e) => setAvgDaysPerFullPack(Number(e.target.value))}
                            className="w-full rounded-xl border border-stone-200 bg-white px-3 pr-14 py-2 text-sm font-semibold"
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-stone-400">
                            days
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* 4. Category-Aware Freshness & Notes */}
                {perishable ? (
                  <div className="rounded-2xl border border-rose-200/70 bg-rose-50/35 p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <label className="inline-flex items-center gap-1.5 text-xs font-bold text-rose-950">
                        <Calendar className="w-3.5 h-3.5 text-rose-600" />
                        Freshness / Best-By Date
                      </label>
                      <div className="flex items-center gap-1">
                        {profile.expiryQuickDays.map((d) => {
                          const targetDate = addDaysToIsoDate(d);
                          const active = expiresAt === targetDate;
                          return (
                            <button
                              key={d}
                              type="button"
                              onClick={() => setExpiresAt(targetDate)}
                              className={`px-2 py-0.5 rounded-md text-[10px] font-bold border transition ${
                                active
                                  ? 'bg-rose-700 text-white border-rose-700'
                                  : 'bg-white text-rose-900 border-rose-200 hover:bg-rose-50'
                              }`}
                            >
                              +{d}d
                            </button>
                          );
                        })}
                        {expiresAt && (
                          <button
                            type="button"
                            onClick={() => setExpiresAt('')}
                            className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold text-stone-500 hover:text-stone-800"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <input
                        type="date"
                        value={expiresAt}
                        onChange={(e) => setExpiresAt(e.target.value)}
                        className="w-full rounded-xl border border-rose-200/80 bg-white px-3 py-2 text-sm"
                      />
                      <input
                        dir="auto"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Quick note (optional)"
                        className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-stone-600 mb-1">
                        Best-By Date (Optional)
                      </label>
                      <input
                        type="date"
                        value={expiresAt}
                        onChange={(e) => setExpiresAt(e.target.value)}
                        className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-stone-600 mb-1">
                        Quick Note
                      </label>
                      <input
                        dir="auto"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Optional note"
                        className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm"
                      />
                    </div>
                  </div>
                )}

                <label className="flex items-center gap-2.5 text-xs text-stone-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={autoAddOnEmpty}
                    onChange={(e) => setAutoAddOnEmpty(e.target.checked)}
                    className="rounded border-stone-300 text-teal-600"
                  />
                  <span>
                    Automatically add to Shopping List when finished
                    {category === 'prepared' && (
                      <span className="text-stone-400"> (off by default for leftovers)</span>
                    )}
                  </span>
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
                      <label className="block text-[10px] font-bold text-stone-500 mb-1">
                        Calories
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={calories}
                        onChange={(e) => setCalories(Number(e.target.value))}
                        className="w-full rounded-xl border border-stone-200 px-2 py-1.5 text-xs font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-indigo-700 mb-1">
                        Protein (g)
                      </label>
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
                      <label className="block text-[10px] font-bold text-rose-700 mb-1">
                        Sugar (g)
                      </label>
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
                      <label className="block text-[10px] font-bold text-emerald-700 mb-1">
                        Fiber (g)
                      </label>
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
                      <label className="block text-[10px] font-bold text-stone-500 mb-1">
                        Carbs (g)
                      </label>
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
                      <label className="block text-[10px] font-bold text-stone-500 mb-1">
                        Fat (g)
                      </label>
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
                confirmDelete ? (
                  <div className="inline-flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        onDelete(item.id);
                        onClose();
                      }}
                      className="inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Confirm Delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="px-2.5 py-2 rounded-xl text-xs font-semibold text-stone-500 hover:bg-stone-100"
                    >
                      Keep
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-rose-600 hover:bg-rose-50"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </button>
                )
              ) : isNew ? (
                <button
                  type="button"
                  onClick={() => setStep('barcode_first')}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-indigo-700 hover:bg-indigo-50"
                >
                  <Barcode className="w-4 h-4" />
                  Change Type / Scan
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
