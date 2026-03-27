import { asyncHandler } from "../utils/asyncHandler.js";
import OpenRouteService from "openrouteservice-js";
import fetch from "node-fetch";
import { GoogleGenAI } from "@google/genai";

// ─── Constants ────────────────────────────────────────────────────────────────

const ORS_API_KEY = process.env.ORS_API_KEY;
const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY; // optional but recommended

const orsDirections = new OpenRouteService.Directions({ api_key: ORS_API_KEY });

const TRANSPORT_PROFILES = {
  walking: "foot-walking",
  running: "foot-walking",
  hiking: "foot-hiking",
  cycling: "cycling-regular",
  mtb: "cycling-mountain",
  ebike: "cycling-electric",
};

const RADIUS_KM = {
  cycling: 15,
  mtb: 15,
  ebike: 15,
  running: 8,
  hiking: 8,
  walking: 4,
};

// ─── Gemini response schema ───────────────────────────────────────────────────

const PLACE_SCHEMA = {
  type: "OBJECT",
  properties: {
    name: { type: "STRING" },
    address: { type: "STRING" }, // full street address from Google Maps
    place_id: { type: "STRING" }, // Google Maps Place ID (ChIJ...)
    lat: { type: "NUMBER" },
    lng: { type: "NUMBER" },
    rating: { type: "NUMBER" }, // Google Maps star rating
    description: { type: "STRING" }, // 2–3 sentence description
    tip: { type: "STRING" }, // insider tip most tourists miss
    duration_minutes: { type: "NUMBER" }, // suggested time to spend here
  },
  required: ["name", "address", "lat", "lng", "description"],
};

const ROUTE_SCHEMA = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING" },
    description: { type: "STRING" },
    theme: { type: "STRING" },
    start: PLACE_SCHEMA,
    waypoints: { type: "ARRAY", items: PLACE_SCHEMA },
    end: PLACE_SCHEMA,
  },
  required: ["title", "description", "start", "waypoints", "end"],
};

// ─── Geo helpers ──────────────────────────────────────────────────────────────

function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

function reorderWaypoints(startCoords, waypoints) {
  if (waypoints.length <= 1) return waypoints;
  const remaining = [...waypoints];
  const ordered = [];
  let current = startCoords;
  while (remaining.length) {
    let nearestIdx = 0;
    let nearestDist = Infinity;
    remaining.forEach((wp, i) => {
      const d = haversineKm(current, wp);
      if (d < nearestDist) {
        nearestDist = d;
        nearestIdx = i;
      }
    });
    ordered.push(remaining[nearestIdx]);
    current = remaining[nearestIdx];
    remaining.splice(nearestIdx, 1);
  }
  return ordered;
}

// ─── Geocoding ────────────────────────────────────────────────────────────────

async function nominatimSearch(query) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
  const res = await fetch(url, { headers: { "User-Agent": "SmartTrail/1.0" } });
  if (!res.ok) return null;
  const [hit] = await res.json();
  return hit ? { lat: parseFloat(hit.lat), lng: parseFloat(hit.lon) } : null;
}

/**
 * Geocode a place using its Maps-verified address first, then fall back to
 * progressively simpler name queries, then ORS as a last resort.
 */
async function geocodePlace(name, address, area) {
  const queries = [address, area ? `${name}, ${area}` : name, name].filter(
    Boolean,
  );

  for (const q of queries) {
    const result = await nominatimSearch(q).catch(() => null);
    if (result) return result;
  }

  // ORS geocoding as last resort
  const text = address || (area ? `${name}, ${area}` : name);
  const orsUrl = `https://api.openrouteservice.org/geocode/search?api_key=${ORS_API_KEY}&text=${encodeURIComponent(text)}&size=1`;
  const orsRes = await fetch(orsUrl);
  if (!orsRes.ok)
    throw new Error(`Geocoding failed for "${name}": ${orsRes.status}`);
  const [feature] = (await orsRes.json()).features ?? [];
  if (!feature) throw new Error(`No geocoding result for "${name}"`);
  const [lng, lat] = feature.geometry.coordinates;
  return { lat, lng };
}

// ─── Place enrichment (Google Places API — New) ───────────────────────────────

const PLACES_BASE = "https://places.googleapis.com/v1";

