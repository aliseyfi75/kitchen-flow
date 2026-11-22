import { NutritionFacts } from '../types/kitchen';

export interface BarcodeLookupResult {
  found: boolean;
  barcode: string;
  productName?: string;
  brand?: string;
  quantity?: string;
  nutrition?: NutritionFacts;
  sourceLabel: string;
  error?: string;
}

// Daily reference intakes (Health Canada / FDA) to convert mg/mcg from Open Food Facts to % DV
const DV_IRON_MG = 18;
const DV_CALCIUM_MG = 1300;
const DV_POTASSIUM_MG = 3400;
const DV_VIT_D_MCG = 20;
const DV_VIT_C_MG = 90;

function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Looks up a grocery barcode directly from Open Food Facts (free, open, no API key).
 * Falls back cleanly with `found: false` so the user can scan the nutrition label instead.
 */
export async function lookupBarcodeFromOpenFoodFacts(
  rawBarcode: string
): Promise<BarcodeLookupResult> {
  const barcode = rawBarcode.replace(/\D/g, '').trim();
  if (barcode.length < 6) {
    return {
      found: false,
      barcode,
      sourceLabel: 'Open Food Facts',
      error: 'Please enter a valid barcode (at least 6 digits).',
    };
  }

  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=product_name,brands,quantity,serving_size,nutriments`
    );

    if (!res.ok) {
      return {
        found: false,
        barcode,
        sourceLabel: 'Open Food Facts',
        error: 'Product not found in Open Food Facts — try scanning the Nutrition Facts label below.',
      };
    }

    const data = await res.json();
    if (data.status !== 1 || !data.product) {
      return {
        found: false,
        barcode,
        sourceLabel: 'Open Food Facts',
        error: 'No match found for this barcode — you can snap the Nutrition Facts label instead.',
      };
    }

    const p = data.product;
    const n = p.nutriments || {};
    const useServing = n['energy-kcal_serving'] !== undefined || n['proteins_serving'] !== undefined;
    const suffix = useServing ? '_serving' : '_100g';

    const calories = Math.round(toNum(n[`energy-kcal${suffix}`] ?? n['energy-kcal_100g']));
    const protein = round1(toNum(n[`proteins${suffix}`] ?? n['proteins_100g']));
    const sugar = round1(toNum(n[`sugars${suffix}`] ?? n['sugars_100g']));
    const fiber = round1(toNum(n[`fiber${suffix}`] ?? n['fiber_100g']));
    const carbs = round1(toNum(n[`carbohydrates${suffix}`] ?? n['carbohydrates_100g']));
    const fat = round1(toNum(n[`fat${suffix}`] ?? n['fat_100g']));
    const sodiumG = toNum(n[`sodium${suffix}`] ?? n['sodium_100g']);
    const sodiumMg = Math.round(sodiumG * 1000);

    // OFF stores minerals in grams (g) and vitamin D in g or mcg; normalize defensively
    const ironG = toNum(n[`iron${suffix}`] ?? n['iron_100g']);
    const calciumG = toNum(n[`calcium${suffix}`] ?? n['calcium_100g']);
    const potassiumG = toNum(n[`potassium${suffix}`] ?? n['potassium_100g']);
    const vitCG = toNum(n[`vitamin-c${suffix}`] ?? n['vitamin-c_100g']);
    const vitDRaw = toNum(n[`vitamin-d${suffix}`] ?? n['vitamin-d_100g']);

    const ironPct = ironG > 0 ? Math.min(200, Math.round(((ironG * 1000) / DV_IRON_MG) * 100)) : undefined;
    const calciumPct =
      calciumG > 0 ? Math.min(200, Math.round(((calciumG * 1000) / DV_CALCIUM_MG) * 100)) : undefined;
    const potassiumPct =
      potassiumG > 0
        ? Math.min(200, Math.round(((potassiumG * 1000) / DV_POTASSIUM_MG) * 100))
        : undefined;
    const vitaminCPct =
      vitCG > 0 ? Math.min(300, Math.round(((vitCG * 1000) / DV_VIT_C_MG) * 100)) : undefined;
    // OFF stores vitamin-d in grams (e.g. 0.000002g = 2mcg)
    const vitDMcg = vitDRaw > 0 && vitDRaw < 0.001 ? vitDRaw * 1_000_000 : vitDRaw;
    const vitaminDPct =
      vitDMcg > 0 ? Math.min(200, Math.round((vitDMcg / DV_VIT_D_MCG) * 100)) : undefined;

    const highlights: string[] = [];
    if (protein >= 15) highlights.push('High Protein');
    if (sugar <= 3) highlights.push('Low Sugar');
    if (fiber >= 3) highlights.push('Good Fiber');
    if (calciumPct && calciumPct >= 10) highlights.push('Calcium');
    if (ironPct && ironPct >= 10) highlights.push('Iron');
    if (vitaminDPct && vitaminDPct >= 10) highlights.push('Vitamin D');
    if (vitaminCPct && vitaminCPct >= 15) highlights.push('Vitamin C');

    const nutrition: NutritionFacts = {
      servingSizeLabel: p.serving_size || (useServing ? '1 serving' : '100g'),
      calories,
      protein,
      sugar,
      fiber,
      carbs,
      fat,
      sodiumMg: sodiumMg > 0 ? sodiumMg : undefined,
      micronutrients: {
        ironPct,
        calciumPct,
        potassiumPct,
        vitaminDPct,
        vitaminCPct,
        highlights: highlights.length > 0 ? highlights : undefined,
      },
      source: 'label_scan',
      lastScannedAt: new Date().toISOString(),
    };

    const fullName = [p.brands ? p.brands.split(',')[0].trim() : '', p.product_name || '']
      .filter(Boolean)
      .join(' ')
      .trim();

    return {
      found: true,
      barcode,
      productName: fullName || p.product_name || undefined,
      brand: p.brands,
      quantity: p.quantity,
      nutrition,
      sourceLabel: 'Open Food Facts (Live Web Lookup)',
    };
  } catch {
    return {
      found: false,
      barcode,
      sourceLabel: 'Open Food Facts',
      error: 'Could not reach Open Food Facts (offline or blocked) — use Nutrition Facts label scan below.',
    };
  }
}

export const SAMPLE_BARCODES = [
  { code: '0056800099112', label: 'Oikos Greek Yogurt' },
  { code: '0068200201650', label: 'Natrel Milk' },
  { code: '0096619756803', label: 'Kirkland Olive Oil' },
];
