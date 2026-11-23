// Supabase Edge Function: gemini-assistant
// Deploy with: supabase functions deploy gemini-assistant
// Set secret with: supabase secrets set GEMINI_API_KEY=your_key_here
//
// Security:
// 1. Verifies caller's Supabase Auth JWT
// 2. Verifies caller exists in public.household_members
// 3. Keeps GEMINI_API_KEY strictly server-side (never exposed to GitHub or browser)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
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

    const body = await req.json();
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