function placesHeaders(fieldMask) {
  return {
    "Content-Type": "application/json",
    "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
    "X-Goog-FieldMask": fieldMask,
  };
}

/**
 * Resolve a real place ID via Text Search (New) when the Gemini-provided one
 * is missing or hallucinated.
 */
async function resolveRealPlaceId(name, lat, lng) {
  const res = await fetch(`${PLACES_BASE}/places:searchText`, {
    method: "POST",
    headers: placesHeaders("places.id"),
    body: JSON.stringify({
      textQuery: name,
      locationBias: {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: 1000.0,
        },
      },
      pageSize: 1,
      languageCode: "en",
    }),
  });

  const status = res.status;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.warn(`[Places] Text Search HTTP ${status} for "${name}": ${body}`);
    return null;
  }

  const data = await res.json();
  const id = data.places?.[0]?.id ?? null;
  console.info(
    `[Places] Text Search for "${name}" → ${id ?? "no result"} (HTTP ${status})`,
  );
  return id;
}

/**
 * Fetch place details (photos, hours, etc.) by place ID using Places API (New).
 */
async function fetchPlaceDetails(placeId) {
  const fieldMask = [
    "photos",
    "regularOpeningHours",
    "websiteUri",
    "internationalPhoneNumber",
    "priceLevel",
    "userRatingCount",
    "editorialSummary",
  ].join(",");

  const res = await fetch(`${PLACES_BASE}/places/${placeId}?languageCode=en`, {
    headers: placesHeaders(fieldMask),
  });

  const status = res.status;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.warn(
      `[Places] Details HTTP ${status} for place_id=${placeId}: ${body}`,
    );
    return null;
  }

  const data = await res.json();
  console.info(
    `[Places] Details for ${placeId} → ${data.photos?.length ?? 0} photo(s) (HTTP ${status})`,
  );
  return data;
}

/**
 * Resolve a photo resource name to an actual image URI using the media endpoint.
 */
