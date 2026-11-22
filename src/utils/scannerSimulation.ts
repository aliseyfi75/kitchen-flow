import { InventoryItem, NutritionFacts, ReceiptParsedItem } from '../types/kitchen';

export interface SampleReceipt {
  id: string;
  label: string;
  storeId: string;
  storeName: string;
  dateLabel: string;
  totalLabel: string;
  rawLines: {
    rawReceiptText: string;
    name: string;
    alias: string;
    portionsToAdd: number;
    portionLabel: string;
    packDescription: string;
    zone: 'freezer' | 'fridge' | 'pantry';
    category: InventoryItem['category'];
    price: number;
  }[];
}

export const SAMPLE_RECEIPTS: SampleReceipt[] = [
  {
    id: 'receipt-costco',
    label: 'Costco Weekend Haul',
    storeId: 'store-costco',
    storeName: 'Costco',
    dateLabel: 'Sat • 11:24 AM',
    totalLabel: '$78.45',
    rawLines: [
      {
        rawReceiptText: 'KS OIKOS 0% GRK YOG 2X750G',
        name: '0% Greek Yogurt',
        alias: 'ماست یونانی',
        portionsToAdd: 8,
        portionLabel: '175g bowl',
        packDescription: '2 x 750g tubs',
        zone: 'fridge',
        category: 'dairy',
        price: 11.99,
      },
      {
        rawReceiptText: 'KS BNLS SKNLS CHKN BRST',
        name: 'Chicken Breast',
        alias: 'سینه مرغ',
        portionsToAdd: 8,
        portionLabel: '180g serving',
        packDescription: '1.5 kg Costco pack → 8 portions',
        zone: 'freezer',
        category: 'protein',
        price: 24.5,
      },
      {
        rawReceiptText: 'LGE EGGS 24CT',
        name: 'Large Eggs',
        alias: 'تخم‌مرغ',
        portionsToAdd: 12,
        portionLabel: '2 eggs',
        packDescription: '24-pack tray (12 servings)',
        zone: 'fridge',
        category: 'dairy',
        price: 8.99,
      },
      {
        rawReceiptText: 'ORG BLUEBERRIES 510G',
        name: 'Organic Blueberries',
        alias: 'بلوبری ارگانیک',
        portionsToAdd: 6,
        portionLabel: '1/2 cup',
        packDescription: '510g clamshell',
        zone: 'fridge',
        category: 'produce',
        price: 7.49,
      },
      {
        rawReceiptText: 'KS EXTRA LEAN GRD BEEF',
        name: 'Lean Ground Beef',
        alias: 'گوشت چرخ‌کرده کم‌چرب',
        portionsToAdd: 8,
        portionLabel: '175g serving',
        packDescription: '1.4 kg tray → 8 portions',
        zone: 'freezer',
        category: 'protein',
        price: 25.48,
      },
    ],
  },
  {
    id: 'receipt-superstore',
    label: 'Superstore Fresh Run',
    storeId: 'store-superstore',
    storeName: 'Superstore',
    dateLabel: 'Sun • 4:10 PM',
    totalLabel: '$29.85',
    rawLines: [
      {
        rawReceiptText: 'NATREL 2% MILK 4L JUG',
        name: '2% Milk',
        alias: 'شیر ۲ درصد',
        portionsToAdd: 16,
        portionLabel: '1 cup (250ml)',
        packDescription: '4L jug',
        zone: 'fridge',
        category: 'dairy',
        price: 6.29,
      },
      {
        rawReceiptText: 'PC ORG BABY SPINACH 454G',
        name: 'Baby Spinach',
        alias: 'اسفناج تازه',
        portionsToAdd: 6,
        portionLabel: '2 big handfuls',
        packDescription: '454g clamshell',
        zone: 'fridge',
        category: 'produce',
        price: 5.99,
      },
      {
        rawReceiptText: 'CHERRY TOMATO & MINI CUCUM',
        name: 'Cherry Tomatoes & Cucumbers',
        alias: 'گوجه گیلاسی و خیار',
        portionsToAdd: 6,
        portionLabel: '1 salad bowl',
        packDescription: 'Weekly salad pack',
        zone: 'fridge',
        category: 'produce',
        price: 7.49,
      },
      {
        rawReceiptText: 'BROCCOLI CROWNS X2',
        name: 'Fresh Broccoli',
        alias: 'کلم بروکلی',
        portionsToAdd: 4,
        portionLabel: '1.5 cups florets',
        packDescription: '2 crowns',
        zone: 'fridge',
        category: 'produce',
        price: 4.59,
      },
      {
        rawReceiptText: 'HASS AVOCADOS BAG 5CT',
        name: 'Avocados',
        alias: 'آووکادو',
        portionsToAdd: 5,
        portionLabel: '1 avocado',
        packDescription: '5-pack bag',
        zone: 'fridge',
        category: 'produce',
        price: 5.49,
      },
    ],
  },
  {
    id: 'receipt-persian',
    label: 'Persian Market Run',
    storeId: 'store-persian',
    storeName: 'Persian Market',
    dateLabel: 'Sat • 2:05 PM',
    totalLabel: '$24.50',
    rawLines: [
      {
        rawReceiptText: 'FRESH SABZI KHORDAN BOX',
        name: 'Fresh Persian Herbs',
        alias: 'سبزی خوردن و جعفری',
        portionsToAdd: 4,
        portionLabel: '1 bunch / plate',
        packDescription: 'Washed herb box',
        zone: 'fridge',
        category: 'produce',
        price: 6.5,
      },
      {
        rawReceiptText: 'WHOLE WHEAT SANGAK X2',
        name: 'Whole Wheat Sangak Bread',
        alias: 'نان سنگک سبوس‌دار',
        portionsToAdd: 8,
        portionLabel: '1 slice',
        packDescription: '2 loaves (sliced & frozen)',
        zone: 'freezer',
        category: 'grains',
        price: 9.0,
      },
      {
        rawReceiptText: 'FETA CHEESE TABRIZ 400G',
        name: 'Persian Feta Cheese',
        alias: 'پنیر لیقوان / فتا',
        portionsToAdd: 10,
        portionLabel: '40g slice',
        packDescription: '400g tub',
        zone: 'fridge',
        category: 'dairy',
        price: 9.0,
      },
    ],
  },
];

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, ' ')
    .split(' ')
    .filter((w) => w.length >= 2);
}

