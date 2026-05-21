import { haversineM } from "./geo.js";
import { fetchRoutePois, filterUnreachablePois } from "./ors.js";
import { genai, GEMINI_MODEL, extractJsonArray } from "./ai/shared.js";

const ORS_CATEGORY_MAP = {
  nature: { groupIds: [330], categoryIds: [] },
  tourism: { groupIds: [620], categoryIds: [] },
  historic: { groupIds: [220], categoryIds: [] },
  food: { groupIds: [560], categoryIds: [] },
  arts_culture: { groupIds: [130], categoryIds: [] },
  leisure: {
    groupIds: [260],
    categoryIds: [],
    catFilter: {
      rangeMin: 261,
      rangeMax: 310,
      allowed: new Set([
        262, 263, 264, 265, 266, 267, 268, 269, 270, 271, 272, 273, 274, 275,
        276, 277, 278, 279, 280, 281, 282, 283, 284, 285, 286, 287, 288, 289,
        290, 291, 292, 293, 294, 295, 296, 297, 299, 300, 301, 304, 305, 306,
        308, 309, 310,
      ]),
    },
  },
};

function buildPoiParams(poiTypes) {
  const groupSet = new Set();
  const catSet = new Set();
  const catFilters = [];
  for (const t of poiTypes) {
    const map = ORS_CATEGORY_MAP[t.toLowerCase()];
    if (!map) continue;
    map.groupIds.forEach((id) => groupSet.add(id));
    map.categoryIds.forEach((id) => catSet.add(id));
    if (map.catFilter) catFilters.push(map.catFilter);
  }
  return { groupIds: [...groupSet], categoryIds: [...catSet], catFilters };
}

function applyCatFilters(features, catFilters) {
  if (!catFilters.length) return features;
  return features.filter((f) => {
    const ids = Object.keys(f.properties?.category_ids ?? {}).map(Number);
    return catFilters.every(({ rangeMin, rangeMax, allowed }) => {
      const inRange = ids.filter((id) => id >= rangeMin && id <= rangeMax);
      return inRange.length === 0 || inRange.some((id) => allowed.has(id));
    });
  });
}

function normOrsPoiFeature(feature, idx) {
  const coords = feature.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;

  const [lng, lat] = coords;

  const props = feature.properties || {};
  const category =
    Object.values(props.category_ids || {})[0]?.category_name || null;

  const name = props.osm_tags?.name || props.name;
  return {
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [lng, lat],
    },
    properties: {
      id: props.osm_id ?? `ors-${idx}`,
      name,
      category,
    },
  };
}

export async function filterPoiFeaturesByReachability(
  features,
  routeCoords,
  orsProfile,
) {
  if (!features.length || routeCoords.length < 2) return features;

  const srcCount = Math.min(10, routeCoords.length);
  const step = (routeCoords.length - 1) / (srcCount - 1);
  const anchors = Array.from(
    { length: srcCount },
    (_, i) => routeCoords[Math.round(i * step)],
  );

  const internal = features.map((f) => ({
    lng: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
    name: f.properties.name ?? "unnamed",
    place_id: String(f.properties.id ?? f.geometry.coordinates),
  }));

  const kept = await filterUnreachablePois(orsProfile, anchors, internal);
  const keptIds = new Set(kept.map((p) => p.place_id));
  return features.filter((f) =>
    keptIds.has(String(f.properties.id ?? f.geometry.coordinates)),
  );
}

function poiRouteProgress(poiCoords, routeCoords) {
  let minDist = Infinity;
  let closestIdx = 0;
  for (let i = 0; i < routeCoords.length; i++) {
    const d = haversineM(poiCoords, routeCoords[i]);
    if (d < minDist) {
      minDist = d;
      closestIdx = i;
    }
  }
  return Math.round((closestIdx / Math.max(routeCoords.length - 1, 1)) * 100);
}

