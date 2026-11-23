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

const GEMINI_MODEL = 'gemini-2.5-flash';

async function callGemini(apiKey: string, parts: unknown[], systemInstruction: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(
    apiKey
  )}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0.4,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errText.slice(0, 300)}`);
  }

  const data = await response.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error('Gemini returned an empty response');
  }
  return JSON.parse(rawText);
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
      "category": "protein" | "dairy" | "produce" | "grains" | "pantry_staple" | "snacks",
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
