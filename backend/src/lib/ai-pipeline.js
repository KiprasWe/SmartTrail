import { GoogleGenAI, Type } from "@google/genai";
import { haversineM, routeBbox, polylineCorridorFilter } from "./geo.js";
import { buildPetalWaypoints, DETOUR_FACTOR } from "./loop-algo.js";
import {
  reverseGeocodePlaceName,
  fetchPlacesByIds,
  searchPlacesForAllIntents,
} from "./places.js";
import {
  fetchORSDirections,
  fetchORSRoundTrip,
  orsFeatureToRouteData,
} from "./ors.js";
import { PROFILE_CONFIGS } from "./profiles.js";
import { PipelineError, Errors } from "../utils/responses.js";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const ORS_API_KEY = process.env.ORS_API_KEY;

// Maximum waypoints passed to ORS — purely a routing-reliability cap.
// The user sees ALL curated POIs on the map regardless of this number.
const ORS_WAYPOINT_CAP = 20;

const genai = GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: GEMINI_API_KEY })
  : null;

// ─── Shared helpers ───────────────────────────────────────────────────────────

function sanitizePromptInput(raw, maxLen = 400) {
  if (!raw || typeof raw !== "string") return "";
  return raw
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .trim()
    .slice(0, maxLen);
}

function extractJsonArray(text) {
  if (!text) return null;
  let t = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(t);
  } catch {
    const s = t.indexOf("[");
    const e = t.lastIndexOf("]");
    if (s !== -1 && e > s) {
      try {
        return JSON.parse(t.slice(s, e + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

const LANG_INSTRUCTIONS = {
  lt: "Respond in Lithuanian. Use Lithuanian place names where they exist.",
  en: "Respond in English.",
};

const PROFILE_FALLBACK_THEME = {
  Walking: "scenic viewpoints, hidden gems, and local landmarks",
  Hiking: "natural landmarks, sweeping viewpoints, and forest trails",
  Running: "parks, riverside paths, and green spaces",
  Cycling: "parks, panoramic viewpoints, and cultural landmarks",
  "Mountain Biking": "forests, technical trails, and natural viewpoints",
  "Road Cycling": "scenic roads, coffee stops, and cultural highlights",
  "E-Bike": "parks, scenic routes, and cultural landmarks",
};

// Detour tolerance per ORS profile (metres). Used for scoring fallback only.
const DETOUR_TOLERANCE = {
  "foot-walking": 800,
  "foot-hiking": 1200,
  running: 600,
  "cycling-regular": 2000,
  "cycling-road": 3000,
  "cycling-mountain": 2500,
  "cycling-electric": 2500,
};

function dedupPois(pois) {
  const seen = new Set();
  return pois.filter((poi) => {
    if (!poi) return false;
    if (poi.place_id) {
      if (seen.has(poi.place_id)) return false;
      seen.add(poi.place_id);
      return true;
    }
    if (
      typeof poi.lat === "number" &&
      typeof poi.lng === "number" &&
      isFinite(poi.lat) &&
      isFinite(poi.lng)
    ) {
      const key = `${poi.lat.toFixed(5)},${poi.lng.toFixed(5)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }
    console.warn("[aiRouting] Dropping POI with missing coords:", poi.name);
    return false;
  });
}

// ─── Route anchor sampling ────────────────────────────────────────────────────
// We sample evenly-spaced anchor points along the real road route and run one
// Gemini Maps Grounding call per anchor. This ensures POIs are discovered along
// the ENTIRE corridor, not just near the start.

function numAnchors(distanceKm) {
  if (distanceKm < 15) return 1;
  if (distanceKm < 40) return 2;
  if (distanceKm < 80) return 3;
  return 4;
}

function sampleRouteAnchors(coords, n) {
  if (!coords?.length || n <= 0) return [];
  if (coords.length === 1 || n === 1) {
    return [coords[Math.floor(coords.length / 2)]];
  }
  const cumul = [0];
  for (let i = 1; i < coords.length; i++) {
    cumul.push(cumul[i - 1] + haversineM(coords[i - 1], coords[i]));
  }
  const total = cumul[cumul.length - 1];
  return Array.from({ length: n }, (_, a) => {
    const target = (a / (n - 1)) * total;
    let i = 0;
    while (i < cumul.length - 1 && cumul[i + 1] < target) i++;
    return coords[i];
  });
}

function segmentLabel(idx, total) {
  if (total === 1) return "throughout the entire journey";
  const map = [
    "near the start (first quarter)",
    "midway through",
    "in the third quarter",
    "near the destination (final section)",
  ];
  return map[Math.min(idx, map.length - 1)] ?? `segment ${idx + 1} of ${total}`;
}

// ─── Gemini Maps Grounding (per anchor) ──────────────────────────────────────
// Grounding's strength is surfacing FAMOUS NAMED PLACES that the user explicitly
// mentioned, or iconic landmarks that Maps data knows about. Generic category
// discovery (parks, museums, tourist_attraction) is handled better by the
// baseline Places text search which runs in parallel.

function buildGroundingPrompt({
  segment,
  profileLabel,
  preferences,
  area,
  hasEnd,
  placeStart,
  placeEnd,
  distanceKm,
  lang,
}) {
  const safePrefs = sanitizePromptInput(preferences, 400);
  const langInstr = LANG_INSTRUCTIONS[lang] ?? LANG_INSTRUCTIONS.en;
  const tripDesc = hasEnd
    ? `${profileLabel} from "${placeStart || "the start"}" to "${placeEnd || "the destination"}" (~${Math.round(distanceKm)} km)`
    : `${profileLabel} round trip from "${placeStart || "the start"}" (~${Math.round(distanceKm)} km)`;

  return [
    `You are a local expert helping a traveller on a ${tripDesc}.`,
    area ? `Area of focus: ${area}.` : null,
    `TRAVELLER'S REQUEST: "${safePrefs || "Show me the best highlights of this area."}"`,
    ``,
    `TASK: Use Google Maps to find real, verified places ${segment}.`,
    ``,
    `PRIORITISE in this order:`,
    `1. Any specific named place the traveller mentioned — find it exactly and include it`,
    `2. UNESCO sites, national heritage landmarks, castles, ruins, famous historical sites`,
    `3. Iconic natural features: famous viewpoints, national parks, famous lakes/rivers`,
    `4. Well-known cultural institutions: major museums, important churches, art landmarks`,
    `5. Local highlights that appear in travel guides for this specific region`,
    ``,
    `AVOID unless the traveller specifically asked for them:`,
    `• Generic chain restaurants or ordinary cafés`,
    `• Supermarkets, petrol stations, or other utility stops`,
    `• Places with few reviews or unknown quality`,
    ``,
    `Every result must be a real, Google Maps-verified place. No hallucinations.`,
    ``,
    langInstr,
  ]
    .filter(Boolean)
    .join("\n");
}

async function discoverForAnchor({ anchor, segment, groundingOpts }) {
  if (!genai) return [];
  const prompt = buildGroundingPrompt({ segment, ...groundingOpts });

  try {
    const response = await genai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        tools: [{ googleMaps: {} }],
        toolConfig: {
          retrievalConfig: {
            latLng: { latitude: anchor[1], longitude: anchor[0] },
          },
        },
        temperature: 0.6,
      },
    });

    const chunks =
      response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    const seen = new Set();
    const entries = [];

    for (const chunk of chunks) {
      if (!chunk.maps?.placeId) continue;
      const raw = chunk.maps.placeId;
      const placeId = raw.startsWith("places/") ? raw.slice(7) : raw;
      if (!placeId || seen.has(placeId)) continue;
      seen.add(placeId);
      entries.push({ placeId, title: chunk.maps.title ?? "" });
    }

    console.log(
      `[aiRouting] Grounding [${segment}]: ${entries.length} places — ${entries.map((e) => e.title).join(", ") || "(none)"}`,
    );
    return entries;
  } catch (err) {
    console.warn(
      `[aiRouting] Grounding failed for anchor [${anchor[0].toFixed(4)}, ${anchor[1].toFixed(4)}]: ${err.message}`,
    );
    return [];
  }
}

// Run one grounding call per anchor in parallel, merge + deduplicate.
async function discoverMultiAnchor(anchors, groundingOpts) {
  const results = await Promise.all(
    anchors.map((anchor, idx) =>
      discoverForAnchor({
        anchor,
        segment: segmentLabel(idx, anchors.length),
        groundingOpts,
      }),
    ),
  );

  const seen = new Set();
  const merged = [];
  for (const list of results) {
    for (const entry of list) {
      if (!seen.has(entry.placeId)) {
        seen.add(entry.placeId);
        merged.push(entry);
      }
    }
  }

  console.log(
    `[aiRouting] Multi-anchor total: ${merged.length} unique place IDs`,
  );
  return merged;
}

// ─── Intent decomposition → Places text search ───────────────────────────────
// Parses the user's free-text request into structured search intents, then
// runs Google Places text searches for each intent. Runs in parallel with
// grounding to supplement coverage (always, not just as a fallback).

const ALLOWED_PLACES_TYPES = [
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
        description:
          "2-8 word Google Places text query. For specific named places, use the exact name.",
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
        description:
          "Named town/village if the user specified one, else empty string.",
      },
      count: {
        type: Type.INTEGER,
        description: "Max results to fetch for this intent, 1-8.",
      },
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
  profileLabel,
  preferences,
  area,
  hasEnd,
  placeStart,
  placeEnd,
  distanceKm,
  lang = "en",
}) {
  const rawPrefs = sanitizePromptInput(preferences, 400);
  const fallback =
    PROFILE_FALLBACK_THEME[profileLabel] ??
    "scenic viewpoints and local landmarks";
  const langInstr = LANG_INSTRUCTIONS[lang] ?? LANG_INSTRUCTIONS.en;

  const tripLine = hasEnd
    ? `${profileLabel} from "${placeStart ?? "start"}" to "${placeEnd ?? "destination"}" (~${Math.round(distanceKm)} km).`
    : `${profileLabel} round trip from "${placeStart ?? "start"}" (~${Math.round(distanceKm)} km).`;

  return [
    `You are a trip-planning assistant. Decompose the user's request into structured Google Places search intents.`,
    `Trip: ${tripLine}`,
    area ? `Area: ${area}.` : null,
    rawPrefs
      ? `User's request: "${rawPrefs}"`
      : `No specific request. Use default theme: ${fallback}.`,
    ``,
    `Output 1-6 intents. Rules:`,
    `1. Named specific places (castles, specific restaurants, monuments by name) → create an intent with that exact name as the theme and count 1-2.`,
    `2. Food requests ("eat", "restaurant", "café") → places_type restaurant or cafe.`,
    `3. Named locations ("in Kaunas", "in Kačerginė") → location_scope "in_area", specific_area set.`,
    `4. General sightseeing → tourist_attraction or historical_landmark.`,
    `5. A→B trips: don't suggest backtracking toward the start.`,
    `6. Don't invent intents the user didn't request. If they only asked for food, return only food.`,
    `7. For open-ended requests, generate 2-4 varied intents covering the main themes of the trip.`,
    ``,
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

async function decomposeIntent(opts) {
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
        `[aiRouting] Intent decomposition attempt ${attempt + 1}: ${err.message}`,
      );
      if (attempt === 0) await new Promise((r) => setTimeout(r, 500));
    }
  }
  return [];
}

// ─── Baseline POI discovery ───────────────────────────────────────────────────
// Runs a broad sweep of common POI categories along the full corridor and at
// the destination. This is the primary discovery mechanism for ensuring the
// curation pool is always rich — regardless of whether grounding works well.
// Grounding supplements this with famous named places and user-specific requests.

const BASELINE_ALONG_ROUTE = [
  {
    theme: "tourist attractions sightseeing cultural",
    places_type: "tourist_attraction",
    count: 8,
  },
  {
    theme: "historical landmarks monuments castle ruins",
    places_type: "historical_landmark",
    count: 6,
  },
  {
    theme: "parks nature scenic viewpoints lakes",
    places_type: "park",
    count: 5,
  },
  { theme: "museums galleries exhibitions", places_type: "museum", count: 5 },
  {
    theme: "churches cathedrals historic architecture",
    places_type: "church",
    count: 4,
  },
];

const BASELINE_AT_DESTINATION = [
  {
    theme: "top attractions highlights must-see",
    places_type: "tourist_attraction",
    count: 15,
  },
  {
    theme: "historical landmarks heritage sites",
    places_type: "historical_landmark",
    count: 10,
  },
  {
    theme: "parks national park nature reserve",
    places_type: "national_park",
    count: 8,
  },
  { theme: "museums cultural institutions", places_type: "museum", count: 8 },
];

const BASELINE_AT_START = [
  {
    theme: "tourist attractions highlights",
    places_type: "tourist_attraction",
    count: 8,
  },
  {
    theme: "historical landmarks",
    places_type: "historical_landmark",
    count: 6,
  },
];

async function searchBaselinePois(ctx) {
  const { hasEnd } = ctx;

  const intents = [
    ...BASELINE_ALONG_ROUTE.map((b) => ({
      ...b,
      location_scope: "along_route",
      specific_area: "",
    })),
    ...(hasEnd
      ? BASELINE_AT_DESTINATION.map((b) => ({
          ...b,
          location_scope: "at_end",
          specific_area: "",
        }))
      : []),
    ...BASELINE_AT_START.map((b) => ({
      ...b,
      location_scope: "at_start",
      specific_area: "",
    })),
  ];

  const pois = await searchPlacesForAllIntents(intents, ctx).catch((err) => {
    console.warn("[aiRouting] Baseline search failed:", err.message);
    return [];
  });

  console.log(
    `[aiRouting] Baseline search: ${pois.length} POIs — ${pois.map((p) => p.name).join(" | ") || "(none)"}`,
  );
  return pois;
}

// ─── Tour guide curation ──────────────────────────────────────────────────────
// Gemini reads the full pool of discovered POIs and:
//  • Honours any specific named places the user requested
//  • Selects the best stops (decides the count — no artificial limit from us)
//  • Writes a personal tour guide note for each chosen stop
//  • Marks stops as essential (goes into ORS routing) or optional (map-only)
//  • Returns them ordered start → destination

const CURATION_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      place_id: {
        type: Type.STRING,
        description: "The exact place_id from the input list.",
      },
      guide_note: {
        type: Type.STRING,
        description:
          "1-2 vivid sentences in a tour guide voice: why this stop is special and what to do/see/taste there.",
      },
      essential: {
        type: Type.BOOLEAN,
        description:
          "true = must-visit stop that physically affects the route; false = nice-to-have, shown on map.",
      },
    },
    required: ["place_id", "guide_note", "essential"],
    propertyOrdering: ["place_id", "guide_note", "essential"],
  },
};

