import { fetchWithRetry, fetchWithTimeout } from "../utils/http.js";
import { thinCoords, haversineM } from "./geo.js";
import {
  TIMEOUT_ROUTING_MS,
  ORS_POI_CHUNK_SIZE,
  ORS_POI_MAX_GROUPS_PER_REQ,
  ORS_MATRIX_BATCH,
} from "../config/tuning.js";
import {
  ORS_API_KEY,
  ORS_POIS_URL,
  ORS_DIRECTIONS_URL,
  ORS_MATRIX_URL,
} from "../config/env.js";

// Exported. Used by routeController, routeEditController, loop-algo, poi-splice, ai/waypoints.
// Core routing call: POSTs coordinates to the ORS directions API and returns
// the raw GeoJSON response (one route through the given points).
export async function fetchORSDirections(orsProfile, coordinates, opts = {}) {
  if (!ORS_API_KEY) throw new Error("ORS_API_KEY is not set");

  const mergedOptions = {
    ...(opts.options ?? {}),
    ...(opts.profileParams && { profile_params: opts.profileParams }),
  };

  const body = {
    coordinates,
    elevation: true,
    instructions: false,
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

// Exported. Used by routeController, routeEditController, loop-algo, poi-splice, ai/pipeline.
// Normalizes a raw ORS GeoJSON feature into the app's routeData shape
// (coords, elevation array, distance/duration/ascent/descent).
export function orsFeatureToRouteData(feature) {
  const rawCoords = feature.geometry.coordinates;
  const coords = rawCoords.map((c) => [c[0], c[1]]);
  const elevArr = rawCoords.map((c) => c[2] ?? 0);

  const props = feature.properties ?? {};
  const segments = props.segments ?? [];

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
    distance_km: +(distance_m / 1000).toFixed(2),
    duration_s: Math.round(duration_s),
    ascent_m,
    descent_m,
  };
}

// Exported, but currently only consumed internally by buildProfileOpts.
// Maps an elevation preference (flat/moderate/hilly) to ORS request options —
// steepness weightings for cycling, avoid-features for walking.
export function buildORSElevationOpts(elevPref, orsProfile = "") {
  const isCycling = orsProfile.startsWith("cycling");

  if (elevPref === "flat") {
    if (isCycling)
      return { profileParams: { weightings: { steepness_difficulty: 0 } } };

    return { options: { avoid_features: ["steps"] } };
  }

  if (elevPref === "moderate") {
    if (isCycling)
      return { profileParams: { weightings: { steepness_difficulty: 1 } } };
    return {};
  }

  if (elevPref === "hilly") {
    if (isCycling)
      return { profileParams: { weightings: { steepness_difficulty: 3 } } };
    return {};
  }

  return {};
}

// Exported. Used by routeController, routeEditController, ai/pipeline.
// Merges a profile's base config with elevation-preference options into the
// final ORS opts object (preference + avoid_features + weightings).
export function buildProfileOpts(profileConfig, elevPref) {
  const elevOpts = buildORSElevationOpts(elevPref, profileConfig.orsProfile);
  const avoidFeatures = [
    ...(profileConfig.options?.avoid_features ?? []),
    ...(elevOpts.options?.avoid_features ?? []),
  ];
  const weightings = {
    ...(profileConfig.profileParams?.weightings ?? {}),
    ...(elevOpts.profileParams?.weightings ?? {}),
  };
  return {
    ...(profileConfig.preference && { preference: profileConfig.preference }),
    ...(avoidFeatures.length > 0 && {
      options: { avoid_features: avoidFeatures },
    }),
    ...(Object.keys(weightings).length > 0 && {
      profileParams: { weightings },
    }),
  };
}

// Exported. Used by poi-select.js (fetchPoiFeatures).
// Queries the ORS POI service along a route corridor, chunking the polyline
// and category groups across parallel requests and de-duping by OSM id.
export async function fetchRoutePois(
  routeCoords,
  { groupIds = [], categoryIds = [] } = {},
  bufferM = 300,
) {
  if (
    !ORS_API_KEY ||
    !routeCoords?.length ||
    (!groupIds.length && !categoryIds.length)
  )
    return [];
  const thinned = thinCoords(routeCoords, 150);

  const lineChunks = [];
  for (let i = 0; i < thinned.length; i += ORS_POI_CHUNK_SIZE - 1) {
    lineChunks.push(thinned.slice(i, i + ORS_POI_CHUNK_SIZE));
  }

  const groupChunks = [];
  if (groupIds.length) {
    for (let i = 0; i < groupIds.length; i += ORS_POI_MAX_GROUPS_PER_REQ) {
      groupChunks.push(groupIds.slice(i, i + ORS_POI_MAX_GROUPS_PER_REQ));
    }
  } else {
    groupChunks.push([]);
  }

  const seenIds = new Set();
  const all = [];

  const tasks = [];
  for (const lineChunk of lineChunks) {
    if (lineChunk.length < 2) continue;
    for (const groupChunk of groupChunks) {
      const filters = {};
      if (groupChunk.length) filters.category_group_ids = groupChunk;
      if (categoryIds.length) filters.category_ids = categoryIds;
      if (!Object.keys(filters).length) continue;
      tasks.push({ lineChunk, groupChunk, filters });
    }
  }

  await Promise.all(
    tasks.map(async ({ lineChunk, groupChunk, filters }) => {
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
                geojson: { type: "LineString", coordinates: lineChunk },
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
          console.warn(
            `[ORS POIs] HTTP ${res.status} — groups=${groupChunk} cats=${categoryIds} body=${errText.slice(0, 500)}`,
          );
          return;
        }
        const text = await res.text();
        const data = JSON.parse(text.replace(/\bNaN\b/g, "null"));
        const features = data.features ?? [];
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

// Exported. Used by poi-select.js and ai/pipeline.js.
// Drops POIs whose routed distance from the route is implausibly longer than
// straight-line (barrier-blocked / unreachable), batching via _matrixFilterBatch.
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

// Used by filterUnreachablePois (one batch of POIs at a time).
// ORS matrix call from route anchors to POIs; keeps a POI if its routed/
// straight-line distance ratio stays under the threshold. Fails open (keeps all).
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
    console.warn(
      `[ors] Matrix filter failed: ${err.message} — keeping all POIs`,
    );
    return pois;
  }

  if (!Array.isArray(distMatrix)) return pois;

  const kept = [];

  for (let j = 0; j < pois.length; j++) {
    const poi = pois[j];
    let minRatio = Infinity;

    for (let s = 0; s < anchors.length; s++) {
      const routedM = distMatrix[s]?.[j];
      if (routedM == null || routedM <= 0) continue;
      const hvM = haversineM(anchors[s], [poi.lng, poi.lat]);
      if (hvM < 50) {
        minRatio = 1;
        break;
      }
      minRatio = Math.min(minRatio, routedM / hvM);
    }

    if (minRatio <= ratioThreshold) {
      kept.push(poi);
    }
  }

  return kept;
}
