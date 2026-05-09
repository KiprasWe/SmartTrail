import { haversineM, routeBbox } from "./geo.js";

const ORS_API_KEY = process.env.ORS_API_KEY;
const NOMINATIM_EMAIL = process.env.NOMINATIM_EMAIL ?? "student@university.lt";
const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const ORS_POI_BASE = "https://api.openrouteservice.org/pois";
const ORS_GEOCODE_BASE = "https://api.openrouteservice.org/geocode/search";
const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";
const ORS_MAX_RESULTS = 100;
const NOMINATIM_TIMEOUT = 12_000;

const TYPE_TO_ORS_CATEGORIES = {
  tourist_attraction:  [620],
  historical_landmark: [220],
  museum:              [130],
  art_gallery:         [130],
  church:              [130, 220],
  monument:            [220],
  park:                [330],
  national_park:       [330],
  restaurant:          [560],
  cafe:                [560],
  bakery:              [420],
  bar:                 [560],
  meal_takeaway:       [560],
  zoo:                 [120],
  aquarium:            [120],
  amusement_park:      [260],
  shopping_mall:       [420],
  stadium:             [260],
};

// ORS category_group_ids used by the AI pipeline intents.
const ORS_GROUP_IDS = {
  animals:                 120,
  arts_and_culture:        130,
  historic:                220,
  leisure_and_entertainment: 260,
  natural:                 330,
  public_places:           360,
  shops:                   420,
  sustenance:              560,
  tourism:                 620,
};

// Maps ORS category_name strings to our internal type tokens.
const ORS_CATEGORY_NAME_MAP = {
  restaurant: "restaurant", food_court: "restaurant",
  fast_food: "fast_food",
  cafe: "cafe", coffee_shop: "cafe",
  bar: "bar", pub: "bar", biergarten: "bar",
  bakery: "bakery",
  museum: "museum",
  gallery: "art_gallery", art_gallery: "art_gallery", arts_centre: "art_gallery",
  cinema: "cinema",
  theatre: "theatre",
  place_of_worship: "church", church: "church", cathedral: "church", chapel: "church",
  monastery: "church", abbey: "church",
  castle: "historical_landmark", ruins: "historical_landmark", ruin: "historical_landmark",
  archaeological_site: "historical_landmark", manor: "historical_landmark",
  fort: "historical_landmark", city_walls: "historical_landmark",
  heritage: "historical_landmark", battlefield: "historical_landmark",
  wayside_shrine: "historical_landmark", wayside_cross: "historical_landmark",
  monument: "monument", memorial: "monument", obelisk: "monument",
  statue: "monument", column: "monument",
  viewpoint: "viewpoint",
  park: "park", garden: "park", recreation_ground: "park",
  nature_reserve: "national_park", national_park: "national_park",
  zoo: "zoo", wildlife_park: "zoo",
  aquarium: "aquarium",
  amusement_park: "amusement_park", theme_park: "amusement_park",
  stadium: "stadium", sports_centre: "sports", sports_center: "sports",
  swimming_pool: "sports", pitch: "sports",
  beach: "beach",
  waterfall: "waterfall",
  peak: "peak", cliff: "peak",
  cave_entrance: "cave", cave: "cave",
  information: "information",
  attraction: "tourist_attraction", artwork: "tourist_attraction",
};

// Fallback: maps ORS source_name (OSM tag key) when category_name doesn't match.
const ORS_SOURCE_NAME_MAP = {
  historic: "historical_landmark",
  natural: "nature",
  leisure: "leisure",
  shop: "shopping_mall",
};

