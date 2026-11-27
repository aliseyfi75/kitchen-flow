// Supabase Edge Function: gemini-assistant
// Deploy with: supabase functions deploy gemini-assistant
// Set secret with: supabase secrets set GEMINI_API_KEY=your_key_here
//
// Security:
// 1. Verifies caller's Supabase Auth JWT
// 2. Verifies caller exists in public.household_members
// 3. Keeps GEMINI_API_KEY strictly server-side (never exposed to GitHub or browser)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const DEFAULT_ALLOWED_ORIGINS = [
  'https://aliseyfi75.github.io',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
];

const MAX_BODY_BYTES = 8 * 1024 * 1024; // 8 MB max (photos + short audio clips)
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const RATE_LIMIT_MAX_REQUESTS = 30;
const userRequestLog = new Map<string, number[]>();

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') || '';
  const extraOrigins = (Deno.env.get('ALLOWED_ORIGINS') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const allowed = new Set([...DEFAULT_ALLOWED_ORIGINS, ...extraOrigins]);
  const matchedOrigin = allowed.has(origin) ? origin : DEFAULT_ALLOWED_ORIGINS[0];

  return {
    'Access-Control-Allow-Origin': matchedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

function checkRateLimit(userId: string): { allowed: boolean; retryAfterSec?: number } {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const recent = (userRequestLog.get(userId) || []).filter((ts) => ts >= cutoff);
  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    const oldest = recent[0];
    const retryAfterSec = Math.max(1, Math.ceil((oldest + RATE_LIMIT_WINDOW_MS - now) / 1000));
    userRequestLog.set(userId, recent);
    return { allowed: false, retryAfterSec };
  }
  recent.push(now);
  userRequestLog.set(userId, recent);
  return { allowed: true };
}

// Cost-optimized model ladder (Nov 2026):
// 1. gemini-3.1-flash-lite ($0.25/$1.50 per 1M, Free Tier) — cheapest GA multimodal model open to all accounts
// 2. gemini-3.5-flash-lite ($0.30/$2.50 per 1M, Free Tier) — official 2.5-flash replacement with stronger doc/multimodal parsing
// 3. gemini-3.8-flash ($0.75/$3.75 per 1M, Free Tier) — fallback if Flash-Lite is unavailable or hits quota
// Also automatically tries Google AI Studio endpoint first and falls back to Vertex AI Express Mode
// if the AQ. key was provisioned via Google Cloud Vertex Express.
const MODEL_LADDER: { id: string; thinkingLevel: 'minimal' | 'low' }[] = [
  { id: 'gemini-3.1-flash-lite', thinkingLevel: 'minimal' },
  { id: 'gemini-3.5-flash-lite', thinkingLevel: 'minimal' },
  { id: 'gemini-3.8-flash', thinkingLevel: 'low' },
];

function buildEndpointUrls(model: string, apiKey: string): string[] {
  const encodedKey = encodeURIComponent(apiKey);
  return [
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodedKey}`,
    `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:generateContent?key=${encodedKey}`,
  ];
}

function parseJsonResponseText(raw: string): unknown {
  const trimmed = raw.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  return JSON.parse(unfenced);
}

async function callGemini(apiKey: string, parts: unknown[], systemInstruction: string) {
  let lastError: Error | null = null;

  for (const { id: model, thinkingLevel } of MODEL_LADDER) {
    const urls = buildEndpointUrls(model, apiKey);
    for (const url of urls) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemInstruction }] },
            contents: [{ role: 'user', parts }],
            generationConfig: {
              maxOutputTokens: 3072,
              responseMimeType: 'application/json',
              thinkingConfig: { thinkingLevel },
            },
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          lastError = new Error(`Gemini (${model}) error ${response.status}: ${errText.slice(0, 220)}`);
          // If 401/403/400/404 on AI Studio, try Vertex Express URL next; otherwise move to next model
          if (
            response.status === 401 ||
            response.status === 403 ||
            response.status === 400 ||
            response.status === 404
          ) {
            continue;
          }
          break;
        }

        const data = await response.json();
        const responseParts = Array.isArray(data?.candidates?.[0]?.content?.parts)
          ? data.candidates[0].content.parts
          : [];
        const textPart =
          responseParts.find(
            (p: { text?: string; thought?: boolean }) => Boolean(p?.text) && !p?.thought
          ) ?? responseParts[responseParts.length - 1];
        const rawText = textPart?.text;
        if (!rawText) {
          lastError = new Error(`Gemini (${model}) returned an empty response`);
          continue;
        }
        return parseJsonResponseText(rawText);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }
  }

  throw lastError || new Error('All Gemini models failed');
}

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const contentLength = Number(req.headers.get('content-length') || 0);
    if (contentLength > MAX_BODY_BYTES) {
      return new Response(
        JSON.stringify({ error: 'Payload too large (max 8 MB). Please use a smaller photo or shorter voice clip.' }),
        { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const geminiKey = Deno.env.get('GEMINI_API_KEY') ?? '';

    if (!geminiKey) {
      return new Response(
        JSON.stringify({ error: 'GEMINI_API_KEY secret is not configured in Supabase yet.' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Authenticate caller using their own JWT (RLS enforces membership)
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();

    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized session' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify caller belongs to the whitelisted household
    const { data: membership, error: memErr } = await userClient
      .from('household_members')
      .select('household_id, display_name')
      .eq('user_id', user.id)
      .maybeSingle();

    if (memErr || !membership) {
      return new Response(JSON.stringify({ error: 'Forbidden: not a household member' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Per-user rate limit guard
    const rate = checkRateLimit(user.id);
    if (!rate.allowed) {
      return new Response(
        JSON.stringify({
          error: `Rate limit reached — please wait ${rate.retryAfterSec}s before trying again.`,
        }),
        {
          status: 429,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'Retry-After': String(rate.retryAfterSec || 60),
          },
        }
      );
    }

    const rawTextBody = await req.text();
    if (rawTextBody.length > MAX_BODY_BYTES) {
      return new Response(
        JSON.stringify({ error: 'Payload too large (max 8 MB).' }),
        { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const body = JSON.parse(rawTextBody);
    const action = body?.action;

    if (action === 'scan_receipt') {
      const { imageBase64, mimeType, stores, existingItems } = body;
      const system = `You are a grocery receipt parser for a household kitchen inventory app (often Costco, Superstore, or Persian markets in North America).
Extract all food/grocery line items from the receipt image. Skip tax, subtotals, bags, and non-food items.
Return strictly valid JSON with this exact shape:
{
  "detectedStoreName": "string",
  "items": [
    {
      "rawReceiptText": "string",
      "name": "Clean English product name",
      "alias": "Short Persian translation/alias (e.g. سینه مرغ)",
      "portionsToAdd": 6,
      "portionLabel": "e.g. 180g serving, 1 cup, 2 eggs",
      "packDescription": "e.g. 2 kg pack",
      "zone": "fridge" | "freezer" | "pantry",
      "category": "protein" | "dairy" | "produce" | "beverages" | "grains" | "condiments" | "spices" | "pantry_staple" | "snacks" | "prepared",
      "trackingMode": "portioned" | "continuous",
      "price": 12.99
    }
  ]
}`;

      const result = await callGemini(
        geminiKey,
        [
          {
            text: `Known household stores: ${JSON.stringify(stores || [])}.
Existing kitchen items (match names cleanly when similar): ${JSON.stringify(
              (existingItems || []).slice(0, 60)
            )}.
Parse this grocery receipt:`,
          },
          { inlineData: { mimeType: mimeType || 'image/jpeg', data: imageBase64 } },
        ],
        system
      );

      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'scan_nutrition_label') {
      const { imageBase64, mimeType, itemName } = body;
      const system = `You read Nutrition Facts tables from food package photos (Canadian or US format).
Return strictly valid JSON with this exact shape:
{
  "servingSizeLabel": "string (e.g. 175g (3/4 cup))",
  "calories": 0,
  "protein": 0,
  "sugar": 0,
  "fiber": 0,
  "carbs": 0,
  "fat": 0,
  "sodiumMg": 0,
  "micronutrients": {
    "ironPct": 0,
    "calciumPct": 0,
    "potassiumPct": 0,
    "vitaminDPct": 0,
    "vitaminCPct": 0,
    "omega3": false,
    "highlights": ["string"]
  }
}`;

      const result = await callGemini(
        geminiKey,
        [
          { text: `Extract the Nutrition Facts table for "${itemName || 'food item'}":` },
          { inlineData: { mimeType: mimeType || 'image/jpeg', data: imageBase64 } },
        ],
        system
      );

      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'meal_plan') {
      const { preferences, stockedInventory } = body;
      const isSingle = preferences?.scope === 'single_meal';
      const system = `You are a practical, healthy, high-protein home meal planner for a bilingual English/Persian couple.
Prioritize:
1. Using stocked ingredients (especially soon-expiring fridge items first).
2. High protein, low added sugar, rich micronutrients, realistic low-stress cooking with the selected tools.
3. Exact per-serving portion quantities matched to the provided inventory item IDs whenever possible.
Return strictly valid JSON:
{
  "recipes": [
    {
      "name": "English meal name",
      "alias": "Natural Persian name (e.g. جوجه‌کباب ایرفرایر)",
      "cuisine": "Persian | Western | Fusion | etc.",
      "mealType": "lunch" | "dinner",
      "prepMinutes": 20,
      "effort": "exhausted" | "normal" | "batch_prep",
      "tools": ["air_fryer"],
      "proteinGrams": 48,
      "sugarGrams": 3,
      "fiberGrams": 5,
      "calories": 480,
      "micronutrients": ["Iron", "Vitamin C"],
      "nutritionHighlight": "Short summary",
      "reasonNote": "Why this fits today's stock & goals",
      "ingredients": [
        { "itemId": "matching_id_or_omit", "name": "string", "alias": "string", "portionsNeeded": 1 }
      ],
      "quickSteps": ["Step 1", "Step 2"]
    }
  ]
}
Return ${isSingle ? 'exactly 1' : 'between 4 and 6'} distinct practical meals.`;

      const result = await callGemini(
        geminiKey,
        [
          {
            text: `Preferences: ${JSON.stringify(preferences)}
Current Kitchen Inventory: ${JSON.stringify(stockedInventory)}`,
          },
        ],
        system
      );

      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'parse_voice_food') {
      const { audioBase64, audioMimeType, transcript, languageHint, existingItems, cuisines } = body;
      const system = `You are a bilingual English & Persian (Farsi) kitchen assistant for a meal & inventory tracking app.
The user will describe a food/meal by voice (audio or text) in English, Farsi, or mixed Pinglish/Farsi+English.
Your job:
1. Accurately transcribe what they said (preserve natural phrasing) and extract the dish details (clean English name + natural Persian alias, cuisine, mealType, prepMinutes, cooking tools, brief quickSteps).
2. Extract EVERY ingredient and its per-1-person serving amount (portionsNeeded & portionLabel). If the user gave a total recipe for 2+ people, normalize portionsNeeded to 1 serving where obvious, or preserve the spoken amount cleanly.
3. Match each ingredient to an existing item in existingItems whenever it refers to the same ingredient (match across English & Persian — e.g. "سینه مرغ" matches "Chicken Breast", "شیر" matches "2% Milk", "سبزی" matches "Fresh Persian Herbs"). When matched, set "matchedItemId" to that exact item's id and align portionsNeeded with its portionLabel when reasonable.
4. For any ingredient NOT in existingItems, omit "matchedItemId" and provide clean English "name", Persian "alias", "category", "zone", "trackingMode", and "packDescription" so the user can confirm creating it in their kitchen.

Return strictly valid JSON with this exact shape:
{
  "transcript": "verbatim or clean transcript of what the user said",
  "name": "Clean English dish name",
  "alias": "Natural Persian dish name (e.g. قورمه‌سبزی)",
  "cuisine": "One of the known cuisines or a new short cuisine name",
  "mealType": "breakfast" | "lunch" | "dinner" | "snack",
  "prepMinutes": 25,
  "tools": ["air_fryer" | "oven" | "pan" | "grill" | "instant_pot" | "slow_cooker" | "blender" | "no_cook"],
  "quickSteps": ["Short step 1", "Short step 2"],
  "ingredients": [
    {
      "spokenText": "original spoken ingredient phrase",
      "matchedItemId": "exact_id_from_existingItems_or_null",
      "name": "Clean English ingredient name",
      "alias": "Natural Persian alias",
      "portionsNeeded": 1,
      "portionLabel": "e.g. 180g serving, 1 cup, 2 eggs, 1 tbsp",
      "category": "protein" | "dairy" | "produce" | "beverages" | "grains" | "condiments" | "spices" | "pantry_staple" | "snacks" | "prepared",
      "zone": "fridge" | "freezer" | "pantry",
      "trackingMode": "portioned" | "continuous",
      "packDescription": "e.g. 1 kg bag, 4L jug, 1 jar"
    }
  ]
}`;

      const parts: unknown[] = [
        {
          text: `Language hint: ${languageHint || 'auto (English or Farsi)'}.
Known cuisines: ${JSON.stringify(cuisines || ['Persian', 'Western', 'Fusion', 'Mediterranean'])}.
Existing kitchen items (match matchedItemId whenever possible): ${JSON.stringify(
            (existingItems || []).slice(0, 120)
          )}.
${transcript ? `Spoken/typed text: "${transcript}"` : 'Listen to the attached audio and extract the food and all ingredients:'}`,
        },
      ];

      if (audioBase64) {
        parts.push({
          inlineData: {
            mimeType: audioMimeType || 'audio/webm',
            data: audioBase64,
          },
        });
      }

      const result = await callGemini(geminiKey, parts, system);

      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'parse_kitchen_voice_update') {
      const { audioBase64, audioMimeType, transcript, languageHint, existingItems, stores } = body;
      const system = `You are a bilingual English & Persian (Farsi) kitchen inventory assistant.
The user will describe changes to their kitchen stock by voice or text — in English, Farsi, or mixed Pinglish — such as what they used/ate/cooked, what ran out/finished, current fill levels, or groceries they bought/restocked.
Your job:
1. Accurately transcribe what they said.
2. Break the utterance into individual item updates.
3. Match each item to an existing item in existingItems whenever it refers to the same product (match across English & Persian — e.g. "شیر" -> "2% Milk", "تخم مرغ" -> "Eggs", "سینه مرغ" -> "Chicken Breast", "اسفناج" -> "Baby Spinach", "روغن زیتون" -> "Extra Virgin Olive Oil"). Set "matchedItemId" to its exact id.
4. Determine the exact action for each item:
   - "use": consumed/ate/cooked/used some amount. Convert spoken units carefully using the item's totalPortions, remainingPortions, containerSize, containerUnit, and portionLabel! Return "amount" + "unit" AND compute "newRemainingPortions" (clamped >= 0) and "newLevelPercent" (0-100 for continuous items). Examples:
     * Eggs (remaining 12, portionLabel "egg"): "ate 3 eggs" -> action "use", amount 3, unit "egg", newRemainingPortions 9.
     * Milk (4L, totalPortions 16, remaining 8, portionLabel "1 cup (250ml)"): "used 2 cups" -> amount 2, unit "cup", newRemainingPortions 6; "used 1 liter" -> amount 1, unit "L", newRemainingPortions 4; "used half the milk" -> newRemainingPortions 4.
     * Spinach (continuous, totalPortions 100, remaining 50): "used half the spinach" -> newRemainingPortions 25, newLevelPercent 25.
   - "finish": finished / empty / ran out / "تموم شد" -> newRemainingPortions 0, newLevelPercent 0.
   - "set_level": user directly states how much is left ("milk is half full", "olive oil is almost out", "نصف شیر مونده", "۳ تا تخم‌مرغ مونده") -> set exact newRemainingPortions and/or newLevelPercent (almost out ~15%, quarter ~25%, half ~50%, mostly full ~75%, full 100%).
   - "restock": bought/refilled an existing item ("bought 1 pack chicken from Costco", "از کاستکو شیر خریدم") -> set "addPortions" (defaulting to 1 full container/pack = item.totalPortions if count is 1 pack/jug) and "newRemainingPortions" = remainingPortions + addPortions, plus "storeId" matching stores if mentioned.
   - "add_new": user explicitly bought/added an item NOT in existingItems -> omit matchedItemId and provide clean English "name", Persian "alias", "category", "zone", "trackingMode", "packDescription", "initialTotalPortions", "portionLabel", and optional "storeId".

Return strictly valid JSON with this exact shape:
{
  "transcript": "clean verbatim transcript of what the user said",
  "updates": [
    {
      "spokenText": "the spoken phrase for this item",
      "action": "use" | "finish" | "set_level" | "restock" | "add_new",
      "matchedItemId": "exact_id_from_existingItems_or_null",
      "name": "Clean English product name",
      "alias": "Natural Persian alias",
      "amount": 2,
      "unit": "egg | cup | L | g | bag | container | %",
      "addPortions": 8,
      "newRemainingPortions": 6,
      "newLevelPercent": 50,
      "storeId": "matching_store_id_or_null",
      "reason": "Short clear summary e.g. Used 2 cups (500ml)",
      "category": "protein" | "dairy" | "produce" | "beverages" | "grains" | "condiments" | "spices" | "pantry_staple" | "snacks" | "prepared",
      "zone": "fridge" | "freezer" | "pantry",
      "trackingMode": "portioned" | "continuous",
      "packDescription": "e.g. 4L jug, 12 eggs",
      "initialTotalPortions": 6,
      "portionLabel": "e.g. egg, 1 cup, container"
    }
  ]
}`;

      const parts: unknown[] = [
        {
          text: `Language hint: ${languageHint || 'auto (English or Farsi)'}.
Known stores: ${JSON.stringify(stores || [])}.
Current Kitchen Inventory (match matchedItemId & calculate exact before->after values using these): ${JSON.stringify(
            (existingItems || []).slice(0, 120)
          )}.
${transcript ? `Spoken/typed text: "${transcript}"` : 'Listen to the attached audio and extract every kitchen stock update:'}`,
        },
      ];

      if (audioBase64) {
        parts.push({
          inlineData: {
            mimeType: audioMimeType || 'audio/webm',
            data: audioBase64,
          },
        });
      }

      const result = await callGemini(geminiKey, parts, system);

      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected Edge Function error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
