import { haversineM, routeBbox } from "./geo.js";
import {
  ORS_MAX_RESULTS,
  NOMINATIM_TIMEOUT_MS as NOMINATIM_TIMEOUT,
} from "../config/tuning.js";
import {
  ORS_API_KEY,
  NOMINATIM_EMAIL,
  APP_URL,
  ORS_POI_BASE,
  NOMINATIM_BASE,
} from "../config/env.js";

const ORS_GROUP_IDS = {
  animals: 120,
  arts_and_culture: 130,
  historic: 220,
  leisure_and_entertainment: 260,
  natural: 330,
  public_places: 360,
  shops: 420,
  sustenance: 560,
  tourism: 620,
};

const ORS_SUBCATEGORY_IDS = {
  archaeological_site: 223,
  castle: 224,
  citywalls: 227,
  battlefield: 228,
  fort: 232,
  manor: 236,
  memorial: 237,
  monument: 240,
  ruins: 243,

  cave_entrance: 331,
  beach: 332,
  peak: 335,
  spring: 338,
  water: 340,

  garden: 272,
  nature_reserve: 279,
  park: 280,

  attraction: 622,
  viewpoint: 627,
};

export const ALLOWED_ORS_SUBCATEGORIES = Object.keys(ORS_SUBCATEGORY_IDS);

const ORS_CATEGORY_NAME_MAP = {
  restaurant: "restaurant",
  food_court: "restaurant",
  fast_food: "fast_food",
  cafe: "cafe",
  coffee_shop: "cafe",
  bar: "bar",
  pub: "bar",
  biergarten: "bar",
  bakery: "bakery",
  museum: "museum",
  gallery: "art_gallery",
  art_gallery: "art_gallery",
  arts_centre: "art_gallery",
  cinema: "cinema",
  theatre: "theatre",
  place_of_worship: "church",
  church: "church",
  cathedral: "church",
  chapel: "church",
  monastery: "church",
  abbey: "church",
  castle: "historical_landmark",
  ruins: "historical_landmark",
  ruin: "historical_landmark",
  archaeological_site: "historical_landmark",
  manor: "historical_landmark",
  fort: "historical_landmark",
  city_walls: "historical_landmark",
  heritage: "historical_landmark",
  battlefield: "historical_landmark",
  wayside_shrine: "historical_landmark",
  wayside_cross: "historical_landmark",
  monument: "monument",
  memorial: "monument",
  obelisk: "monument",
  statue: "monument",
  column: "monument",
  viewpoint: "viewpoint",
  park: "park",
  garden: "park",
  recreation_ground: "park",
  nature_reserve: "national_park",
  national_park: "national_park",
  zoo: "zoo",
  wildlife_park: "zoo",
  aquarium: "aquarium",
  amusement_park: "amusement_park",
  theme_park: "amusement_park",
  stadium: "stadium",
  sports_centre: "sports",
  sports_center: "sports",
  swimming_pool: "sports",
  pitch: "sports",
  beach: "beach",
  waterfall: "waterfall",
  peak: "peak",
  cliff: "peak",
  cave_entrance: "cave",
  cave: "cave",
  information: "information",
  attraction: "tourist_attraction",
  artwork: "tourist_attraction",
};

const ORS_SOURCE_NAME_MAP = {
  historic: "historical_landmark",
  natural: "nature",
  leisure: "leisure",
  shop: "shopping_mall",
};

