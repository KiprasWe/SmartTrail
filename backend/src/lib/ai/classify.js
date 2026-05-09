// lib/ai/classify.js — request classification + intent decomposition.
//
// classifyAndDecompose() — single Gemini call: classify mode + generate intents

import { Type } from "@google/genai";
import {
  genai,
  GEMINI_MODEL,
  LANG_INSTRUCTIONS,
  PROFILE_FALLBACK_THEME,
  ROUTE_SYSTEM_INSTRUCTION,
  sanitizePromptInput,
} from "./shared.js";
import { createAiTrace } from "./trace.js";

const ALLOWED_ORS_GROUPS = [
  "animals",
  "arts_and_culture",
  "historic",
  "leisure_and_entertainment",
  "natural",
  "public_places",
  "shops",
  "sustenance",
  "tourism",
];

const INTENT_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      theme: {
        type: Type.STRING,
        description: "2-8 word theme describing what to look for.",
      },
      places_type: {
        type: Type.STRING,
        description: `One of: ${ALLOWED_ORS_GROUPS.join(", ")}. Use "tourism" if none fits.`,
      },
      count: { type: Type.INTEGER, description: "Max results to fetch, 1-8." },
      travel_heading: {
        type: Type.INTEGER,
        description:
          "Loop-only: preferred initial direction. 0 = no preference. 1=N, 2=NE, 3=E, 4=SE, 5=S, 6=SW, 7=W, 8=NW.",
      },
    },
    required: ["theme", "places_type", "count", "travel_heading"],
    propertyOrdering: ["theme", "places_type", "count", "travel_heading"],
  },
};

const CLASSIFY_DECOMPOSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    mode: { type: Type.STRING },
    named_places: { type: Type.ARRAY, items: { type: Type.STRING } },
    has_categories: { type: Type.BOOLEAN },
    intents: INTENT_SCHEMA,
  },
  required: ["mode", "named_places", "has_categories", "intents"],
  propertyOrdering: ["mode", "named_places", "has_categories", "intents"],
};

