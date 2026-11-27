import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Loader2,
  Mic,
  Minus,
  Plus,
  ShoppingCart,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import {
  FoodCategory,
  InventoryItem,
  StorageZone,
  Store,
  TrackingMode,
} from '../types/kitchen';
import { CATEGORY_META, ZONE_META } from '../i18n/translations';
import { getLearnedStoreId } from '../utils/forecasting';
import { CONTINUOUS_LEVEL_PRESETS } from '../utils/inventoryDisplay';
import {
  getCategoryProfile,
  PRODUCT_CATEGORY_ORDER,
} from '../utils/productCategories';
import {
  buildProposedUpdateForItem,
  computeBeforeAfterSummary,
  parseKitchenVoiceUpdateLocally,
  ProposedInventoryUpdate,
  VoiceInventoryAction,
  VoiceInventoryParseResult,
} from '../utils/voiceInventoryParser';
import { parseKitchenVoiceUpdateWithGemini } from '../services/geminiEdge';

interface VoiceInventoryModalProps {
  items: InventoryItem[];
  stores: Store[];
  onClose: () => void;
  onConfirmApply: (updates: ProposedInventoryUpdate[]) => void;
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

const EXAMPLES: { label: string; lang: 'en' | 'fa'; text: string }[] = [
  {
    label: 'EN: Used + Finished',
    lang: 'en',
    text: 'I used 3 eggs, half the baby spinach, and the milk is finished',
  },
  {
    label: 'فارسی: مصرف + تموم شد',
    lang: 'fa',
    text: '۳ تا تخم‌مرغ و نصف اسفناج رو مصرف کردم، شیر هم تموم شد',
  },
  {
    label: 'EN: Restock',
    lang: 'en',
    text: 'Bought 1 jug of milk and chicken breast from Costco',
  },
];

const ACTION_BADGE: Record<
  VoiceInventoryAction,
  { label: string; cls: string }
> = {
  use: { label: 'Used', cls: 'bg-teal-50 text-teal-800 border-teal-200' },
  finish: { label: 'Finished', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  set_level: { label: 'Set Level', cls: 'bg-sky-50 text-sky-800 border-sky-200' },
  restock: { label: 'Restocked', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  add_new: { label: 'New Item', cls: 'bg-indigo-50 text-indigo-800 border-indigo-200' },
};

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

export const VoiceInventoryModal: React.FC<VoiceInventoryModalProps> = ({
  items,
  stores,
  onClose,
  onConfirmApply,
}) => {
  const defaultStoreId = stores[0]?.id ?? 'store-superstore';

  const [step, setStep] = useState<'record' | 'confirm'>('record');
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
  const [updates, setUpdates] = useState<ProposedInventoryUpdate[]>([]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const timerRef = useRef<number | null>(null);
  const transcriptRef = useRef(transcript);
  transcriptRef.current = transcript;

  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const storeMap = useMemo(() => new Map(stores.map((s) => [s.id, s])), [stores]);

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => a.name.localeCompare(b.name)),
    [items]
  );

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

  const populateConfirm = (parsed: VoiceInventoryParseResult) => {
    setTranscript(parsed.transcript || transcriptRef.current);
    setUpdates(parsed.updates);
    if (parsed.updates.length === 0) {
      setErrorMsg(
        'No specific kitchen items were detected. Try mentioning item names and amounts (e.g. "used 3 eggs" or "شیر تموم شد").'
      );
      return;
    }
    if (parsed.source === 'local_fallback') {
      setInfoNotice(
        'Parsed with built-in bilingual matcher — check the Before → After amounts below before confirming.'
      );
    } else if (parsed.source === 'gemini_audio') {
      setInfoNotice(
        'Transcribed & calculated with Gemini AI (EN/FA) — review Before → After amounts before confirming.'
      );
    } else {
      setInfoNotice(
        'Parsed with Gemini AI — review Before → After amounts below before confirming.'
      );
    }
    setStep('confirm');
  };

  const runAnalysis = async (blobOverride?: Blob | null, textOverride?: string) => {
    const activeBlob = blobOverride !== undefined ? blobOverride : recordedBlob;
    const activeText = (textOverride !== undefined ? textOverride : transcriptRef.current).trim();

    if (!activeBlob && !activeText) {
      setErrorMsg('Please record your voice or type/dictate your kitchen update first.');
      return;
    }

    setIsAnalyzing(true);
    setErrorMsg(null);
    setInfoNotice(null);

    try {
      const parsed = await parseKitchenVoiceUpdateWithGemini({
        audioBlob: activeBlob,
        transcript: activeText,
        languageHint: voiceLang,
        inventory: items,
        stores,
      });
      populateConfirm(parsed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Voice analysis failed';
      if (activeText) {
        const local = parseKitchenVoiceUpdateLocally(activeText, items, stores);
        if (local.updates.length > 0) {
          populateConfirm(local);
          setInfoNotice(
            `Gemini AI unavailable (${msg}) — parsed offline instead. Please verify Before → After amounts below.`
          );
        } else {
          setErrorMsg(
            `Gemini AI unavailable (${msg}) and no matching kitchen items were found offline. Check item spelling or try again.`
          );
        }
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

    let gotAudioRecorder = false;

    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef.current = stream;
        const mime = pickSupportedAudioMime();
        const recorder = mime
          ? new MediaRecorder(stream, { mimeType: mime })
          : new MediaRecorder(stream);
        mediaRecorderRef.current = recorder;

        recorder.ondataavailable = (ev) => {
          if (ev.data && ev.data.size > 0) {
            audioChunksRef.current.push(ev.data);
          }
        };
        recorder.onstop = () => {
          if (audioChunksRef.current.length > 0) {
            const blob = new Blob(audioChunksRef.current, {
              type: recorder.mimeType || 'audio/webm',
            });
            setRecordedBlob(blob);
          }
        };
        recorder.start(250);
        gotAudioRecorder = true;
      } catch {
        // Fall through to Web Speech API
      }
    }

    const win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionInstance;
      webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
    };
    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;
    let gotSpeechApi = false;

    if (SpeechRec) {
      try {
        const recognition = new SpeechRec();
        recognition.lang = voiceLang === 'fa' ? 'fa-IR' : 'en-US';
        recognition.continuous = true;
        recognition.interimResults = true;
        const baseText = transcriptRef.current.trim();

        recognition.onresult = (event) => {
          let combined = '';
          for (let i = 0; i < event.results.length; i++) {
            combined += event.results[i][0].transcript;
          }
          const next = baseText ? `${baseText} ${combined.trim()}` : combined.trim();
          setTranscript(next);
        };
        recognition.onerror = () => {
          // Keep audio recorder alive if SpeechRecognition fails
        };
        recognition.start();
        recognitionRef.current = recognition;
        gotSpeechApi = true;
      } catch {
        // Ignore if SpeechRecognition cannot start alongside MediaRecorder
      }
    }

    if (!gotAudioRecorder && !gotSpeechApi) {
      setErrorMsg(
        'Microphone access was blocked or unsupported in this browser. You can still type or use your phone keyboard mic below.'
      );
      return;
    }

    setIsRecording(true);
    timerRef.current = window.setInterval(() => {
      setRecordSeconds((s) => s + 1);
    }, 1000);
  };

  const stopRecordingAndAnalyze = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = () => {
        const blob =
          audioChunksRef.current.length > 0
            ? new Blob(audioChunksRef.current, {
                type: recorder.mimeType || 'audio/webm',
              })
            : null;
        setRecordedBlob(blob);
        void runAnalysis(blob, transcriptRef.current);
      };
      stopAllCapture();
    } else {
      stopAllCapture();
      void runAnalysis(recordedBlob, transcriptRef.current);
    }
  };

