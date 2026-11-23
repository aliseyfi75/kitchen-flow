import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Link2,
  Loader2,
  Mic,
  Plus,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import {
  CookingTool,
  FoodCategory,
  InventoryItem,
  MealRecipe,
  RecipeIngredient,
  StorageZone,
  Store,
  TrackingMode,
  UILanguage,
} from '../types/kitchen';
import { CATEGORY_META, TOOL_META, ZONE_META } from '../i18n/translations';
import { estimateRecipeNutrition } from '../utils/mealEngine';
import { formatItemStockSummary } from '../utils/inventoryDisplay';
import {
  getCategoryProfile,
  parseMeasuredQuantity,
  PRODUCT_CATEGORY_ORDER,
} from '../utils/productCategories';
import {
  parseVoiceFoodLocally,
  VoiceParsedFood,
  VoiceParsedIngredient,
} from '../utils/voiceFoodParser';
import { parseVoiceFoodWithGemini } from '../services/geminiEdge';

interface VoiceFoodModalProps {
  items: InventoryItem[];
  stores: Store[];
  cuisines: string[];
  lang: UILanguage;
  onClose: () => void;
  onConfirmSave: (
    recipe: Omit<MealRecipe, 'id'>,
    newInventoryItems: InventoryItem[]
  ) => void;
}

type SpeechRecognitionInstance = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

const ALL_TOOLS: CookingTool[] = [
  'air_fryer',
  'oven',
  'pan',
  'grill',
  'instant_pot',
  'slow_cooker',
  'blender',
  'no_cook',
];

const EXAMPLE_EN =
  'Air fryer salmon bowl with 1 salmon fillet, 1 cup basmati rice, 2 handfuls baby spinach, half an avocado, and 1 tbsp olive oil, 20 minutes';
const EXAMPLE_FA =
  'املت اسفناج و قارچ توی تابه، ۱۵ دقیقه: ۳ تا تخم‌مرغ، ۱ مشت اسفناج تازه، ۱۰۰ گرم قارچ، یک قاشق روغن زیتون و کمی پنیر فتا';

function pickSupportedAudioMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return '';
}