/**
 * Matches a receipt line against existing kitchen inventory using EN/FA token overlap.
 */
export function matchInventoryItem(
  candidateName: string,
  candidateAlias: string,
  items: InventoryItem[]
): { item: InventoryItem; confidence: 'high' | 'medium' } | null {
  const candTokens = new Set([...tokenize(candidateName), ...tokenize(candidateAlias)]);
  if (candTokens.size === 0) return null;

  let best: InventoryItem | null = null;
  let bestScore = 0;

  for (const item of items) {
    const itemTokens = [...tokenize(item.name), ...tokenize(item.alias)];
    let overlap = 0;
    for (const tok of itemTokens) {
      if (candTokens.has(tok)) overlap += 1;
    }
    const ratio = overlap / Math.max(1, Math.min(candTokens.size, itemTokens.length));
    if (ratio > bestScore) {
      bestScore = ratio;
      best = item;
    }
  }

  if (best && bestScore >= 0.6) {
    return { item: best, confidence: bestScore >= 0.85 ? 'high' : 'medium' };
  }
  return null;
}

export function buildParsedReceiptItems(
  receipt: SampleReceipt,
  inventory: InventoryItem[]
): ReceiptParsedItem[] {
  return receipt.rawLines.map((line, idx) => {
    const match = matchInventoryItem(line.name, line.alias, inventory);
    if (match) {
      return {
        id: `rcpt-line-${idx}-${Date.now()}`,
        rawReceiptText: line.rawReceiptText,
        matchedItemId: match.item.id,
        name: match.item.name,
        alias: match.item.alias || line.alias,
        portionsToAdd: match.item.totalPortions || line.portionsToAdd,
        portionLabel: match.item.portionLabel || line.portionLabel,
        packDescription: match.item.packDescription || line.packDescription,
        zone: match.item.zone,
        category: match.item.category,
        price: line.price,
        included: true,
        confidence: match.confidence,
      };
    }

    return {
      id: `rcpt-line-${idx}-${Date.now()}`,
      rawReceiptText: line.rawReceiptText,
      name: line.name,
      alias: line.alias,
      portionsToAdd: line.portionsToAdd,
      portionLabel: line.portionLabel,
      packDescription: line.packDescription,
      zone: line.zone,
      category: line.category,
      price: line.price,
      included: true,
      confidence: 'new',
    };
  });
}