async function resolvePhotoUri(photoName) {
  const res = await fetch(
    `${PLACES_BASE}/${photoName}/media?maxWidthPx=800&skipHttpRedirect=true&key=${GOOGLE_PLACES_API_KEY}`,
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.photoUri ?? null;
}

/**
 * Fetch photos, opening hours, and details from Google Places API (New).
 * Falls back to Text Search when Gemini's place_id is missing or invalid.
 */
async function enrichWithGooglePlaces(place) {
  if (!GOOGLE_PLACES_API_KEY) {
    console.warn(
      "[Places] GOOGLE_PLACES_API_KEY not set — skipping enrichment",
    );
    return place;
  }

  try {
    let placeId = place.place_id ?? null;
    let details = placeId ? await fetchPlaceDetails(placeId) : null;

    // Gemini place_id was hallucinated — resolve via Text Search
    if (!details && place.lat && place.lng) {
      console.info(`[Places] Falling back to Text Search for "${place.name}"`);
      placeId = await resolveRealPlaceId(place.name, place.lat, place.lng);
      if (placeId) details = await fetchPlaceDetails(placeId);
    }

    if (!details) {
      console.warn(`[Places] No details found for "${place.name}" — no photos`);
      return place;
    }

    // Resolve up to 3 photo URIs from their resource names
    const photoNames = (details.photos ?? []).slice(0, 3).map((p) => p.name);
    const photoUris = (
      await Promise.all(photoNames.map(resolvePhotoUri))
    ).filter(Boolean);

    console.info(
      `[Places] "${place.name}" → ${photoUris.length} photo URI(s) resolved`,
    );

    return {
      ...place,
      place_id: placeId,
      photos: photoUris,
      opening_hours: details.regularOpeningHours?.weekdayDescriptions ?? null,
      is_open_now: details.regularOpeningHours?.openNow ?? null,
      website: details.websiteUri ?? null,
      phone: details.internationalPhoneNumber ?? null,
      price_level: details.priceLevel ?? null,
      review_count: details.userRatingCount ?? null,
      editorial_summary: details.editorialSummary?.text ?? null,
      enriched_by: "google_places",
    };
  } catch (err) {
    console.warn(
      `[Places] Enrichment failed for "${place.name}":`,
      err.message,
    );
    return place;
  }
}

/**
 * Fetch a Wikipedia summary + thumbnail as a free fallback.
 * No API key required.
 */
async function enrichWithWikipedia(place) {
  try {
    const title = encodeURIComponent(place.name);
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${title}`,
    );
    if (!res.ok) return place;

    const data = await res.json();
    if (data.type === "disambiguation") return place; // skip ambiguous pages

    return {
      ...place,
      photos: data.thumbnail?.source
        ? [data.thumbnail.source]
        : (place.photos ?? []),
      wikipedia_summary: data.extract ?? null,
      wikipedia_url: data.content_urls?.desktop?.page ?? null,
      enriched_by: "wikipedia",
    };
  } catch {
    return place;
  }
}

/**
 * Enrich a single place: try Google Places, fall back to Wikipedia for photos.
 */
async function enrichPlace(place) {
  // 1. Try Google Places (authoritative photos + hours)
  let enriched = await enrichWithGooglePlaces(place);

  // 2. If no photos yet, try Wikipedia
  if (!enriched.photos?.length) {
    enriched = await enrichWithWikipedia(enriched);
  }

  return enriched;
}

// ─── Simple route handlers ────────────────────────────────────────────────────

export const generateAtoB = asyncHandler(async (req, res) => {
  const { start, end, transport = "walking" } = req.body;
  if (!start?.lat || !start?.lng || !end?.lat || !end?.lng)
    return res
      .status(400)
      .json({ error: "Start and end coordinates are required" });

  const route = await orsDirections.calculate({
    coordinates: [
      [start.lng, start.lat],
      [end.lng, end.lat],
    ],
    profile: TRANSPORT_PROFILES[transport] ?? "foot-walking",
    format: "json",
    api_version: "v2",
    alternative_routes: {
      target_count: 3,
      weight_factor: 1.6,
      share_factor: 0.5,
    },
  });

  res.json({ mode: "a_to_b", route });
});

export const generateRoundTrip = asyncHandler(async (req, res) => {
  const { start, transport = "walking", length = 5000 } = req.body;
  if (!start?.lat || !start?.lng)
    return res.status(400).json({ error: "Start coordinates are required" });

  const responses = await Promise.all(
    [1, 2, 3].map((seed) =>
      orsDirections.calculate({
        coordinates: [[start.lng, start.lat]],
        profile: TRANSPORT_PROFILES[transport] ?? "foot-walking",
        format: "json",
        api_version: "v2",
        options: { round_trip: { length, points: 3, seed } },
      }),
    ),
  );

  const routes = responses.flatMap((r) => r.routes ?? []);
  res.json({ mode: "round_trip", route: { ...responses[0], routes } });
});

// ─── AI route handler ─────────────────────────────────────────────────────────

export const generateAIRoute = asyncHandler(async (req, res) => {
  const {
    preferences,
    area,
    transport = "walking",
    start,
    mode = "a_to_b",
  } = req.body;

  if (!preferences?.trim())
    return res.status(400).json({ error: "Preferences are required" });
  if (!area?.trim() && !start)
    return res
      .status(400)
      .json({ error: "Area is required when no GPS location is provided" });
  if (!process.env.GEMINI_API_KEY)
    return res.status(500).json({ error: "GEMINI_API_KEY is not configured" });

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const profile = TRANSPORT_PROFILES[transport] ?? "foot-walking";
  const isRound = mode === "round_trip";
  const radiusKm = RADIUS_KM[transport] ?? 4;
  const maxLegKm = Math.round(radiusKm * 0.6 * 10) / 10;

  // Resolve anchor point for radius validation
  const areaCenter = area?.trim()
    ? await nominatimSearch(area).catch(() => null)
    : null;
  const anchorLat = start?.lat ?? areaCenter?.lat;
  const anchorLng = start?.lng ?? areaCenter?.lng;

  if (!anchorLat || !anchorLng)
    return res.status(400).json({
      error: `Could not resolve coordinates for "${area}" — try a more specific city name`,
    });

  // ── Step 1: Gemini with Maps grounding → free-text grounded answer ──────────
  const groundedResult = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: {
      tools: [{ googleMaps: {} }],
      toolConfig: {
        retrievalConfig: {
          latLng: { latitude: anchorLat, longitude: anchorLng },
        },
      },
    },
  });

  const groundedText = groundedResult.text;

  // ── Step 2: Extract grounded text into strict JSON ──────────────────────────
  const extractPrompt = `
Extract the route plan from the text below into the required JSON format.
Return ONLY valid JSON matching the schema — no markdown fences, no extra text.

Text:
${groundedText}
`.trim();

  const structuredResult = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: extractPrompt,
    config: {
      systemInstruction:
        "You are a JSON extraction assistant. Output only valid JSON, nothing else.",
      responseMimeType: "application/json",
      responseSchema: ROUTE_SCHEMA,
    },
  });

  const plan = JSON.parse(structuredResult.text);

  // ── Geocode all places using their Maps-verified addresses ──────────────────
  console.info("[AI route] Geocoding places using Maps-verified addresses");

  const allPlaces = [
    { slot: "start", place: plan.start },
    ...plan.waypoints.map((wp, i) => ({ slot: i, place: wp })),
    { slot: "end", place: plan.end },
  ];

  const geocoded = await Promise.allSettled(
    allPlaces.map(({ place }) => geocodePlace(place.name, place.address, area)),
  );

  geocoded.forEach((r, i) => {
    const { slot, place } = allPlaces[i];
    if (r.status === "fulfilled" && r.value) {
      const coords = r.value;
      if (slot === "start") plan.start = { ...plan.start, ...coords };
      else if (slot === "end") plan.end = { ...plan.end, ...coords };
      else plan.waypoints[slot] = { ...plan.waypoints[slot], ...coords };
    } else {
      console.warn(
        `[AI route] Geocoding failed for "${place.name}" (${place.address})`,
      );
    }
  });

  // GPS fix is the most accurate start we can have
  if (start) {
    plan.start.lat = start.lat;
    plan.start.lng = start.lng;
  }

  // Round-trip: force end to exactly match start
  if (isRound) {
    plan.end.lat = plan.start.lat;
    plan.end.lng = plan.start.lng;
  }

  // ── Drop anything still outside radius after geocoding ──────────────────────
  const anchor = { lat: anchorLat, lng: anchorLng };
  const hardLimit = radiusKm * 2;

  const before = plan.waypoints.length;
  plan.waypoints = plan.waypoints.filter((wp) => {
    const dist = haversineKm(anchor, wp);
    if (dist > hardLimit) {
      console.warn(
        `[AI route] Dropping "${wp.name}" — ${dist.toFixed(1)} km from center`,
      );
      return false;
    }
    return true;
  });
  if (plan.waypoints.length < before)
    console.info(
      `[AI route] Removed ${before - plan.waypoints.length} out-of-radius waypoint(s)`,
    );

  if (haversineKm(anchor, plan.start) > hardLimit) {
    console.warn(
      `[AI route] start "${plan.start.name}" out of radius — snapping to anchor`,
    );
    plan.start = { ...plan.start, lat: anchorLat, lng: anchorLng };
  }
  if (!isRound && haversineKm(anchor, plan.end) > hardLimit) {
    console.warn(
      `[AI route] end "${plan.end.name}" out of radius — snapping to anchor`,
    );
    plan.end = { ...plan.end, lat: anchorLat, lng: anchorLng };
  }

  // ── Enrich all places with photos & details ─────────────────────────────────
  console.info("[AI route] Enriching places with photos and details");

  [plan.start, plan.end, ...plan.waypoints] = await Promise.all([
    enrichPlace(plan.start),
    enrichPlace(plan.end),
    ...plan.waypoints.map(enrichPlace),
  ]);

  // ── Build ORS route ─────────────────────────────────────────────────────────
  plan.waypoints = reorderWaypoints(plan.start, plan.waypoints);

  const coordinates = [
    [plan.start.lng, plan.start.lat],
    ...plan.waypoints.map((wp) => [wp.lng, wp.lat]),
    [plan.end.lng, plan.end.lat],
  ];

  const orsRes = await fetch(
    `https://api.openrouteservice.org/v2/directions/${profile}/json`,
    {
      method: "POST",
      headers: {
        Authorization: ORS_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ coordinates }),
    },
  );

  if (!orsRes.ok) {
    const errText = await orsRes.text();
    return res
      .status(502)
      .json({ error: `ORS error: ${orsRes.status} — ${errText}` });
  }

  res.json({
    mode: "ai_route",
    route: await orsRes.json(),
    plan,
    start: { lat: plan.start.lat, lng: plan.start.lng },
    end: { lat: plan.end.lat, lng: plan.end.lng },
  });
});
