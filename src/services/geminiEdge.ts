import {
  CookingTool,
  FoodCategory,
  InventoryItem,
  MealRecipe,
  NutritionFacts,
  ReceiptParsedItem,
  StorageZone,
  Store,
  TrackingMode,
} from '../types/kitchen';
import { MealPlanRequest } from '../utils/mealEngine';
import { matchInventoryItem } from '../utils/scannerSimulation';
import {
  getCategoryProfile,
  inferProductDefaultsFromText,
} from '../utils/productCategories';
import {
  matchVoiceIngredientToKitchen,
  parseVoiceFoodLocally,
  VoiceParsedFood,
  VoiceParsedIngredient,
} from '../utils/voiceFoodParser';
import { isSupabaseConfigured, supabase } from './supabaseClient';

/**
 * Compresses & downscales camera photos client-side (max 1280px JPEG @ 0.78 quality)
 * before sending to Gemini Vision — cuts AI token cost by ~70% and speeds up mobile uploads.
 */
export async function fileToBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  try {
    const bitmap = await createImageBitmap(file);
    const maxDim = 1280;
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(bitmap, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.78);
      const commaIdx = dataUrl.indexOf(',');
      return {
        base64: commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl,
        mimeType: 'image/jpeg',
      };
    }
  } catch {
    // Fall back to raw file read if browser can't decode into canvas
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const commaIdx = result.indexOf(',');
      const base64 = commaIdx >= 0 ? result.slice(commaIdx + 1) : result;
      resolve({ base64, mimeType: file.type || 'image/jpeg' });
    };
    reader.onerror = () => reject(new Error('Could not read image file'));
    reader.readAsDataURL(file);
  });
}

async function invokeGeminiEdge<T>(payload: Record<string, unknown>): Promise<T> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase is not configured yet (running in Local Demo mode).');
  }
  const { data, error } = await supabase.functions.invoke('gemini-assistant', {
    body: payload,
  });
  if (error) {
    let detailedMsg = error.message || 'Edge function call failed';
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.text === 'function') {
        const rawBody = await ctx.text();
        if (rawBody) {
          try {
            const parsed = JSON.parse(rawBody) as { error?: string; message?: string };
            if (parsed.error || parsed.message) {
              detailedMsg = String(parsed.error || parsed.message);
            }
          } catch {
            detailedMsg = rawBody.slice(0, 200);
          }
        }
      }
    } catch {
      // keep fallback message
    }
    throw new Error(detailedMsg);
  }
  if (data?.error) {
    throw new Error(String(data.error));
  }
  return data as T;
}

export async function scanReceiptWithGemini(
  file: File,
  stores: Store[],
  inventory: InventoryItem[]
): Promise<{ detectedStoreId: string; items: ReceiptParsedItem[] }> {
  const { base64, mimeType } = await fileToBase64(file);
  const raw = await invokeGeminiEdge<{
    detectedStoreName?: string;
    items?: {
      rawReceiptText?: string;
      name: string;
      alias?: string;
      portionsToAdd?: number;
      portionLabel?: string;
      packDescription?: string;
      zone?: 'fridge' | 'freezer' | 'pantry';
      category?: InventoryItem['category'];
      trackingMode?: InventoryItem['trackingMode'];
      price?: number;
    }[];
  }>({
    action: 'scan_receipt',
    imageBase64: base64,
    mimeType,
    stores: stores.map((s) => ({ id: s.id, name: s.name, alias: s.alias })),
    existingItems: inventory.map((i) => ({ id: i.id, name: i.name, alias: i.alias, zone: i.zone })),
  });

  const storeGuess = (raw.detectedStoreName || '').toLowerCase();
  const matchedStore =
    stores.find(
      (s) =>
        storeGuess.includes(s.name.toLowerCase()) ||
        (s.alias && storeGuess.includes(s.alias.toLowerCase()))
    ) ?? stores[0];

  const parsedItems: ReceiptParsedItem[] = (raw.items || []).map((line, idx) => {
    const match = matchInventoryItem(line.name, line.alias || '', inventory);
    if (match) {
      return {
        id: `rcpt-ai-${idx}-${Date.now()}`,
        rawReceiptText: line.rawReceiptText || line.name.toUpperCase(),
        matchedItemId: match.item.id,
        name: match.item.name,
        alias: match.item.alias || line.alias || '',
        portionsToAdd:
          match.item.trackingMode === 'continuous'
            ? match.item.totalPortions
            : line.portionsToAdd || match.item.totalPortions || 4,
        portionLabel: match.item.portionLabel || line.portionLabel || '1 portion',
        packDescription: line.packDescription || match.item.packDescription || '1 pack',
        zone: match.item.zone,
        category: match.item.category,
        trackingMode: match.item.trackingMode,
        price: line.price,
        included: true,
        confidence: match.confidence,
      };
    }

    return {
      id: `rcpt-ai-${idx}-${Date.now()}`,
      rawReceiptText: line.rawReceiptText || line.name.toUpperCase(),
      name: line.name,
      alias: line.alias || '',
      portionsToAdd: Math.max(1, line.portionsToAdd || 4),
      portionLabel: line.portionLabel || '1 portion',
      packDescription: line.packDescription || '1 pack',
      zone: line.zone || 'fridge',
      category: line.category || 'pantry_staple',
      trackingMode: line.trackingMode,
      price: line.price,
      included: true,
      confidence: 'new',
    };
  });

  return {
    detectedStoreId: matchedStore?.id ?? stores[0]?.id ?? 'store-costco',
    items: parsedItems,
  };
}