function buildPrompt({ profileLabel, preferences, area, hasEnd, placeStart, placeEnd, distanceKm, lang = "en" }) {
  const rawPrefs = sanitizePromptInput(preferences, 400);
  const fallback = PROFILE_FALLBACK_THEME[profileLabel] ?? "scenic viewpoints and local landmarks";
  const langInstr = LANG_INSTRUCTIONS[lang] ?? LANG_INSTRUCTIONS.en;
  const tripLine = hasEnd
    ? `${profileLabel} from "${placeStart ?? "start"}" to "${placeEnd ?? "destination"}" (~${Math.round(distanceKm)} km).`
    : `${profileLabel} round trip from "${placeStart ?? "start"}" (~${Math.round(distanceKm)} km).`;

  return [
    `You are an expert local tour guide and trip-planning assistant.`,
    langInstr,
    `Perform two tasks simultaneously for this travel request.`,
    ``,
    `Trip: ${tripLine}`,
    area ? `Area: ${area}.` : null,
    rawPrefs
      ? `User's request:\n<user_request>${rawPrefs}</user_request>`
      : `No specific request. Use default theme: ${fallback}.`,
    ``,
    `━━━ TASK 1: CLASSIFY ━━━`,
    `Determine mode, named_places, and has_categories.`,
    ``,
    `mode:`,
    `  "named"    → user wants ONLY specific named places (e.g. "visit Trakai Castle")`,
    `  "category" → user wants types/themes (e.g. "some parks", "WWII history", "nature")`,
    `  "mixed"    → user wants BOTH named places AND category themes`,
    ``,
    `named_places: specific place names the user mentioned.`,
    `  Handle: grammatical case, misspellings, missing diacritics, partial names.`,
    `  Return canonical nominative/dictionary form with proper capitalisation.`,
    `  NOT named: generic words like "nature", "parks", "restaurants", "history".`,
    ``,
    `has_categories: true if any generic theme/category interest present.`,
    ``,
    `━━━ TASK 2: INTENTS ━━━`,
    `Based on your classification, generate POI search intents:`,
    `  CATEGORY mode → 2-5 intents covering the user's themes.`,
    `  NAMED mode    → intents = [] (named places drive the route).`,
    `  MIXED mode    → 2-4 intents for the CATEGORY parts ONLY. Do NOT create intents for the named places.`,
    `  No request    → 2-3 intents, count=6-8, use default theme: ${fallback}.`,
    ``,
    `TYPE MAPPING (use ONLY the group names listed above):`,
    `  "nature / forest / woods / green / reserves / lake / river / beach / dune / coast" → natural`,
    `  "viewpoint / panorama / scenic / overlook / observation point"                     → tourism`,
    `  "tourist attraction / sightseeing / must-see / hidden gems / interesting places"   → tourism`,
    `  "castle / ruins / fort / bunker / manor / palace / old building / city walls"      → historic`,
    `  "history / heritage / WWII / war / military / archaeology / cultural"              → historic`,
    `  "church / cathedral / monastery / chapel / shrine / abbey"                         → historic`,
    `  "monument / memorial / statue / obelisk / hill fort / grave"                       → historic`,
    `  "museum / gallery / theatre / cinema / arts centre / exhibition"                   → arts_and_culture`,
    `  "eat / food / restaurant / lunch / dinner / dining"                                → sustenance`,
    `  "cafe / coffee / bakery / bar / pub / drinks / beer"                               → sustenance`,
    `  "zoo / aquarium / wildlife park / animal farm"                                     → animals`,
    `  "sports / stadium / pool / fitness / recreation / bowling / climbing"              → leisure_and_entertainment`,
    `  "amusement park / theme park / fun / entertainment venue"                          → leisure_and_entertainment`,
    `  "square / plaza / fountain / promenade / public garden / market square"            → public_places`,
    `  "market / craft shop / souvenir / local shop / boutique / mall"                   → shops`,
    `  Local-language synonyms map to the same group.`,
    `  NEVER use leisure_and_entertainment for casinos, gambling, strip clubs, or adult entertainment.`,
    ``,
    `CREATIVE THINKING — for vague or broad requests, think about what actually exists near the route:`,
    `  "WWII / war / military" → forts, war memorials, bunkers, military museums typical to this region`,
    `  "manors / estates / castles" → historic manor houses, palaces, castle ruins of the local area`,
    `  "nature" near coast → dunes, beaches, viewpoints, nature reserves, seaside paths`,
    `  "nature" inland → forests, lakes, hiking areas, natural parks, scenic viewpoints`,
    `  "sea / maritime" → maritime museums, harbors, old fortifications, ferry points`,
    `  "history" → castle ruins, churches, monuments, historic museums relevant to local culture`,
    `  DO NOT name specific places — generate search themes that find what actually exists there.`,
    `  When in doubt: 2-3 intents covering different facets of the theme, not one broad catch-all.`,
    ``,
    `RULES:`,
    `1. "a X" / "one X" / "stop for" → count=1-2.`,
    `2. "some X" / "a few X" → count=2-4.`,
    `3. Broad category ("parks", "nature", "historic sites") → count=6-8.`,
    `4. Split big themes: "history and nature" → separate intents for each.`,
    `5. No preferences → 2-3 intents for the profile default theme, count=6-8 each.`,
    ``,
    `LOOP DIRECTION (round trips only):`,
    `- If the user expresses a directional preference (e.g. "south of the city", "go north", "eastern side"),`,
    `  set travel_heading in every intent to match: 1=N, 2=NE, 3=E, 4=SE, 5=S, 6=SW, 7=W, 8=NW.`,
    `- Otherwise set travel_heading=0.`,
  ]
    .filter(Boolean)
    .join("\n");
}