function buildCurationPrompt({
  pois,
  profileLabel,
  preferences,
  placeStart,
  placeEnd,
  hasEnd,
  distanceKm,
  lang,
}) {
  const safePrefs = sanitizePromptInput(preferences, 400);
  const langInstr = LANG_INSTRUCTIONS[lang] ?? LANG_INSTRUCTIONS.en;
  const tripDesc = hasEnd
    ? `${profileLabel} from "${placeStart || "start"}" to "${placeEnd || "destination"}" (~${Math.round(distanceKm)} km)`
    : `${profileLabel} round trip from "${placeStart || "start"}" (~${Math.round(distanceKm)} km)`;

  const poiList = pois
    .map(
      (p, i) =>
        `[${i + 1}] place_id="${p.place_id}" | ${p.name} (${p.primary_type ?? "place"}) | ` +
        `Rating: ${p.rating ?? "n/a"} (${p.user_rating_count ?? 0} reviews) | ` +
        `${p.formatted_address ?? ""} | ${p.editorial_summary || p.description || ""}`,
    )
    .join("\n");

  return [
    `You are an expert local tour guide curating stops for this trip:`,
    `TRIP: ${tripDesc}`,
    `TRAVELLER'S REQUEST: "${safePrefs || "No specific request — make it memorable."}"`,
    ``,
    `AVAILABLE PLACES (Google Maps verified):`,
    poiList,
    ``,
    `YOUR TASK — THREE CATEGORIES:`,
    ``,
    `ESSENTIAL (essential=true): Must-visit stops that physically change the route. Use for:`,
    `  • Iconic landmarks and major attractions the traveller should not miss`,
    `  • Any place the traveller specifically named or requested — ALWAYS include these`,
    `  • The top highlights of the journey (typically 4-10 for most trips)`,
    ``,
    `OPTIONAL (essential=false): Interesting places shown on the map as bonus markers. Use for:`,
    `  • Good places that are worth knowing about but don't need a detour`,
    `  • Secondary attractions, alternatives, or extra stops`,
    `  • WHEN IN DOUBT, mark as optional rather than excluding`,
    `  • Be GENEROUS with optional — include everything of reasonable quality`,
    ``,
    `EXCLUDE: ONLY places that are completely irrelevant (car parks, petrol stations,`,
    `  chain supermarkets, hardware stores) or clearly outside the route area.`,
    ``,
    `IMPORTANT: The traveller wants a RICH map with many visible stops. Do not drop`,
    `good POIs — if something has cultural, natural, historic, or food value and a`,
    `reasonable rating, include it as optional at minimum.`,
    ``,
    `For EACH included place, write a guide_note: 1-2 vivid tour-guide sentences`,
    `explaining what makes it special and what to do there.`,
    ``,
    `PRINCIPLES:`,
    `• Spread essential stops across the WHOLE route (start, middle, near destination)`,
    `• Balance culture, nature, food, history — don't cluster the same type`,
    `• Transport-aware: for ${profileLabel.toLowerCase()}, consider realistic detour distances`,
    ``,
    `Return a JSON array ordered start → destination. Only use place_ids from the list above.`,
    ``,
    langInstr,
  ]
    .filter(Boolean)
    .join("\n");
}