function wikiToUrl(wikipediaTag) {
  // OSM wikipedia tag is commonly "lang:Title" (e.g. "en:Trakai Island Castle")
  if (typeof wikipediaTag !== "string") return null;
  const t = wikipediaTag.trim();
  if (!t) return null;
  const m = t.match(/^([a-z]{2,3}):(.+)$/i);
  if (!m) return null;
  const lang = m[1].toLowerCase();
  const title = m[2].trim().replace(/ /g, "_");
  if (!title) return null;
  return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`;
}

function nominatimHeaders() {
  return {
    "User-Agent": `RouteApp/1.0 (${APP_URL}; ${NOMINATIM_EMAIL})`,
    Referer: APP_URL,
    Accept: "application/json",
  };
}

function orsPOIHeaders() {
  if (!ORS_API_KEY) throw new Error("ORS_API_KEY env var is not set");
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: ORS_API_KEY,
  };
}

async function orsPoiSearch({ lat, lng, radiusM, categoryIds, limit }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { features: [] };

  const body = {
    request: "pois",
    geometry: {
      geojson: { type: "Point", coordinates: [lng, lat] },
      buffer: Math.max(1, Math.min(Math.round(radiusM), 2000)),
    },
    filters: { category_group_ids: categoryIds },
    limit: Math.min(limit, ORS_MAX_RESULTS),
    sortby: "distance",
  };

  const res = await fetch(ORS_POI_BASE, {
    method: "POST",
    headers: orsPOIHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ORS POI HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const raw = await res.text();
  try {
    return JSON.parse(raw.replace(/\bNaN\b/g, "null"));
  } catch (err) {
    throw new Error(`ORS POI invalid JSON: ${err.message}`);
  }
}

function derivePrimaryType(categoryData) {
  if (!categoryData) return "tourist_attraction";
  const entries = Object.values(categoryData);
  for (const { category_name } of entries) {
    const type = ORS_CATEGORY_NAME_MAP[category_name?.toLowerCase()];
    if (type) return type;
  }
  for (const { source_name } of entries) {
    const type = ORS_SOURCE_NAME_MAP[source_name?.toLowerCase()];
    if (type) return type;
  }
  return "tourist_attraction";
}

function orsFeatureToPoi(feature, trace) {
  const coords = feature.geometry?.coordinates;
  if (!coords) {
    trace?.decision("poi_drop", { reason: "missing_geometry_coordinates" });
    return null;
  }
  const [lng, lat] = coords;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    trace?.decision("poi_drop", { reason: "non_finite_coordinates", lng, lat });
    return null;
  }

  const props = feature.properties ?? {};
  const name = props.osm_tags?.name;
  if (!name) {
    trace?.decision("poi_drop", { reason: "missing_name", place_id: props.osm_id ?? null });
    return null;
  }

  const primary_type = derivePrimaryType(props.category_ids);
  const tags = props.osm_tags ?? {};
  const addrParts = [tags["addr:street"], tags["addr:city"] || tags["addr:town"]].filter(Boolean);
  const wikipedia_uri = wikiToUrl(tags.wikipedia);
  const wikidata = typeof tags.wikidata === "string" ? tags.wikidata.trim() : null;

  return {
    place_id: `ors:${props.osm_id}`,
    name,
    lat,
    lng,
    primary_type,
    types: [primary_type],
    formatted_address: addrParts.join(", ") || null,
    description: null,
    editorial_summary: null,
    rating: null,
    user_rating_count: null,
    website_uri: tags.website || tags.url || null,
    wikipedia_uri,
    wikidata: wikidata || null,
    google_maps_uri: null,
    photo_name: null,
    _ors_categories: props.category_ids,
  };
}

export async function searchORS({ places_type, lat, lng, radiusM, count, trace }) {
  const categoryIds =
    TYPE_TO_ORS_CATEGORIES[places_type] ?? TYPE_TO_ORS_CATEGORIES.tourist_attraction;
  try {
    const geojson = await orsPoiSearch({ lat, lng, radiusM, categoryIds, limit: count });
    const pois = (geojson.features ?? []).map((f) => orsFeatureToPoi(f, trace)).filter(Boolean);
    console.log(`[places] ORS search (${places_type}, r=${(radiusM / 1000).toFixed(1)}km): ${pois.length} results`);
    return pois;
  } catch (err) {
    console.warn(`[places] searchORS failed: ${err.message}`);
    return [];
  }
}

function sampleRoute(coords, stepM) {
  if (!coords?.length) return [coords[0]];
  const result = [coords[0]];
  let accumulated = 0;
  for (let i = 1; i < coords.length; i++) {
    accumulated += haversineM(coords[i - 1], coords[i]);
    if (accumulated >= stepM) {
      result.push(coords[i]);
      accumulated = 0;
    }
  }
  const last = coords[coords.length - 1];
  if (result[result.length - 1] !== last) result.push(last);
  return result;
}

// Scans the full route corridor by sampling the skeleton and firing parallel
// ORS point searches. Step = radius * 1.5 guarantees adjacent circles overlap.
export async function searchRouteByCategories(skeletonCoords, categoryIds, radiusM = 2_000, trace) {
  if (!skeletonCoords?.length || !categoryIds?.length) return [];

  const clampedRadius = Math.min(radiusM, 2_000);
  const samples = sampleRoute(skeletonCoords, Math.round(clampedRadius * 1.5));

  const batches = await Promise.all(
    samples.map(([lng, lat]) =>
      orsPoiSearch({ lat, lng, radiusM: clampedRadius, categoryIds, limit: 40 }).catch(() => ({
        features: [],
      })),
    ),
  );

  const seen = new Set();
  const pois = [];
  for (const batch of batches) {
    for (const poi of (batch.features ?? []).map((f) => orsFeatureToPoi(f, trace)).filter(Boolean)) {
      if (!seen.has(poi.place_id)) {
        seen.add(poi.place_id);
        pois.push(poi);
      }
    }
  }

  console.log(`[places] Corridor scan (${samples.length} samples, r=${clampedRadius / 1_000}km): ${pois.length} POIs`);
  return pois;
}

// Samples the trip region (straight line A→B, or loop circle) rather than the
// skeleton, so POI candidates aren't biased by the pre-generated route shape.
function sampleStraightLine(start, end, stepM) {
  const totalM = haversineM(start, end);
  if (totalM < stepM) return [start, end];
  const n = Math.ceil(totalM / stepM);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t]);
  }
  return pts;
}

function sampleLoopArea(start, loopRadiusM) {
  const pts = [start];
  if (loopRadiusM <= 1_500) return pts;
  const [lng, lat] = start;
  const latRad = (lat * Math.PI) / 180;
  const latDeg = loopRadiusM / 111_320;
  const lngDeg = loopRadiusM / (111_320 * (Math.cos(latRad) || 1));
  for (const deg of [0, 90, 180, 270]) {
    const rad = (deg * Math.PI) / 180;
    pts.push([lng + Math.sin(rad) * lngDeg, lat + Math.cos(rad) * latDeg]);
  }
  return pts;
}

// Area-based POI search: covers the trip region instead of just the corridor.
// For A→B routes samples the straight line; for loops samples a ring.
export async function searchAreaByCategories(start, end, targetDistanceM, categoryIds, hasEnd = true, trace) {
  if (!categoryIds?.length) return [];
  const radiusM = 2_000;
  const stepM = radiusM * 1.5;
  const samplePoints = hasEnd && end
    ? sampleStraightLine(start, end, stepM)
    : sampleLoopArea(start, targetDistanceM / (2 * Math.PI));

  const batches = await Promise.all(
    samplePoints.map(([lng, lat]) =>
      orsPoiSearch({ lat, lng, radiusM, categoryIds, limit: 40 }).catch(() => ({ features: [] })),
    ),
  );

  const seen = new Set();
  const pois = [];
  for (const batch of batches) {
    for (const poi of (batch.features ?? []).map((f) => orsFeatureToPoi(f, trace)).filter(Boolean)) {
      if (!seen.has(poi.place_id)) {
        seen.add(poi.place_id);
        pois.push(poi);
      }
    }
  }

  console.log(`[places] Area search (${samplePoints.length} points, r=2km): ${pois.length} POIs`);
  return pois;
}

export function collectCategoryIds(intents) {
  return [
    ...new Set(
      intents.map(
        (i) => ORS_GROUP_IDS[i.places_type] ?? ORS_GROUP_IDS.tourism,
      ),
    ),
  ];
}

// Resolves a named place from grounded coordinates via Nominatim reverse geocode.
export async function resolvePoiFromCoords(name, lat, lng) {
  try {
    const qs = new URLSearchParams({
      lat: String(lat),
      lon: String(lng),
      format: "jsonv2",
      zoom: "17",
      "accept-language": "en",
    });
    const res = await fetch(`${NOMINATIM_BASE}/reverse?${qs}`, {
      headers: nominatimHeaders(),
      signal: AbortSignal.timeout(6_000),
    });
    const data = res.ok ? await res.json() : null;
    const resolvedName =
      data?.name || data?.display_name?.split(",")[0]?.trim() || name;
    return buildGroundedPoi(resolvedName, lat, lng, data?.display_name ?? null);
  } catch {
    return buildGroundedPoi(name, lat, lng, null);
  }
}

function buildGroundedPoi(name, lat, lng, address) {
  return {
    place_id: `grounding:${lat.toFixed(5)},${lng.toFixed(5)}`,
    name,
    lat,
    lng,
    primary_type: "tourist_attraction",
    types: ["tourist_attraction"],
    formatted_address: address,
    description: null,
    editorial_summary: null,
    rating: null,
    user_rating_count: null,
    website_uri: null,
    google_maps_uri: null,
    photo_name: null,
    _osm_tags: {},
  };
}

// Nominatim structured search for parks/green spaces in a route bounding box.
// Finds named OSM area features (leisure=park, nature_reserve, garden) that ORS
// point-based /pois misses because parks are polygons, not nodes.
export async function searchParksByBbox(skeletonCoords, bufferM = 3_000) {
  if (!skeletonCoords?.length) return [];

  const [minLng, minLat, maxLng, maxLat] = routeBbox(skeletonCoords);
  const latBuf = bufferM / 111_320;
  const midLat = (minLat + maxLat) / 2;
  const lngBuf = bufferM / (111_320 * Math.cos((midLat * Math.PI) / 180) || 1);
  const viewbox = `${(minLng - lngBuf).toFixed(6)},${(maxLat + latBuf).toFixed(6)},${(maxLng + lngBuf).toFixed(6)},${(minLat - latBuf).toFixed(6)}`;

  const leisureTypes = ["park", "nature_reserve", "garden"];
  const batches = await Promise.all(
    leisureTypes.map(async (ltype) => {
      try {
        const qs = new URLSearchParams({
          format: "jsonv2",
          leisure: ltype,
          viewbox,
          bounded: "1",
          limit: "15",
          namedetails: "1",
          "accept-language": "en",
        });
        const res = await fetch(`${NOMINATIM_BASE}/search?${qs}`, {
          headers: nominatimHeaders(),
          signal: AbortSignal.timeout(NOMINATIM_TIMEOUT),
        });
        return res.ok ? await res.json() : [];
      } catch (err) {
        console.warn(`[places] Nominatim park search (${ltype}) failed: ${err.message}`);
        return [];
      }
    }),
  );
  const allResults = batches.flat();

  const seen = new Set();
  const pois = allResults
    .filter((r) => {
      const key = `${r.osm_type}:${r.osm_id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((r) => {
      const lat = parseFloat(r.lat);
      const lng = parseFloat(r.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      const name = r.namedetails?.name || r.display_name?.split(",")[0]?.trim();
      if (!name) return null;
      return {
        place_id: `nominatim:${r.osm_type}:${r.osm_id}`,
        name,
        lat,
        lng,
        primary_type: "park",
        types: ["park"],
        formatted_address: r.display_name || null,
        description: null,
        editorial_summary: null,
        rating: null,
        user_rating_count: null,
        website_uri: null,
        google_maps_uri: null,
        photo_name: null,
      };
    })
    .filter(Boolean);

  console.log(`[places] Nominatim parks (bbox): ${pois.length} results`);
  return pois;
}

async function orsGeocode(name) {
  if (!ORS_API_KEY) return null;
  const qs = new URLSearchParams({
    api_key: ORS_API_KEY,
    text: name,
    size: "5",
    layers: "locality,county,region,macroregion",
  });
  const res = await fetch(`${ORS_GEOCODE_BASE}?${qs}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`ORS geocode HTTP ${res.status}`);
  const data = await res.json();
  const [lng, lat] = data.features?.[0]?.geometry?.coordinates ?? [];
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return [lng, lat];
}

export async function geocodeCity(name, lang = "en") {
  // Try ORS Pelias first — fast, not rate-limited
  try {
    const coords = await orsGeocode(name);
    if (coords) {
      console.log(`[geocodeCity] ORS "${name}" → [${coords[0].toFixed(4)}, ${coords[1].toFixed(4)}]`);
      return coords;
    }
  } catch (err) {
    console.warn(`[geocodeCity] ORS failed for "${name}": ${err.message}`);
  }

  // Nominatim fallback
  try {
    const qs = new URLSearchParams({
      q: name,
      format: "jsonv2",
      addressdetails: "1",
      limit: "5",
      "accept-language": lang,
    });
    const res = await fetch(`${NOMINATIM_BASE}/search?${qs}`, {
      headers: nominatimHeaders(),
      signal: AbortSignal.timeout(NOMINATIM_TIMEOUT),
    });
    if (!res.ok) return null;
    const results = await res.json();
    if (!results.length) return null;
    const settlement = results.find((r) =>
      ["city", "town", "village", "municipality", "administrative"].includes(r.addresstype ?? r.type),
    );
    const r = settlement ?? results[0];
    const lat = parseFloat(r.lat);
    const lng = parseFloat(r.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    console.log(`[geocodeCity] Nominatim "${name}" → [${lng.toFixed(4)}, ${lat.toFixed(4)}]`);
    return [lng, lat];
  } catch (err) {
    console.warn(`[geocodeCity] Nominatim fallback failed for "${name}": ${err.message}`);
    return null;
  }
}

export async function reverseGeocodePlaceName([lng, lat], lang = "en") {
  try {
    const qs = new URLSearchParams({
      lat: String(lat),
      lon: String(lng),
      format: "jsonv2",
      addressdetails: "1",
      zoom: "10",
      "accept-language": lang,
    });
    const res = await fetch(`${NOMINATIM_BASE}/reverse?${qs}`, {
      headers: nominatimHeaders(),
      signal: AbortSignal.timeout(NOMINATIM_TIMEOUT),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const addr = data?.address ?? {};
    return (
      addr.city || addr.town || addr.village ||
      addr.municipality || addr.county || addr.state ||
      data?.display_name?.split(",")[0]?.trim() || null
    );
  } catch (err) {
    console.warn(`[places] Nominatim reverse geocode failed: ${err.message}`);
    return null;
  }
}

const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

const OVERPASS_TAG_TO_TYPE = {
  "tourism:viewpoint": "tourist_attraction",
  "tourism:attraction": "tourist_attraction",
  "tourism:picnic_site": "tourist_attraction",
  "leisure:park": "park",
  "leisure:nature_reserve": "national_park",
  "leisure:garden": "park",
  "natural:wood": "park",
  "natural:waterfall": "tourist_attraction",
  "natural:peak": "tourist_attraction",
  "natural:beach": "tourist_attraction",
  "natural:cave_entrance": "tourist_attraction",
  "historic:castle": "historical_landmark",
  "historic:fort": "historical_landmark",
  "historic:ruins": "historical_landmark",
  "historic:monastery": "historical_landmark",
  "historic:archaeological_site": "historical_landmark",
  "historic:battlefield": "historical_landmark",
  "military:bunker": "historical_landmark",
  "boundary:national_park": "national_park",
  "boundary:protected_area": "national_park",
};

function overpassTagsToPrimaryType(tags) {
  for (const [k, v] of Object.entries(tags ?? {})) {
    const t = OVERPASS_TAG_TO_TYPE[`${k}:${v}`];
    if (t) return t;
  }
  if (tags?.tourism) return "tourist_attraction";
  if (tags?.leisure) return "park";
  if (tags?.historic || tags?.military) return "historical_landmark";
  if (tags?.natural) return "tourist_attraction";
  return "tourist_attraction";
}

// Searches OpenStreetMap via Overpass API for features matching given OSM tags
// within a [minLng, minLat, maxLng, maxLat] bounding box.
// Finds parks, forests, viewpoints, historic sites etc. that ORS POI misses
// because they are stored as OSM ways/relations rather than nodes.
export async function searchOverpassByBbox(bbox, osmTags, limit = 60) {
  if (!osmTags?.length || !bbox) return [];
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const bboxStr = `${minLat},${minLng},${maxLat},${maxLng}`;

  const tagParts = osmTags.map(({ key, value }) => [
    `  node["${key}"="${value}"](${bboxStr});`,
    `  way["${key}"="${value}"](${bboxStr});`,
    `  relation["${key}"="${value}"](${bboxStr});`,
  ].join("\n"));

  const fetchLimit = Math.min(limit * 4, 400);
  const query = `[out:json][timeout:20];\n(\n${tagParts.join("\n")}\n);\nout tags center ${fetchLimit};\n`;

  let res;
  try {
    for (const mirror of OVERPASS_MIRRORS) {
      try {
        res = await fetch(mirror, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(25_000),
        });
        if (res.ok) break;
        console.warn(`[places] Overpass ${mirror} HTTP ${res.status}, trying next mirror`);
      } catch (mirrorErr) {
        console.warn(`[places] Overpass ${mirror} failed: ${mirrorErr.message}, trying next mirror`);
      }
    }
    if (!res?.ok) {
      console.warn(`[places] All Overpass mirrors failed`);
      return [];
    }
    const data = await res.json();
    const seen = new Set();
    const pois = [];

    for (const el of data.elements ?? []) {
      const lat = el.lat ?? el.center?.lat;
      const lng = el.lon ?? el.center?.lon;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const name = el.tags?.name ?? el.tags?.["name:en"] ?? el.tags?.["name:lt"];
      if (!name) continue;
      const id = `overpass:${el.type}:${el.id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const wikipedia_uri = wikiToUrl(el.tags?.wikipedia);
      const wikidata = typeof el.tags?.wikidata === "string" ? el.tags.wikidata.trim() : null;
      pois.push({
        place_id: id,
        name,
        lat,
        lng,
        primary_type: overpassTagsToPrimaryType(el.tags),
        types: [overpassTagsToPrimaryType(el.tags)],
        formatted_address: null,
        description: el.tags?.description ?? null,
        editorial_summary: null,
        rating: null,
        user_rating_count: null,
        website_uri: el.tags?.website ?? el.tags?.url ?? null,
        wikipedia_uri,
        wikidata: wikidata || null,
        google_maps_uri: null,
        photo_name: null,
      });
      if (pois.length >= limit) break;
    }

    const tagStr = osmTags.map((t) => `${t.key}=${t.value}`).join(",");
    console.log(`[places] Overpass [${tagStr}] → ${pois.length} named results`);
    return pois;
  } catch (err) {
    console.warn(`[places] Overpass failed: ${err.message}`);
    return [];
  }
}
