import React from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Barcode,
  ChefHat,
  CheckCircle2,
  Layers,
  Refrigerator,
  Settings,
  ShoppingCart,
  Sparkles,
  X,
} from 'lucide-react';
import { UIMode } from '../types/kitchen';

export type TourTabId = 'kitchen' | 'shopping' | 'meals' | 'settings';

export interface TourStepDef {
  id: string;
  tab: TourTabId;
  uiMode: UIMode;
  badge: string;
  title: string;
  subtitle: string;
  bullets: string[];
  icon: React.ReactNode;
}

export const TOUR_STEPS: TourStepDef[] = [
  {
    id: 'kitchen-basics',
    tab: 'kitchen',
    uiMode: 'simple',
    badge: 'Kitchen • Simple Mode',
    title: 'Zero-Stress Everyday Tracking',
    subtitle: 'Track Fridge, Freezer, and Pantry staples in English & Persian — in one tap.',
    bullets: [
      'Pick Solo (1×), Together (2×), or Guests at the top so every tap deducts the right servings.',
      'Use the quick 100%–25% level bar for items like milk & greens, or tap Finished to auto-add to Shopping.',
      'Tap + Shop on any item anytime to add it manually while keeping a note of what you still have.',
    ],
    icon: <Refrigerator className="w-4 h-4" />,
  },
  {
    id: 'scanning',
    tab: 'kitchen',
    uiMode: 'simple',
    badge: 'Fast Entry • Barcode & Receipt',
    title: 'Add Items & Restock in Seconds',
    subtitle: 'Skip tedious typing when unpacking groceries.',
    bullets: [
      'Tap + Add Item → opens the Barcode Scanner first (free live Open Food Facts lookup) with a 1-tap Skip option.',
      'Tap Scan Receipt after a Costco or Superstore run → auto-matches existing items, updates stock & clears Shopping.',
    ],
    icon: <Barcode className="w-4 h-4" />,
  },
  {
    id: 'detailed-nutrition',
    tab: 'kitchen',
    uiMode: 'detailed',
    badge: 'Simple vs. Detailed Mode',
    title: 'Dig Into Nutrition Only When You Want',
    subtitle: 'We just switched the preview to Detailed Mode so you can see full macros & micronutrients.',
    bullets: [
      'Tracks Protein, Sugar, Fiber, Calories, and % DV Micronutrients (Iron, Calcium, Vit D, Vit C, Omega-3).',
      'Tap the camera icon on any card to scan a barcode or snap its Nutrition Facts label.',
      'Flip back to Simple Mode in the header anytime for a calm, clutter-free daily view.',
    ],
    icon: <Layers className="w-4 h-4" />,
  },
  {
    id: 'shopping-forecast',
    tab: 'shopping',
    uiMode: 'detailed',
    badge: 'Weekend Shopping & Forecasting',
    title: 'Know Exactly Which Stores You Need',
    subtitle: 'KitchenFlow learns how fast staples run out and which store you buy them from.',
    bullets: [
      'Top banner tells you which stores have essential items this weekend vs. skippable optional stops.',
      'Catches items that survive the weekend but will run out mid-week next week (like Lean Ground Beef above).',
      'Manual adds from Kitchen clearly show how much you still have at home; Radar highlights items under 10 days left.',
    ],
    icon: <ShoppingCart className="w-4 h-4" />,
  },
  {
    id: 'meals-library',
    tab: 'meals',
    uiMode: 'detailed',
    badge: 'Meal Plan & Food Library',
    title: 'Healthy High-Protein Meals From Your Stock',
    subtitle: 'Decide a single meal right now or plan 3, 5, or 7 days around your tools & ingredients.',
    bullets: [
      'Pick cooking tools (Air Fryer, Oven, Pan + extras) and tap ingredients to Must Use or Skip.',
      'Use Ask Gemini AI for fresh ideas, or search your Food Library and filter by All Ingredients In Stock.',
      'Tap Cooked & Deduct (1× / 2× / +) on any planned or library meal to deduct exact ingredient amounts automatically.',
    ],
    icon: <ChefHat className="w-4 h-4" />,
  },
  {
    id: 'settings-sync',
    tab: 'settings',
    uiMode: 'simple',
    badge: 'Settings & 2-Phone Auto-Sync',
    title: 'Tailored to Your Household, Synced Live',
    subtitle: 'Every change auto-saves and syncs in real time between Ali & Keemia.',
    bullets: [
      'Customize store colors, shopping day, 10-day Forecast Radar horizon, and Protein / Sugar targets.',
      'Edit any item’s Learned Cycle, Burn Rate, or Learned Store inline right in the table.',
      'You can replay this interactive demo tour anytime from Settings!',
    ],
    icon: <Settings className="w-4 h-4" />,
  },
];