async function tourGuideCurate({
  pois,
  profileLabel,
  preferences,
  placeStart,
  placeEnd,
  hasEnd,
  distanceKm,
  lang,
}) {
  if (!genai || !pois.length) return null;

  const prompt = buildCurationPrompt({
    pois,
    profileLabel,
    preferences,
    placeStart,
    placeEnd,
    hasEnd,
    distanceKm,
    lang,
  });

  try {
    const r = await genai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: CURATION_SCHEMA,
        temperature: 0.65,
      },
    });

    let parsed;
    try {
      parsed = JSON.parse(r.text ?? "");
    } catch {
      parsed = extractJsonArray(r.text ?? "");
    }

    if (!Array.isArray(parsed) || !parsed.length) {
      console.warn("[aiRouting] Curation returned empty");
      return null;
    }

    const byId = new Map(pois.map((p) => [p.place_id, p]));
    const curated = parsed
      .filter((item) => item?.place_id && byId.has(item.place_id))
      .map((item) => ({
        ...byId.get(item.place_id),
        guide_note: String(item.guide_note ?? "").trim(),
        essential: Boolean(item.essential),
      }));

    const essential = curated.filter((p) => p.essential).length;
    const optional = curated.length - essential;
    console.log(
      `[aiRouting] Tour guide curated ${curated.length} stops (${essential} essential, ${optional} optional):\n` +
        curated
          .map(
            (p) =>
              `  ${p.essential ? "★" : "○"} ${p.name} — "${p.guide_note?.slice(0, 80)}..."`,
          )
          .join("\n"),
    );

    return curated.length ? curated : null;
  } catch (err) {
    console.warn("[aiRouting] Curation failed:", err.message);
    return null;
  }
}

