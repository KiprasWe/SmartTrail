// lib/ai/classify.js — request classification + intent decomposition.
//
// Two Gemini calls live here:
//   detectMode()       — classify as category / named / mixed
//   decomposeIntent()  — break the request into 2-5 structured search intents
//
// Plus the thin wrapper around resolveNamedPois() and the trip-distance cap
// helper (named stops uncap the budget — router must reach them).

import { Type } from "@google/genai";
import { resolveNamedPois } from "../places.js";
import {
  genai,
  GEMINI_MODEL,
  LANG_INSTRUCTIONS,
  PROFILE_FALLBACK_THEME,
  sanitizePromptInput,
  extractJsonArray,
} from "./shared.js";

// ─── Mode detection ───────────────────────────────────────────────────────────
//
// Receives the full discovered POI pool so Gemini can match user's free-text
// names against real OSM names. Returns EXACT names from the pool so
// resolveNamedPois() can look them up with a guaranteed hit.

export async function detectMode(
  preferences,
  genaiClient = genai,
  model = GEMINI_MODEL,
  discoveredPois = [],
) {
  if (!preferences?.trim()) {
    return { mode: "category", namedPlaces: [], hasCategories: true };
  }
  if (!genaiClient) {
    return { mode: "category", namedPlaces: [], hasCategories: true };
  }

  // Prioritise historically/culturally significant types for the name list
  // since those are most likely to be referred to by name by users.
  const priorityTypes = new Set([
    "historical_landmark",
    "tourist_attraction",
    "monument",
    "museum",
    "church",
    "national_park",
    "art_gallery",
  ]);
  const sortedPool = [
    ...discoveredPois.filter((p) => priorityTypes.has(p.primary_type)),
    ...discoveredPois.filter((p) => !priorityTypes.has(p.primary_type)),
  ].slice(0, 300);

  const poiListStr =
    sortedPool.length > 0
      ? sortedPool.map((p) => `- "${p.name}" [${p.primary_type}]`).join("\n")
      : "(no POIs discovered yet)";

  const prompt = [
    `Analyse this travel request and classify it. Return JSON only.`,
    ``,
    `Request: "${preferences.trim().slice(0, 400)}"`,
    ``,
    `AVAILABLE PLACES IN THE AREA (real OSM names):`,
    poiListStr,
    ``,
    `Rules:`,
    `- named_places: specific named places the user wants to visit.`,
    `  Match the user's text against the AVAILABLE PLACES list. Handle ALL of these:`,
    `  - Grammatical case changes (Lithuanian declension):`,
    `      "vingio parka" → "Vingio parkas" (locative/genitive → nominative)`,
    `      "katedros aikštėje" → "Katedros aikštė" (locative → nominative)`,
    `      "gedimino prospekte" → "Gedimino prospektas" (locative → nominative)`,
    `  - Misspellings: "pypliu piliakalnis" → "Pyplių piliakalnis"`,
    `  - Missing diacritics: "zalgirio arena" → "Žalgirio arena"`,
    `  - Abbreviations: "PN" → "Pažaislio monasterynas"`,
    `  Always return the EXACT name from the AVAILABLE PLACES list when a match is found.`,
    `  If no match found in list, return the canonical NOMINATIVE dictionary form`,
    `  (e.g. "vingio parka" → "Vingio parkas", NOT the user's inflected form).`,
    `  Use proper capitalisation.`,
    `  NOT named places: "gamta", "nature", "parkai", "restaurants", "history"`,
    ``,
    `- has_categories: true if ANY generic category interest present`,
    `  (nature, parks, history, food, scenic, culture, lakes, forests, etc.)`,
    ``,
    `- mode:`,
    `  "named"    → named_places non-empty AND has_categories false`,
    `  "mixed"    → named_places non-empty AND has_categories true`,
    `  "category" → named_places empty`,
    ``,
    `Return ONLY valid JSON: { "mode": "...", "named_places": [...], "has_categories": true/false }`,
  ].join("\n");

  try {
    const r = await genaiClient.models.generateContent({
      model,
      contents: prompt,
      config: { responseMimeType: "application/json", temperature: 0.1 },
    });

    let parsed;
    try {
      parsed = JSON.parse(r.text ?? "");
    } catch {
      const t = (r.text ?? "").trim();
      const s = t.indexOf("{");
      const e = t.lastIndexOf("}");
      if (s !== -1 && e > s) {
        try {
          parsed = JSON.parse(t.slice(s, e + 1));
        } catch {
          parsed = null;
        }
      }
    }

    if (!parsed || !["category", "named", "mixed"].includes(parsed.mode)) {
      console.warn("[mode] Invalid result, defaulting to category");
      return { mode: "category", namedPlaces: [], hasCategories: true };
    }

    const namedPlaces = (
      Array.isArray(parsed.named_places) ? parsed.named_places : []
    )
      .filter((x) => typeof x === "string" && x.trim().length > 1)
      .map((x) => x.trim())
      .slice(0, 8);

    const result = {
      mode: parsed.mode,
      namedPlaces,
      hasCategories: Boolean(parsed.has_categories),
    };

    console.log(
      `[mode] ${result.mode.toUpperCase()} | named: [${result.namedPlaces.join(", ")}] | categories: ${result.hasCategories}`,
    );

    return result;
  } catch (err) {
    console.warn(
      `[mode] Detection failed: ${err.message} — defaulting to category`,
    );
    return { mode: "category", namedPlaces: [], hasCategories: true };
  }
}