interface FeatureTourProps {
  stepIndex: number;
  onChangeStep: (nextIndex: number) => void;
  onFinish: () => void;
}

export const FeatureTour: React.FC<FeatureTourProps> = ({
  stepIndex,
  onChangeStep,
  onFinish,
}) => {
  const step = TOUR_STEPS[stepIndex] || TOUR_STEPS[0];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === TOUR_STEPS.length - 1;

  return (
    <>
      {/* Top Preview Indicator Ribbon */}
      <div className="sticky top-16 z-30 bg-indigo-950 text-white px-3 py-1.5 text-[11px] font-medium flex items-center justify-between gap-2 shadow-sm">
        <div className="flex items-center gap-1.5 min-w-0">
          <Sparkles className="w-3.5 h-3.5 text-teal-300 shrink-0" />
          <span className="truncate">
            <strong>Interactive Tour Preview</strong> — showing realistic sample data (your real kitchen is untouched)
          </span>
        </div>
        <button
          type="button"
          onClick={onFinish}
          className="text-[11px] font-bold text-teal-300 hover:text-white whitespace-nowrap shrink-0 underline underline-offset-2"
        >
          Exit Tour
        </button>
      </div>

      {/* Floating Tour Guide Card — Positioned Safely Above Mobile Bottom Nav */}
      <div className="fixed z-40 inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] lg:bottom-6 lg:left-auto lg:right-6 lg:w-[420px]">
        <div className="rounded-3xl bg-stone-950/95 backdrop-blur-md text-white shadow-2xl border border-stone-800 p-4 sm:p-5 space-y-3">
          {/* Progress & Close */}
          <div className="flex items-center justify-between gap-2">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-teal-500/20 text-teal-300 text-[11px] font-bold">
              {step.icon}
              <span>{step.badge}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-stone-400">
                {stepIndex + 1} / {TOUR_STEPS.length}
              </span>
              <button
                type="button"
                onClick={onFinish}
                className="p-1 rounded-full text-stone-400 hover:text-white hover:bg-white/10"
                aria-label="Skip tour"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Progress Dots */}
          <div className="flex items-center gap-1">
            {TOUR_STEPS.map((s, idx) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onChangeStep(idx)}
                aria-label={`Go to step ${idx + 1}`}
                className={`h-1.5 rounded-full transition-all ${
                  idx === stepIndex
                    ? 'flex-[2] bg-teal-400'
                    : idx < stepIndex
                    ? 'flex-1 bg-teal-700'
                    : 'flex-1 bg-stone-700'
                }`}
              />
            ))}
          </div>

          {/* Copy */}
          <div>
            <h3 className="text-sm sm:text-base font-bold text-white leading-snug">{step.title}</h3>
            <p className="text-xs text-stone-300 mt-0.5">{step.subtitle}</p>
          </div>

          <ul className="space-y-1.5 text-xs text-stone-200">
            {step.bullets.map((b, i) => (
              <li key={i} className="flex items-start gap-2 leading-relaxed">
                <span className="w-1.5 h-1.5 rounded-full bg-teal-400 shrink-0 mt-1.5" />
                <span>{b}</span>
              </li>
            ))}
          </ul>

          {/* Controls */}
          <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/10">
            {isFirst ? (
              <button
                type="button"
                onClick={onFinish}
                className="px-3 py-2 rounded-xl text-xs font-semibold text-stone-400 hover:text-white"
              >
                Skip Tour
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onChangeStep(stepIndex - 1)}
                className="inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-semibold text-stone-300 hover:bg-white/10"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back
              </button>
            )}

            {isLast ? (
              <button
                type="button"
                onClick={onFinish}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-teal-500 hover:bg-teal-400 text-stone-950 text-xs font-bold shadow-sm transition"
              >
                <CheckCircle2 className="w-4 h-4" />
                Start Using My Kitchen
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onChangeStep(stepIndex + 1)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-teal-500 hover:bg-teal-400 text-stone-950 text-xs font-bold shadow-sm transition"
              >
                Next
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
};
