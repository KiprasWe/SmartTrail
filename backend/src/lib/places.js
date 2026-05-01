const ORS_API_KEY = process.env.ORS_API_KEY;

// Maps our internal places_type → the OSM tags to query in Overpass.
// Used by searchCorridorByType to build type-filtered corridor queries.
const TYPE_TO_OSM_TAGS = {
  tourist_attraction: [["tourism", ["attraction", "viewpoint", "artwork", "gallery"]]],
  historical_landmark: [
    ["historic", ["castle", "ruins", "archaeological_site", "building", "manor", "fort", "city_gate", "battlefield", "monument", "memorial"]],
  ],
  museum: [["tourism", ["museum"]], ["amenity", ["museum"]]],
  church: [["historic", ["church"]], ["amenity", ["place_of_worship"]]],
  monument: [["historic", ["monument", "memorial", "wayside_shrine", "wayside_cross"]]],
  park: [["leisure", ["park", "nature_reserve", "garden"]], ["tourism", ["picnic_site"]]],
  national_park: [["leisure", ["nature_reserve"]]],
  restaurant: [["amenity", ["restaurant"]]],
  cafe: [["amenity", ["cafe"]]],
  bar: [["amenity", ["bar", "pub"]]],
};
const NOMINATIM_EMAIL = process.env.NOMINATIM_EMAIL ?? "student@university.lt";
const APP_URL = process.env.APP_URL ?? "http://localhost:3000";

const ORS_POI_BASE = "https://api.openrouteservice.org/pois";
const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

const ORS_MAX_RESULTS = 100;

const OSM_TOURISM_TO_TYPE = {
  attraction: "tourist_attraction",
  museum: "museum",
  artwork: "tourist_attraction",
  viewpoint: "tourist_attraction",
  gallery: "art_gallery",
  picnic_site: "park",
  camp_site: "park",
  theme_park: "amusement_park",
  zoo: "zoo",
  aquarium: "aquarium",
};

const OSM_SHOP_TO_TYPE = {
  mall: "shopping_mall",
  department_store: "shopping_mall",
};

const OSM_HISTORIC_TO_TYPE = {
  castle: "historical_landmark",
  ruins: "historical_landmark",
  monument: "monument",
  memorial: "monument",
  archaeological_site: "historical_landmark",
  building: "historical_landmark",
  manor: "historical_landmark",
  church: "church",
  fort: "historical_landmark",
  city_gate: "historical_landmark",
  battlefield: "historical_landmark",
  wayside_shrine: "monument",
  wayside_cross: "monument",
  milestone: "monument",
  boundary_stone: "monument",
};

const OSM_LEISURE_TO_TYPE = {
  park: "park",
  nature_reserve: "national_park",
  garden: "park",
  nature_trail: "park",
};

const OSM_AMENITY_TO_TYPE = {
  restaurant: "restaurant",
  cafe: "cafe",
  bar: "bar",
  pub: "bar",
  fast_food: "meal_takeaway",
  place_of_worship: "church",
  museum: "museum",
};

const OSM_NATURAL_TO_TYPE = {
  peak: "tourist_attraction",
  waterfall: "tourist_attraction",
  spring: "tourist_attraction",
  cave_entrance: "tourist_attraction",
  dune: "tourist_attraction",
  sand: "tourist_attraction",
  beach: "tourist_attraction",
  cliff: "tourist_attraction",
  wood: "park",
};

function osmTagsToPrimaryType(tags) {
  if (tags.tourism)
    return OSM_TOURISM_TO_TYPE[tags.tourism] ?? "tourist_attraction";
  if (tags.shop) return OSM_SHOP_TO_TYPE[tags.shop] ?? null;
  if (tags.historic)
    return OSM_HISTORIC_TO_TYPE[tags.historic] ?? "historical_landmark";
  if (tags.leisure) return OSM_LEISURE_TO_TYPE[tags.leisure] ?? "park";
  if (tags.amenity)
    return OSM_AMENITY_TO_TYPE[tags.amenity] ?? "tourist_attraction";
  if (tags.natural)
    return OSM_NATURAL_TO_TYPE[tags.natural] ?? "tourist_attraction";
  return "tourist_attraction";
}

