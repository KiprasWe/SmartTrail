import { Type } from "@google/genai";
import {
  genai,
  GEMINI_MODEL,
  LANG_INSTRUCTIONS,
  ROUTE_SYSTEM_INSTRUCTION,
  sanitizePromptInput,
  extractJsonArray,
} from "./shared.js";

function resolveCuratePlaceId(rawId, pois, byId) {
  if (!rawId || typeof rawId !== "string") return null;
  const id = rawId.trim();
  if (byId.has(id)) return id;
  const m = id.match(/^ors:(\d+)$/i);
  if (!m) return null;
  const digits = m[1];
  const n = parseInt(digits, 10);
  if (!Number.isFinite(n) || n < 1 || n > pois.length) return null;

  if (digits.length > 6) return null;
  const candidate = pois[n - 1]?.place_id;
  return candidate && String(candidate) !== id ? candidate : null;
}

function buildModeCurationContext(mode, namedPois, preferences) {
  switch (mode) {
    case "category":
      return {
        modeLabel: "OPEN TRAVEL GUIDE",
        modeInstructions: [
          `OPEN TRAVEL GUIDE MODE — user wants:\n<user_request>${preferences || "best in the trip region"}</user_request>`,
          `Act as a passionate local guide. Be generous — don't cap at some arbitrary number.`,
          `If there are 8 great historic sites in the trip region, include all 8.`,
          `essential=true: genuinely worth visiting, fits the theme, worth routing to.`,
          `essential=false: nice bonus if passing by.`,
          `Spread essentials across the trip region. Tell a coherent story with the stops.`,
        ],
      };

    case "named": {
      const anchorList = namedPois.map((p) => `  • ${p.name}`).join("\n");
      return {
        modeLabel: "STRICT ANCHOR",
        modeInstructions: [
          `STRICT ANCHOR MODE — user named specific places they MUST visit:`,
          anchorList,
          ``,
          `1. Every USER-REQUESTED place MUST be essential=true. No exceptions.`,
          `2. Do NOT add stops from categories the user didn't mention.`,
          `3. Only add stops directly on/near the route between anchors AND relevant.`,
          `4. Write vivid guide notes for each anchor explaining why it is special.`,
          `5. Exclude anything unrelated to the user's named stops.`,
        ],
      };
    }

    case "mixed": {
      const anchorList = namedPois.map((p) => `  • ${p.name}`).join("\n");
      return {
        modeLabel: "ANCHOR + TRAVEL GUIDE",
        modeInstructions: [
          `COMMITTED STOPS (already on the route, NOT in the list below):`,
          anchorList,
          `These are guaranteed. Your job is ONLY to curate the category stops below.`,
          ``,
          `User also wants:\n<user_request>${preferences}</user_request>`,
          ``,
          `RULES:`,
          `1. The committed stops above are already included — do not add them again.`,
          `2. Be generous with category stops — if 6 great parks exist in the trip region, include all 6.`,
          `3. essential=true for anything genuinely worth the detour for the requested theme.`,
          `4. essential=false for nice-to-have bonuses.`,
          `5. Do NOT artificially limit. Quality AND quantity both matter here.`,
        ],
      };
    }

    default:
      return { modeLabel: "OPEN TRAVEL GUIDE", modeInstructions: [] };
  }
}