function formatTimer(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export const VoiceFoodModal: React.FC<VoiceFoodModalProps> = ({
  items,
  stores,
  cuisines,
  lang,
  onClose,
  onConfirmSave,
}) => {
  const defaultStoreId = stores[0]?.id ?? 'store-superstore';

  const [step, setStep] = useState<'record' | 'review'>('record');
  const [voiceLang, setVoiceLang] = useState<'auto' | 'en' | 'fa'>(() => {
    try {
      const saved = localStorage.getItem('kitchenflow_voice_lang_v1');
      if (saved === 'auto' || saved === 'en' || saved === 'fa') return saved;
    } catch {
      // ignore
    }
    return 'auto';
  });
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoNotice, setInfoNotice] = useState<string | null>(null);

  // Review & confirmation state
  const [foodName, setFoodName] = useState('');
  const [foodAlias, setFoodAlias] = useState('');
  const [foodCuisine, setFoodCuisine] = useState(cuisines[0] || 'Persian');
  const [foodMealType, setFoodMealType] = useState<MealRecipe['mealType']>('dinner');
  const [foodPrepMinutes, setFoodPrepMinutes] = useState(20);
  const [foodTools, setFoodTools] = useState<CookingTool[]>(['pan']);
  const [foodSteps, setFoodSteps] = useState<string[]>([]);
  const [parsedIngredients, setParsedIngredients] = useState<VoiceParsedIngredient[]>([]);

  // MediaRecorder & SpeechRecognition refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const timerRef = useRef<number | null>(null);
  const transcriptRef = useRef(transcript);
  transcriptRef.current = transcript;

  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const handleSetVoiceLang = (next: 'auto' | 'en' | 'fa') => {
    setVoiceLang(next);
    try {
      localStorage.setItem('kitchenflow_voice_lang_v1', next);
    } catch {
      // ignore
    }
  };

  const stopAllCapture = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // ignore
      }
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((tr) => tr.stop());
      mediaStreamRef.current = null;
    }
    setIsRecording(false);
  };

  useEffect(() => {
    return () => {
      stopAllCapture();
    };
  }, []);

  const populateReview = (parsed: VoiceParsedFood) => {
    setTranscript(parsed.transcript || transcriptRef.current);
    setFoodName(parsed.name);
    setFoodAlias(parsed.alias);
    setFoodCuisine(parsed.cuisine || cuisines[0] || 'Persian');
    setFoodMealType(parsed.mealType);
    setFoodPrepMinutes(parsed.prepMinutes);
    setFoodTools(parsed.tools.length > 0 ? parsed.tools : ['pan']);
    setFoodSteps(parsed.quickSteps);
    setParsedIngredients(parsed.ingredients);
    if (parsed.source === 'local_fallback') {
      setInfoNotice(
        'Extracted using built-in bilingual parser — review ingredients and confirm any missing kitchen items below.'
      );
    } else if (parsed.source === 'gemini_audio') {
      setInfoNotice('Transcribed & extracted directly from your voice audio (EN/FA).');
    } else if (parsed.source === 'gemini_compat') {
      setInfoNotice('Extracted with Gemini AI — review matched kitchen tickers and confirm any missing items.');
    } else {
      setInfoNotice('Extracted with Gemini AI — review matches and confirm missing kitchen items.');
    }
    setStep('review');
  };

  const runExtraction = async (blobOverride?: Blob | null, textOverride?: string) => {
    const activeBlob = blobOverride !== undefined ? blobOverride : recordedBlob;
    const activeText = (textOverride !== undefined ? textOverride : transcriptRef.current).trim();

    if (!activeBlob && !activeText) {
      setErrorMsg('Please record your voice or type/dictate a food description first.');
      return;
    }

    setIsAnalyzing(true);
    setErrorMsg(null);
    setInfoNotice(null);

    try {
      const parsed = await parseVoiceFoodWithGemini({
        audioBlob: activeBlob,
        transcript: activeText,
        languageHint: voiceLang,
        inventory: items,
        defaultStoreId,
        cuisines,
      });
      populateReview(parsed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Voice analysis failed';
      if (activeText) {
        // Graceful fallback to local bilingual parser whenever we have transcript text
        const local = parseVoiceFoodLocally(activeText, items, defaultStoreId, cuisines);
        populateReview(local);
        setInfoNotice(
          `Gemini AI unavailable (${msg}) — parsed with offline bilingual matcher instead. Please review below.`
        );
      } else {
        setErrorMsg(
          `Could not process audio (${msg}). Try typing or using your phone keyboard mic in the box below.`
        );
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  const startRecording = async () => {
    setErrorMsg(null);
    setInfoNotice(null);
    setRecordedBlob(null);
    audioChunksRef.current = [];
    setRecordSeconds(0);

    let startedAudio = false;
    let startedSpeech = false;

    // 1. Start MediaRecorder for high-accuracy multimodal EN/FA audio (especially great for Farsi & mixed speech)
    if (navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef.current = stream;
        const mime = pickSupportedAudioMime();
        const recorder = mime
          ? new MediaRecorder(stream, { mimeType: mime })
          : new MediaRecorder(stream);

        recorder.ondataavailable = (ev) => {
          if (ev.data && ev.data.size > 0) {
            audioChunksRef.current.push(ev.data);
          }
        };

        recorder.onstop = () => {
          const finalType = recorder.mimeType || mime || 'audio/webm';
          const blob =
            audioChunksRef.current.length > 0
              ? new Blob(audioChunksRef.current, { type: finalType })
              : null;
          if (blob && blob.size > 0) {
            setRecordedBlob(blob);
          }
          if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach((tr) => tr.stop());
            mediaStreamRef.current = null;
          }
          // Wait briefly so SpeechRecognition flushes its final spoken words into transcriptRef
          window.setTimeout(() => {
            if (blob || transcriptRef.current.trim()) {
              runExtraction(blob, transcriptRef.current);
            }
          }, 280);
        };

        mediaRecorderRef.current = recorder;
        recorder.start(250);
        startedAudio = true;
      } catch {
        // Microphone denied or unavailable; we'll still try SpeechRecognition or notify user
      }
    }

    // 2. Simultaneously start Web Speech API for live transcript preview (EN or FA)
    const SpeechRecCtor = (
      window as unknown as {
        SpeechRecognition?: new () => SpeechRecognitionInstance;
        webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
      }
    ).SpeechRecognition ||
      (
        window as unknown as {
          webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
        }
      ).webkitSpeechRecognition;

    if (SpeechRecCtor) {
      try {
        const rec = new SpeechRecCtor();
        rec.lang = voiceLang === 'fa' ? 'fa-IR' : 'en-US';
        rec.continuous = true;
        rec.interimResults = true;
        const baseText = transcriptRef.current.trim();

        rec.onresult = (event) => {
          let spoken = '';
          for (let i = 0; i < event.results.length; i++) {
            spoken += event.results[i][0]?.transcript || '';
          }
          const combined = baseText ? `${baseText} ${spoken.trim()}` : spoken.trim();
          setTranscript(combined);
        };

        rec.onerror = () => {
          // Audio recording still continues if active
        };

        rec.start();
        recognitionRef.current = rec;
        startedSpeech = true;
      } catch {
        // SpeechRecognition unavailable or failed to start
      }
    }

    if (!startedAudio && !startedSpeech) {
      setErrorMsg(
        'Microphone access was blocked or unsupported in this browser. You can type or use your keyboard dictation mic below.'
      );
      return;
    }

    setIsRecording(true);
    timerRef.current = window.setInterval(() => {
      setRecordSeconds((s) => s + 1);
    }, 1000);
  };

  const stopRecording = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }

    const hadRecorder =
      mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive';
    if (hadRecorder) {
      mediaRecorderRef.current!.stop(); // triggers onstop -> runExtraction
    } else {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((tr) => tr.stop());
        mediaStreamRef.current = null;
      }
      // Speech-only mode: run extraction directly from transcript
      if (transcriptRef.current.trim()) {
        runExtraction(null, transcriptRef.current);
      }
    }
    setIsRecording(false);
  };

  const updateIngredient = (id: string, patch: Partial<VoiceParsedIngredient>) => {
    setParsedIngredients((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const relinkIngredient = (id: string, nextItemId: string) => {
    if (!nextItemId) {
      // Unlink -> becomes a new missing ingredient to confirm
      setParsedIngredients((prev) =>
        prev.map((row) =>
          row.id === id
            ? {
                ...row,
                matchedItemId: undefined,
                matchConfidence: 'new',
                confirmCreateInKitchen: true,
              }
            : row
        )
      );
      return;
    }

    const inv = itemMap.get(nextItemId);
    if (!inv) return;
    setParsedIngredients((prev) =>
      prev.map((row) =>
        row.id === id
          ? {
              ...row,
              matchedItemId: inv.id,
              matchConfidence: 'exact',
              name: inv.name,
              alias: inv.alias,
              portionLabel: inv.portionLabel || row.portionLabel,
              suggestedCategory: inv.category,
              suggestedZone: inv.zone,
              suggestedTrackingMode: inv.trackingMode,
              confirmCreateInKitchen: false,
            }
          : row
      )
    );
  };

  const addBlankIngredient = () => {
    const prof = getCategoryProfile('produce');
    setParsedIngredients((prev) => [
      ...prev,
      {
        id: `ving-manual-${Date.now()}`,
        spokenText: '',
        matchedItemId: undefined,
        matchConfidence: 'new',
        name: '',
        alias: '',
        portionsNeeded: 1,
        portionLabel: prof.defaultPortionLabel,
        suggestedCategory: 'produce',
        suggestedZone: 'fridge',
        suggestedTrackingMode: 'portioned',
        suggestedPackDescription: '1 pack',
        confirmCreateInKitchen: true,
        initialInStock: false,
        initialStockCount: 0,
        storeId: defaultStoreId,
      },
    ]);
  };

  const matchedIngredients = useMemo(
    () => parsedIngredients.filter((ing) => Boolean(ing.matchedItemId)),
    [parsedIngredients]
  );

  const missingIngredients = useMemo(
    () => parsedIngredients.filter((ing) => !ing.matchedItemId),
    [parsedIngredients]
  );

  const confirmedNewCount = useMemo(
    () => missingIngredients.filter((ing) => ing.confirmCreateInKitchen && ing.name.trim()).length,
    [missingIngredients]
  );

  const liveNutrition = useMemo(() => {
    const asRecipeIngs: RecipeIngredient[] = parsedIngredients
      .filter((i) => i.name.trim())
      .map((i) => ({
        itemId: i.matchedItemId,
        name: i.name,
        alias: i.alias || undefined,
        portionsNeeded: i.portionsNeeded,
        portionLabel: i.portionLabel,
      }));
    return estimateRecipeNutrition(asRecipeIngs, foodTools, items);
  }, [parsedIngredients, foodTools, items]);

  const handleConfirmSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!foodName.trim()) return;

    const nowIso = new Date().toISOString();
    const newInventoryItems: InventoryItem[] = [];
    const finalIngredients: RecipeIngredient[] = [];

    for (const ing of parsedIngredients) {
      const cleanName = ing.name.trim();
      if (!cleanName) continue;

      if (ing.matchedItemId) {
        finalIngredients.push({
          itemId: ing.matchedItemId,
          name: cleanName,
          alias: ing.alias.trim() || undefined,
          portionsNeeded: Math.max(0.25, Number(ing.portionsNeeded) || 1),
          portionLabel: ing.portionLabel.trim() || undefined,
        });
      } else if (ing.confirmCreateInKitchen) {
        const newId = `item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const prof = getCategoryProfile(ing.suggestedCategory);
        const isCont = ing.suggestedTrackingMode === 'continuous';
        const measured = parseMeasuredQuantity(ing.suggestedPackDescription);
        const totalQty = isCont
          ? 100
          : Math.max(1, ing.initialInStock ? Math.max(prof.defaultPortionCount, ing.initialStockCount || 1) : prof.defaultPortionCount);
        const remQty = ing.initialInStock
          ? isCont
            ? 100
            : Math.max(1, ing.initialStockCount || prof.defaultPortionCount)
          : 0;

        newInventoryItems.push({
          id: newId,
          name: cleanName,
          alias: ing.alias.trim(),
          category: ing.suggestedCategory,
          zone: ing.suggestedZone,
          trackingMode: ing.suggestedTrackingMode,
          continuousStyle: isCont
            ? measured
              ? 'measured'
              : prof.defaultContinuousStyle
            : undefined,
          containerSize: isCont ? measured?.size : undefined,
          containerUnit: isCont ? measured?.unit : undefined,
          totalPortions: totalQty,
          remainingPortions: remQty,
          portionLabel: isCont ? 'container' : ing.portionLabel.trim() || prof.defaultPortionLabel,
          packDescription:
            ing.suggestedPackDescription.trim() ||
            (isCont ? prof.levelPackPresets[0] ?? '1 container' : `${totalQty} × ${prof.defaultPortionLabel}`),
          proteinPerPortion: 0,
          defaultStoreId: ing.storeId || defaultStoreId,
          storePurchaseCounts: { [ing.storeId || defaultStoreId]: 1 },
          avgDaysPerFullPack: prof.defaultAvgDays,
          cycleCount: 0,
          lastRestockedAt: nowIso,
          autoAddOnEmpty: prof.defaultAutoAdd,
        });

        finalIngredients.push({
          itemId: newId,
          name: cleanName,
          alias: ing.alias.trim() || undefined,
          portionsNeeded: Math.max(0.25, Number(ing.portionsNeeded) || 1),
          portionLabel: ing.portionLabel.trim() || undefined,
        });
      } else {
        // Include in recipe only, without creating a kitchen inventory item
        finalIngredients.push({
          name: cleanName,
          alias: ing.alias.trim() || undefined,
          portionsNeeded: Math.max(0.25, Number(ing.portionsNeeded) || 1),
          portionLabel: ing.portionLabel.trim() || undefined,
        });
      }
    }

    const recipe: Omit<MealRecipe, 'id'> = {
      name: foodName.trim(),
      alias: foodAlias.trim() || undefined,
      cuisine: foodCuisine.trim() || 'Persian',
      mealType: foodMealType,
      prepMinutes: Math.max(5, Number(foodPrepMinutes) || 20),
      effort: foodPrepMinutes <= 20 ? 'exhausted' : foodPrepMinutes >= 45 ? 'batch_prep' : 'normal',
      tools: foodTools.length > 0 ? foodTools : ['pan'],
      proteinGrams: liveNutrition.proteinGrams,
      sugarGrams: liveNutrition.sugarGrams,
      fiberGrams: liveNutrition.fiberGrams,
      calories: liveNutrition.calories,
      micronutrients:
        liveNutrition.micronutrients.length > 0 ? liveNutrition.micronutrients : ['Whole Foods'],
      nutritionHighlight: `~${liveNutrition.proteinGrams}g Protein • ~${liveNutrition.sugarGrams}g Sugar • Voice Added`,
      nutritionEstimated: true,
      ingredients: finalIngredients,
      quickSteps:
        foodSteps.length > 0
          ? foodSteps
          : ['Prepare ingredients and cook using selected tools.'],
      isFavorite: true,
    };

    onConfirmSave(recipe, newInventoryItems);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-stone-950/55 backdrop-blur-xs p-0 sm:p-4">
      <div className="w-full max-w-2xl max-h-[92dvh] flex flex-col rounded-t-3xl sm:rounded-3xl bg-white shadow-2xl border border-stone-200 overflow-hidden safe-bottom">
        {/* Header */}
        <div className="px-5 py-4 bg-gradient-to-r from-indigo-900 via-indigo-800 to-teal-800 text-white flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-white/15 flex items-center justify-center shrink-0">
              <Mic className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-bold leading-tight">
                {step === 'record' ? 'Add Food by Voice (EN / فارسی)' : 'Confirm Food & Ingredients'}
              </h2>
              <p className="text-xs text-indigo-100 truncate">
                {step === 'record'
                  ? 'Speak in English or Farsi — auto-links kitchen items & creates missing ones'
                  : 'Review matched kitchen tickers and confirm any new items to create'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              stopAllCapture();
              onClose();
            }}
            className="p-2 rounded-full bg-white/15 hover:bg-white/25 text-white shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* STEP 1: VOICE RECORDING & TRANSCRIPT */}
        {step === 'record' ? (
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {/* Language Hint Selector */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-xs font-semibold text-stone-600">Spoken Language</span>
              <div className="inline-flex items-center rounded-xl bg-stone-100 p-1 gap-1">
                {(
                  [
                    { id: 'auto', label: 'Auto (EN / فارسی)' },
                    { id: 'en', label: 'English' },
                    { id: 'fa', label: 'فارسی' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={isRecording}
                    onClick={() => handleSetVoiceLang(opt.id)}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                      voiceLang === opt.id
                        ? 'bg-white text-stone-900 shadow-2xs'
                        : 'text-stone-500 hover:text-stone-800'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Mic Capture Hero */}
            <div className="rounded-3xl border-2 border-dashed border-indigo-200 bg-indigo-50/40 p-6 text-center space-y-4">
              <div className="flex justify-center">
                <button
                  type="button"
                  disabled={isAnalyzing}
                  onClick={() => (isRecording ? stopRecording() : startRecording())}
                  className={`relative w-20 h-20 rounded-full flex items-center justify-center text-white shadow-lg transition active:scale-95 ${
                    isRecording
                      ? 'bg-rose-600 hover:bg-rose-700 ring-8 ring-rose-500/25 animate-pulse'
                      : 'bg-indigo-700 hover:bg-indigo-800 ring-8 ring-indigo-500/15'
                  }`}
                  aria-label={isRecording ? 'Stop recording' : 'Start voice recording'}
                >
                  {isRecording ? (
                    <Square className="w-7 h-7 fill-current" />
                  ) : (
                    <Mic className="w-8 h-8" />
                  )}
                </button>
              </div>

              <div className="space-y-1">
                <div className="text-sm font-bold text-stone-900">
                  {isRecording
                    ? `Listening… ${formatTimer(recordSeconds)} — tap stop when done`
                    : isAnalyzing
                    ? 'Extracting food, amounts & matching kitchen tickers…'
                    : 'Tap the microphone and describe your food'}
                </div>
                <p className="text-xs text-stone-500 max-w-md mx-auto">
                  Say the dish name, ingredients, amounts, and tool — in English, Farsi, or a mix of both!
                </p>
              </div>

              {isAnalyzing && (
                <div className="inline-flex items-center gap-2 rounded-full bg-indigo-100 text-indigo-900 px-3.5 py-1.5 text-xs font-bold">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Analyzing voice &amp; matching against your {items.length} kitchen items...
                </div>
              )}
            </div>

            {/* Editable Transcript / Manual Dictation Box */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-stone-700">
                  Transcript / Description (editable — supports EN &amp; فارسی)
                </label>
                {transcript && (
                  <button
                    type="button"
                    onClick={() => {
                      setTranscript('');
                      setRecordedBlob(null);
                    }}
                    className="text-[11px] font-semibold text-stone-400 hover:text-stone-700"
                  >
                    Clear
                  </button>
                )}
              </div>
              <textarea
                dir="auto"
                rows={3}
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                placeholder="e.g. Jujeh kabab in air fryer: 200g chicken breast, half cup basmati rice, 1 tbsp olive oil, saffron... یا به فارسی بگویید..."
                className="w-full rounded-2xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />

              {/* Quick Try Examples */}
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                <span className="text-[11px] text-stone-400 font-medium">Examples:</span>
                <button
                  type="button"
                  onClick={() => setTranscript(EXAMPLE_EN)}
                  className="text-[11px] font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 px-2.5 py-1 rounded-lg transition"
                >
                  Try English example
                </button>
                <button
                  type="button"
                  onClick={() => setTranscript(EXAMPLE_FA)}
                  className="text-[11px] font-semibold text-teal-800 bg-teal-50 hover:bg-teal-100 border border-teal-200 px-2.5 py-1 rounded-lg transition"
                >
                  مثال فارسی (املت اسفناج و قارچ)
                </button>
              </div>
            </div>

            {errorMsg && (
              <div className="rounded-2xl bg-amber-50 border border-amber-200 px-3.5 py-2.5 text-xs text-amber-900 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Step 1 Footer */}
            <div className="flex items-center justify-between gap-3 pt-2 border-t border-stone-100">
              <button
                type="button"
                onClick={() => {
                  stopAllCapture();
                  onClose();
                }}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-stone-500 hover:bg-stone-100"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isAnalyzing || isRecording || (!transcript.trim() && !recordedBlob)}
                onClick={() => runExtraction()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-teal-700 hover:bg-teal-800 disabled:opacity-40 text-white px-5 py-2.5 text-xs font-bold shadow-xs transition"
              >
                {isAnalyzing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Extracting...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Extract Food &amp; Ingredients
                  </>
                )}
              </button>
            </div>
          </div>
        ) : (
          /* STEP 2: REVIEW FOOD + MATCHED TICKERS + CONFIRM MISSING KITCHEN ITEMS */
          <form onSubmit={handleConfirmSubmit} className="flex-1 overflow-y-auto p-5 space-y-5">
            {infoNotice && (
              <div className="rounded-2xl bg-indigo-50 border border-indigo-200 px-3.5 py-2.5 text-xs text-indigo-950 flex items-start gap-2">
                <Sparkles className="w-4 h-4 text-indigo-700 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="font-semibold">{infoNotice}</div>
                  {transcript && (
                    <div dir="auto" className="text-[11px] text-indigo-800/80 italic">
                      &ldquo;{transcript}&rdquo;
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Extracted Food Info */}
            <div className="rounded-2xl border border-stone-200 bg-stone-50/70 p-4 space-y-3">
              <div className="text-xs font-bold uppercase tracking-wider text-stone-500">
                1. Extracted Food Details
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-semibold text-stone-600 mb-1">
                    Food Name *
                  </label>
                  <input
                    dir="auto"
                    required
                    value={foodName}
                    onChange={(e) => setFoodName(e.target.value)}
                    className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-stone-600 mb-1">
                    Persian / Secondary Alias
                  </label>
                  <input
                    dir="auto"
                    value={foodAlias}
                    onChange={(e) => setFoodAlias(e.target.value)}
                    placeholder="مثلاً قورمه‌سبزی"
                    className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-[11px] font-semibold text-stone-600 mb-1">
                    Cuisine
                  </label>
                  <input
                    dir="auto"
                    value={foodCuisine}
                    onChange={(e) => setFoodCuisine(e.target.value)}
                    className="w-full rounded-xl border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-stone-600 mb-1">
                    Meal Type
                  </label>
                  <select
                    value={foodMealType}
                    onChange={(e) => setFoodMealType(e.target.value as MealRecipe['mealType'])}
                    className="w-full rounded-xl border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-semibold"
                  >
                    <option value="breakfast">Breakfast</option>
                    <option value="lunch">Lunch</option>
                    <option value="dinner">Dinner</option>
                    <option value="snack">Snack</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-stone-600 mb-1">
                    Prep (min)
                  </label>
                  <input
                    type="number"
                    min={5}
                    value={foodPrepMinutes}
                    onChange={(e) => setFoodPrepMinutes(Number(e.target.value))}
                    className="w-full rounded-xl border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-bold"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {ALL_TOOLS.map((tl) => {
                  const active = foodTools.includes(tl);
                  return (
                    <button
                      key={tl}
                      type="button"
                      onClick={() =>
                        setFoodTools((prev) =>
                          prev.includes(tl) ? prev.filter((x) => x !== tl) : [...prev, tl]
                        )
                      }
                      className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition ${
                        active
                          ? 'bg-stone-900 text-white border-stone-900'
                          : 'bg-white text-stone-600 border-stone-200'
                      }`}
                    >
                      {TOOL_META[tl].emoji} {TOOL_META[tl].en}
                    </button>
                  );
                })}
              </div>

              {/* Live Auto-Estimated Nutrition */}
              <div className="flex items-center flex-wrap gap-1.5 pt-1 text-[11px] font-bold">
                <span className="text-stone-500 font-medium">Est. per serving:</span>
                <span className="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-800 border border-indigo-200">
                  ~{liveNutrition.proteinGrams}g Pro
                </span>
                <span className="px-2 py-0.5 rounded-md bg-rose-50 text-rose-800 border border-rose-200">
                  ~{liveNutrition.sugarGrams}g Sugar
                </span>
                <span className="px-2 py-0.5 rounded-md bg-teal-50 text-teal-800 border border-teal-200">
                  ~{liveNutrition.fiberGrams}g Fiber
                </span>
                <span className="px-2 py-0.5 rounded-md bg-white text-stone-700 border border-stone-200">
                  ~{liveNutrition.calories} kcal
                </span>
              </div>
            </div>

            {/* Section 2: Matched Kitchen Tickers */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-bold uppercase tracking-wider text-emerald-800 flex items-center gap-1.5">
                  <Link2 className="w-3.5 h-3.5" />
                  2. Matched in Your Kitchen ({matchedIngredients.length})
                </div>
                <button
                  type="button"
                  onClick={addBlankIngredient}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:text-teal-900"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Ingredient
                </button>
              </div>

              {matchedIngredients.length === 0 ? (
                <div className="rounded-xl border border-dashed border-stone-200 p-3 text-xs text-stone-500 text-center">
                  No existing kitchen tickers matched automatically. You can link any item below or create new ones.
                </div>
              ) : (
                <div className="space-y-2">
                  {matchedIngredients.map((ing) => {
                    const inv = ing.matchedItemId ? itemMap.get(ing.matchedItemId) : undefined;
                    return (
                      <div
                        key={ing.id}
                        className="rounded-2xl border border-emerald-200/90 bg-emerald-50/40 p-3 space-y-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                                <CheckCircle2 className="w-3 h-3" />
                                Kitchen Ticker
                              </span>
                              <span dir="auto" className="text-sm font-bold text-stone-900">
                                {ing.name}
                              </span>
                              {ing.alias && (
                                <span dir="auto" className="text-xs text-teal-800">
                                  ({ing.alias})
                                </span>
                              )}
                            </div>
                            {inv && (
                              <div className="text-[11px] text-stone-600 mt-0.5">
                                {ZONE_META[inv.zone][lang]} • {formatItemStockSummary(inv)}
                              </div>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setParsedIngredients((prev) => prev.filter((r) => r.id !== ing.id))
                            }
                            className="p-1.5 rounded-lg text-stone-400 hover:text-rose-600 hover:bg-rose-50"
                            title="Remove ingredient"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="block text-[10px] font-semibold text-stone-500 mb-0.5">
                              Amount / Serving
                            </label>
                            <input
                              type="number"
                              step="0.25"
                              min="0.25"
                              value={ing.portionsNeeded}
                              onChange={(e) =>
                                updateIngredient(ing.id, {
                                  portionsNeeded: Math.max(0.25, Number(e.target.value) || 0.25),
                                })
                              }
                              className="w-full rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs font-bold"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-semibold text-stone-500 mb-0.5">
                              Unit Label
                            </label>
                            <input
                              dir="auto"
                              value={ing.portionLabel}
                              onChange={(e) =>
                                updateIngredient(ing.id, { portionLabel: e.target.value })
                              }
                              className="w-full rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-semibold text-stone-500 mb-0.5">
                              Linked Item
                            </label>
                            <select
                              value={ing.matchedItemId || ''}
                              onChange={(e) => relinkIngredient(ing.id, e.target.value)}
                              className="w-full rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs"
                            >
                              <option value="">Create as new item…</option>
                              {items.map((it) => (
                                <option key={it.id} value={it.id}>
                                  {it.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Section 3: Missing Ingredients — Confirm Creation in Kitchen */}
            {missingIngredients.length > 0 && (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="text-xs font-bold uppercase tracking-wider text-amber-900 flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                    3. Missing from Kitchen — Confirm New Items ({missingIngredients.length})
                  </div>
                  <span className="text-[11px] text-stone-500">
                    Check items to create in your kitchen inventory
                  </span>
                </div>

                <div className="space-y-2.5">
                  {missingIngredients.map((ing) => (
                    <div
                      key={ing.id}
                      className={`rounded-2xl border p-3.5 space-y-3 transition ${
                        ing.confirmCreateInKitchen
                          ? 'border-amber-300 bg-amber-50/45 shadow-2xs'
                          : 'border-stone-200 bg-stone-50/60 opacity-75'
                      }`}
                    >
                      {/* Top Confirm Row */}
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            updateIngredient(ing.id, {
                              confirmCreateInKitchen: !ing.confirmCreateInKitchen,
                            })
                          }
                          className="inline-flex items-center gap-2 text-xs font-bold text-stone-900"
                        >
                          <span
                            className={`w-5 h-5 rounded-md border flex items-center justify-center transition ${
                              ing.confirmCreateInKitchen
                                ? 'bg-teal-700 border-teal-700 text-white'
                                : 'bg-white border-stone-300'
                            }`}
                          >
                            {ing.confirmCreateInKitchen && (
                              <Check className="w-3.5 h-3.5 stroke-[3]" />
                            )}
                          </span>
                          <span>
                            {ing.confirmCreateInKitchen
                              ? 'Confirm: Create in Kitchen'
                              : 'Recipe only (skip kitchen creation)'}
                          </span>
                        </button>

                        <div className="flex items-center gap-1.5">
                          {items.length > 0 && (
                            <select
                              value=""
                              onChange={(e) => {
                                if (e.target.value) relinkIngredient(ing.id, e.target.value);
                              }}
                              className="rounded-lg border border-stone-200 bg-white px-2 py-1 text-[11px] text-stone-600 max-w-[140px]"
                              title="Link to an existing kitchen item instead"
                            >
                              <option value="">Link existing…</option>
                              {items.map((it) => (
                                <option key={it.id} value={it.id}>
                                  {it.name}
                                </option>
                              ))}
                            </select>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              setParsedIngredients((prev) => prev.filter((r) => r.id !== ing.id))
                            }
                            className="p-1.5 rounded-lg text-stone-400 hover:text-rose-600 hover:bg-rose-50"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Name + Alias */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input
                          dir="auto"
                          value={ing.name}
                          onChange={(e) => updateIngredient(ing.id, { name: e.target.value })}
                          placeholder="Ingredient name (EN)"
                          className="rounded-xl border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-semibold"
                        />
                        <input
                          dir="auto"
                          value={ing.alias}
                          onChange={(e) => updateIngredient(ing.id, { alias: e.target.value })}
                          placeholder="Persian alias (مثلاً قارچ)"
                          className="rounded-xl border border-stone-200 bg-white px-2.5 py-1.5 text-xs text-teal-800"
                        />
                      </div>

                      {/* Recipe Amount + Kitchen Item Defaults */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <div>
                          <label className="block text-[10px] font-semibold text-stone-500 mb-0.5">
                            Used / Serving
                          </label>
                          <input
                            type="number"
                            step="0.25"
                            min="0.25"
                            value={ing.portionsNeeded}
                            onChange={(e) =>
                              updateIngredient(ing.id, {
                                portionsNeeded: Math.max(0.25, Number(e.target.value) || 0.25),
                              })
                            }
                            className="w-full rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs font-bold"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-stone-500 mb-0.5">
                            Unit / Amount
                          </label>
                          <input
                            dir="auto"
                            value={ing.portionLabel}
                            onChange={(e) =>
                              updateIngredient(ing.id, { portionLabel: e.target.value })
                            }
                            className="w-full rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-stone-500 mb-0.5">
                            Category
                          </label>
                          <select
                            value={ing.suggestedCategory}
                            onChange={(e) => {
                              const nextCat = e.target.value as FoodCategory;
                              const prof = getCategoryProfile(nextCat);
                              updateIngredient(ing.id, {
                                suggestedCategory: nextCat,
                                suggestedZone: prof.defaultZone,
                                suggestedTrackingMode: prof.defaultTrackingMode,
                              });
                            }}
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
                          <label className="block text-[10px] font-semibold text-stone-500 mb-0.5">
                            Zone
                          </label>
                          <select
                            value={ing.suggestedZone}
                            onChange={(e) =>
                              updateIngredient(ing.id, {
                                suggestedZone: e.target.value as StorageZone,
                              })
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

                      {/* Additional Kitchen Creation Options when confirmed */}
                      {ing.confirmCreateInKitchen && (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1 border-t border-amber-200/70">
                          <div>
                            <label className="block text-[10px] font-semibold text-stone-500 mb-0.5">
                              Tracking Style
                            </label>
                            <select
                              value={ing.suggestedTrackingMode}
                              onChange={(e) =>
                                updateIngredient(ing.id, {
                                  suggestedTrackingMode: e.target.value as TrackingMode,
                                })
                              }
                              className="w-full rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs"
                            >
                              <option value="portioned">Count / Portions</option>
                              <option value="continuous">Continuous / Level</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-[10px] font-semibold text-stone-500 mb-0.5">
                              Store
                            </label>
                            <select
                              value={ing.storeId}
                              onChange={(e) => updateIngredient(ing.id, { storeId: e.target.value })}
                              className="w-full rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs"
                            >
                              {stores.map((st) => (
                                <option key={st.id} value={st.id}>
                                  {st.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="col-span-2 sm:col-span-1">
                            <label className="block text-[10px] font-semibold text-stone-500 mb-0.5">
                              In Stock Now?
                            </label>
                            <div className="grid grid-cols-2 gap-1">
                              <button
                                type="button"
                                onClick={() =>
                                  updateIngredient(ing.id, {
                                    initialInStock: false,
                                    initialStockCount: 0,
                                  })
                                }
                                className={`py-1 rounded-lg text-[11px] font-semibold border transition ${
                                  !ing.initialInStock
                                    ? 'bg-stone-900 text-white border-stone-900'
                                    : 'bg-white text-stone-600 border-stone-200'
                                }`}
                              >
                                Out (0)
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const prof = getCategoryProfile(ing.suggestedCategory);
                                  updateIngredient(ing.id, {
                                    initialInStock: true,
                                    initialStockCount: prof.defaultPortionCount,
                                  });
                                }}
                                className={`py-1 rounded-lg text-[11px] font-semibold border transition ${
                                  ing.initialInStock
                                    ? 'bg-teal-700 text-white border-teal-700'
                                    : 'bg-white text-stone-600 border-stone-200'
                                }`}
                              >
                                Have it
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Step 2 Footer */}
            <div className="flex items-center justify-between gap-2 pt-3 border-t border-stone-100">
              <button
                type="button"
                onClick={() => setStep('record')}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-stone-600 hover:bg-stone-100"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back / Re-record
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold text-stone-500 hover:bg-stone-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!foodName.trim()}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-teal-700 hover:bg-teal-800 disabled:opacity-40 text-white px-4 py-2.5 text-xs font-bold shadow-xs transition"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {confirmedNewCount > 0
                    ? `Confirm & Create ${confirmedNewCount} Item${confirmedNewCount === 1 ? '' : 's'} + Save Food`
                    : 'Save Food to Library'}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