const TYPE_TO_ORS_CATEGORIES = {
  tourist_attraction: [622, 621, 627, 623],
  // 224=manor/palace 223=castle/ruins 232=historic building 243=archaeological
  // 226=city wall 227=fortification 228=tower 236=mill 239=other historic
  historical_landmark: [224, 223, 232, 243, 226, 227, 228, 236, 239, 131],
  museum: [134],
  art_gallery: [132, 131],
  church: [135],
  monument: [240, 237, 247, 248],
  park: [280, 272, 279, 625],
  national_park: [279, 280],
  restaurant: [570],
  cafe: [564, 435],
  bakery: [426],
  bar: [561, 569, 563],
  meal_takeaway: [566, 567],
  zoo: [310],
  aquarium: [308],
  amusement_park: [309],
  shopping_mall: [492],
  stadium: [289],
};

const ORS_ID_TO_TYPE = {
  622: "tourist_attraction",
  621: "tourist_attraction",
  627: "tourist_attraction",
  623: "tourist_attraction",
  224: "historical_landmark",
  223: "historical_landmark",
  232: "historical_landmark",
  243: "historical_landmark",
  226: "historical_landmark",
  227: "historical_landmark",
  228: "historical_landmark",
  236: "historical_landmark",
  239: "historical_landmark",
  240: "monument",
  237: "monument",
  247: "monument",
  248: "monument",
  134: "museum",
  132: "art_gallery",
  131: "art_gallery",
  135: "church",
  280: "park",
  272: "park",
  279: "national_park",
  625: "park",
  570: "restaurant",
  564: "cafe",
  435: "cafe",
  426: "bakery",
  561: "bar",
  569: "bar",
  563: "bar",
  566: "meal_takeaway",
  567: "meal_takeaway",
  310: "zoo",
  308: "aquarium",
  309: "amusement_park",
  492: "shopping_mall",
  289: "stadium",
};

function buildOverpassQuery(bbox) {
  const [minLat, minLng, maxLat, maxLng] = bbox;
  const b = `(${minLat},${minLng},${maxLat},${maxLng})`;

  const tourismTags = [
    "attraction",
    "museum",
    "artwork",
    "viewpoint",
    "gallery",
    "picnic_site",
    "theme_park",
    "zoo",
    "aquarium",
  ]
    .map((v) => `nwr["tourism"="${v}"]${b};`)
    .join("\n  ");

  const historicTags = [
    "castle",
    "ruins",
    "monument",
    "memorial",
    "archaeological_site",
    "building",
    "manor",
    "church",
    "fort",
    "city_gate",
    "battlefield",
    "wayside_shrine",
    "wayside_cross",
  ]
    .map((v) => `nwr["historic"="${v}"]${b};`)
    .join("\n  ");

  const leisureTags = ["park", "nature_reserve", "garden"]
    .map((v) => `nwr["leisure"="${v}"]${b};`)
    .join("\n  ");

  const amenityTags = ["restaurant", "cafe", "bar", "pub", "place_of_worship"]
    .map((v) => `nwr["amenity"="${v}"]${b};`)
    .join("\n  ");

  const naturalTags = [
    "peak",
    "waterfall",
    "spring",
    "cave_entrance",
    "dune",
    "sand",
    "beach",
    "cliff",
    "wood",
  ]
    .map((v) => `nwr["natural"="${v}"]${b};`)
    .join("\n  ");

  const shopTags = ["mall", "supermarket", "department_store"]
    .map((v) => `nwr["shop"="${v}"]${b};`)
    .join("\n  ");

  return `
[out:json][timeout:25];
(
  ${tourismTags}
  ${historicTags}
  ${leisureTags}
  ${amenityTags}
  ${naturalTags}
);
out center tags;
`.trim();
}