  const updateRow = (
    id: string,
    updater: (u: ProposedInventoryUpdate) => ProposedInventoryUpdate
  ) => {
    setUpdates((prev) => prev.map((u) => (u.id === id ? updater(u) : u)));
  };

  const handleChangeLinkedItem = (rowId: string, nextItemId: string) => {
    updateRow(rowId, (row) => {
      if (!nextItemId) {
        return {
          ...row,
          matchedItemId: undefined,
          action: 'add_new',
          targetRemainingPortions: Math.max(1, row.initialTotalPortions || 1),
          deltaPortions: Math.max(1, row.initialTotalPortions || 1),
          reason: 'Create as new item',
        };
      }
      const target = itemMap.get(nextItemId);
      if (!target) return row;
      const nextAction: VoiceInventoryAction =
        row.action === 'add_new' ? 'use' : row.action;
      return buildProposedUpdateForItem({
        id: row.id,
        spokenText: row.spokenText,
        action: nextAction,
        item: target,
        storeId: row.storeId,
        reason: row.reason,
      });
    });
  };

  const handleChangeAction = (rowId: string, nextAction: VoiceInventoryAction) => {
    updateRow(rowId, (row) => {
      if (nextAction === 'add_new') {
        return {
          ...row,
          action: 'add_new',
          matchedItemId: undefined,
          targetRemainingPortions: Math.max(1, row.initialTotalPortions || 4),
          deltaPortions: Math.max(1, row.initialTotalPortions || 4),
          reason: 'New item to add',
        };
      }
      const existing = row.matchedItemId ? itemMap.get(row.matchedItemId) : undefined;
      if (!existing) {
        return { ...row, action: nextAction };
      }
      return buildProposedUpdateForItem({
        id: row.id,
        spokenText: row.spokenText,
        action: nextAction,
        item: existing,
        storeId: row.storeId,
      });
    });
  };