function wikiToUrl(wikipediaTag) {
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

async function orsPoiSearch({
  lat,
  lng,
  radiusM,
  filters: filterShape,
  limit,
}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { features: [] };
  const filterField = filterShape?.category_ids?.length
    ? { category_ids: filterShape.category_ids }
    : filterShape?.category_group_ids?.length
      ? { category_group_ids: filterShape.category_group_ids }
      : null;
  if (!filterField) return { features: [] };

  const body = {
    request: "pois",
    geometry: {
      geojson: { type: "Point", coordinates: [lng, lat] },
      buffer: Math.max(1, Math.min(Math.round(radiusM), 2000)),
    },
    filters: filterField,
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

function orsFeatureToPoi(feature) {
  const coords = feature.geometry?.coordinates;
  if (!coords) {
    return null;
  }
  const [lng, lat] = coords;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    return null;
  }

  const props = feature.properties ?? {};
  const name = props.osm_tags?.name;
  if (!name) {
    return null;
  }

  const primary_type = derivePrimaryType(props.category_ids);
  const tags = props.osm_tags ?? {};
  const addrParts = [
    tags["addr:street"],
    tags["addr:city"] || tags["addr:town"],
  ].filter(Boolean);
  const wikipedia_uri = wikiToUrl(tags.wikipedia);
  const wikidata =
    typeof tags.wikidata === "string" ? tags.wikidata.trim() : null;

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

function sampleStraightLine(start, end, stepM) {
  const totalM = haversineM(start, end);
  if (totalM < stepM) return [start, end];
  const n = Math.ceil(totalM / stepM);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([
      start[0] + (end[0] - start[0]) * t,
      start[1] + (end[1] - start[1]) * t,
    ]);
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

export async function searchAreaByCategories(
  start,
  end,
  targetDistanceM,
  filters,
  hasEnd = true,
  loopSkeletonCoords = null,
  corridorCoords = null,
) {
  const groupIds = filters?.groupIds ?? [];
  const categoryIds = filters?.categoryIds ?? [];
  if (!groupIds.length && !categoryIds.length) return [];

  const filterShapes = [];
  if (categoryIds.length) filterShapes.push({ category_ids: categoryIds });
  if (groupIds.length) filterShapes.push({ category_group_ids: groupIds });

  const radiusM = 2_000;
  const stepM = radiusM * 1.5;
  let samplePoints;
  let samplingMode;
  if (Array.isArray(corridorCoords) && corridorCoords.length >= 2) {
    samplePoints = sampleRoute(corridorCoords, stepM);
    samplingMode = "a_to_b_corridor";
  } else if (hasEnd && end) {
    samplePoints = sampleStraightLine(start, end, stepM);
    samplingMode = "a_to_b_line";
  } else if (
    Array.isArray(loopSkeletonCoords) &&
    loopSkeletonCoords.length >= 2
  ) {
    samplePoints = sampleRoute(loopSkeletonCoords, stepM);
    samplingMode = "loop_corridor";
  } else {
    samplePoints = sampleLoopArea(start, targetDistanceM / (2 * Math.PI));
    samplingMode = "loop_radial";
  }

  const requests = [];
  for (const [lng, lat] of samplePoints) {
    for (const shape of filterShapes) {
      requests.push(
        orsPoiSearch({ lat, lng, radiusM, filters: shape, limit: 40 }).catch(
          () => ({ features: [] }),
        ),
      );
    }
  }
  const batches = await Promise.all(requests);

  const seen = new Set();
  const pois = [];
  for (const batch of batches) {
    for (const poi of (batch.features ?? [])
      .map((f) => orsFeatureToPoi(f))
      .filter(Boolean)) {
      if (!seen.has(poi.place_id)) {
        seen.add(poi.place_id);
        pois.push(poi);
      }
    }
  }

  console.log(
    `[places] Area search [${samplingMode}] (${samplePoints.length} points × ${filterShapes.length} filter set(s), r=2km): ${pois.length} POIs ` +
      `[groupIds=${groupIds.join(",") || "-"} categoryIds=${categoryIds.join(",") || "-"}]`,
  );
  return pois;
}

export function collectORSFilters(intents) {
  const groupIds = new Set();
  const categoryIds = new Set();
  for (const intent of intents ?? []) {
    const resolvedSubs = (
      Array.isArray(intent?.subcategories) ? intent.subcategories : []
    )
      .map((s) => ORS_SUBCATEGORY_IDS[s])
      .filter((id) => Number.isFinite(id));

    if (resolvedSubs.length) {
      resolvedSubs.forEach((id) => categoryIds.add(id));
    } else {
      const gid = ORS_GROUP_IDS[intent?.places_type] ?? ORS_GROUP_IDS.tourism;
      groupIds.add(gid);
    }
  }
  return { groupIds: [...groupIds], categoryIds: [...categoryIds] };
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
      addr.city ||
      addr.town ||
      addr.village ||
      addr.municipality ||
      addr.county ||
      addr.state ||
      data?.display_name?.split(",")[0]?.trim() ||
      null
    );
  } catch (err) {
    console.warn(`[places] Nominatim reverse geocode failed: ${err.message}`);
    return null;
  }
}
