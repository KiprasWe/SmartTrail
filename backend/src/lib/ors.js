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