// ─── Named POI pre-pass ───────────────────────────────────────────────────────
// Thin wrapper — resolveNamedPois in places.js does the real work against pool.

export async function runNamedPoiPrepass(
  namedPlaces,
  searchCtx,
  discoveredPois = [],
) {
  return resolveNamedPois(namedPlaces, discoveredPois, searchCtx);
}

// ─── Distance cap ─────────────────────────────────────────────────────────────
// Named stops override the user's distance budget — router must reach them.

export function getEffectiveTripDistance(tripDistanceM, namedPoisCount) {
  if (namedPoisCount > 0) {
    console.log(
      `[namedPOI] Distance cap removed — ${namedPoisCount} named stops, routing uncapped.`,
    );
    return Infinity;
  }
  return tripDistanceM;
}

// ─── Intent decomposition ─────────────────────────────────────────────────────

export const ALLOWED_PLACES_TYPES = [
  "restaurant",
  "cafe",
  "bakery",
  "bar",
  "meal_takeaway",
  "tourist_attraction",
  "museum",
  "art_gallery",
  "historical_landmark",
  "church",
  "monument",
  "park",
  "national_park",
  "zoo",
  "aquarium",
  "amusement_park",
  "shopping_mall",
  "stadium",
];

const INTENT_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      theme: {
        type: Type.STRING,
        description: "2-8 word Google Places text query.",
      },
      places_type: {
        type: Type.STRING,
        description: `One of: ${ALLOWED_PLACES_TYPES.join(", ")}. Empty string if none fits.`,
      },
      location_scope: {
        type: Type.STRING,
        description: "One of: along_route, at_end, at_start, in_area.",
      },
      specific_area: {
        type: Type.STRING,
        description: "Named town/village if specified, else empty string.",
      },
      count: { type: Type.INTEGER, description: "Max results to fetch, 1-8." },
    },
    required: [
      "theme",
      "places_type",
      "location_scope",
      "specific_area",
      "count",
    ],
    propertyOrdering: [
      "theme",
      "places_type",
      "location_scope",
      "specific_area",
      "count",
    ],
  },
};

