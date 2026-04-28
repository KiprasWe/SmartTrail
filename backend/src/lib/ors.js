import { fetchWithRetry, fetchWithTimeout } from "../utils/http.js";
import { thinCoords, METRES_PER_DEG_LAT } from "./geo.js";

const ORS_API_KEY = process.env.ORS_API_KEY;
export const ORS_POIS_URL = "https://api.openrouteservice.org/pois";
export const ORS_DIRECTIONS_URL =
  "https://api.openrouteservice.org/v2/directions";

const TIMEOUT_ROUTING_MS = 30_000;

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
  const isFoot = orsProfile.startsWith("foot");

  if (elevPref === "flat") {
    if (isCycling) return { profileParams: { weightings: { steepness_difficulty: 0 } } };
    // foot: low green bias keeps routing on paved/urban paths (generally flatter)
    if (isFoot) return { profileParams: { weightings: { green: 0.0, quiet: 0.3 } } };
    return {};
  }

  if (elevPref === "hilly") {
    if (isCycling) return { profileParams: { weightings: { steepness_difficulty: 3 } } };
    // foot: high green bias steers toward parks/trails which tend to have more elevation
    if (isFoot) return { profileParams: { weightings: { green: 1.0 } } };
    return {};
  }

  if (elevPref === "optimal") {
    if (isCycling) return { profileParams: { weightings: { steepness_difficulty: 1 } } };
    if (isFoot) return { profileParams: { weightings: { green: 0.5 } } };
    return {};
  }

  return {};
}

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

const ORS_POI_CHUNK_SIZE = 40;

export async function fetchRoutePois(
  routeCoords,
  categoryGroupIds,
  bufferM = 300,
) {
  if (!ORS_API_KEY || !routeCoords?.length || !categoryGroupIds?.length)
    return [];
  const thinned = thinCoords(routeCoords, 150);

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
          filters: { category_group_ids: [330, 620, 220] },
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