// ─── Waypoint snapping ───────────────────────────────────────────────────────
// When a POI is very close to the route skeleton (within profile-specific threshold),
// snap its ORS waypoint to the nearest skeleton road point. This avoids ORS routing
// into dead-end access roads or tiny side streets for POIs that are effectively
// on or right beside the main road.
//
// POIs that require a meaningful detour (castles on islands, museums 500m off-road)
// keep their actual coords — ORS routes to them properly.
//
// The POI's display pin is always at the real location; only the routing waypoint
// gets snapped.

const SNAP_THRESHOLD_M = {
  "foot-walking": 150,
  "foot-hiking": 200,
  running: 100,
  "cycling-regular": 250,
  "cycling-road": 350,
  "cycling-mountain": 300,
  "cycling-electric": 280,
};

function snapToSkeleton(coord, skeletonCoords, profile) {
  const threshold = SNAP_THRESHOLD_M[profile] ?? 200;
  let bestDist = Infinity;
  let bestCoord = null;

  for (const sk of skeletonCoords) {
    const d = haversineM(coord, sk);
    if (d < bestDist) {
      bestDist = d;
      bestCoord = sk;
    }
  }

  // Only snap if the POI is within the threshold — it's essentially on the road.
  // Beyond that, use the actual POI coords so ORS routes to the real location.
  if (bestCoord && bestDist <= threshold) {
    return bestCoord;
  }
  return coord;
}

// ─── Scoring fallback ─────────────────────────────────────────────────────────
// Used only when curation fails. Scores POIs by distance to route + category.

function distanceToPolylineMeters(point, coords) {
  if (!coords?.length || coords.length < 2) return Infinity;
  let min = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    const d = haversineM(
      [point.lng, point.lat],
      [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
    );
    if (d < min) min = d;
  }
  return min;
}

function scoreFallback(poi, routeCoords) {
  let score = 50;
  const dist = distanceToPolylineMeters(poi, routeCoords);
  score -= Math.min(dist / 100, 30);
  if (poi.primary_type === "tourist_attraction") score += 20;
  if (poi.primary_type === "historical_landmark") score += 25;
  if (poi.primary_type === "museum") score += 15;
  if (poi.types?.includes("park")) score += 10;
  if (poi.types?.includes("natural_feature")) score += 15;
  if (poi.rating >= 4.5) score += 10;
  else if (poi.rating >= 4.0) score += 5;
  const nameLower = poi.name?.toLowerCase() ?? "";
  if (nameLower.includes("kirpykla") || nameLower.includes("autoservisas")) {
    score = -100;
  }
  return score;
}

// ─── POI ordering ─────────────────────────────────────────────────────────────

function sortPoisAlongLine(pois, start, end) {
  const [sx, sy] = start;
  const dx = end[0] - sx;
  const dy = end[1] - sy;
  const lenSq = dx * dx + dy * dy || 1;
  return [...pois]
    .map((p) => ({
      p,
      t: ((p.lng - sx) * dx + (p.lat - sy) * dy) / lenSq,
    }))
    .sort((a, b) => a.t - b.t)
    .map(({ p }) => p);
}

function sortPoisAroundLoop(pois, start) {
  if (pois.length <= 1) return [...pois];
  const remaining = [...pois];
  const sorted = [];
  let [curLng, curLat] = start;
  while (remaining.length) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineM(
        [curLng, curLat],
        [remaining[i].lng, remaining[i].lat],
      );
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const next = remaining.splice(bestIdx, 1)[0];
    sorted.push(next);
    curLng = next.lng;
    curLat = next.lat;
  }
  return sorted;
}