function buildIntentPrompt({
  mode,
  profileLabel,
  preferences,
  area,
  hasEnd,
  placeStart,
  placeEnd,
  distanceKm,
  lang = "en",
  namedPlaces = [],
}) {
  const rawPrefs = sanitizePromptInput(preferences, 400);
  const fallback =
    PROFILE_FALLBACK_THEME[profileLabel] ??
    "scenic viewpoints and local landmarks";
  const langInstr = LANG_INSTRUCTIONS[lang] ?? LANG_INSTRUCTIONS.en;
  const tripLine = hasEnd
    ? `${profileLabel} from "${placeStart ?? "start"}" to "${placeEnd ?? "destination"}" (~${Math.round(distanceKm)} km).`
    : `${profileLabel} round trip from "${placeStart ?? "start"}" (~${Math.round(distanceKm)} km).`;

  const modeRules = {
    category: [
      `CATEGORY MODE: Decompose the user's category/theme request into search intents.`,
      `Generate 2-5 varied intents covering the themes the user mentioned.`,
    ],
    named: [
      `NAMED MODE: User named specific places. DO NOT generate category intents.`,
      `Only generate intents for: ${namedPlaces.join(", ")}.`,
      `One intent per named place, count=1, use the exact name as the theme.`,
    ],
    mixed: [
      `MIXED MODE: User named anchors AND wants category recommendations.`,
      `Named anchors (already found, do NOT include): ${namedPlaces.join(", ")}.`,
      `Generate 2-4 category intents for the OTHER things the user mentioned.`,
    ],
  };

  return [
    `You are an expert local tour guide AND trip-planning assistant.`,
    `Your job: understand what the user REALLY wants and turn it into concrete POI search intents.`,
    `Think like a local guide who knows the region — what actually exists here that fits the request?`,
    `Trip: ${tripLine}`,
    area ? `Area: ${area}.` : null,
    rawPrefs
      ? `User's request: "${rawPrefs}"`
      : `No specific request. Use default theme: ${fallback}.`,
    ``,
    ...(modeRules[mode] ?? modeRules.category),
    ``,
    `TYPE MAPPING — translate the user's language to places_type:`,
    `  "WWII / war / military / forts / fortifications / bunkers" → historical_landmark + monument`,
    `  "manor / estate / palace / castle / ruins / old building / dvaras / pilis" → historical_landmark`,
    `  "history / historic / heritage / cultural" → historical_landmark + monument`,
    `  "nature / forest / woods / green / trails / reserves" → park + tourist_attraction`,
    `  "viewpoint / panorama / observation / views / overlook" → tourist_attraction`,
    `  "dune / beach / coast / spit / seaside / shore" → tourist_attraction`,
    `  "eat / food / lunch / dinner / restaurant / cafe / coffee" → restaurant or cafe`,
    `  "eat/stop AT [PLACE NAME]" → restaurant/cafe + location_scope "in_area" + specific_area=[PLACE]`,
    `  "church / cathedral / monastery / chapel" → church`,
    `  "memorial / monument / statue / obelisk / piliakalnis (hill fort)" → monument`,
    `  "museum" → museum (separate from historical_landmark)`,
    ``,
    `CREATIVE THINKING — for vague requests, think about what actually exists in this region:`,
    `  "WWII" near Kaunas → IX Fort, Pažaislis, fortification forts encircling the city, WWII memorials`,
    `  "manors" in central Lithuania → historic manor houses (dvаrai) like Raudondvaris, Lentvaris, Trakų Vokė`,
    `  "nature" on Curonian Spit → dunes (Parnidžio, Didžioji kopa), viewpoints, pine forests`,
    `  "sea / maritime" in Klaipėda → Sea Museum, Smiltynė ferry, Old Town fortifications`,
    `  "history" in Vilnius → castle ruins, churches, Old Town monuments, museums`,
    `  When in doubt: generate 2-3 intents covering different facets of the theme.`,
    ``,
    `RULES:`,
    `1. Named specific places → use exact name as theme, count=1.`,
    `2. Food at a specific town → location_scope "in_area", specific_area=that town name.`,
    `3. A→B trips: don't suggest backtracking toward the start.`,
    `4. QUANTITY: "a X" / "one X" / "stop for" → count=1-2.`,
    `5. QUANTITY: "some X" / "a few X" → count=2-4.`,
    `6. QUANTITY: broad category ("parks", "nature", "historic sites") → count=6-8, be generous.`,
    `7. No preferences → count=6-8, pick the most interesting for this profile and region.`,
    `8. Split big themes: "history and nature" → separate intents for each.`,
    langInstr,
  ]
    .filter(Boolean)
    .join("\n");
}

function normalizeIntents(parsed) {
  if (!Array.isArray(parsed)) return [];
  const allowed = new Set(ALLOWED_PLACES_TYPES);
  const validScopes = new Set(["along_route", "at_end", "at_start", "in_area"]);
  return parsed
    .filter((p) => p && typeof p === "object")
    .map((p) => {
      const theme = String(p.theme ?? "")
        .trim()
        .slice(0, 150);
      if (!theme) return null;
      const rawType = String(p.places_type ?? "").trim();
      const rawScope = String(p.location_scope ?? "along_route").trim();
      return {
        theme,
        places_type: allowed.has(rawType) ? rawType : "",
        location_scope: validScopes.has(rawScope) ? rawScope : "along_route",
        specific_area: String(p.specific_area ?? "")
          .trim()
          .slice(0, 100),
        count: Math.max(1, Math.min(Number(p.count) || 3, 8)),
      };
    })
    .filter(Boolean)
    .slice(0, 6);
}

export async function decomposeIntent(opts) {
  if (!genai) return [];
  const prompt = buildIntentPrompt(opts);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await genai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseJsonSchema: INTENT_SCHEMA,
          temperature: 0.4,
        },
      });
      let parsed;
      try {
        parsed = JSON.parse(r.text ?? "");
      } catch {
        parsed = extractJsonArray(r.text ?? "");
      }
      const intents = normalizeIntents(parsed);
      if (intents.length) {
        console.log(
          `[aiRouting] Intents (${intents.length}): ${JSON.stringify(intents)}`,
        );
        return intents;
      }
    } catch (err) {
      console.warn(
        `[aiRouting] Intent decomp attempt ${attempt + 1}: ${err.message}`,
      );
      if (attempt === 0) await new Promise((r) => setTimeout(r, 500));
    }
  }
  return [];
}