  const handleSetTargetRemaining = (
    rowId: string,
    nextRemaining: number,
    existing?: InventoryItem
  ) => {
    const safe = Math.max(0, Number(nextRemaining.toFixed(2)));
    updateRow(rowId, (row) => {
      const baseRem = existing ? existing.remainingPortions : 0;
      const delta = Number((safe - baseRem).toFixed(2));
      const targetPercent =
        existing && existing.trackingMode === 'continuous' && existing.totalPortions > 0
          ? Math.round((safe / existing.totalPortions) * 100)
          : row.targetPercent;
      const derivedAction: VoiceInventoryAction =
        !existing || row.action === 'add_new'
          ? 'add_new'
          : safe === 0
          ? 'finish'
          : delta > 0
          ? 'restock'
          : row.action === 'finish'
          ? 'use'
          : row.action;

      return {
        ...row,
        action: derivedAction,
        targetRemainingPortions: safe,
        targetPercent,
        deltaPortions: delta,
        initialTotalPortions:
          !existing || row.action === 'add_new' ? Math.max(1, safe) : row.initialTotalPortions,
      };
    });
  };

  const handleSetContinuousPercent = (
    rowId: string,
    pct: number,
    existing: InventoryItem
  ) => {
    const clamped = Math.max(0, Math.min(200, Math.round(pct)));
    const nextRem =
      clamped === 0
        ? 0
        : Math.max(0.01, Number(((existing.totalPortions * clamped) / 100).toFixed(2)));
    handleSetTargetRemaining(rowId, nextRem, existing);
  };

  const handleAddManualRow = () => {
    const firstItem = sortedItems[0];
    if (firstItem) {
      setUpdates((prev) => [
        ...prev,
        buildProposedUpdateForItem({
          id: `vupd-manual-${Date.now()}`,
          spokenText: 'Added manually',
          action: 'use',
          item: firstItem,
        }),
      ]);
    } else {
      const prof = getCategoryProfile('produce');
      setUpdates((prev) => [
        ...prev,
        {
          id: `vupd-manual-${Date.now()}`,
          spokenText: 'Added manually',
          action: 'add_new',
          name: '',
          alias: '',
          targetRemainingPortions: prof.defaultPortionCount,
          deltaPortions: prof.defaultPortionCount,
          storeId: defaultStoreId,
          reason: 'New kitchen item',
          included: true,
          suggestedCategory: 'produce',
          suggestedZone: prof.defaultZone,
          suggestedTrackingMode: prof.defaultTrackingMode,
          suggestedPackDescription: `${prof.defaultPortionCount} × ${prof.defaultPortionLabel}`,
          initialTotalPortions: prof.defaultPortionCount,
          portionLabel: prof.defaultPortionLabel,
        },
      ]);
    }
  };