function overpassElementToPoi(el) {
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const tags = el.tags ?? {};
  const name = tags.name || tags["name:lt"] || tags["name:en"];
  if (!name) return null;

  const primary_type = osmTagsToPrimaryType(tags);

  const addrParts = [
    tags["addr:street"],
    tags["addr:city"] || tags["addr:town"] || tags["addr:village"],
    tags["addr:country"],
  ].filter(Boolean);

  return {
    place_id: `osm:${el.type}${el.id}`,
    name,
    lat,
    lng,
    primary_type,
    types: [primary_type],
    formatted_address: addrParts.join(", ") || null,
    description: tags.description || tags["description:lt"] || null,
    editorial_summary: null,
    rating: null,
    user_rating_count: null,
    website_uri: tags.website || tags.url || null,
    google_maps_uri: null,
    photo_name: null,
    _osm_tags: tags,
  };
}

async function overpassQuery(queryString) {
  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": `RouteApp/1.0 (${APP_URL}; ${NOMINATIM_EMAIL})`,
    },
    body: `data=${encodeURIComponent(queryString)}`,
    signal: AbortSignal.timeout(25_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Overpass HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.elements ?? [];
}

function coordsToBbox(coords, paddingDeg = 0.05) {
  const lats = coords.map((c) => c[1]);
  const lngs = coords.map((c) => c[0]);
  return [
    Math.min(...lats) - paddingDeg,
    Math.min(...lngs) - paddingDeg,
    Math.max(...lats) + paddingDeg,
    Math.max(...lngs) + paddingDeg,
  ];
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
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    console.warn("[places] orsPoiSearch: invalid coords", { lat, lng });
    return { type: "FeatureCollection", features: [] };
  }

  const body = {
    request: "pois",
    geometry: {
      geojson: { type: "Point", coordinates: [lng, lat] },
      buffer: Math.max(1, Math.min(Math.round(radiusM), 2000)),
    },
    filters: { category_ids: categoryIds },
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
  const safe = raw.replace(/\bNaN\b/g, "null");
  try {
    return JSON.parse(safe);
  } catch (err) {
    throw new Error(
      `ORS POI invalid JSON: ${err.message} | ${raw.slice(0, 120)}`,
    );
  }
}

function derivePrimaryType(categoryIds) {
  if (!categoryIds?.length) return "tourist_attraction";
  for (const id of categoryIds) {
    const type = ORS_ID_TO_TYPE[id];
    if (type) return type;
  }
  return "tourist_attraction";
}

function orsFeatureToPoi(feature) {
  const coords = feature.geometry?.coordinates;
  if (!coords) return null;
  const [lng, lat] = coords;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;

  const props = feature.properties ?? {};
  const name = props.osm_tags?.name;
  if (!name) return null;

  const categoryIds = Object.values(props.category_ids ?? {}).flat();
  const primary_type = derivePrimaryType(categoryIds);
  const tags = props.osm_tags ?? {};
  const addrParts = [
    tags["addr:street"],
    tags["addr:city"] || tags["addr:town"],
    tags["addr:country"],
  ].filter(Boolean);

  return {
    place_id: `ors:${props.osm_id}`,
    name,
    lat,
    lng,
    primary_type,
    types: categoryIds.map((id) => ORS_ID_TO_TYPE[id] ?? "tourist_attraction"),
    formatted_address: addrParts.join(", ") || null,
    description: null,
    editorial_summary: null,
    rating: null,
    user_rating_count: null,
    website_uri: tags.website || tags.url || null,
    google_maps_uri: null,
    photo_name: null,
    _ors_categories: props.category_ids,
  };
}

async function searchORS({ places_type, lat, lng, radiusM, count }) {
  const categoryIds =
    TYPE_TO_ORS_CATEGORIES[places_type] ??
    TYPE_TO_ORS_CATEGORIES.tourist_attraction;
  try {
    const geojson = await orsPoiSearch({
      lat,
      lng,
      radiusM,
      categoryIds,
      limit: count,
    });
    const pois = (geojson.features ?? []).map(orsFeatureToPoi).filter(Boolean);
    console.log(
      `[places] ORS search (${places_type}, r=${(radiusM / 1000).toFixed(1)}km): ${pois.length} results`,
    );
    return pois;
  } catch (err) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      console.warn(
        `[places] searchORS: skipping invalid center (lat=${lat}, lng=${lng})`,
      );
      return [];
    }
    return [];
  }
}

