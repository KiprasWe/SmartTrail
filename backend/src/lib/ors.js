import { fetchWithRetry, fetchWithTimeout } from "../utils/http.js";
import { thinCoords, haversineM } from "./geo.js";

const ORS_API_KEY = process.env.ORS_API_KEY;
const ORS_VERBOSE = process.env.ORS_VERBOSE === "1";
const orsLog = (...args) => {
  if (ORS_VERBOSE) console.log(...args);
};

export const ORS_POIS_URL = "https://api.heigit.org/openpoiservice/v0/pois";
export const ORS_DIRECTIONS_URL =
  "https://api.heigit.org/openrouteservice/v2/directions";
export const ORS_MATRIX_URL = "https://api.openrouteservice.org/v2/matrix";

const TIMEOUT_ROUTING_MS = 20_000;

export async function fetchORSDirections(orsProfile, coordinates, opts = {}) {
  if (!ORS_API_KEY) throw new Error("ORS_API_KEY is not set");

  const mergedOptions = {
    ...(opts.options ?? {}),
    ...(opts.profileParams && { profile_params: opts.profileParams }),
  };

  const body = {
    coordinates,
    elevation: true,
    instructions: true,
    ...(opts.preference && { preference: opts.preference }),
    ...(opts.alternativeRoutes && {
      alternative_routes: opts.alternativeRoutes,
    }),
    ...(opts.radiuses && { radiuses: opts.radiuses }),
    ...(Object.keys(mergedOptions).length > 0 && { options: mergedOptions }),
  };

  const url = `${ORS_DIRECTIONS_URL}/${orsProfile}/geojson`;
  const res = await fetchWithRetry(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/geo+json",
        Authorization: ORS_API_KEY,
      },
      body: JSON.stringify(body),
    },
    { timeoutMs: TIMEOUT_ROUTING_MS, retries: 1 },
  );

  if (!res.ok) {
    const text = await res.text();
    const bodyExcerpt = text.length > 500 ? text.slice(0, 500) + "…" : text;
    console.error(
      `[ORS directions] FAIL status=${res.status} url=${url} ` +
        `coords=${coordinates.length} ` +
        `bodyKeys=${Object.keys(body).join(",")} ` +
        `response=${bodyExcerpt}`,
    );
    throw new Error(`ORS ${res.status} on ${orsProfile}: ${bodyExcerpt}`);
  }
  return res.json();
}

export function orsFeatureToRouteData(feature) {
  const rawCoords = feature.geometry.coordinates;
  const coords = rawCoords.map((c) => [c[0], c[1]]);
  const elevArr = rawCoords.map((c) => c[2] ?? 0);

  const props = feature.properties ?? {};
  const segments = props.segments ?? [];
  const maneuvers = segments
    .flatMap((seg) => seg.steps ?? [])
    .map((s) => ({
      instruction: s.instruction ?? "",
      type: s.type ?? 0,
      distance_km: +((s.distance ?? 0) / 1000).toFixed(3),
      duration_s: Math.round(s.duration ?? 0),
    }));

  const distance_m =
    props.summary?.distance ??
    segments.reduce((s, x) => s + (x.distance ?? 0), 0);
  const duration_s =
    props.summary?.duration ??
    segments.reduce((s, x) => s + (x.duration ?? 0), 0);
  const ascent_m = Math.round(
    props.ascent ?? segments.reduce((s, x) => s + (x.ascent ?? 0), 0),
  );
  const descent_m = Math.round(
    props.descent ?? segments.reduce((s, x) => s + (x.descent ?? 0), 0),
  );

  return {
    coords,
    elevArr,
    maneuvers,
    distance_km: +(distance_m / 1000).toFixed(2),
    duration_s: Math.round(duration_s),
    ascent_m,
    descent_m,
  };
}

export function buildORSElevationOpts(elevPref, orsProfile = "") {
  const isCycling = orsProfile.startsWith("cycling");

  if (elevPref === "flat") {
    if (isCycling)
      // steepness_difficulty 0 = Novice — ORS routes away from steep roads
      return { profileParams: { weightings: { steepness_difficulty: 0 } } };
    // Foot/running: avoid steps (literal stair segments = elevation changes)
    return { options: { avoid_features: ["steps"] } };
  }

  if (elevPref === "moderate") {
    if (isCycling)
      // steepness_difficulty 1 = Moderate — balanced gradient preference
      return { profileParams: { weightings: { steepness_difficulty: 1 } } };
    return {};
  }

  if (elevPref === "hilly") {
    if (isCycling)
      // steepness_difficulty 3 = Pro — ORS prefers steeper gradients
      return { profileParams: { weightings: { steepness_difficulty: 3 } } };
    return {};
  }

  return {};
}

const ORS_POI_CHUNK_SIZE = 40;

