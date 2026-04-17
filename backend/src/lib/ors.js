// lib/ors.js — OpenRouteService API helpers
//
// Used for loop and AI routing. `alternative_routes` only works with exactly
// 2 coordinates, so for multi-waypoint routes (AI POIs, loop outbound) we make
// separate calls per variant, and for the loop return leg we use
// `alternative_routes` + `avoid_polygons` to get diverse return paths.

import { fetchWithRetry, fetchWithTimeout } from "../utils/http.js";
import { thinCoords, METRES_PER_DEG_LAT } from "./geo.js";

const ORS_API_KEY = process.env.ORS_API_KEY;
export const ORS_POIS_URL = "https://api.openrouteservice.org/pois";
export const ORS_DIRECTIONS_URL =
  "https://api.openrouteservice.org/v2/directions";

const TIMEOUT_ROUTING_MS = 30_000;

// ORS GeoJSON MultiPolygon corridor over a polyline. Buffer in degrees
// (~0.0006° ≈ 66 m at LT latitudes).
export function buildAvoidMultiPolygon(coords, bufferDeg = 0.0006) {
  const pts = thinCoords(coords, 50);
  const polys = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = (-dy / len) * bufferDeg;
    const ny = (dx / len) * bufferDeg;
    polys.push([
      [
        [x1 + nx, y1 + ny],
        [x2 + nx, y2 + ny],
        [x2 - nx, y2 - ny],
        [x1 - nx, y1 - ny],
        [x1 + nx, y1 + ny],
      ],
    ]);
  }
  return { type: "MultiPolygon", coordinates: polys };
}

// Generate a round-trip loop from a single start point targeting distanceM metres.
// ORS picks the shape; different seeds produce different circular routes.
export async function fetchORSRoundTrip(orsProfile, start, distanceM, seed = 0, extraOpts = {}) {
  return fetchORSDirections(orsProfile, [start], {
    ...(extraOpts.preference && { preference: extraOpts.preference }),
    ...(extraOpts.profileParams && { profileParams: extraOpts.profileParams }),
    options: {
      round_trip: {
        length: Math.round(distanceM),
        points: 5,
        seed,
      },
    },
  });
}

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
    { timeoutMs: TIMEOUT_ROUTING_MS },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ORS error (${res.status}): ${text}`);
  }
  return res.json();
}

// Convert one ORS GeoJSON feature into the normalized route data shape.
export function orsFeatureToRouteData(feature) {
  const rawCoords = feature.geometry.coordinates; // [[lon,lat,ele], ...] when elevation:true
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

/**
 * Build ORS request options for the requested elevation preference.
 *
 * steepness_difficulty (cycling profiles ONLY):
 *   0 = novice — penalises steep segments heavily → flattest
 *   1 = easy
 *   2 = intermediate
 *   3 = pro — no penalty → allows steep climbs
 *
 * For foot/running profiles ORS ignores steepness_difficulty entirely.
 * We send no special params for those — elevation selection is handled in
 * the controller by requesting route alternatives and picking by ascent.
 *
 * @param {"flat"|"optimal"|"hilly"|"auto"} elevPref
 * @param {string} orsProfile  e.g. "foot-hiking", "cycling-road"
 * @returns {{ preference?: string, profileParams?: object }}
 */
export function buildORSElevationOpts(elevPref, orsProfile = "") {
  const isCycling = orsProfile.startsWith("cycling");

  if (elevPref === "flat") {
    if (isCycling) {
      return { profileParams: { weightings: { steepness_difficulty: 0 } } };
    }
    // Foot/run: no native flat param — controller picks flattest alternative
    return {};
  }

  if (elevPref === "hilly") {
    if (isCycling) {
      return { profileParams: { weightings: { steepness_difficulty: 3 } } };
    }
    return {};
  }

  if (elevPref === "optimal") {
    if (isCycling) {
      return { profileParams: { weightings: { steepness_difficulty: 1 } } };
    }
    return {};
  }

  return {};
}

// Fetch elevation for an array of [lng, lat] coords in one ORS elevation/line call.
// Returns a parallel array of elevation values (metres); falls back to zeros on error.
// ORS elevation/line has an undocumented ~2000-point limit — inputs larger than
// 1 500 are thinned first.
export async function fetchElevations(coords) {
  if (!ORS_API_KEY || !coords.length) return coords.map(() => 0);
  const coordsToQuery =
    coords.length > 1_500 ? thinCoords(coords, 1_500) : coords;
  try {
    const res = await fetchWithTimeout(
      "https://api.openrouteservice.org/elevation/line",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: ORS_API_KEY,
        },
        body: JSON.stringify({
          format_in: "geojson",
          format_out: "geojson",
          geometry: { type: "LineString", coordinates: coordsToQuery },
        }),
      },
      TIMEOUT_ROUTING_MS,
    );
    if (!res.ok) return coordsToQuery.map(() => 0);
    const data = await res.json();
    return (data.geometry?.coordinates ?? []).map((c) => c[2] ?? 0);
  } catch {
    return coordsToQuery.map(() => 0);
  }
}

// Fetch ORS POIs along a route polyline filtered to within bufferM metres.
// categoryGroupIds: array of ORS category_group_ids (e.g. [330, 620]).
// Returns raw ORS GeoJSON features.
// ORS POI API caps geometry at ~73 km². For long routes we chunk the thinned
// LineString into segments small enough to stay under the limit, then merge.
const ORS_POI_CHUNK_SIZE = 40; // points per chunk (~safe for routes up to ~150 km)

export async function fetchRoutePois(routeCoords, categoryGroupIds, bufferM = 300) {
  if (!ORS_API_KEY || !routeCoords?.length || !categoryGroupIds?.length) return [];
  const thinned = thinCoords(routeCoords, 150);

  // Split into overlapping chunks so we don't miss POIs near chunk boundaries.
  const chunks = [];
  for (let i = 0; i < thinned.length; i += ORS_POI_CHUNK_SIZE - 1) {
    chunks.push(thinned.slice(i, i + ORS_POI_CHUNK_SIZE));
  }

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
              filters: { category_group_ids: categoryGroupIds },
              limit: 200,
            }),
          },
          TIMEOUT_ROUTING_MS,
        );
        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          console.warn(`[ORS POIs] ${res.status}: ${errText}`);
          return;
        }
        const data = await res.json();
        for (const f of data.features ?? []) {
          const id = f.properties?.osm_id ?? JSON.stringify(f.geometry?.coordinates);
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

// Fetch scenic/natural/touristic POI coords inside a bounding box around center.
// Used for candidate scoring — independent of the user's selected poiTypes.
export async function fetchAreaPOIs(center, radiusM) {
  if (!ORS_API_KEY) return [];
  const dLat = radiusM / METRES_PER_DEG_LAT;
  const dLng =
    radiusM / (METRES_PER_DEG_LAT * Math.cos((center[1] * Math.PI) / 180));
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
            geojson: {
              type: "Polygon",
              coordinates: [
                [
                  [center[0] - dLng, center[1] - dLat],
                  [center[0] + dLng, center[1] - dLat],
                  [center[0] + dLng, center[1] + dLat],
                  [center[0] - dLng, center[1] + dLat],
                  [center[0] - dLng, center[1] - dLat],
                ],
              ],
            },
            buffer: 0,
          },
          filters: { category_group_ids: [330, 620, 220] }, // natural, tourism, historic
          limit: 200,
        }),
      },
      TIMEOUT_ROUTING_MS,
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.features ?? []).map((f) => f.geometry.coordinates);
  } catch {
    return [];
  }
}