function skeletonHaversineM([lng1, lat1], [lng2, lat2]) {
  const R = 6_371_000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function sampleSkeleton(coords, stepM) {
  if (!coords?.length) return [];
  const result = [coords[0]];
  let accumulated = 0;
  for (let i = 1; i < coords.length; i++) {
    accumulated += skeletonHaversineM(coords[i - 1], coords[i]);
    if (accumulated >= stepM) {
      result.push(coords[i]);
      accumulated = 0;
    }
  }
  const last = coords[coords.length - 1];
  if (result[result.length - 1] !== last) result.push(last);
  return result;
}

// Overpass corridor search for a specific POI type along a route skeleton.
// Samples the skeleton every stepM metres and fires a single multi-center
// Overpass query — bypasses the ORS POI API's hard 2km buffer cap and covers
// the full corridor rather than just 2-3 zone anchor points.
//
// osmTagOverride: optional array of {key, value} objects. When provided and
// non-empty, replaces the TYPE_TO_OSM_TAGS lookup with precise OSM tags
// supplied by the AI intent decomposition.

function osmTagsToTagGroups(osmTags) {
  const map = new Map();
  for (const { key, value } of osmTags) {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(value);
  }
  return [...map.entries()];
}

export async function searchCorridorByType(
  skeletonCoords,
  places_type,
  radiusM = 3_000,
  count = 20,
  stepM = 5_000,
  osmTagOverride = null,
) {
  if (!skeletonCoords?.length) return [];

  const tagGroups =
    osmTagOverride?.length
      ? osmTagsToTagGroups(osmTagOverride)
      : (TYPE_TO_OSM_TAGS[places_type] ?? TYPE_TO_OSM_TAGS.tourist_attraction);
  const samples = sampleSkeleton(skeletonCoords, stepM);

  const lines = [];
  for (const [lng, lat] of samples) {
    for (const [key, values] of tagGroups) {
      for (const val of values) {
        lines.push(`nwr["${key}"="${val}"](around:${radiusM},${lat.toFixed(6)},${lng.toFixed(6)});`);
      }
    }
  }

  const query = `[out:json][timeout:30];\n(\n  ${lines.join("\n  ")}\n);\nout center tags;`;

  try {
    const elements = await overpassQuery(query);
    const pois = elements.map(overpassElementToPoi).filter(Boolean);

    const seen = new Set();
    const deduped = pois.filter((p) => {
      if (seen.has(p.place_id)) return false;
      seen.add(p.place_id);
      return true;
    });

    console.log(
      `[places] Corridor search (${places_type}, ${samples.length} samples, r=${(radiusM / 1000).toFixed(1)}km): ${deduped.length} results`,
    );
    return deduped.slice(0, count);
  } catch (err) {
    console.warn(`[places] Corridor search failed: ${err.message}`);
    return [];
  }
}

// Overpass area search by explicit OSM tag pairs.
// Used to discover POIs in spatially-constrained areas (e.g. "west part of the city")
// using precise OSM tags from the AI intent (e.g. military=bunker).
export async function searchAreaByOsmTags(center, radiusM, osmTagSets, limit = 40) {
  if (!center || !osmTagSets?.length) return [];

  const [lng, lat] = center;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];

  const lines = [];
  for (const { key, value } of osmTagSets) {
    const safeKey = String(key).replace(/[^a-z_:-]/gi, "").slice(0, 40);
    const safeVal = String(value).replace(/["\\]/g, "").slice(0, 40);
    if (!safeKey || !safeVal) continue;
    lines.push(`nwr["${safeKey}"="${safeVal}"](around:${Math.round(radiusM)},${lat.toFixed(6)},${lng.toFixed(6)});`);
  }

  if (!lines.length) return [];

  const query = `[out:json][timeout:25];\n(\n  ${lines.join("\n  ")}\n);\nout center tags;`;

  try {
    const elements = await overpassQuery(query);
    const pois = elements.map(overpassElementToPoi).filter(Boolean);

    const seen = new Set();
    const deduped = pois.filter((p) => {
      if (seen.has(p.place_id)) return false;
      seen.add(p.place_id);
      return true;
    });

    console.log(
      `[places] searchAreaByOsmTags (r=${(radiusM / 1000).toFixed(1)}km, ${osmTagSets.length} tag pairs): ${deduped.length} results`,
    );

    return deduped.slice(0, limit);
  } catch (err) {
    console.warn(`[places] searchAreaByOsmTags failed: ${err.message}`);
    return [];
  }
}

export async function discoverAllPois({ start, end, hasEnd, zones }) {
  let bboxCoords;
  if (zones?.length) {
    bboxCoords = zones.map((z) => z.anchor);
    if (start) bboxCoords.push(start);
    if (hasEnd && end) bboxCoords.push(end);
  } else if (hasEnd && end) {
    bboxCoords = [start, end];
  } else {
    bboxCoords = [start];
  }

  const bbox = coordsToBbox(bboxCoords, 0.05);
  console.log(
    `[places] discoverAllPois bbox: [${bbox.map((v) => v.toFixed(3)).join(", ")}] ` +
      `from ${bboxCoords.length} anchor points`,
  );

  try {
    const elements = await overpassQuery(buildOverpassQuery(bbox));
    const pois = elements.map(overpassElementToPoi).filter(Boolean);

    const seen = new Set();
    const deduped = pois.filter((p) => {
      if (seen.has(p.place_id)) return false;
      seen.add(p.place_id);
      return true;
    });

    const byType = {};
    for (const p of deduped) {
      byType[p.primary_type] = (byType[p.primary_type] ?? 0) + 1;
    }
    const typeBreakdown = Object.entries(byType)
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => `${t}×${n}`)
      .join(", ");

    console.log(
      `[places] Discovery: ${elements.length} elements → ${deduped.length} named POIs | ${typeBreakdown}`,
    );

    return deduped;
  } catch (err) {
    console.warn(`[places] discoverAllPois failed: ${err.message}`);
    return [];
  }
}

export async function resolveNamedPois(namedPlaces, discoveredPois, searchCtx) {
  if (!namedPlaces.length) return [];

  const results = await Promise.all(
    namedPlaces.map((name) =>
      resolveOneName(name, discoveredPois, searchCtx).catch(() => null),
    ),
  );

  const found = results.filter(Boolean).map((poi) => ({
    ...poi,
    essential: true,
    _userNamed: true,
    guide_note: null,
  }));

  console.log(
    `[namedPOI] Resolved ${found.length}/${namedPlaces.length}: ` +
      found.map((p) => p.name).join(", "),
  );

  return found;
}

async function resolveOneName(name, discoveredPois, searchCtx) {
  const fuzzyMatch = fuzzyMatchPoi(name, discoveredPois);
  if (fuzzyMatch) {
    console.log(`[namedPOI] Pool hit: "${name}" → "${fuzzyMatch.name}"`);
    return fuzzyMatch;
  }

  console.log(`[namedPOI] "${name}" not in pool — trying Overpass exact match`);
  const overpassResult = await fetchNamedPoiOverpass(name, searchCtx);
  if (overpassResult) return overpassResult;

  console.log(`[namedPOI] Could not resolve "${name}" — skipping`);
  return null;
}

function normalize(str) {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fuzzyMatchPoi(query, pois) {
  const normQuery = normalize(query);
  const queryWords = normQuery.split(" ").filter((w) => w.length > 2);

  let bestMatch = null;
  let bestScore = 0;

  for (const poi of pois) {
    const normName = normalize(poi.name);
    let score = 0;

    if (normName === normQuery) return poi;

    if (
      queryWords.length > 0 &&
      queryWords.every((w) => normName.includes(w))
    ) {
      score = 90;
    } else if (normName.includes(normQuery)) {
      score = 80;
    } else if (normQuery.includes(normName) && normName.length > 4) {
      score = 70;
    } else {
      const nameWords = normName.split(" ").filter((w) => w.length > 2);
      const overlap = queryWords.filter((w) =>
        nameWords.some((nw) => nw.includes(w) || w.includes(nw)),
      );
      if (overlap.length > 0) {
        score =
          (overlap.length / Math.max(queryWords.length, nameWords.length)) * 60;
      }
    }

    if (score > bestScore && score >= 50) {
      bestScore = score;
      bestMatch = poi;
    }
  }

  if (bestMatch) {
    console.log(
      `[namedPOI] Fuzzy: "${query}" → "${bestMatch.name}" (score ${bestScore.toFixed(0)})`,
    );
  }

  return bestMatch;
}

export async function fetchNamedPoiOverpass(name, { start, end, hasEnd }) {
  const bboxCoords = hasEnd ? [start, end] : [start];
  const paddings = [0.15, 0.5];

  for (const padding of paddings) {
    const bbox = coordsToBbox(bboxCoords, padding);
    const [minLat, minLng, maxLat, maxLng] = bbox;
    const b = `(${minLat},${minLng},${maxLat},${maxLng})`;

    const query = `
[out:json][timeout:25];
(
  nwr["name"="${name}"]${b};
  nwr["name:lt"="${name}"]${b};
  nwr["name:en"="${name}"]${b};
);
out center tags;
`.trim();

    try {
      const elements = await overpassQuery(query);
      const pois = elements.map(overpassElementToPoi).filter(Boolean);

      if (pois.length > 0) {
        console.log(
          `[namedPOI] Overpass exact (pad=${padding}°): "${pois[0].name}" for "${name}"`,
        );
        return pois[0];
      }
    } catch (err) {
      console.warn(
        `[namedPOI] Overpass exact error (pad=${padding}°) for "${name}": ${err.message}`,
      );
    }
  }

  // Attempt 3: Partial word-prefix regex (handles inflected forms e.g. "vingio parka" → "Vingio parkas").
  // Normalise name, split into significant words, and search Overpass with a prefix regex so that
  // "parka" matches "parkas", "prospekte" matches "prospektas", etc.
  const normWords = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length >= 3);

  if (normWords.length >= 1) {
    // Use at most the first two words. Only alphanumeric chars allowed in the regex.
    const safeWords = normWords
      .slice(0, 2)
      .map((w) => w.replace(/[^a-z0-9]/g, ""))
      .filter((w) => w.length >= 3);

    if (safeWords.length >= 1) {
      const regexPattern = safeWords.join(".*");

      for (const padding of [0.2, 0.5]) {
        const bbox = coordsToBbox(bboxCoords, padding);
        const [minLat, minLng, maxLat, maxLng] = bbox;
        const b = `(${minLat},${minLng},${maxLat},${maxLng})`;

        const partialQuery = `
[out:json][timeout:25];
(
  nwr["name"~"${regexPattern}",i]${b};
  nwr["name:lt"~"${regexPattern}",i]${b};
);
out center tags;
`.trim();

        try {
          const elements = await overpassQuery(partialQuery);
          const pois = elements.map(overpassElementToPoi).filter(Boolean);

          if (pois.length > 0) {
            // Pick the most name-similar result using the existing fuzzy scorer.
            const best = pois
              .map((poi) => ({ poi, score: _simpleWordOverlap(name, poi.name) }))
              .sort((a, b) => b.score - a.score)[0];

            if (best.score >= 30) {
              console.log(
                `[namedPOI] Overpass partial regex (pad=${padding}°): "${best.poi.name}" for "${name}"`,
              );
              return best.poi;
            }
          }
        } catch (err) {
          console.warn(
            `[namedPOI] Overpass partial error (pad=${padding}°) for "${name}": ${err.message}`,
          );
        }
      }
    }
  }

  return fetchNamedPoiNominatim(name, { start, end, hasEnd });
}

function _simpleWordOverlap(query, candidate) {
  const norm = (s) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .trim();
  const qWords = norm(query).split(/\s+/).filter((w) => w.length >= 3);
  const cWords = norm(candidate).split(/\s+/).filter((w) => w.length >= 3);
  if (!qWords.length) return 0;
  const overlap = qWords.filter((qw) =>
    cWords.some((cw) => cw.startsWith(qw) || qw.startsWith(cw)),
  );
  return (overlap.length / Math.max(qWords.length, cWords.length)) * 100;
}

async function fetchNamedPoiNominatim(name, { start, end, hasEnd }) {
  try {
    const bboxCoords = hasEnd ? [start, end] : [start];
    const bbox = coordsToBbox(bboxCoords, 0.5);
    const viewbox = `${bbox[1]},${bbox[0]},${bbox[3]},${bbox[2]}`;

    const qs = new URLSearchParams({
      q: name,
      format: "jsonv2",
      addressdetails: "1",
      extratags: "1",
      namedetails: "1",
      limit: "5",
      viewbox,
      bounded: "1",
    });

    const res = await fetch(`${NOMINATIM_BASE}/search?${qs}`, {
      headers: nominatimHeaders(),
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const results = await res.json();
    if (!results.length) {
      console.log(`[namedPOI] Nominatim: no results for "${name}"`);
      return null;
    }

    const r = results[0];
    const lat = parseFloat(r.lat);
    const lng = parseFloat(r.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    const tags = { ...r.extratags, ...r.namedetails };
    const resolvedName =
      r.namedetails?.name ||
      r.namedetails?.["name:lt"] ||
      r.display_name.split(",")[0].trim();

    console.log(`[namedPOI] Nominatim found "${resolvedName}" for "${name}"`);
    return {
      place_id: `nominatim:${r.osm_type}${r.osm_id}`,
      name: resolvedName,
      lat,
      lng,
      primary_type: osmTagsToPrimaryType(tags),
      types: [osmTagsToPrimaryType(tags)],
      formatted_address: r.display_name ?? null,
      description: tags.description ?? null,
      editorial_summary: null,
      rating: null,
      user_rating_count: null,
      website_uri: tags.website ?? tags.url ?? null,
      google_maps_uri: null,
      photo_name: null,
      _osm_tags: tags,
    };
  } catch (err) {
    console.warn(
      `[namedPOI] Nominatim fallback failed for "${name}": ${err.message}`,
    );
    return null;
  }
}

export async function geocodeCity(name, lang = "en") {
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
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const results = await res.json();
    if (!results.length) {
      console.log(`[geocodeCity] No results for "${name}"`);
      return null;
    }
    // Prefer settlement types over POI results
    const settlement = results.find((r) =>
      ["city", "town", "village", "municipality", "administrative"].includes(
        r.addresstype ?? r.type,
      ),
    );
    const r = settlement ?? results[0];
    const lat = parseFloat(r.lat);
    const lng = parseFloat(r.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    console.log(
      `[geocodeCity] "${name}" → [${lng.toFixed(4)}, ${lat.toFixed(4)}]`,
    );
    return [lng, lat];
  } catch (err) {
    console.warn(`[geocodeCity] Failed for "${name}": ${err.message}`);
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
      signal: AbortSignal.timeout(8_000),
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

export async function searchPlacesForAllIntents(intents, ctx) {
  if (!intents?.length) return [];

  const { start, end, hasEnd, searchCenter, searchRadiusM = 10_000 } = ctx;

  function resolveCenter(intent) {
    switch (intent.location_scope) {
      case "at_start":
        return { center: start, radius: Math.min(searchRadiusM, 8_000) };
      case "at_end":
        return hasEnd
          ? { center: end, radius: Math.min(searchRadiusM, 8_000) }
          : { center: searchCenter ?? start, radius: searchRadiusM };
      case "in_area":
        return { center: searchCenter ?? start, radius: searchRadiusM };
      default:
        return { center: searchCenter ?? start, radius: searchRadiusM };
    }
  }

  const results = await Promise.all(
    intents.map(async (intent) => {
      const { center, radius } = resolveCenter(intent);
      if (!center) return [];
      const [lng, lat] = center;
      return searchORS({
        places_type: intent.places_type || "tourist_attraction",
        lat,
        lng,
        radiusM: radius,
        count: intent.count ?? 5,
      });
    }),
  );

  const seen = new Set();
  const deduped = [];
  for (const batch of results) {
    for (const poi of batch) {
      if (!seen.has(poi.place_id)) {
        seen.add(poi.place_id);
        deduped.push(poi);
      }
    }
  }

  return deduped;
}