const CURATION_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      place_id: {
        type: Type.STRING,
        description:
          "Copy the FULL place_id string from the input exactly (e.g. ors:8569856283). " +
          "Never shorten, never invent, never use only digits after ors:. Must match one input line.",
      },
      guide_note: {
        type: Type.STRING,
        description:
          "For essential=true: 1-2 vivid sentences in a tour guide voice. For essential=false: empty string.",
      },
      essential: {
        type: Type.BOOLEAN,
        description:
          "true = must-visit stop affecting the route; false = nice-to-have.",
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
  mode,
  namedPois,
  userNamedPlaceIds,
}) {
  const langInstr = LANG_INSTRUCTIONS[lang] ?? LANG_INSTRUCTIONS.en;
  const tripDesc = hasEnd
    ? `${profileLabel} from "${placeStart || "start"}" to "${placeEnd || "destination"}" (~${Math.round(distanceKm)} km)`
    : `${profileLabel} round trip from "${placeStart || "start"}" (~${Math.round(distanceKm)} km)`;

  const poiList = pois
    .map((p) => {
      const isNamed = userNamedPlaceIds?.has(p.place_id);
      const tag = isNamed ? " ⚑ USER-REQUESTED — MUST be essential=true" : "";
      return (
        `place_id=${p.place_id} | ${p.name} (${p.primary_type ?? "place"}) | ` +
        `${p.formatted_address ?? ""} | ${p.editorial_summary || p.description || ""}` +
        tag
      );
    })
    .join("\n");

  const { modeLabel, modeInstructions } = buildModeCurationContext(
    mode,
    namedPois,
    sanitizePromptInput(preferences, 400),
  );

  const maxStopsForDistance = Math.min(
    Math.max(3, Math.round(2 + Math.sqrt(distanceKm / 4))),
    12,
  );

  return [
    `You are an expert local tour guide curating stops for this trip:`,
    langInstr,
    `TRIP: ${tripDesc}`,
    `MODE: ${modeLabel}`,
    ``,
    ...modeInstructions,
    ``,
    `AVAILABLE PLACES (verified OSM data):`,
    poiList,
    ``,
    `CURATION TASK:`,
    `Trip is ~${Math.round(distanceKm)} km. Budget: max ${maxStopsForDistance} ESSENTIAL category stops.`,
    `POIs are drawn from the full trip region — the route will be built to pass through whatever you mark essential.`,
    `Each essential stop adds real detour distance — every extra essential km you add inflates the route.`,
    `Prefer stops that are geographically spread along the trip direction rather than clustered in one area.`,
    `ESSENTIAL (essential=true): Genuinely unmissable stops worth routing to. MAX ${maxStopsForDistance}.`,
    `  • Only the absolute best stops for the theme — ruthlessly cut the rest`,
    `  • Examples: 10 km → ~3-4 stops, 60 km → ~6 stops, 120 km → ~8 stops`,
    `OPTIONAL (essential=false): Shown on map if passing by, zero route impact. Be generous here.`,
    `EXCLUDE: Car parks, petrol stations, supermarkets, hardware stores, irrelevant places.`,
    ``,
    `GUIDE NOTES (resource-saving rule):`,
    `- If essential=true → write a vivid 1-2 sentence guide_note.`,
    `- If essential=false → set guide_note to an empty string "" (do NOT write a description).`,
    `CRITICAL — place_id rules:`,
    `- Each line starts with place_id=… Copy that ENTIRE token after the equals sign (full string).`,
    `- Wrong: ors:23, ors:4, gmap:1 (too short / looks like a line number).`,
    `- Right: ors:8569856283 (same as in the list).`,
    `Return a JSON array ordered start → destination. Every place_id MUST appear verbatim in the list above.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function tourGuideCurate({
  pois,
  profileLabel,
  preferences,
  placeStart,
  placeEnd,
  hasEnd,
  distanceKm,
  lang,
  mode,
  namedPois,
  userNamedPlaceIds,
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
    mode,
    namedPois,
    userNamedPlaceIds,
  });

  try {
    const temperature = distanceKm < 20 ? 0.5 : distanceKm < 60 ? 0.4 : 0.3;
    const r = await genai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        systemInstruction: ROUTE_SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseJsonSchema: CURATION_SCHEMA,
        temperature,
      },
    });

    let parsed;
    try {
      parsed = JSON.parse(r.text ?? "");
    } catch {
      parsed = extractJsonArray(r.text ?? "");
    }

    if (!Array.isArray(parsed) || !parsed.length) {
      console.warn("[curate] Curation returned empty");
      return null;
    }

    const byId = new Map(pois.map((p) => [p.place_id, p]));

    const curated = [];
    const seen = new Set();
    for (const item of parsed) {
      const raw =
        typeof item?.place_id === "string" ? item.place_id.trim() : "";
      const resolvedId =
        raw && byId.has(raw) ? raw : resolveCuratePlaceId(raw, pois, byId);
      if (!resolvedId || !byId.has(resolvedId) || seen.has(resolvedId))
        continue;
      seen.add(resolvedId);
      const essential = userNamedPlaceIds?.has(resolvedId)
        ? true
        : Boolean(item.essential);
      const note = String(item.guide_note ?? "").trim();
      curated.push({
        ...byId.get(resolvedId),
        guide_note: essential ? note : null,
        essential,
      });
    }

    const rawLen = parsed.length;
    const minKept = Math.max(3, Math.floor(rawLen * 0.25));
    if (rawLen >= 8 && curated.length < minKept) {
      console.warn(
        `[curate] Discarding curation: only ${curated.length}/${rawLen} place_ids matched (likely model typos). Using fallback.`,
      );
      return null;
    }
    if (rawLen >= 5 && curated.length === 0) {
      return null;
    }

    if (userNamedPlaceIds?.size) {
      for (const placeId of userNamedPlaceIds) {
        if (!curated.some((p) => p.place_id === placeId) && byId.has(placeId)) {
          const poi = byId.get(placeId);
          curated.push({
            ...poi,
            guide_note: poi.guide_note ?? poi.editorial_summary ?? "",
            essential: true,
          });
          console.log(`[curate] Safety net: re-injected "${poi.name}"`);
        }
      }
    }

    const essential = curated.filter((p) => p.essential).length;
    console.log(
      `[curate] ${curated.length} stops (${essential} essential, ${curated.length - essential} optional) [mode=${mode}]:\n` +
        curated
          .map((p) => {
            const note = p.guide_note?.trim();
            const tail = note
              ? `"${note.slice(0, 80)}${note.length > 80 ? "…" : ""}"`
              : "—";
            return `  ${p.essential ? "★" : "○"} ${p.name} — ${tail}`;
          })
          .join("\n"),
    );

    return curated.length ? curated : null;
  } catch (err) {
    console.warn("[curate] Curation failed:", err.message);
    return null;
  }
}