function normalizeIntents(parsed, trace) {
  if (!Array.isArray(parsed)) return [];
  const allowed = new Set(ALLOWED_ORS_GROUPS);
  const normalized = parsed
    .filter((p) => p && typeof p === "object")
    .map((p) => {
      const theme = String(p.theme ?? "").trim().slice(0, 150);
      if (!theme) return null;
      const rawType = String(p.places_type ?? "").trim();
      const coercedType = allowed.has(rawType) ? rawType : "tourism";
      if (trace?.enabled) {
        trace.decision("intent_normalize", {
          raw: {
            theme: String(p.theme ?? "").trim().slice(0, 150) || null,
            places_type: rawType || null,
            count: p.count ?? null,
            travel_heading: p.travel_heading ?? null,
          },
          normalized: {
            theme,
            places_type: coercedType,
            count: Math.max(1, Math.min(Number(p.count) || 3, 8)),
            travel_heading: Math.max(0, Math.min(Number(p.travel_heading) || 0, 8)),
          },
          fixes: {
            places_type_fallback: allowed.has(rawType) ? null : "tourism",
            theme_empty_dropped: null,
          },
        });
      }
      return {
        theme,
        places_type: coercedType,
        count: Math.max(1, Math.min(Number(p.count) || 3, 8)),
        travel_heading: Math.max(0, Math.min(Number(p.travel_heading) || 0, 8)),
      };
    })
    .filter(Boolean)
    .slice(0, 6);
  return normalized;
}

export async function classifyAndDecompose({
  preferences,
  profileLabel,
  area,
  hasEnd,
  placeStart,
  placeEnd,
  distanceKm,
  lang = "en",
  trace,
}) {
  const fallback = { mode: "category", namedPlaces: [], hasCategories: true, intents: [] };
  if (!genai || !preferences?.trim()) return fallback;

  const t = trace ?? createAiTrace({ enabled: false });
  const prompt = buildPrompt({ profileLabel, preferences, area, hasEnd, placeStart, placeEnd, distanceKm, lang });

  try {
    const r = await genai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        systemInstruction: ROUTE_SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseJsonSchema: CLASSIFY_DECOMPOSE_SCHEMA,
        temperature: 0.3,
      },
    });

    let parsed;
    try {
      parsed = JSON.parse(r.text ?? "");
    } catch {
      const t = (r.text ?? "").trim();
      const s = t.indexOf("{");
      const e = t.lastIndexOf("}");
      if (s !== -1 && e > s) {
        try { parsed = JSON.parse(t.slice(s, e + 1)); } catch { parsed = null; }
      }
    }

    if (!parsed || !["category", "named", "mixed"].includes(parsed.mode)) {
      console.warn("[classify] Invalid result, using defaults");
      return fallback;
    }

    const namedPlaces = (Array.isArray(parsed.named_places) ? parsed.named_places : [])
      .filter((x) => typeof x === "string" && x.trim().length > 1)
      .map((x) => x.trim())
      .slice(0, 8);

    const rawIntents = Array.isArray(parsed.intents) ? parsed.intents : [];
    const intents = normalizeIntents(rawIntents, t);

    t.summary("classify_result", {
      mode: parsed.mode,
      named_places_count: namedPlaces.length,
      intents_raw_count: Array.isArray(rawIntents) ? rawIntents.length : 0,
      intents_normalized_count: intents.length,
      has_categories: Boolean(parsed.has_categories),
    });

    console.log(
      `[classify] mode=${parsed.mode.toUpperCase()} | named: [${namedPlaces.join(", ")}] | intents: ${intents.length}`,
    );

    return {
      mode: parsed.mode,
      namedPlaces,
      hasCategories: Boolean(parsed.has_categories),
      intents,
    };
  } catch (err) {
    console.warn(`[classify] Failed: ${err.message}, using defaults`);
    return fallback;
  }
}