  const includedUpdates = updates.filter((u) => {
    if (!u.included) return false;
    if (u.action === 'add_new' && !u.name.trim()) return false;
    return true;
  });

  const handleConfirm = () => {
    if (includedUpdates.length === 0) return;
    onConfirmApply(includedUpdates);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-stone-900/55 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-2xl rounded-t-3xl sm:rounded-3xl shadow-2xl border border-stone-200 max-h-[92dvh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-stone-100 flex items-center justify-between gap-3 bg-gradient-to-r from-indigo-50/80 via-white to-teal-50/70">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-xs">
              <Mic className="w-4.5 h-4.5" />
            </div>
            <div className="min-w-0">
              <h2 className="font-bold text-stone-900 text-base leading-tight">
                {step === 'record' ? 'Voice Kitchen Update' : 'Confirm Stock Updates'}
              </h2>
              <p className="text-[11px] text-stone-500">
                {step === 'record'
                  ? 'Speak or type in English or فارسی — nothing changes until you confirm'
                  : 'Review exact Before → After amounts before applying to your Kitchen'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              stopAllCapture();
              onClose();
            }}
            className="p-2 rounded-xl text-stone-400 hover:text-stone-700 hover:bg-stone-100 shrink-0"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {errorMsg && (
            <div className="rounded-xl bg-rose-50 border border-rose-200 px-3.5 py-2.5 text-xs text-rose-800 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
              <span>{errorMsg}</span>
            </div>
          )}

          {infoNotice && (
            <div className="rounded-xl bg-indigo-50/70 border border-indigo-200 px-3.5 py-2.5 text-xs text-indigo-900 flex items-start gap-2">
              <Sparkles className="w-4 h-4 shrink-0 mt-0.5 text-indigo-600" />
              <span>{infoNotice}</span>
            </div>
          )}

          {step === 'record' ? (
            <div className="space-y-4">
              {/* Language Selector */}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-xs font-semibold text-stone-600">
                  Spoken language
                </span>
                <div className="inline-flex items-center rounded-xl bg-stone-100 p-0.5 text-xs font-semibold">
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
                      onClick={() => handleSetVoiceLang(opt.id)}
                      className={`px-3 py-1 rounded-lg transition ${
                        voiceLang === opt.id
                          ? 'bg-white text-indigo-800 shadow-2xs'
                          : 'text-stone-600 hover:text-stone-900'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Microphone Capture Card */}
              <div className="rounded-2xl border border-stone-200 bg-stone-50/70 p-5 flex flex-col items-center text-center gap-3">
                {isRecording ? (
                  <>
                    <button
                      type="button"
                      onClick={stopRecordingAndAnalyze}
                      className="w-16 h-16 rounded-full bg-rose-600 hover:bg-rose-700 text-white flex items-center justify-center shadow-lg ring-8 ring-rose-100 transition animate-pulse"
                      aria-label="Stop recording and analyze"
                    >
                      <Square className="w-6 h-6 fill-current" />
                    </button>
                    <div>
                      <p className="text-sm font-bold text-rose-700">
                        Listening… {formatTimer(recordSeconds)}
                      </p>
                      <p className="text-xs text-stone-500 mt-0.5">
                        Tap stop when finished — we’ll show every Before → After change first
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={startRecording}
                      disabled={isAnalyzing}
                      className="w-16 h-16 rounded-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white flex items-center justify-center shadow-md ring-8 ring-indigo-50 transition"
                      aria-label="Start voice recording"
                    >
                      <Mic className="w-7 h-7" />
                    </button>
                    <div>
                      <p className="text-sm font-bold text-stone-800">
                        Tap to speak your kitchen update
                      </p>
                      <p className="text-xs text-stone-500 mt-0.5">
                        Say what you used, finished, how much is left, or what you bought
                      </p>
                    </div>
                  </>
                )}

                {recordedBlob && !isRecording && (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Voice clip ready ({Math.max(1, Math.round(recordedBlob.size / 1024))} KB)
                  </span>
                )}
              </div>

              {/* Editable Transcript / Type Box */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-stone-600 block">
                  Or type / edit your update (English or فارسی)
                </label>
                <textarea
                  dir="auto"
                  rows={3}
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  placeholder='e.g. "I used 3 eggs, half the baby spinach, and milk is finished" or "۳ تا تخم‌مرغ مصرف کردم، شیر تموم شد"'
                  className="w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* Quick Example Chips */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-semibold text-stone-400 uppercase tracking-wide">
                  Try an example
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {EXAMPLES.map((ex) => (
                    <button
                      key={ex.label}
                      type="button"
                      onClick={() => {
                        setTranscript(ex.text);
                        handleSetVoiceLang(ex.lang);
                        setErrorMsg(null);
                      }}
                      className="text-xs font-medium px-2.5 py-1 rounded-lg bg-stone-100 hover:bg-indigo-50 hover:text-indigo-800 text-stone-600 border border-stone-200/80 transition"
                    >
                      {ex.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            /* STEP 2: Mandatory BEFORE -> AFTER Confirmation */
            <div className="space-y-3.5">
              {/* Recognized Transcript Pill */}
              {transcript && (
                <div className="rounded-xl bg-stone-50 border border-stone-200 px-3.5 py-2.5 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-stone-400 block">
                      What we heard
                    </span>
                    <p dir="auto" className="text-xs text-stone-800 mt-0.5 leading-relaxed">
                      “{transcript}”
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setStep('record');
                      setErrorMsg(null);
                    }}
                    className="shrink-0 text-[11px] font-semibold text-indigo-700 hover:text-indigo-900 px-2 py-1 rounded-lg hover:bg-indigo-50"
                  >
                    Edit text
                  </button>
                </div>
              )}

              {/* Proposed Updates List */}
              <div className="space-y-3">
                {updates.map((upd) => {
                  const existing = upd.matchedItemId
                    ? itemMap.get(upd.matchedItemId)
                    : undefined;
                  const preview = computeBeforeAfterSummary(upd, existing);
                  const badge = ACTION_BADGE[upd.action];
                  const autoAddStore = existing
                    ? storeMap.get(getLearnedStoreId(existing))?.name ?? 'Shopping List'
                    : '';

                  return (
                    <div
                      key={upd.id}
                      className={`rounded-2xl border p-3.5 space-y-3 transition ${
                        upd.included
                          ? 'bg-white border-stone-200 shadow-2xs'
                          : 'bg-stone-50/70 border-stone-200/60 opacity-60'
                      }`}
                    >
                      {/* Top Row: Include Checkbox + Action + Linked Item + Delete */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2.5 min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={() =>
                              updateRow(upd.id, (r) => ({ ...r, included: !r.included }))
                            }
                            className={`mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition ${
                              upd.included
                                ? 'bg-teal-700 border-teal-700 text-white'
                                : 'bg-white border-stone-300 text-transparent'
                            }`}
                            aria-label={`Toggle ${upd.name}`}
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>

                          <div className="min-w-0 flex-1 space-y-1.5">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold border ${badge.cls}`}
                              >
                                {badge.label}
                              </span>
                              <span dir="auto" className="text-[11px] text-stone-500 truncate">
                                “{upd.spokenText}”
                              </span>
                            </div>

                            {/* Item & Action Selectors */}
                            <div className="flex flex-wrap items-center gap-2">
                              <select
                                value={upd.matchedItemId || ''}
                                onChange={(e) =>
                                  handleChangeLinkedItem(upd.id, e.target.value)
                                }
                                className="flex-1 min-w-[160px] rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1.5 text-xs font-semibold text-stone-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
                                aria-label="Matched kitchen item"
                              >
                                <option value="">+ Create as new item</option>
                                {sortedItems.map((it) => (
                                  <option key={it.id} value={it.id}>
                                    {it.name}
                                    {it.alias ? ` (${it.alias})` : ''}
                                  </option>
                                ))}
                              </select>

                              <select
                                value={upd.action}
                                onChange={(e) =>
                                  handleChangeAction(
                                    upd.id,
                                    e.target.value as VoiceInventoryAction
                                  )
                                }
                                className="rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-xs font-semibold text-stone-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
                                aria-label="Update action"
                              >
                                <option value="use">Used</option>
                                <option value="finish">Finished (Empty)</option>
                                <option value="set_level">Set Level</option>
                                <option value="restock">Restocked</option>
                                <option value="add_new">New Item</option>
                              </select>
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            setUpdates((prev) => prev.filter((r) => r.id !== upd.id))
                          }
                          className="p-1.5 rounded-lg text-stone-400 hover:text-rose-600 hover:bg-rose-50 shrink-0"
                          title="Remove this update"
                          aria-label="Remove update"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Prominent BEFORE -> AFTER Comparison Box */}
                      <div className="rounded-xl bg-stone-50 border border-stone-200/80 p-3">
                        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                          <div className="min-w-0">
                            <span className="text-[10px] font-bold uppercase tracking-wide text-stone-400 block">
                              Before
                            </span>
                            <p className="text-xs sm:text-sm font-semibold text-stone-600 truncate">
                              {preview.beforeText}
                            </p>
                          </div>

                          <div className="flex flex-col items-center gap-0.5 px-1">
                            <ArrowRight className="w-4 h-4 text-stone-400" />
                            <span
                              className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap ${
                                upd.action === 'restock' || upd.action === 'add_new'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : upd.targetRemainingPortions === 0
                                  ? 'bg-rose-100 text-rose-700'
                                  : 'bg-teal-100 text-teal-800'
                              }`}
                            >
                              {preview.deltaLabel}
                            </span>
                          </div>

                          <div className="min-w-0 text-right">
                            <span className="text-[10px] font-bold uppercase tracking-wide text-teal-700 block">
                              After
                            </span>
                            <p className="text-xs sm:text-sm font-bold text-stone-900 truncate">
                              {preview.afterText}
                            </p>
                          </div>
                        </div>

                        {preview.willAutoAddToShopping && (
                          <div className="mt-2 pt-2 border-t border-stone-200/70 flex items-center gap-1.5 text-[11px] font-semibold text-amber-800">
                            <ShoppingCart className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                            <span>Will auto-add to {autoAddStore}</span>
                          </div>
                        )}
                      </div>

                      {/* Inline Quick Adjustment Controls */}
                      {upd.included && existing && upd.action !== 'add_new' && (
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                          {existing.trackingMode === 'continuous' ? (
                            <div className="flex items-center gap-1 flex-wrap w-full">
                              <span className="text-[11px] font-semibold text-stone-500 mr-1">
                                Adjust After:
                              </span>
                              <button
                                type="button"
                                onClick={() => handleSetContinuousPercent(upd.id, 0, existing)}
                                className={`px-2 py-1 rounded-lg text-[11px] font-bold border transition ${
                                  upd.targetRemainingPortions === 0
                                    ? 'bg-rose-600 text-white border-rose-600'
                                    : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-100'
                                }`}
                              >
                                Empty
                              </button>
                              {CONTINUOUS_LEVEL_PRESETS.map((preset) => {
                                const currentPct =
                                  existing.totalPortions > 0
                                    ? Math.round(
                                        (upd.targetRemainingPortions / existing.totalPortions) * 100
                                      )
                                    : 0;
                                const isActive =
                                  upd.targetRemainingPortions > 0 &&
                                  Math.abs(currentPct - preset.pct) <= 4;
                                return (
                                  <button
                                    key={preset.pct}
                                    type="button"
                                    onClick={() =>
                                      handleSetContinuousPercent(upd.id, preset.pct, existing)
                                    }
                                    className={`px-2 py-1 rounded-lg text-[11px] font-bold border transition ${
                                      isActive
                                        ? 'bg-stone-900 text-white border-stone-900'
                                        : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-100'
                                    }`}
                                  >
                                    {preset.shortLabel}
                                  </button>
                                );
                              })}
                              <div className="ml-auto inline-flex items-center gap-1">
                                <input
                                  type="number"
                                  min={0}
                                  max={200}
                                  step={5}
                                  value={
                                    existing.totalPortions > 0
                                      ? Math.round(
                                          (upd.targetRemainingPortions / existing.totalPortions) *
                                            100
                                        )
                                      : 0
                                  }
                                  onChange={(e) =>
                                    handleSetContinuousPercent(
                                      upd.id,
                                      Number(e.target.value) || 0,
                                      existing
                                    )
                                  }
                                  className="w-14 rounded-lg border border-stone-200 px-2 py-1 text-xs font-bold text-right text-stone-800"
                                  aria-label={`After percentage for ${existing.name}`}
                                />
                                <span className="text-[11px] font-semibold text-stone-500">%</span>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between gap-2 w-full flex-wrap">
                              <span className="text-[11px] font-semibold text-stone-500">
                                Adjust After ({existing.portionLabel}):
                              </span>
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleSetTargetRemaining(
                                      upd.id,
                                      Math.max(0, upd.targetRemainingPortions - 1),
                                      existing
                                    )
                                  }
                                  className="w-7 h-7 rounded-lg border border-stone-200 bg-white hover:bg-stone-100 flex items-center justify-center text-stone-700"
                                  aria-label="Decrease after amount"
                                >
                                  <Minus className="w-3.5 h-3.5" />
                                </button>
                                <input
                                  type="number"
                                  min={0}
                                  step={0.5}
                                  value={upd.targetRemainingPortions}
                                  onChange={(e) =>
                                    handleSetTargetRemaining(
                                      upd.id,
                                      Math.max(0, Number(e.target.value) || 0),
                                      existing
                                    )
                                  }
                                  className="w-16 rounded-lg border border-stone-200 px-2 py-1 text-xs font-bold text-center text-stone-900"
                                  aria-label={`After amount for ${existing.name}`}
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleSetTargetRemaining(
                                      upd.id,
                                      upd.targetRemainingPortions + 1,
                                      existing
                                    )
                                  }
                                  className="w-7 h-7 rounded-lg border border-stone-200 bg-white hover:bg-stone-100 flex items-center justify-center text-stone-700"
                                  aria-label="Increase after amount"
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleSetTargetRemaining(upd.id, 0, existing)}
                                  className="px-2 py-1 rounded-lg text-[11px] font-semibold border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                                >
                                  0 (Empty)
                                </button>
                              </div>
                            </div>
                          )}

                          {upd.action === 'restock' && stores.length > 0 && (
                            <div className="flex items-center gap-2 text-[11px] w-full pt-1">
                              <span className="font-semibold text-stone-500">Store:</span>
                              <select
                                value={upd.storeId || existing.defaultStoreId || defaultStoreId}
                                onChange={(e) =>
                                  updateRow(upd.id, (r) => ({ ...r, storeId: e.target.value }))
                                }
                                className="rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs font-semibold text-stone-700"
                              >
                                {stores.map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}
                        </div>
                      )}

                      {/* New Item Inline Fields */}
                      {upd.included && (!existing || upd.action === 'add_new') && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                          <input
                            type="text"
                            value={upd.name}
                            onChange={(e) =>
                              updateRow(upd.id, (r) => ({ ...r, name: e.target.value }))
                            }
                            placeholder="English name"
                            className="col-span-2 sm:col-span-2 rounded-lg border border-stone-200 px-2.5 py-1.5 text-xs font-semibold text-stone-900"
                          />
                          <input
                            type="text"
                            dir="auto"
                            value={upd.alias}
                            onChange={(e) =>
                              updateRow(upd.id, (r) => ({ ...r, alias: e.target.value }))
                            }
                            placeholder="نام فارسی (optional)"
                            className="col-span-2 sm:col-span-2 rounded-lg border border-stone-200 px-2.5 py-1.5 text-xs text-stone-800"
                          />
                          <select
                            value={upd.suggestedZone}
                            onChange={(e) =>
                              updateRow(upd.id, (r) => ({
                                ...r,
                                suggestedZone: e.target.value as StorageZone,
                              }))
                            }
                            className="rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-xs font-medium text-stone-700"
                          >
                            {(['fridge', 'freezer', 'pantry'] as StorageZone[]).map((z) => (
                              <option key={z} value={z}>
                                {ZONE_META[z].en}
                              </option>
                            ))}
                          </select>
                          <select
                            value={upd.suggestedCategory}
                            onChange={(e) => {
                              const cat = e.target.value as FoodCategory;
                              const prof = getCategoryProfile(cat);
                              updateRow(upd.id, (r) => ({
                                ...r,
                                suggestedCategory: cat,
                                suggestedTrackingMode: prof.defaultTrackingMode,
                              }));
                            }}
                            className="rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-xs font-medium text-stone-700"
                          >
                            {PRODUCT_CATEGORY_ORDER.map((c) => (
                              <option key={c} value={c}>
                                {CATEGORY_META[c].en}
                              </option>
                            ))}
                          </select>
                          <select
                            value={upd.suggestedTrackingMode}
                            onChange={(e) => {
                              const mode = e.target.value as TrackingMode;
                              updateRow(upd.id, (r) => ({
                                ...r,
                                suggestedTrackingMode: mode,
                                targetRemainingPortions: mode === 'continuous' ? 100 : Math.max(1, r.initialTotalPortions || 4),
                                initialTotalPortions: mode === 'continuous' ? 100 : Math.max(1, r.initialTotalPortions || 4),
                              }));
                            }}
                            className="rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-xs font-medium text-stone-700"
                          >
                            <option value="portioned">Portions</option>
                            <option value="continuous">Fill Level</option>
                          </select>
                          <select
                            value={upd.storeId || defaultStoreId}
                            onChange={(e) =>
                              updateRow(upd.id, (r) => ({ ...r, storeId: e.target.value }))
                            }
                            className="rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-xs font-medium text-stone-700"
                          >
                            {stores.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={handleAddManualRow}
                className="w-full py-2 rounded-xl border border-dashed border-stone-300 text-xs font-semibold text-stone-600 hover:border-teal-400 hover:text-teal-800 hover:bg-teal-50/40 inline-flex items-center justify-center gap-1.5 transition"
              >
                <Plus className="w-3.5 h-3.5" />
                Add another item to this batch
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-stone-100 bg-stone-50/70 flex items-center justify-between gap-2">
          {step === 'record' ? (
            <>
              <button
                type="button"
                onClick={() => {
                  stopAllCapture();
                  onClose();
                }}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-stone-600 hover:bg-stone-200/70"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isAnalyzing || isRecording || (!recordedBlob && !transcript.trim())}
                onClick={() => void runAnalysis()}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs sm:text-sm font-bold shadow-xs transition"
              >
                {isAnalyzing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Understanding…
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Preview Updates
                  </>
                )}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  setStep('record');
                  setErrorMsg(null);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-stone-600 hover:bg-stone-200/70"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back
              </button>
              <button
                type="button"
                disabled={includedUpdates.length === 0}
                onClick={handleConfirm}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-xs sm:text-sm font-bold shadow-xs transition"
              >
                <CheckCircle2 className="w-4 h-4" />
                Confirm & Apply {includedUpdates.length} Update
                {includedUpdates.length === 1 ? '' : 's'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
