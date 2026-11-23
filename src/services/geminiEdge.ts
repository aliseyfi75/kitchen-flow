import {
  InventoryItem,
  MealRecipe,
  NutritionFacts,
  ReceiptParsedItem,
  Store,
} from '../types/kitchen';
import { MealPlanRequest } from '../utils/mealEngine';
import { matchInventoryItem } from '../utils/scannerSimulation';
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
    throw new Error(error.message || 'Edge function call failed');
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
