// lib/ai/curate.js — Gemini tour-guide curation.
//
// Takes the assembled POI pool and asks Gemini to pick essential vs optional
// stops, write a 1-2 sentence guide note for each, and respect the mode-
// specific rules (named anchors always essential, no invented stops, etc).
//
// Mode-specific prompt context lives in buildModeCurationContext() — it was
// previously in ai-routing-patch.js, now colocated with the caller.

import { Type } from "@google/genai";
import {
  genai,
  GEMINI_MODEL,
  LANG_INSTRUCTIONS,
  sanitizePromptInput,
  extractJsonArray,
} from "./shared.js";

// ─── Per-mode curation context ───────────────────────────────────────────────

export function buildModeCurationContext(mode, namedPois, preferences) {
  switch (mode) {
    case "category":
      return {
        modeLabel: "OPEN TRAVEL GUIDE",
        modeInstructions: [
          `OPEN TRAVEL GUIDE MODE — user wants: "${preferences || "best of the route"}"`,
          `Act as a passionate local guide. Be generous — don't cap at some arbitrary number.`,
          `If there are 8 great historic sites along the route, include all 8.`,
          `essential=true: genuinely worth visiting, fits the theme, good detour candidate.`,
          `essential=false: nice bonus if passing by.`,
          `Spread essentials across the whole route. Tell a coherent story with the stops.`,
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
          `1. Every ⚑ USER-REQUESTED place MUST be essential=true. No exceptions.`,
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
          `User also wants: "${preferences}"`,
          ``,
          `RULES:`,
          `1. The committed stops above are already included — do not add them again.`,
          `2. Be generous with category stops — if 6 great parks exist along the route, include all 6.`,
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

// ─── Curation schema + prompt ────────────────────────────────────────────────

const CURATION_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      place_id: {
        type: Type.STRING,
        description: "Exact place_id from the input list.",
      },
      guide_note: {
        type: Type.STRING,
        description:
          "1-2 vivid sentences in a tour guide voice: why this stop is special.",
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

function positionLabel(fraction) {
  if (fraction < 0.33) return "[ROUTE START]";
  if (fraction < 0.67) return "[MIDROUTE]";
  return "[ROUTE END]";
}

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
  routePositions,
}) {
  const langInstr = LANG_INSTRUCTIONS[lang] ?? LANG_INSTRUCTIONS.en;
  const tripDesc = hasEnd
    ? `${profileLabel} from "${placeStart || "start"}" to "${placeEnd || "destination"}" (~${Math.round(distanceKm)} km)`
    : `${profileLabel} round trip from "${placeStart || "start"}" (~${Math.round(distanceKm)} km)`;

  const poiList = pois
    .map((p, i) => {
      const isNamed = userNamedPlaceIds?.has(p.place_id);
      const isGapFill = p._gapFill && !isNamed;
      const fraction = routePositions?.get(p.place_id);
      const posTag = fraction != null ? ` ${positionLabel(fraction)}` : "";
      const tag = isNamed
        ? " ⚑ USER-REQUESTED — MUST be essential=true"
        : isGapFill
          ? " [GAP-FILL] travel guide suggestion"
          : "";
      return (
        `[${i + 1}] place_id="${p.place_id}" | ${p.name} (${p.primary_type ?? "place"}) | ` +
        `${p.formatted_address ?? ""} | ${p.editorial_summary || p.description || ""}` +
        posTag +
        tag
      );
    })
    .join("\n");

  // Compute bucket sizes for the distribution rule
  let distributionRule = "";
  if (routePositions?.size) {
    const fractions = [...routePositions.values()];
    const startN = fractions.filter((f) => f < 0.33).length;
    const midN = fractions.filter((f) => f >= 0.33 && f < 0.67).length;
    const endN = fractions.filter((f) => f >= 0.67).length;
    if (midN > 0) {
      distributionRule = [
        `ROUTE DISTRIBUTION: Pool has ${startN} stops near the start [ROUTE START], ` +
          `${midN} midroute [MIDROUTE], ${endN} near the destination [ROUTE END].`,
        `MANDATORY: Select AT LEAST 1 essential stop from [MIDROUTE] if any good ones exist there.`,
        `Do NOT mark all essentials from [ROUTE END] only — spread them along the whole route.`,
      ].join("\n");
    }
  }

  const { modeLabel, modeInstructions } = buildModeCurationContext(
    mode,
    namedPois,
    sanitizePromptInput(preferences, 400),
  );

  const maxStopsForDistance = Math.max(
    2,
    Math.min(Math.round(distanceKm / 4), 12),
  );
  return [
    `You are an expert local tour guide curating stops for this trip:`,
    `TRIP: ${tripDesc}`,
    `MODE: ${modeLabel}`,
    ``,
    ...modeInstructions,
    ``,
    `AVAILABLE PLACES (verified OSM data):`,
    poiList,
    ``,
    `CURATION TASK:`,
    `Trip is ~${Math.round(distanceKm)} km. Budget: max ${maxStopsForDistance} ESSENTIAL stops total.`,
    `Adding too many essential stops massively inflates the route distance — be selective.`,
    `ESSENTIAL (essential=true): Stops that physically change the route. MAX ${maxStopsForDistance} total.`,
    `  • Named/committed stops always essential`,
    `  • Only the most unmissable category stops — prefer quality over quantity`,
    `  • A 20km ride needs ~5 stops max, not 19`,
    `OPTIONAL (essential=false): Shown on map, no detour. Be generous here instead.`,
    `EXCLUDE: Car parks, petrol stations, supermarkets, hardware stores, irrelevant places.`,
    distributionRule,
    ``,
    `For EACH included place write a guide_note: 1-2 vivid tour-guide sentences.`,
    `Return a JSON array ordered start → destination. Only use place_ids from the list above.`,
    ``,
    langInstr,
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
  routePositions,
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
    routePositions,
  });

  try {
    const r = await genai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: CURATION_SCHEMA,
        temperature: 0.55,
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
        essential: userNamedPlaceIds?.has(item.place_id)
          ? true
          : Boolean(item.essential),
      }));

    // Safety net: re-inject any user-named POI curation silently dropped
    if (userNamedPlaceIds?.size) {
      for (const placeId of userNamedPlaceIds) {
        if (!curated.some((p) => p.place_id === placeId) && byId.has(placeId)) {
          const poi = byId.get(placeId);
          curated.push({
            ...poi,
            guide_note: poi.guide_note ?? poi.editorial_summary ?? "",
            essential: true,
          });
          console.log(`[aiRouting] Safety net: re-injected "${poi.name}"`);
        }
      }
    }

    const essential = curated.filter((p) => p.essential).length;
    console.log(
      `[aiRouting] Curated ${curated.length} stops (${essential} essential, ${curated.length - essential} optional) [mode=${mode}]:\n` +
        curated
          .map(
            (p) =>
              `  ${p.essential ? "★" : "○"} ${p.name}` +
              `${p._userNamed ? " [ANCHOR]" : p._gapFill ? " [GAP-FILL]" : ""} — "${p.guide_note?.slice(0, 80)}..."`,
          )
          .join("\n"),
    );

    return curated.length ? curated : null;
  } catch (err) {
    console.warn("[aiRouting] Curation failed:", err.message);
    return null;
  }
}