export async function scanNutritionLabelWithGemini(
  file: File,
  itemName: string
): Promise<NutritionFacts> {
  const { base64, mimeType } = await fileToBase64(file);
  const res = await invokeGeminiEdge<Omit<NutritionFacts, 'source' | 'lastScannedAt'>>({
    action: 'scan_nutrition_label',
    imageBase64: base64,
    mimeType,
    itemName,
  });

  return {
    servingSizeLabel: res.servingSizeLabel || '1 serving',
    calories: Math.round(Number(res.calories) || 0),
    protein: Number(res.protein) || 0,
    sugar: Number(res.sugar) || 0,
    fiber: Number(res.fiber) || 0,
    carbs: Number(res.carbs) || 0,
    fat: Number(res.fat) || 0,
    sodiumMg: Number(res.sodiumMg) || undefined,
    micronutrients: {
      ironPct: res.micronutrients?.ironPct || undefined,
      calciumPct: res.micronutrients?.calciumPct || undefined,
      potassiumPct: res.micronutrients?.potassiumPct || undefined,
      vitaminDPct: res.micronutrients?.vitaminDPct || undefined,
      vitaminCPct: res.micronutrients?.vitaminCPct || undefined,
      omega3: Boolean(res.micronutrients?.omega3) || undefined,
      highlights: res.micronutrients?.highlights,
    },
    source: 'label_scan',
    lastScannedAt: new Date().toISOString(),
  };
}

export async function generateMealsWithGemini(
  items: InventoryItem[],
  request: MealPlanRequest
): Promise<(Omit<MealRecipe, 'id'> & { reasonNote?: string })[]> {
  const stockedInventory = items
    .filter((i) => i.remainingPortions > 0 && !request.excludedItemIds.includes(i.id))
    .map((i) => ({
      id: i.id,
      name: i.name,
      alias: i.alias,
      zone: i.zone,
      remainingPortions: i.remainingPortions,
      portionLabel: i.portionLabel,
      proteinPerPortion: i.proteinPerPortion,
      sugarPerPortion: i.nutrition?.sugar ?? 0,
      mustUse: request.mustUseItemIds.includes(i.id),
      expiresAt: i.expiresAt ?? null,
    }));

  const res = await invokeGeminiEdge<{
    recipes?: (Omit<MealRecipe, 'id'> & { reasonNote?: string })[];
  }>({
    action: 'meal_plan',
    preferences: {
      scope: request.days === 0 ? 'single_meal' : `${request.days}_days`,
      effort: request.effort,
      tools: request.selectedTools,
      dailyProteinTargetGrams: request.dailyProteinTarget,
      cuisine: request.cuisineFilter,
    },
    stockedInventory,
  });

  return (res.recipes || []).map((r) => ({
    ...r,
    isFavorite: false,
    nutritionEstimated: true,
    micronutrients: r.micronutrients || ['Whole Foods'],
    quickSteps: r.quickSteps || ['Prepare and cook ingredients until done.'],
    ingredients: r.ingredients || [],
  }));
}

async function blobToBase64(blob: Blob): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const commaIdx = result.indexOf(',');
      const base64 = commaIdx >= 0 ? result.slice(commaIdx + 1) : result;
      // Strip codec suffixes (e.g. "audio/webm;codecs=opus" -> "audio/webm") for Gemini inlineData compatibility
      const cleanMime = (blob.type || 'audio/webm').split(';')[0].trim() || 'audio/webm';
      resolve({ base64, mimeType: cleanMime });
    };
    reader.onerror = () => reject(new Error('Could not read recorded audio'));
    reader.readAsDataURL(blob);
  });
}

const VALID_TOOLS: CookingTool[] = [
  'air_fryer',
  'oven',
  'pan',
  'grill',
  'instant_pot',
  'slow_cooker',
  'blender',
  'no_cook',
];

const VALID_CATEGORIES: FoodCategory[] = [
  'protein',
  'dairy',
  'produce',
  'beverages',
  'grains',
  'condiments',
  'spices',
  'pantry_staple',
  'snacks',
  'prepared',
];

