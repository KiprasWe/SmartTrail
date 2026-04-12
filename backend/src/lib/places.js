// lib/places.js — Google Places API helpers + Photon geocoding
//
// fetchPOIsGooglePlaces — route-level POI search (A-to-B and Loop modes)
// reverseGeocodePlaceName / forwardGeocode — Photon OSM geocoding
// searchPlacesByIntent / searchPlacesForAllIntents — AI mode intent-driven search

import { fetchWithTimeout } from "../utils/http.js";
import { haversineM, minDistToRoute, bboxFromCenter, bboxFromCorridor } from "./geo.js";

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
export const GOOGLE_PLACES_TEXT_SEARCH_URL =
  "https://places.googleapis.com/v1/places:searchText";

const TIMEOUT_PLACES_MS = 15_000;

// ─── Route-level POI fetch (standard A-to-B and Loop routes) ──────────────────

export const POI_PLACES_CONFIG = {
  nature:        { query: "nature park viewpoint waterfall",  type: "park" },
  tourism:       { query: "tourist attraction sightseeing",   type: "tourist_attraction" },
  historic:      { query: "historical monument landmark",     type: "historical_landmark" },
  food:          { query: "cafe restaurant food",             type: "restaurant" },
  arts_culture:  { query: "museum art gallery theatre",       type: "museum" },
  leisure:       { query: "park sports ground recreation",    type: "sports_complex" },
  facilities:    { query: "public toilet restroom WC",        type: "public_restroom" },
  public_places: { query: "public square plaza marketplace",  type: "shopping_mall" },
};

export async function fetchPOIsGooglePlaces(routeCoords, poiTypes) {
  if (!poiTypes.length) return [];
  if (!GOOGLE_PLACES_API_KEY) {
    console.warn("fetchPOIsGooglePlaces: GOOGLE_PLACES_API_KEY not set");
    return [];
  }

  // Bounding box from route coords + ~500 m buffer.
  const BUFFER_DEG = 0.005;
  const lngs = routeCoords.map((c) => c[0]);
  const lats = routeCoords.map((c) => c[1]);
  const locationRestriction = {
    rectangle: {
      low: {
        latitude: Math.min(...lats) - BUFFER_DEG,
        longitude: Math.min(...lngs) - BUFFER_DEG,
      },
      high: {
        latitude: Math.max(...lats) + BUFFER_DEG,
        longitude: Math.max(...lngs) + BUFFER_DEG,
      },
    },
  };

  // One Places text search per POI type, in parallel.
  const results = await Promise.allSettled(
    poiTypes.map(async (type) => {
      const config = POI_PLACES_CONFIG[type.toLowerCase()];
      if (!config) return [];
      const res = await fetchWithTimeout(
        GOOGLE_PLACES_TEXT_SEARCH_URL,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
            "X-Goog-FieldMask":
              "places.id,places.displayName,places.location,places.primaryType,places.rating,places.userRatingCount,places.editorialSummary,places.photos",
          },
          body: JSON.stringify({
            textQuery: config.query,
            pageSize: 8,
            locationRestriction,
            rankPreference: "RELEVANCE",
            includedType: config.type,
          }),
        },
        TIMEOUT_PLACES_MS,
      );
      if (!res.ok) return [];
      const data = await res.json();
      return (data.places ?? []).map((p) => ({ ...p, _poiType: type }));
    }),
  );

  // Merge + deduplicate by place id.
  const seen = new Set();
  const all = results
    .filter((r) => r.status === "fulfilled")
    .flatMap((r) => r.value)
    .filter((p) => {
      if (!p.id || seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });

  // Keep only places within 400 m of the actual route.
  return all
    .filter((p) => {
      if (p.location?.latitude == null || p.location?.longitude == null)
        return false;
      return (
        minDistToRoute([p.location.longitude, p.location.latitude], routeCoords) <= 400
      );
    })
    .map((p, i) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.location.longitude, p.location.latitude] },
      properties: {
        id: p.id ?? i,
        name: p.displayName?.text ?? "Unnamed",
        category: p.primaryType ?? p._poiType ?? null,
        rating: p.rating ?? null,
        user_rating_count: p.userRatingCount ?? null,
        photo_name: p.photos?.[0]?.name ?? null,
        editorial_summary: p.editorialSummary?.text ?? null,
      },
    }));
}

// ─── Photon geocoding ─────────────────────────────────────────────────────────

// Reverse-geocode a [lng, lat] via Photon (OSM, no API key) into a short
// human-readable place name like "Vilnius, Lithuania".
// Returns null on any failure — caller falls back to raw coords.
export async function reverseGeocodePlaceName([lng, lat], lang = "en") {
  try {
    const url = `https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}&lang=${encodeURIComponent(lang)}`;
    const res = await fetchWithTimeout(url, {}, 8_000);
    if (!res.ok) return null;
    const data = await res.json();
    const props = data?.features?.[0]?.properties;
    if (!props) return null;
    const parts = [
      props.name,
      props.city && props.city !== props.name ? props.city : null,
      props.state && props.state !== props.city ? props.state : null,
      props.country,
    ].filter(Boolean);
    if (!parts.length) return null;
    return parts.join(", ");
  } catch {
    return null;
  }
}