function enrichedPoiToFeature(poi, i) {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [poi.lng, poi.lat] },
    properties: {
      id: i,
      name: poi.name ?? null,
      category: poi.primary_type ?? poi.types?.[0] ?? null,
      distance_from_route: 0,
      // guide_note is the AI tour guide's personal description (if curated)
      // ai_description falls back to editorial summary from Google Places
      guide_note: poi.guide_note ?? null,
      ai_description:
        poi.guide_note ?? poi.editorial_summary ?? poi.description ?? null,
      essential: poi.essential ?? false,
      rating: poi.rating,
      user_rating_count: poi.user_rating_count,
      formatted_address: poi.formatted_address,
      website_uri: poi.website_uri,
      google_maps_uri: poi.google_maps_uri,
      editorial_summary: poi.editorial_summary,
      photo_name: poi.photo_name,
      place_id: poi.place_id,
    },
  };
}

// ─── ORS routing with waypoint fallback ──────────────────────────────────────
// ORS error 2010 means a waypoint is more than 350 m from any routable road
// (common for parks, viewpoints, buildings set back from the road).
// We parse which coordinate index failed, drop it, and retry until we succeed
// or run out of waypoints to drop.

async function fetchORSWithFallback(
  orsProfile,
  startCoord,
  midCoords,
  endCoord,
  opts = {},
  protectedCount = 0,
) {
  let waypoints = [...midCoords];

  for (;;) {
    try {
      const full = endCoord
        ? [startCoord, ...waypoints, endCoord]
        : [startCoord, ...waypoints];
      // Give user-specified waypoints (first protectedCount) a 1 500 m snap radius
      // so ORS can find a routable road even when a POI sits in a park or lake.
      // -1 means "use ORS default (350 m)" for start, AI waypoints, and end.
      const radiuses =
        protectedCount > 0
          ? full.map((_, i) => (i >= 1 && i <= protectedCount ? 1500 : -1))
          : null;
      return await fetchORSDirections(orsProfile, full, {
        ...opts,
        ...(radiuses && { radiuses }),
      });
    } catch (err) {
      const match = err.message.match(/coordinate\s+(\d+)/i);
      if (!match) throw err;

      const absIdx = parseInt(match[1], 10);
      const wpIdx = absIdx - 1; // subtract 1 to account for startCoord

      if (wpIdx < 0 || wpIdx >= waypoints.length) throw err; // start/end is the problem
      if (wpIdx < protectedCount) throw err; // user-specified stop — cannot be silently dropped

      console.warn(
        `[aiRouting] ORS 2010: dropping unroutable waypoint at position ${absIdx} [${waypoints[wpIdx]}]`,
      );
      waypoints = waypoints.filter((_, i) => i !== wpIdx);

      if (!waypoints.length) throw err; // nothing left to drop
    }
  }
}

// ─── Core pipeline ────────────────────────────────────────────────────────────