export async function parseVoiceFoodWithGemini(params: {
  audioBlob?: Blob | null;
  transcript?: string;
  languageHint: 'auto' | 'en' | 'fa';
  inventory: InventoryItem[];
  defaultStoreId: string;
  cuisines: string[];
}): Promise<VoiceParsedFood> {
  const { audioBlob, transcript, languageHint, inventory, defaultStoreId, cuisines } = params;
  const cleanTranscript = (transcript || '').trim();

  // Offline / Local Demo mode fallback when Supabase isn't configured
  if (!isSupabaseConfigured || !supabase) {
    if (!cleanTranscript) {
      throw new Error(
        'Audio transcription requires Gemini Cloud sync, or type/dictate your food description in the box below.'
      );
    }
    return parseVoiceFoodLocally(cleanTranscript, inventory, defaultStoreId, cuisines);
  }

  let audioBase64: string | undefined;
  let audioMimeType: string | undefined;
  if (audioBlob && audioBlob.size > 0) {
    const encoded = await blobToBase64(audioBlob);
    audioBase64 = encoded.base64;
    audioMimeType = encoded.mimeType;
  }

  type RawVoiceResponse = {
    transcript?: string;
    name?: string;
    alias?: string;
    cuisine?: string;
    mealType?: MealRecipe['mealType'];
    prepMinutes?: number;
    tools?: string[];
    quickSteps?: string[];
    ingredients?: {
      spokenText?: string;
      matchedItemId?: string | null;
      itemId?: string | null;
      name?: string;
      alias?: string;
      portionsNeeded?: number;
      portionLabel?: string;
      category?: string;
      zone?: string;
      trackingMode?: string;
      packDescription?: string;
    }[];
  };

  let raw: RawVoiceResponse;
  let usedSource: VoiceParsedFood['source'] = audioBase64 ? 'gemini_audio' : 'gemini_text';

  const existingItemsPayload = inventory.map((i) => ({
    id: i.id,
    name: i.name,
    alias: i.alias,
    zone: i.zone,
    category: i.category,
    portionLabel: i.portionLabel,
    trackingMode: i.trackingMode,
  }));

  try {
    raw = await invokeGeminiEdge<RawVoiceResponse>({
      action: 'parse_voice_food',
      audioBase64,
      audioMimeType,
      transcript: cleanTranscript || undefined,
      languageHint,
      cuisines,
      existingItems: existingItemsPayload,
    });
  } catch (primaryErr) {
    const errMsg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
    const isUnknownAction = /unknown action/i.test(errMsg);

    // Retry 1: If audio upload failed (e.g. Safari codec mismatch) and we have a transcript, retry text-only
    if (!isUnknownAction && audioBase64 && cleanTranscript) {
      raw = await invokeGeminiEdge<RawVoiceResponse>({
        action: 'parse_voice_food',
        transcript: cleanTranscript,
        languageHint,
        cuisines,
        existingItems: existingItemsPayload,
      });
      usedSource = 'gemini_text';
    } else if (isUnknownAction && cleanTranscript) {
      // Retry 2: Deployed Edge Function hasn't been redeployed with `parse_voice_food` yet —
      // route through the already-deployed `meal_plan` action so live Gemini still parses the exact spoken food!
      const compatRes = await invokeGeminiEdge<{
        recipes?: RawVoiceResponse[];
      }>({
        action: 'meal_plan',
        preferences: {
          scope: 'single_meal',
          task: 'EXTRACT_EXACT_SPOKEN_FOOD_FROM_TRANSCRIPT',
          instruction:
            'CRITICAL: Do NOT invent an unrelated meal. Return EXACTLY 1 recipe matching the user spoken description below verbatim in intent. Extract the exact dish name (clean English name + natural Persian alias), cooking tools, prepMinutes, and EVERY spoken ingredient with its amount (portionsNeeded + portionLabel). Match itemId to the exact id in stockedInventory whenever the ingredient exists in stockedInventory — match across English and Persian (e.g. روغن -> Olive Oil, گوشت تیکه‌ای -> Beef, سبزی -> Persian Herbs, شیر -> Milk, تخم‌مرغ -> Eggs). For missing ingredients, omit itemId and provide clean English name and Persian alias.',
          spokenFoodDescription: cleanTranscript,
          languageHint,
          cuisine: 'all',
        },
        stockedInventory: inventory.map((i) => ({
          id: i.id,
          name: i.name,
          alias: i.alias,
          zone: i.zone,
          remainingPortions: i.remainingPortions,
          portionLabel: i.portionLabel,
          proteinPerPortion: i.proteinPerPortion,
        })),
      });

      const firstRecipe = compatRes.recipes?.[0];
      if (!firstRecipe) {
        throw primaryErr;
      }
      raw = {
        ...firstRecipe,
        transcript: cleanTranscript,
      };
      usedSource = 'gemini_compat';
    } else {
      throw primaryErr;
    }
  }

  const itemById = new Map(inventory.map((i) => [i.id, i]));
  const parsedIngredients: VoiceParsedIngredient[] = (raw.ingredients || [])
    .filter((ing) => (ing.name || ing.alias || ing.spokenText || '').trim().length > 0)
    .map((ing, idx) => {
      const candidateName = (ing.name || ing.spokenText || '').trim();
      const candidateAlias = (ing.alias || '').trim();
      const candidateId = ing.matchedItemId || ing.itemId || undefined;
      const directMatch =
        candidateId && itemById.has(candidateId) ? itemById.get(candidateId) : undefined;
      const fallbackMatch = directMatch
        ? null
        : matchVoiceIngredientToKitchen(candidateName, candidateAlias, inventory);
      const matched = directMatch ?? fallbackMatch?.item;

      if (matched) {
        return {
          id: `ving-ai-${idx}-${Date.now()}`,
          spokenText: ing.spokenText || candidateName,
          matchedItemId: matched.id,
          matchConfidence: directMatch ? 'exact' : fallbackMatch?.confidence ?? 'fuzzy',
          name: matched.name,
          alias: matched.alias || candidateAlias,
          portionsNeeded: Math.max(0.25, Number(ing.portionsNeeded) || 1),
          portionLabel: ing.portionLabel?.trim() || matched.portionLabel || '1 portion',
          suggestedCategory: matched.category,
          suggestedZone: matched.zone,
          suggestedTrackingMode: matched.trackingMode,
          suggestedPackDescription: matched.packDescription,
          confirmCreateInKitchen: false,
          initialInStock: matched.remainingPortions > 0,
          initialStockCount: matched.remainingPortions,
          storeId: matched.defaultStoreId || defaultStoreId,
        };
      }

      const inferred = inferProductDefaultsFromText(`${candidateName} ${candidateAlias}`);
      const rawCat = ing.category as FoodCategory | undefined;
      const cat: FoodCategory =
        rawCat && VALID_CATEGORIES.includes(rawCat)
          ? rawCat
          : inferred?.category ?? 'produce';
      const prof = getCategoryProfile(cat);
      const rawZone = ing.zone as StorageZone | undefined;
      const zone: StorageZone =
        rawZone === 'fridge' || rawZone === 'freezer' || rawZone === 'pantry'
          ? rawZone
          : inferred?.zone ?? prof.defaultZone;
      const trackingMode: TrackingMode =
        ing.trackingMode === 'continuous' || ing.trackingMode === 'portioned'
          ? ing.trackingMode
          : inferred?.trackingMode ?? prof.defaultTrackingMode;

      return {
        id: `ving-ai-${idx}-${Date.now()}`,
        spokenText: ing.spokenText || candidateName,
        matchedItemId: undefined,
        matchConfidence: 'new',
        name: candidateName,
        alias: candidateAlias,
        portionsNeeded: Math.max(0.25, Number(ing.portionsNeeded) || 1),
        portionLabel: ing.portionLabel?.trim() || prof.defaultPortionLabel,
        suggestedCategory: cat,
        suggestedZone: zone,
        suggestedTrackingMode: trackingMode,
        suggestedPackDescription:
          ing.packDescription?.trim() ||
          (trackingMode === 'continuous'
            ? prof.levelPackPresets[0] ?? '1 container'
            : `${prof.defaultPortionCount} × ${prof.defaultPortionLabel}`),
        confirmCreateInKitchen: true,
        initialInStock: false,
        initialStockCount: 0,
        storeId: defaultStoreId,
      };
    });

  const validTools = (raw.tools || []).filter((tl): tl is CookingTool =>
    VALID_TOOLS.includes(tl as CookingTool)
  );
  const mealType: MealRecipe['mealType'] =
    raw.mealType === 'breakfast' ||
    raw.mealType === 'lunch' ||
    raw.mealType === 'dinner' ||
    raw.mealType === 'snack'
      ? raw.mealType
      : 'dinner';

  return {
    transcript: raw.transcript || cleanTranscript,
    name: (raw.name || 'New Voice Food').trim(),
    alias: (raw.alias || '').trim(),
    cuisine: (raw.cuisine || cuisines[0] || 'Persian').trim(),
    mealType,
    prepMinutes: Math.max(5, Math.min(240, Number(raw.prepMinutes) || 20)),
    tools: validTools.length > 0 ? validTools : ['pan'],
    quickSteps:
      Array.isArray(raw.quickSteps) && raw.quickSteps.length > 0
        ? raw.quickSteps.filter(Boolean)
        : ['Prepare ingredients and cook until done.'],
    ingredients: parsedIngredients,
    source: usedSource,
  };
}