/**
 * Simulated Gemini Vision Nutrition Facts label reader for Phase 1 Demo.
 * In Phase 2, the uploaded photo is sent to our Supabase Edge Function -> Gemini Vision.
 */
export function simulateNutritionLabelScan(itemName: string): NutritionFacts {
  const lower = itemName.toLowerCase();
  const nowIso = new Date().toISOString();

  if (lower.includes('yogurt') || lower.includes('ماست')) {
    return {
      servingSizeLabel: '175g (3/4 cup)',
      calories: 100,
      protein: 18,
      sugar: 5,
      fiber: 0,
      carbs: 6,
      fat: 0,
      sodiumMg: 65,
      micronutrients: { calciumPct: 18, potassiumPct: 6, vitaminDPct: 0, ironPct: 0, highlights: ['Probiotics', 'Calcium'] },
      source: 'label_scan',
      lastScannedAt: nowIso,
    };
  }
  if (lower.includes('milk') || lower.includes('شیر')) {
    return {
      servingSizeLabel: '250ml (1 cup)',
      calories: 130,
      protein: 9,
      sugar: 12,
      fiber: 0,
      carbs: 12,
      fat: 5,
      sodiumMg: 125,
      micronutrients: { calciumPct: 25, vitaminDPct: 15, potassiumPct: 8, highlights: ['Calcium', 'Vitamin D'] },
      source: 'label_scan',
      lastScannedAt: nowIso,
    };
  }
  if (lower.includes('whey') || lower.includes('protein') || lower.includes('پروتئین')) {
    return {
      servingSizeLabel: '1 scoop (32g)',
      calories: 120,
      protein: 25,
      sugar: 1,
      fiber: 0,
      carbs: 3,
      fat: 1.5,
      sodiumMg: 130,
      micronutrients: { calciumPct: 10, potassiumPct: 4, ironPct: 2, highlights: ['BCAAs', 'Low Sugar'] },
      source: 'label_scan',
      lastScannedAt: nowIso,
    };
  }
  if (lower.includes('salmon') || lower.includes('سالمون')) {
    return {
      servingSizeLabel: '1 fillet (170g)',
      calories: 280,
      protein: 36,
      sugar: 0,
      fiber: 0,
      carbs: 0,
      fat: 13,
      sodiumMg: 95,
      micronutrients: { vitaminDPct: 85, potassiumPct: 16, ironPct: 6, omega3: true, highlights: ['Omega-3', 'Vitamin D'] },
      source: 'label_scan',
      lastScannedAt: nowIso,
    };
  }

  // Generic realistic Canadian/US packaged food Nutrition Facts scan
  return {
    servingSizeLabel: '1 serving (100g)',
    calories: 185,
    protein: 22,
    sugar: 3,
    fiber: 3,
    carbs: 12,
    fat: 5,
    sodiumMg: 160,
    micronutrients: {
      ironPct: 12,
      calciumPct: 8,
      potassiumPct: 10,
      vitaminDPct: 4,
      vitaminCPct: 6,
      highlights: ['Iron', 'Potassium', 'Low Sugar'],
    },
    source: 'label_scan',
    lastScannedAt: nowIso,
  };
}