export async function fetchRoutePois(
  routeCoords,
  { groupIds = [], categoryIds = [] } = {},
  bufferM = 300,
) {
  if (!ORS_API_KEY || !routeCoords?.length || (!groupIds.length && !categoryIds.length))
    return [];
  const thinned = thinCoords(routeCoords, 150);

  const chunks = [];
  for (let i = 0; i < thinned.length; i += ORS_POI_CHUNK_SIZE - 1) {
    chunks.push(thinned.slice(i, i + ORS_POI_CHUNK_SIZE));
  }

  const filters = {};
  if (groupIds.length) filters.category_group_ids = groupIds;
  if (categoryIds.length) filters.category_ids = categoryIds;

  const seenIds = new Set();
  const all = [];

  await Promise.all(
    chunks.map(async (chunk) => {
      if (chunk.length < 2) return;
      try {
        const res = await fetchWithTimeout(
          ORS_POIS_URL,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: ORS_API_KEY,
            },
            body: JSON.stringify({
              request: "pois",
              geometry: {
                geojson: { type: "LineString", coordinates: chunk },
                buffer: bufferM,
              },
              filters,
              limit: 200,
            }),
          },
          TIMEOUT_ROUTING_MS,
        );
        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          console.warn(`[ORS POIs] HTTP ${res.status} — groups=${groupIds} cats=${categoryIds} body=${errText.slice(0, 500)}`);
          return;
        }
        const text = await res.text();
        const data = JSON.parse(text.replace(/\bNaN\b/g, "null"));
        const features = data.features ?? [];
        const named = features.filter((f) => f.properties?.osm_tags?.name || f.properties?.name);
        orsLog(
          `[ORS POIs] chunk ${features.length} raw / ${named.length} named — groups=${groupIds} cats=${categoryIds}`,
        );
        for (const f of features) {
          const id =
            f.properties?.osm_id ?? JSON.stringify(f.geometry?.coordinates);
          if (!seenIds.has(id)) {
            seenIds.add(id);
            all.push(f);
          }
        }
      } catch (err) {
        console.warn("[ORS POIs] chunk error:", err.message);
      }
    }),
  );

  return all;
}

// Drops POIs that are disproportionately far by actual routed distance vs
// straight-line distance — catches barriers like rivers, walls, motorways.
// anchorCoords: evenly-sampled skeleton points used as matrix sources.
// ratioThreshold: max allowed routedDist/haversineDist (default 2.5).
// Fail-open: any matrix error returns the original pois list unchanged.
const ORS_MATRIX_BATCH = 50;

export async function filterUnreachablePois(
  orsProfile,
  anchorCoords,
  pois,
  ratioThreshold = 2.5,
) {
  if (!ORS_API_KEY || !pois.length || !anchorCoords.length) return pois;

  const result = [];
  for (let i = 0; i < pois.length; i += ORS_MATRIX_BATCH) {
    const batch = pois.slice(i, i + ORS_MATRIX_BATCH);
    const kept = await _matrixFilterBatch(
      orsProfile,
      anchorCoords,
      batch,
      ratioThreshold,
    );
    result.push(...kept);
  }
  return result;
}

async function _matrixFilterBatch(orsProfile, anchors, pois, ratioThreshold) {
  const locations = [
    ...anchors.map(([lng, lat]) => [lng, lat]),
    ...pois.map((p) => [p.lng, p.lat]),
  ];
  const sourceIndices = anchors.map((_, i) => i);
  const destIndices = pois.map((_, i) => i + anchors.length);

  let distMatrix;
  try {
    const res = await fetchWithTimeout(
      `${ORS_MATRIX_URL}/${orsProfile}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: ORS_API_KEY,
        },
        body: JSON.stringify({
          locations,
          sources: sourceIndices,
          destinations: destIndices,
          metrics: ["distance"],
          units: "m",
        }),
      },
      15_000,
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(
        `[ors] Matrix HTTP ${res.status}: ${text.slice(0, 200)} — keeping all POIs`,
      );
      return pois;
    }
    distMatrix = (await res.json()).distances;
  } catch (err) {
    console.warn(`[ors] Matrix filter failed: ${err.message} — keeping all POIs`);
    return pois;
  }

  if (!Array.isArray(distMatrix)) return pois;

  const kept = [];
  let dropped = 0;

  for (let j = 0; j < pois.length; j++) {
    const poi = pois[j];
    let minRatio = Infinity;

    for (let s = 0; s < anchors.length; s++) {
      const routedM = distMatrix[s]?.[j];
      if (routedM == null || routedM <= 0) continue;
      const hvM = haversineM(anchors[s], [poi.lng, poi.lat]);
      if (hvM < 50) { minRatio = 1; break; } // essentially on the route
      minRatio = Math.min(minRatio, routedM / hvM);
    }

    if (minRatio <= ratioThreshold) {
      kept.push(poi);
    } else {
      dropped++;
      orsLog(
        `[ors] Matrix: dropped "${poi.name}" (ratio ${minRatio === Infinity ? "∞" : minRatio.toFixed(1)}x)`,
      );
    }
  }

  if (dropped > 0) {
    orsLog(
      `[ors] Matrix filter: kept ${kept.length}/${pois.length} (dropped ${dropped} barrier-blocked)`,
    );
  }

  return kept;
}
