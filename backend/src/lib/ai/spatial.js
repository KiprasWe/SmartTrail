// lib/ai/spatial.js — spatial constraint extraction for AI route generation.
//
// Detects directional or named-area constraints in the user's preferences
// ("west part", "old town", "riverside") and geocodes them into concrete
// [lng, lat] + radiusM areas for targeted POI discovery.

import { genai, GEMINI_MODEL } from "./shared.js";
import { geocodeCity } from "../places.js";

const DIRECTION_ANGLES = {
  north: Math.PI / 2,
  northeast: Math.PI / 4,
  east: 0,
  southeast: -Math.PI / 4,
  south: -Math.PI / 2,
  southwest: -(3 * Math.PI) / 4,
  west: Math.PI,
  northwest: (3 * Math.PI) / 4,
};

const METRES_PER_DEG = 111_320;

function directionalOffset([lng, lat], direction, distanceM) {
  const angle = DIRECTION_ANGLES[direction];
  if (angle === undefined) return null;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const dLat = (Math.sin(angle) * distanceM) / METRES_PER_DEG;
  const dLng = (Math.cos(angle) * distanceM) / (METRES_PER_DEG * cosLat);
  return [lng + dLng, lat + dLat];
}

/**
 * Extract spatial area constraints from the user's preferences string.
 *
 * Returns an array of up to 3 objects:
 *   { label: string, center: [lng, lat], radiusM: number }
 *
 * Fails gracefully to [] on any error.
 */
export async function extractSpatialAreas(
  preferences,
  start,
  placeStart,
  distanceKm,
  lang = "en",
) {
  if (!genai || !preferences?.trim()) return [];

  const safePrefs = String(preferences).replace(/[\x00-\x1F\x7F]/g, " ").trim().slice(0, 300);
  const radiusM = Math.max(3_000, Math.round((distanceKm * 1_000) / 4));

  const prompt = [
    `Analyse the travel request below and extract any explicit spatial/directional constraints.`,
    `A spatial constraint is a named area or direction ("west part", "old town", "riverside", "northern district").`,
    `Generic category words ("parks", "history", "restaurants") are NOT spatial constraints.`,
    ``,
    `Request: "${safePrefs}"`,
    placeStart ? `City context: ${placeStart}` : null,
    ``,
    `For each spatial constraint found, return a JSON object with:`,
    `  label       — short human-readable label (e.g. "west part", "old town")`,
    `  geocode_hint — best search string to geocode this area (e.g. "Old Town Vilnius"), or "" if purely directional`,
    `  direction   — one of: north, northeast, east, southeast, south, southwest, west, northwest, or "" if not directional`,
    ``,
    `Return a JSON array (max 3 items). Return [] if no spatial constraints found.`,
    `Return ONLY valid JSON.`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const r = await genai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: { responseMimeType: "application/json", temperature: 0.1 },
    });

    let parsed;
    try {
      parsed = JSON.parse(r.text ?? "");
    } catch {
      const t = (r.text ?? "").trim();
      const s = t.indexOf("[");
      const e = t.lastIndexOf("]");
      if (s !== -1 && e > s) {
        try {
          parsed = JSON.parse(t.slice(s, e + 1));
        } catch {
          parsed = null;
        }
      }
    }

    if (!Array.isArray(parsed) || parsed.length === 0) return [];

    const areas = [];

    for (const item of parsed.slice(0, 3)) {
      if (!item || typeof item !== "object") continue;
      const label = String(item.label ?? "").trim();
      if (!label) continue;

      const geocodeHint = String(item.geocode_hint ?? "").trim();
      const direction = String(item.direction ?? "").trim().toLowerCase();

      let center = null;

      // Try geocoding first if we have a hint
      if (geocodeHint) {
        center = await geocodeCity(geocodeHint, lang).catch(() => null);
      }

      // Fall back to directional offset from start
      if (!center && direction && DIRECTION_ANGLES[direction] !== undefined) {
        center = directionalOffset(start, direction, radiusM);
      }

      if (!center) continue;

      areas.push({ label, center, radiusM });
    }

    if (areas.length) {
      console.log(
        `[spatial] Extracted ${areas.length} area(s): ${areas.map((a) => `"${a.label}"`).join(", ")}`,
      );
    }

    return areas;
  } catch (err) {
    console.warn(`[spatial] extractSpatialAreas failed: ${err.message}`);
    return [];
  }
}