export async function geminiSelectPois(pois, count, routeCoords) {
  if (!count || pois.length <= count) return pois;
  if (!genai) return rankAndLimitPoisFallback(pois, count, routeCoords);

  const poiList = pois
    .map((f, i) => {
      const p = f.properties;
      const pct = poiRouteProgress(f.geometry.coordinates, routeCoords);
      return `[${i}] ${p.name ?? "unnamed"} (${p.category ?? "unknown"}) - route position: ${pct}%`;
    })
    .join("\n");

  const prompt = [
    `You are a travel guide. A user is planning a route and wants to visit exactly ${count} POI(s).`,
    `Each POI has a "route position" (0% = start, 100% = end) showing where along the route it sits.`,
    `Select the ${count} most interesting and worth-visiting places, ensuring they are spread out along the full length of the route.`,
    `Avoid picking POIs that are all clustered near the same route position - aim for variety across the whole route.`,
    ``,
    `POIs near the route:`,
    poiList,
    ``,
    `Return a JSON array of exactly ${count} index number(s) from the list above. Example: [0, 4, 7]`,
    `Return ONLY the JSON array, nothing else.`,
  ].join("\n");

  try {
    const r = await genai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: { responseMimeType: "application/json", temperature: 0.3 },
    });

    let parsed;
    try {
      parsed = JSON.parse(r.text ?? "");
    } catch {
      parsed = extractJsonArray(r.text ?? "");
    }

    if (!Array.isArray(parsed) || !parsed.length)
      throw new Error("empty response");

    const selected = parsed
      .filter((i) => typeof i === "number" && i >= 0 && i < pois.length)
      .slice(0, count)
      .map((i) => pois[i]);

    if (selected.length === 0) throw new Error("no valid indices");

    console.log(
      `[poi-select] Gemini picked ${selected.length}/${pois.length}: ` +
        selected.map((f) => f.properties.name).join(", "),
    );
    return selected;
  } catch (err) {
    console.warn(
      `[poi-select] Gemini failed (${err.message}), falling back to score rank`,
    );
    return rankAndLimitPoisFallback(pois, count, routeCoords);
  }
}

function rankAndLimitPoisFallback(pois, count, routeCoords) {
  if (!count || pois.length <= count) return pois;
  const anchors = thinForInsertion(routeCoords, 50);
  return pois
    .map((f) => {
      const coords = f.geometry.coordinates;
      const addedM = cheapestInsertionAddedM(coords, anchors);
      const quality = poiQualityScore(f);
      return { feature: f, score: quality - addedM / 200 };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map((r) => r.feature);
}

export async function fetchPoiFeatures(routeCoords, poiTypes) {
  if (!poiTypes.length) return [];
  const { groupIds, categoryIds, catFilters } = buildPoiParams(poiTypes);
  console.log(
    `[poi-fetch] types=${poiTypes} -> groupIds=${groupIds} categoryIds=${categoryIds}`,
  );
  if (!groupIds.length && !categoryIds.length) return [];
  const raw = await fetchRoutePois(routeCoords, { groupIds, categoryIds });
  const filtered = applyCatFilters(raw, catFilters);
  const normed = filtered
    .map((f, i) => normOrsPoiFeature(f, i))
    .filter(Boolean);
  console.log(
    `[poi-fetch] ${raw.length} raw -> ${filtered.length} after cat filter -> ${normed.length} named`,
  );
  return normed;
}

function thinForInsertion(coords, samples = 50) {
  if (coords.length <= samples) return coords;
  const step = (coords.length - 1) / (samples - 1);
  return Array.from(
    { length: samples },
    (_, i) => coords[Math.round(i * step)],
  );
}

function cheapestInsertionAddedM(poi, anchors) {
  let best = Infinity;
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i];
    const b = anchors[i + 1];
    const detour = haversineM(a, poi) + haversineM(poi, b) - haversineM(a, b);
    if (detour < best) best = detour;
  }
  return Math.max(0, best);
}

function poiQualityScore(poi) {
  const rating = poi.properties.rating ?? 0;
  const reviews = poi.properties.user_rating_count ?? 0;
  const cat = (poi.properties.category ?? "").toLowerCase();
  let bonus = 0;
  if (cat.includes("museum") || cat.includes("historic")) bonus += 8;
  if (cat.includes("park") || cat.includes("nature")) bonus += 6;
  if (cat.includes("viewpoint") || cat.includes("attraction")) bonus += 5;
  if (cat.includes("cafe") || cat.includes("restaurant")) bonus += 3;
  return rating * 5 + Math.min(reviews / 100, 5) + bonus;
}