// Forward-geocode a free-text place name via Photon into [lng, lat].
// Returns null on failure.
export async function forwardGeocode(query, lang = "en") {
  if (!query || typeof query !== "string") return null;
  try {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=1&lang=${encodeURIComponent(lang)}`;
    const res = await fetchWithTimeout(url, {}, 8_000);
    if (!res.ok) return null;
    const data = await res.json();
    const coords = data?.features?.[0]?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length !== 2) return null;
    return [coords[0], coords[1]]; // [lng, lat]
  } catch {
    return null;
  }
}

// ─── AI intent-driven Places search ──────────────────────────────────────────

// Map our locale codes to BCP-47 language tags accepted by Google Places API.
export const PLACES_LANG_MAP = { en: "en", lt: "lt" };

export const PLACES_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.rating",
  "places.userRatingCount",
  "places.websiteUri",
  "places.googleMapsUri",
  "places.types",
  "places.primaryType",
  "places.editorialSummary",
  "places.photos",
].join(",");

// Run ONE Google Places Text Search for a single intent. Returns a list of
// POIs in our normalized shape.
export async function searchPlacesByIntent(
  intent,
  { start, end, hasEnd, searchCenter, searchRadiusM, lang },
) {
  if (!GOOGLE_PLACES_API_KEY) return [];
  const languageCode = PLACES_LANG_MAP[lang] ?? "en";

  let rect = null;
  let textQueryExtra = "";

  if (intent.location_scope === "in_area" && intent.specific_area) {
    const geo = await forwardGeocode(intent.specific_area, lang);
    if (geo) {
      rect = { rectangle: bboxFromCenter(geo, 5_000) };
      textQueryExtra = ` in ${intent.specific_area}`;
    } else {
      console.warn(
        `[aiRouting] could not geocode specific_area "${intent.specific_area}" — falling back to along_route`,
      );
      textQueryExtra = ` ${intent.specific_area}`;
    }
  }

  if (!rect && intent.location_scope === "at_end" && hasEnd) {
    rect = { rectangle: bboxFromCenter(end, 4_000) };
  }

  if (!rect && intent.location_scope === "at_start") {
    rect = { rectangle: bboxFromCenter(start, 4_000) };
  }

  if (!rect) {
    if (hasEnd) {
      rect = { rectangle: bboxFromCorridor(start, end, 3_000) };
    } else {
      rect = {
        rectangle: bboxFromCenter(
          searchCenter,
          Math.max(1000, Math.min(searchRadiusM, 50_000)),
        ),
      };
    }
  }

  const body = {
    textQuery: `${intent.theme}${textQueryExtra}`.trim(),
    pageSize: Math.max(1, Math.min(intent.count, 10)),
    languageCode,
    locationRestriction: rect,
    rankPreference: "RELEVANCE",
  };
  if (intent.places_type) {
    body.includedType = intent.places_type;
    body.strictTypeFiltering = true;
  }

  let places;
  try {
    const res = await fetchWithTimeout(GOOGLE_PLACES_TEXT_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
        "X-Goog-FieldMask": PLACES_FIELD_MASK,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.warn(
        `[places] search failed for intent "${body.textQuery}" (${res.status}): ${errText.slice(0, 200)}`,
      );
      return [];
    }
    const data = await res.json();
    places = data.places ?? [];
  } catch (err) {
    console.warn(
      `[places] search error for intent "${body.textQuery}":`,
      err.message,
    );
    return [];
  }

  // If strict type filtering returned nothing, retry once relaxed.
  if (!places.length && body.strictTypeFiltering) {
    console.log(
      `[places] strict filter returned 0 for "${body.textQuery}", retrying relaxed`,
    );
    const relaxedBody = { ...body };
    delete relaxedBody.strictTypeFiltering;
    try {
      const res = await fetchWithTimeout(GOOGLE_PLACES_TEXT_SEARCH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
          "X-Goog-FieldMask": PLACES_FIELD_MASK,
        },
        body: JSON.stringify(relaxedBody),
      });
      if (res.ok) {
        const data = await res.json();
        places = data.places ?? [];
      }
    } catch {
      /* ignore */
    }
  }

  return places
    .map((place) => {
      if (place.location?.latitude == null || place.location?.longitude == null)
        return null;
      return {
        name: place.displayName?.text ?? "Unnamed place",
        lat: place.location.latitude,
        lng: place.location.longitude,
        description:
          place.editorialSummary?.text ??
          `${intent.theme}${textQueryExtra}`.trim(),
        place_id: place.id ?? null,
        formatted_address: place.formattedAddress ?? null,
        rating: place.rating ?? null,
        user_rating_count: place.userRatingCount ?? null,
        website_uri: place.websiteUri ?? null,
        google_maps_uri: place.googleMapsUri ?? null,
        types: place.types ?? [],
        primary_type: place.primaryType ?? null,
        editorial_summary: place.editorialSummary?.text ?? null,
        photo_name: place.photos?.[0]?.name ?? null,
        _intent: intent.theme,
      };
    })
    .filter(Boolean);
}

// Run every intent's Places search in parallel, merge results, dedupe by place_id.
export async function searchPlacesForAllIntents(intents, ctx) {
  const lists = await Promise.all(
    intents.map((intent) => searchPlacesByIntent(intent, ctx)),
  );
  const byId = new Map();
  for (const list of lists) {
    for (const poi of list) {
      const key = poi.place_id || `${poi.lat.toFixed(5)},${poi.lng.toFixed(5)}`;
      if (!byId.has(key)) byId.set(key, poi);
    }
  }
  return Array.from(byId.values());
}
