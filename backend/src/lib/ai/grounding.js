import { genai, GEMINI_MODEL, extractJsonArray } from "./shared.js";

const GROUNDING_SYSTEM =
  "You are a geographic assistant. Use Google Maps to find the exact coordinates of requested places. " +
  "Return only valid JSON — no explanation, no markdown, no extra text.";

// Used by resolveNamedPlacesWithGrounding.
// Coerces n to a finite number clamped to [lo, hi] (lo on non-finite).
function clamp(n, lo, hi) {
  const x = Number(n);
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

// Used by resolveNamedPlacesWithGrounding.
// Validates a [minLng,minLat,maxLng,maxLat] bbox into a named hint object
// (or null) for constraining Maps results.
function bboxToHint(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return null;
  const [minLng, minLat, maxLng, maxLat] = bbox.map(Number);
  if (![minLng, minLat, maxLng, maxLat].every(Number.isFinite)) return null;
  return { minLng, minLat, maxLng, maxLat };
}

// Used by resolveNamedPlacesWithGrounding.
// Normalizes a Maps grounding candidate into our POI shape (essential +
// _userNamed); returns null if it lacks valid coords/name.
function toPoiFromMaps(item) {
  const lat = Number(item.lat);
  const lng = Number(item.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const name = typeof item.name === "string" ? item.name.trim() : "";
  if (!name) return null;

  const placeIdRaw =
    typeof item.place_id === "string"
      ? item.place_id
      : typeof item.placeId === "string"
        ? item.placeId
        : "";
  const placeId = placeIdRaw.trim();

  return {
    place_id: placeId
      ? `gmap:${placeId}`
      : `grounding:${lat.toFixed(5)},${lng.toFixed(5)}`,
    name,
    lat,
    lng,
    primary_type: "tourist_attraction",
    types: ["tourist_attraction"],
    formatted_address:
      typeof item.address === "string"
        ? item.address.trim().slice(0, 180)
        : null,
    description: null,
    editorial_summary: null,
    rating: null,
    user_rating_count: null,
    website_uri: null,
    google_maps_uri: null,
    photo_name: null,
    essential: true,
    guide_note: null,
    _userNamed: true,
  };
}

// Exported — module entry point. Used by ai/pipeline.js.
// Resolves user-named places to coordinates via a Gemini + Google Maps
// grounding call, returning them as user-named POIs (empty [] on failure).
export async function resolveNamedPlacesWithGrounding(
  namedPlaces,
  start,
  langOrOpts = "en",
) {
  if (!genai || !namedPlaces.length) return [];

  const opts =
    langOrOpts && typeof langOrOpts === "object"
      ? langOrOpts
      : { lang: langOrOpts };
  const maxCandidates = clamp(opts.maxCandidates ?? 2, 1, 4);
  const bboxHint = bboxToHint(opts.bbox);

  const [lng, lat] = start;
  const placeList = namedPlaces.map((n, i) => `${i + 1}. ${n}`).join("\n");

  const prompt = [
    `Find the exact GPS coordinates for each place listed below using Google Maps.`,
    `Anchor location: latitude ${lat.toFixed(5)}, longitude ${lng.toFixed(5)}.`,
    bboxHint
      ? `Restrict results to this bounding box: minLng=${bboxHint.minLng.toFixed(5)}, minLat=${bboxHint.minLat.toFixed(5)}, maxLng=${bboxHint.maxLng.toFixed(5)}, maxLat=${bboxHint.maxLat.toFixed(5)}.`
      : null,
    ``,
    `Places:`,
    placeList,
    ``,
    `Return ONLY valid JSON, no other text.`,
    `Return an array of objects. For each requested place include up to ${maxCandidates} candidates if ambiguous.`,
    `Schema: [{"query":"original input","candidates":[{"name":"Official name","lat":54.1234,"lng":25.1234,"place_id":"...","address":"...","confidence":0.0}]}]`,
    ``,
    `Use the official local-language name for each place.`,
    `Omit any place you cannot find with confidence.`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const r = await genai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        systemInstruction: GROUNDING_SYSTEM,
        tools: [{ googleMaps: {} }],
        toolConfig: {
          retrievalConfig: {
            latLng: { latitude: lat, longitude: lng },
          },
        },
        temperature: 0.1,
      },
    });

    const rawText = r.text ?? "";
    console.log(
      `[grounding] Query: [${namedPlaces.join(", ")}] | raw response (${rawText.length} chars): ${
        rawText.trim() ? JSON.stringify(rawText.slice(0, 1000)) : "(empty)"
      }`,
    );

    const parsed = extractJsonArray(rawText);
    if (!Array.isArray(parsed) || !parsed.length) {
      console.warn(
        `[grounding] No valid JSON array in Maps grounding response — parsed=${JSON.stringify(parsed)}`,
      );
      return [];
    }

    console.log(
      `[grounding] Parsed ${parsed.length} row(s): ${JSON.stringify(parsed).slice(0, 1000)}`,
    );

    const rows = parsed
      .filter((row) => row && typeof row === "object")
      .map((row) => {
        const candidates = Array.isArray(row.candidates) ? row.candidates : [];
        return candidates
          .filter((c) => c && typeof c === "object")
          .slice(0, maxCandidates);
      })
      .flat();

    console.log(
      `[grounding] Maps grounding: ${rows.length} candidate(s) for ${namedPlaces.length} query/queries`,
    );

    const pois = rows.map(toPoiFromMaps).filter(Boolean);

    if (pois.length < rows.length) {
      console.warn(
        `[grounding] ${rows.length - pois.length}/${rows.length} candidate(s) dropped by toPoiFromMaps (missing/invalid lat-lng). Raw candidates: ${JSON.stringify(rows).slice(0, 1000)}`,
      );
    }

    console.log(
      `[grounding] Resolved ${pois.length} POIs: ${pois.map((p) => p.name).join(", ") || "(none)"}`,
    );
    return pois;
  } catch (err) {
    console.warn(`[grounding] Maps grounding failed: ${err.message}`);
    return [];
  }
}