export async function runAiPipeline(params, { onStage = () => {} } = {}) {
  const {
    start,
    end,
    distance,
    waypoints: userWaypointCoords = [],
    profile = "foot-walking",
    elevationPreference = "optimal",
    area,
    preferences,
    lang = "en",
  } = params;

  // ── Validate ──
  const profileConfig = PROFILE_CONFIGS[profile];
  if (!profileConfig) {
    throw new PipelineError(
      Errors.BAD_REQUEST,
      `Invalid profile. Allowed: ${Object.keys(PROFILE_CONFIGS).join(", ")}`,
    );
  }
  if (!Array.isArray(start) || start.length !== 2) {
    throw new PipelineError(
      Errors.BAD_REQUEST,
      "start must be a [lng, lat] array",
    );
  }

  const hasEnd = Array.isArray(end) && end.length === 2;
  if (!hasEnd && !(typeof distance === "number" && distance >= 500)) {
    throw new PipelineError(
      Errors.BAD_REQUEST,
      "Either end or distance (>=500m) is required",
    );
  }

  if (!ORS_API_KEY) {
    throw new PipelineError(
      Errors.EXTERNAL_SERVICE_ERROR,
      "ORS_API_KEY is not configured",
    );
  }

  const tripDistanceM = hasEnd ? haversineM(start, end) : (distance ?? 10_000);
  const distanceKm = tripDistanceM / 1_000;
  const { orsProfile, label: profileLabel } = profileConfig;

  // Extract valid user waypoint coords early — needed for skeleton generation
  // so the corridor is anchored to the real path the user wants.
  const validUserWaypointCoords = (
    Array.isArray(userWaypointCoords) ? userWaypointCoords : []
  ).filter(
    (w) =>
      Array.isArray(w) && w.length === 2 && isFinite(w[0]) && isFinite(w[1]),
  );

  // ── Reverse geocode start + end ──
  const [placeStart, placeEnd] = await Promise.all([
    reverseGeocodePlaceName(start, lang).catch(() => null),
    hasEnd ? reverseGeocodePlaceName(end, lang).catch(() => null) : null,
  ]);
  if (placeStart) console.log(`[aiRouting] start → "${placeStart}"`);
  if (placeEnd) console.log(`[aiRouting] end   → "${placeEnd}"`);

  // ── Stage 1: Route skeleton — always built through user's must-stops ──
  //
  // The skeleton drives everything: anchor points for Gemini grounding,
  // corridor filter for POI discovery, and the distance budget for AI stops.
  // Building it through user stops ensures the corridor reflects reality
  // (e.g. a 50 km loop with Green Lakes produces a Vilnius→GreenLakes→Vilnius
  // skeleton, not an 8 km circle around Vilnius).
  onStage("ai_pois");
  let skeletonCoords = null;
  let skeletonDistanceM = 0;
  let purePetalCoords = null; // backbone waypoints for pure-loop final routing
  let petalApex = null; // apex of the petal, used as POI search centre

  // Give user stops a generous 1 500 m road-snap so ORS finds access roads.
  const userStopRadiuses =
    validUserWaypointCoords.length > 0
      ? [-1, ...validUserWaypointCoords.map(() => 1500), -1]
      : null;

  if (hasEnd) {
    try {
      const locs = [start, ...validUserWaypointCoords, end];
      const base = await fetchORSDirections(
        orsProfile,
        locs,
        userStopRadiuses ? { radiuses: userStopRadiuses } : {},
      );
      const feat = base.features?.[0];
      skeletonCoords =
        feat?.geometry?.coordinates?.map((c) => [c[0], c[1]]) ?? null;
      skeletonDistanceM = feat?.properties?.summary?.distance ?? 0;
    } catch (err) {
      console.warn("[aiRouting] Skeleton route failed:", err.message);
    }
  } else if (validUserWaypointCoords.length > 0) {
    // Loop with user stops: route through them to build the real corridor.
    try {
      const locs = [start, ...validUserWaypointCoords, start];
      const base = await fetchORSDirections(orsProfile, locs, {
        radiuses: userStopRadiuses,
      });
      const feat = base.features?.[0];
      skeletonCoords =
        feat?.geometry?.coordinates?.map((c) => [c[0], c[1]]) ?? null;
      skeletonDistanceM = feat?.properties?.summary?.distance ?? 0;
    } catch (err) {
      console.warn("[aiRouting] Loop skeleton with stops failed:", err.message);
      // Fall back to round_trip if the stop itself is unreachable
      try {
        const base = await fetchORSRoundTrip(
          orsProfile,
          start,
          tripDistanceM,
          0,
        );
        const feat = base.features?.[0];
        skeletonCoords =
          feat?.geometry?.coordinates?.map((c) => [c[0], c[1]]) ?? null;
        skeletonDistanceM = feat?.properties?.summary?.distance ?? 0;
      } catch (err2) {
        console.warn(
          "[aiRouting] Round-trip skeleton fallback failed:",
          err2.message,
        );
      }
    }
  } else {
    // Pure loop (no user stops): teardrop/petal shape with random bearing.
    // Random bearing gives a different direction each generation.
    // Using petal waypoints (at correct radii) instead of fetchORSRoundTrip so
    // that the same backbone drives both skeleton (corridor → POI discovery) and
    // final routing (accurate distance).
    const bearing = Math.floor(Math.random() * 360);
    const detour = DETOUR_FACTOR[orsProfile] ?? 1.3;
    const petal = buildPetalWaypoints(start, tripDistanceM, bearing, detour);
    petalApex = petal.apex;
    purePetalCoords = [
      petal.outbound,
      petal.apexOut,
      petal.apexRet,
      petal.return,
    ];

    console.log(
      `[aiRouting] Petal bearing: ${bearing}° | ` +
        `apex: [${petalApex[0].toFixed(4)}, ${petalApex[1].toFixed(4)}]`,
    );

    try {
      const base = await fetchORSDirections(orsProfile, [
        start,
        ...purePetalCoords,
        start,
      ]);
      const feat = base.features?.[0];
      skeletonCoords =
        feat?.geometry?.coordinates?.map((c) => [c[0], c[1]]) ?? null;
      skeletonDistanceM = feat?.properties?.summary?.distance ?? 0;
    } catch (err) {
      console.warn(
        "[aiRouting] Petal skeleton failed, falling back to round_trip:",
        err.message,
      );
      purePetalCoords = null;
      petalApex = null;
      try {
        const seed = Math.floor(Math.random() * 89) + 1;
        const base = await fetchORSRoundTrip(
          orsProfile,
          start,
          tripDistanceM,
          seed,
        );
        const feat = base.features?.[0];
        skeletonCoords =
          feat?.geometry?.coordinates?.map((c) => [c[0], c[1]]) ?? null;
        skeletonDistanceM = feat?.properties?.summary?.distance ?? 0;
      } catch (err2) {
        console.warn(
          "[aiRouting] Round-trip skeleton fallback failed:",
          err2.message,
        );
      }
    }
  }

  // How much distance is left after the base skeleton for AI detour stops.
  // Negative = skeleton already exceeds request → add no extra AI stops.
  const remainingDistanceM = tripDistanceM - skeletonDistanceM;
  console.log(
    `[aiRouting] Skeleton: ${(skeletonDistanceM / 1000).toFixed(1)} km | ` +
      `requested: ${distanceKm.toFixed(1)} km | ` +
      `AI stop budget: ${(remainingDistanceM / 1000).toFixed(1)} km`,
  );

  // Search center/radius: cover the actual corridor, not just the start.
  // For loops with user stops, centre between start and the farthest stop.
  const farthestUserStopM =
    validUserWaypointCoords.length > 0
      ? Math.max(...validUserWaypointCoords.map((c) => haversineM(start, c)))
      : 0;
  const searchCenter = hasEnd
    ? [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]
    : farthestUserStopM > 0
      ? [
          (start[0] +
            validUserWaypointCoords.reduce((s, c) => s + c[0], 0) /
              validUserWaypointCoords.length) /
            2,
          (start[1] +
            validUserWaypointCoords.reduce((s, c) => s + c[1], 0) /
              validUserWaypointCoords.length) /
            2,
        ]
      : petalApex
        ? // Centre between start and the petal apex so Places search covers the
          // full outbound corridor rather than clustering near the start location.
          [(start[0] + petalApex[0]) / 2, (start[1] + petalApex[1]) / 2]
        : start;
  const loopRadius = tripDistanceM / (2 * Math.PI);
  const petalApexDistM = petalApex ? haversineM(start, petalApex) : 0;
  const searchRadiusM = hasEnd
    ? Math.max(5_000, tripDistanceM * 0.65)
    : farthestUserStopM > 0
      ? Math.max(5_000, farthestUserStopM * 1.3)
      : petalApexDistM > 0
        ? Math.max(5_000, petalApexDistM * 1.2)
        : Math.max(3_000, loopRadius * 1.5);

  // Determine anchor points: evenly spaced along the real road path
  const anchors = skeletonCoords
    ? sampleRouteAnchors(skeletonCoords, numAnchors(distanceKm))
    : [start];

  const groundingOpts = {
    profileLabel,
    preferences,
    area,
    hasEnd,
    placeStart,
    placeEnd,
    distanceKm,
    lang,
  };

  const placesCtx = { start, end, hasEnd, searchCenter, searchRadiusM, lang };

  // ── Stage 2: Parallel POI discovery ──
  // Run everything in parallel:
  //  a) Multi-anchor Gemini Maps Grounding — finds famous named places + user-specified places
  //  b) Intent decomposition — understands what the user specifically asked for
  //  c) Baseline category search — sweeps tourist_attraction / historical_landmark /
  //     park / museum along the full corridor AND at the destination
  const [groundingEntries, intents, baselinePois] = await Promise.all([
    discoverMultiAnchor(anchors, groundingOpts),
    decomposeIntent({
      profileLabel,
      preferences,
      area,
      hasEnd,
      placeStart,
      placeEnd,
      distanceKm,
      lang,
    }).catch(() => []),
    searchBaselinePois(placesCtx),
  ]);

  // ── Stage 3: Enrich grounding + run user-intent text search ──
  onStage("enriching");

  // User intent search: what the traveller specifically asked for.
  // Falls back to a generic scenic search if intent decomposition returned nothing.
  const effectiveIntents = intents.length
    ? intents
    : [
        {
          theme:
            PROFILE_FALLBACK_THEME[profileLabel] ??
            "scenic viewpoints and landmarks",
          places_type: "tourist_attraction",
          location_scope: hasEnd ? "along_route" : "at_start",
          specific_area: "",
          count: 10,
        },
      ];

  const [groundingPois, intentPois] = await Promise.all([
    groundingEntries.length > 0
      ? fetchPlacesByIds(groundingEntries)
      : Promise.resolve([]),
    searchPlacesForAllIntents(effectiveIntents, placesCtx).catch(() => []),
  ]);

  console.log(
    `[aiRouting] Sources — grounding: ${groundingPois.length}, intents: ${intentPois.length}, baseline: ${baselinePois.length}`,
  );

  // ── User must-stop waypoints (always included, always essential) ──
  const userWaypoints = (
    Array.isArray(userWaypointCoords) ? userWaypointCoords : []
  )
    .filter(
      (w) =>
        Array.isArray(w) && w.length === 2 && isFinite(w[0]) && isFinite(w[1]),
    )
    .map(([lng, lat]) => ({
      lng,
      lat,
      name: "Must-stop",
      description: null,
      place_id: null,
      formatted_address: null,
      rating: null,
      user_rating_count: null,
      website_uri: null,
      google_maps_uri: null,
      types: [],
      primary_type: null,
      editorial_summary: null,
      photo_name: null,
      guide_note: null,
      essential: true,
      _isUserWaypoint: true,
    }));

  // Merge all three sources: grounding first (authoritative IDs), then user
  // intent results, then baseline. Dedup by place_id so we keep the richest
  // version of each place (grounding-enriched data takes priority).
  const rawPool = dedupPois([...groundingPois, ...intentPois, ...baselinePois]);

  // Filter to corridor — drop anything sitting outside the route band
  const corridorCoords = skeletonCoords ?? (hasEnd ? [start, end] : [start]);
  let enrichedPool = skeletonCoords
    ? polylineCorridorFilter(rawPool, corridorCoords)
    : rawPool;

  console.log(
    `[aiRouting] Corridor filter: ${rawPool.length} → ${enrichedPool.length} POIs`,
  );

  // For pure loops (no user stops): drop POIs too far from start to fit the distance.
  // Skipped for loops-with-stops because the skeleton corridor filter already
  // constrains the pool to the real Vilnius→GreenLakes→Vilnius corridor.
  if (!hasEnd && validUserWaypointCoords.length === 0) {
    const maxDetourM = loopRadius * 1.5;
    const before = enrichedPool.length;
    enrichedPool = enrichedPool.filter(
      (p) => haversineM(start, [p.lng, p.lat]) <= maxDetourM,
    );
    if (enrichedPool.length < before) {
      console.log(
        `[aiRouting] Loop detour filter: ${before} → ${enrichedPool.length} POIs (max ${(maxDetourM / 1000).toFixed(1)} km from start)`,
      );
    }
  }

  const allPois = dedupPois([...enrichedPool, ...userWaypoints]);

  console.log(
    `[aiRouting] POI pool: ${allPois.length} total — ${allPois.map((p) => p.name).join(" | ") || "(none)"}`,
  );

  if (!enrichedPool.length && !userWaypoints.length) {
    throw new PipelineError(
      Errors.AI_GENERATION_FAILED,
      "No usable POIs found",
    );
  }

  // ── Stage 4: Rank by rating, mark top stops essential ──
  onStage("curating");

  const ranked = [...enrichedPool].sort(
    (a, b) =>
      (b.rating ?? 0) - (a.rating ?? 0) ||
      (b.user_rating_count ?? 0) - (a.user_rating_count ?? 0),
  );

  // How many AI-discovered POIs become essential (routed) waypoints.
  //
  // A→B: top ~30%, min 4, max 12.
  // Loop with user stops: budget by remaining distance after skeleton.
  //   Each extra AI stop adds ~2.5 km average detour. Cap at 0 if no budget.
  // Pure loop: cap by distance — roughly 1 stop per 6 km.
  const essentialCount = hasEnd
    ? Math.min(Math.max(Math.ceil(ranked.length * 0.3), 4), 12)
    : validUserWaypointCoords.length > 0 && skeletonDistanceM > 0
      ? Math.min(
          Math.ceil(ranked.length * 0.3),
          Math.max(0, Math.floor(remainingDistanceM / 2_500)),
          8,
        )
      : // Pure loop: petal waypoints provide the route shape, so AI POIs are
        // map-only. Routing through them at the wrong scale caused 22% accuracy.
        0;
  const finalPoisFromPool = ranked.map((p, i) => ({
    ...p,
    guide_note: null,
    essential: i < essentialCount,
  }));

  const finalPois = dedupPois([...finalPoisFromPool, ...userWaypoints]);

  console.log(
    `[aiRouting] Ranked pool: ${finalPois.length} stops (${essentialCount} essential):\n` +
      finalPoisFromPool
        .slice(0, essentialCount)
        .map((p) => `  ★ ${p.name} (${p.rating ?? "n/a"})`)
        .join("\n"),
  );

  // ── Sort for display and routing ──
  const allSorted = hasEnd
    ? sortPoisAlongLine(finalPois, start, end)
    : sortPoisAroundLoop(finalPois, start);

  const poiFeatures = allSorted.map(enrichedPoiToFeature);

  // Build ORS waypoints from essential POIs only, capped for routing reliability
  const essentialOrdered = allSorted.filter((p) => p.essential);
  const userWaypointsInEssential = essentialOrdered.filter(
    (p) => p._isUserWaypoint,
  );
  const aiEssentialOrdered = essentialOrdered.filter((p) => !p._isUserWaypoint);
  const waypointPois = [
    ...userWaypointsInEssential,
    ...aiEssentialOrdered.slice(
      0,
      ORS_WAYPOINT_CAP - userWaypointsInEssential.length,
    ),
  ];
  // Snap waypoints that are very close to the route skeleton to the nearest road
  // point on the skeleton. This prevents ORS from routing into dead-end side streets
  // for POIs that are effectively "on" the main road. POIs with significant detours
  // (castles on islands, etc.) keep their real coordinates so ORS routes to them.
  const waypointCoords = waypointPois.map((p) => {
    if (p._isUserWaypoint || !skeletonCoords) return [p.lng, p.lat];
    return snapToSkeleton([p.lng, p.lat], skeletonCoords, profile);
  });

  console.log(
    `[aiRouting] Routing through ${waypointCoords.length} waypoints (${finalPois.length - waypointCoords.length} optional on map)`,
  );

  // ── A→B routing ──
  if (hasEnd) {
    onStage("routing", { mode: "a_to_b" });

    let orsResult;
    try {
      orsResult = await fetchORSWithFallback(
        orsProfile,
        start,
        waypointCoords,
        end,
        {},
        userWaypointsInEssential.length,
      );
    } catch (err) {
      throw new PipelineError(
        Errors.EXTERNAL_SERVICE_ERROR,
        `Route generation failed: ${err.message}`,
      );
    }

    const feature = orsResult.features?.[0];
    if (!feature) {
      throw new PipelineError(
        Errors.EXTERNAL_SERVICE_ERROR,
        "ORS returned no route",
      );
    }

    const routeData = orsFeatureToRouteData(feature);
    console.log(
      `[aiRouting] A→B final: ${routeData.distance_km} km ` +
        `(skeleton was ${(skeletonDistanceM / 1000).toFixed(1)} km)`,
    );
    return {
      profile,
      elevation_preference: elevationPreference,
      poi_types_requested: [],
      ai_plan: { pois: poiFeatures },
      routes: [
        {
          label: "recommended",
          description: "AI Tour Guide route",
          profile: profileLabel,
          distance_km: routeData.distance_km,
          duration_s: routeData.duration_s,
          ascent_m: routeData.ascent_m,
          descent_m: routeData.descent_m,
          geometry: { type: "LineString", coordinates: routeData.coords },
          bbox: routeBbox(routeData.coords),
          elevation_profile: routeData.elevArr,
          maneuvers: routeData.maneuvers,
          pois: poiFeatures,
        },
      ],
    };
  }

  // ── Loop routing ──
  onStage("routing", { mode: "loop" });

  // For pure loops: route through the petal backbone (distance-accurate, varied
  // direction). AI POIs are map-only and don't affect routing.
  // For loops with user stops: route through user must-stops + AI essential POIs.
  const loopRoutingCoords = purePetalCoords ?? waypointCoords;
  const loopProtectedCount = purePetalCoords
    ? 0
    : userWaypointsInEssential.length;

  if (!loopRoutingCoords.length) {
    throw new PipelineError(
      Errors.AI_GENERATION_FAILED,
      "No waypoints available for loop routing",
    );
  }

  let loopOrsResult;
  try {
    loopOrsResult = await fetchORSWithFallback(
      orsProfile,
      start,
      loopRoutingCoords,
      start,
      {},
      loopProtectedCount,
    );
  } catch (err) {
    throw new PipelineError(
      Errors.EXTERNAL_SERVICE_ERROR,
      `Loop routing failed: ${err.message}`,
    );
  }

  const loopFeature = loopOrsResult.features?.[0];
  if (!loopFeature) {
    throw new PipelineError(
      Errors.EXTERNAL_SERVICE_ERROR,
      "ORS returned no loop route",
    );
  }

  const loopData = orsFeatureToRouteData(loopFeature);
  const distanceRatio = loopData.distance_km / distanceKm;

  console.log(
    `[aiRouting] Loop final: ${loopData.distance_km} km | ` +
      `requested: ${distanceKm.toFixed(1)} km | ` +
      `accuracy: ${(distanceRatio * 100).toFixed(0)}% | ` +
      `ascent: ${loopData.ascent_m} m`,
  );

  return {
    profile,
    elevation_preference: elevationPreference,
    poi_types_requested: [],
    ai_plan: { pois: poiFeatures },
    routes: [
      {
        label: "loop",
        description: "AI Tour Guide loop",
        profile: profileLabel,
        distance_km: loopData.distance_km,
        duration_s: loopData.duration_s,
        ascent_m: loopData.ascent_m,
        descent_m: loopData.descent_m,
        geometry: { type: "LineString", coordinates: loopData.coords },
        bbox: routeBbox(loopData.coords),
        elevation_profile: loopData.elevArr,
        maneuvers: loopData.maneuvers,
        pois: poiFeatures,
      },
    ],
  };
}
