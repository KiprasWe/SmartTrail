import { asyncHandler } from "../utils/asyncHandler.js";
import { sendError, sendSuccess, Errors, Success } from "../utils/responses.js";
import { PROFILE_CONFIGS } from "../lib/profiles.js";
import { routeBbox, haversineM } from "../lib/geo.js";
import {
  fetchORSDirections,
  orsFeatureToRouteData,
  buildORSElevationOpts,
  fetchRoutePois,
} from "../lib/ors.js";
import { generateLoop } from "../lib/loop-algo.js";
import { fetchWithTimeout } from "../utils/http.js";

const ORS_API_KEY = process.env.ORS_API_KEY;

const ORS_CATEGORY_GROUP_MAP = {
  nature: [330],        // natural
  tourism: [620],       // tourism
  historic: [220],      // historic
  food: [560],          // sustenance
  arts_culture: [130],  // arts_and_culture
  leisure: [260],       // leisure_and_entertainment
};

function normOrsPoiFeature(feature, idx) {
  const props = feature.properties ?? {};
  const coords = feature.geometry?.coordinates;
  if (!coords) return null;
  const [lng, lat] = coords;
  const catEntry = Object.values(props.category_ids ?? {})[0];
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [lng, lat] },
    properties: {
      id: props.osm_id ?? `ors-${idx}`,
      name:
        props.osm_tags?.name || props.name || catEntry?.category_name || null,
      category: catEntry?.category_name ?? null,
      rating: null,
      user_rating_count: null,
      photo_name: null,
      editorial_summary: null,
    },
  };
}

// POIs are fetched within a 300m straight-line buffer of the route, so any POI
// that requires >3.5km of actual road travel to reach is almost certainly behind
// a barrier (river, motorway, fenced area). The ORS matrix API tells us the real
// routed distance from evenly-sampled route points to each POI.
const MATRIX_SOURCE_COUNT = 10;
const MATRIX_MAX_LOCATIONS = 50; // conservative for ORS free tier
const BARRIER_MAX_ROUTED_M = 3500;

async function filterPoisByReachability(pois, routeCoords, orsProfile) {
  if (!pois.length || !ORS_API_KEY || routeCoords.length < 2) return pois;

  const srcCount = Math.min(MATRIX_SOURCE_COUNT, routeCoords.length);
  const step = (routeCoords.length - 1) / (srcCount - 1);
  const sources = Array.from({ length: srcCount }, (_, i) =>
    routeCoords[Math.round(i * step)],
  );

  const maxDests = MATRIX_MAX_LOCATIONS - srcCount;
  const kept = [];
  let droppedCount = 0;

  for (let offset = 0; offset < pois.length; offset += maxDests) {
    const batch = pois.slice(offset, offset + maxDests);
    const locations = [
      ...sources,
      ...batch.map((f) => f.geometry.coordinates),
    ];

    let distances;
    try {
      const res = await fetchWithTimeout(
        `https://api.openrouteservice.org/v2/matrix/${orsProfile}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: ORS_API_KEY,
          },
          body: JSON.stringify({
            locations,
            sources: sources.map((_, i) => i),
            destinations: batch.map((_, i) => srcCount + i),
            metrics: ["distance"],
            resolve_locations: false,
          }),
        },
        15_000,
      );

      if (!res.ok) {
        console.warn(`[poi-reachability] Matrix ${res.status} — keeping batch as-is`);
        kept.push(...batch);
        continue;
      }

      ({ distances } = await res.json());
    } catch (err) {
      console.warn(`[poi-reachability] Matrix error: ${err.message} — keeping batch as-is`);
      kept.push(...batch);
      continue;
    }

    for (let di = 0; di < batch.length; di++) {
      let minRoutedM = Infinity;
      for (let si = 0; si < sources.length; si++) {
        const d = distances[si]?.[di];
        if (d != null && d < minRoutedM) minRoutedM = d;
      }

      if (minRoutedM > BARRIER_MAX_ROUTED_M) {
        droppedCount++;
        console.log(
          `[poi-reachability] Dropped "${batch[di].properties.name}" ` +
            `— ${(minRoutedM / 1000).toFixed(1)}km by road from nearest route point`,
        );
        continue;
      }

      kept.push(batch[di]);
    }
  }

  console.log(
    `[poi-reachability] ${pois.length} fetched → ${kept.length} reachable` +
      (droppedCount ? ` (${droppedCount} barrier-blocked dropped)` : ""),
  );

  return kept;
}

function rankAndLimitPois(pois, routeCoords, count) {
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

async function fetchPoiFeatures(routeCoords, poiTypes) {
  if (!poiTypes.length) return [];
  const groupIds = [
    ...new Set(
      poiTypes.flatMap((t) => ORS_CATEGORY_GROUP_MAP[t.toLowerCase()] ?? []),
    ),
  ].slice(0, 5);
  if (!groupIds.length) return [];
  const raw = await fetchRoutePois(routeCoords, groupIds);
  return raw.map((f, i) => normOrsPoiFeature(f, i)).filter(Boolean);
}

export const directRouting = asyncHandler(async (req, res) => {
  const { start, end, profile, poiTypes, poiCount, elevationPreference, waypoints } =
    req.body;

  const profileConfig = PROFILE_CONFIGS[profile];
  if (!profileConfig)
    return sendError(res, { ...Errors.BAD_REQUEST, message: `Invalid profile: ${profile}` });
  const locations = [start, ...waypoints, end];
  const orsElevOpts = buildORSElevationOpts(
    elevationPreference,
    profileConfig.orsProfile,
  );
  const needsElevPick =
    elevationPreference === "flat" || elevationPreference === "hilly" || elevationPreference === "optimal";

  let pickedData;
  try {
    if (waypoints.length === 0 && needsElevPick) {
      const orsResult = await fetchORSDirections(
        profileConfig.orsProfile,
        locations,
        {
          ...orsElevOpts,
          alternativeRoutes: {
            target_count: 3,
            weight_factor: 1.6,
            share_factor: 0.4,
          },
        },
      );
      const features = orsResult.features ?? [];
      if (!features.length) throw new Error("ORS returned no route");

      const candidates = features.map((f) => orsFeatureToRouteData(f));
      if (elevationPreference === "optimal") {
        const sorted = [...candidates].sort((a, b) => a.ascent_m - b.ascent_m);
        pickedData = sorted[Math.floor(sorted.length / 2)];
      } else {
        pickedData = candidates.reduce((best, c) =>
          elevationPreference === "flat"
            ? c.ascent_m < best.ascent_m ? c : best
            : c.ascent_m > best.ascent_m ? c : best,
        );
      }

      console.log(
        `[directRouting] picked ${elevationPreference} from ${candidates.length} alternatives — ` +
          `ascents: ${candidates.map((c) => c.ascent_m + "m").join(" / ")} → chose ${pickedData.ascent_m}m`,
      );
    } else {
      const orsResult = await fetchORSDirections(
        profileConfig.orsProfile,
        locations,
        orsElevOpts,
      );
      const features = orsResult.features ?? [];
      if (!features.length) throw new Error("ORS returned no route");
      pickedData = orsFeatureToRouteData(features[0]);
    }
  } catch (err) {
    return sendError(res, {
      ...Errors.EXTERNAL_SERVICE_ERROR,
      message: `Route generation failed: ${err.message}`,
    });
  }

  const {
    coords,
    elevArr,
    ascent_m,
    descent_m,
    maneuvers,
    distance_km,
  } = pickedData;
  const duration_s = Math.round(pickedData.duration_s * (profileConfig.speedFactor ?? 1));

  const rawPois = await fetchPoiFeatures(coords, poiTypes);
  const reachablePois = await filterPoisByReachability(rawPois, coords, profileConfig.orsProfile);
  const pois = rankAndLimitPois(reachablePois, coords, poiCount);

  const route = {
    label: "recommended",
    description: "Recommended route",
    profile,
    distance_km,
    duration_s,
    ascent_m,
    descent_m,
    geometry: { type: "LineString", coordinates: coords },
    bbox: routeBbox(coords),
    elevation_profile: elevArr,
    maneuvers,
    pois,
  };

  return sendSuccess(res, Success.ROUTE_GENERATED, {
    profile,
    elevation_preference: elevationPreference,
    poi_types_requested: poiTypes,
    routes: [route],
  });
});

function buildLoopRoute(routeData, pois, profileKey, overlapRatio) {
  return {
    label: "loop",
    description: "Loop route",
    profile: profileKey,
    distance_km: routeData.distance_km,
    duration_s: routeData.duration_s,
    ascent_m: routeData.ascent_m,
    descent_m: routeData.descent_m,
    geometry: { type: "LineString", coordinates: routeData.coords },
    bbox: routeBbox(routeData.coords),
    elevation_profile: routeData.elevArr,
    maneuvers: routeData.maneuvers,
    pois,
    ...(overlapRatio != null && { overlap_ratio: overlapRatio }),
  };
}

export const loopRouting = asyncHandler(async (req, res) => {
  const {
    start,
    distance,
    profile,
    poiTypes,
    poiCount,
    elevationPreference,
    waypoints,
    controlPoints,
  } = req.body;

  if (!ORS_API_KEY) {
    return sendError(res, {
      ...Errors.EXTERNAL_SERVICE_ERROR,
      message: "ORS_API_KEY is not configured",
    });
  }

  const profileConfig = PROFILE_CONFIGS[profile];
  if (!profileConfig)
    return sendError(res, { ...Errors.BAD_REQUEST, message: `Invalid profile: ${profile}` });
  const orsProfile = profileConfig.orsProfile;
  const orsElevOpts = buildORSElevationOpts(elevationPreference, orsProfile);

  const farthestStopM = waypoints.length
    ? Math.max(...waypoints.map((w) => haversineM(start, w)))
    : 0;
  const stopForcesExtension = farthestStopM > distance * 1.5;

  // For flat/hilly/optimal preference with pure or stops-only loops, generate multiple
  // candidates with different random shapes and pick the best by ascent.
  // controlPoints are user-drawn so we don't re-randomise those.
  const needsElevPick = elevationPreference === "flat" || elevationPreference === "hilly" || elevationPreference === "optimal";
  const loopAttempts = needsElevPick && !controlPoints?.length ? 3 : 1;

  let result;
  try {
    if (loopAttempts === 1) {
      result = await generateLoop({
        start,
        targetM: distance,
        orsProfile,
        orsElevOpts,
        stops: waypoints,
        controlPoints,
      });
    } else {
      const LOOP_DISTANCE_TOLERANCE = 0.12;
      const candidates = [];
      for (let i = 0; i < loopAttempts; i++) {
        try {
          const r = await generateLoop({
            start,
            targetM: distance,
            orsProfile,
            orsElevOpts,
            stops: waypoints,
          });
          candidates.push(r);
          const offRatio =
            Math.abs(r.routeData.distance_km * 1000 - distance) / distance;
          if (offRatio <= LOOP_DISTANCE_TOLERANCE) break;
        } catch (err) {
          console.warn(`[loopRouting] attempt ${i + 1} failed: ${err.message}`);
        }
      }
      if (!candidates.length) throw new Error("All loop generation attempts failed");

      if (elevationPreference === "optimal") {
        const sorted = [...candidates].sort((a, b) => a.routeData.ascent_m - b.routeData.ascent_m);
        result = sorted[Math.floor(sorted.length / 2)];
      } else {
        result = candidates.reduce((best, r) =>
          elevationPreference === "flat"
            ? r.routeData.ascent_m < best.routeData.ascent_m ? r : best
            : r.routeData.ascent_m > best.routeData.ascent_m ? r : best,
        );
      }

      console.log(
        `[loopRouting] elevation pick (${elevationPreference}): ` +
          candidates.map((r) => `${r.routeData.ascent_m}m`).join(" / ") +
          ` → chose ${result.routeData.ascent_m}m`,
      );
    }
  } catch (err) {
    return sendError(res, {
      ...Errors.EXTERNAL_SERVICE_ERROR,
      message: `Loop generation failed: ${err.message}`,
    });
  }

  const meta = {
    ...result.meta,
    auto_extended: stopForcesExtension && result.meta.snapped_to_min,
  };

  console.log(
    `[loopRouting] ${result.routeData.distance_km} km ` +
      `(target ${(distance / 1000).toFixed(1)} km` +
      `${meta.snapped_to_min ? ` — snapped to min ${meta.min_distance_km} km` : ""}) ` +
      `cps=${result.controlPoints.length} stops=${waypoints.length}`,
  );

  const rawPois = await fetchPoiFeatures(result.routeData.coords, poiTypes);
  const reachablePois = await filterPoisByReachability(rawPois, result.routeData.coords, orsProfile);
  const pois = rankAndLimitPois(reachablePois, result.routeData.coords, poiCount);

  const loopRouteData = profileConfig.speedFactor
    ? { ...result.routeData, duration_s: Math.round(result.routeData.duration_s * profileConfig.speedFactor) }
    : result.routeData;

  return sendSuccess(res, Success.ROUTE_GENERATED, {
    profile,
    elevation_preference: elevationPreference,
    poi_types_requested: poiTypes,
    controlPoints: result.controlPoints,
    loop_meta: meta,
    routes: [
      buildLoopRoute(
        loopRouteData,
        pois,
        profile,
        result.meta.overlap_ratio,
      ),
    ],
  });
});

export const addPoiToRoute = asyncHandler(async (req, res) => {
  const { poi, legs, profile } = req.body;
  const profileConfig = PROFILE_CONFIGS[profile];
  if (!profileConfig)
    return sendError(res, { ...Errors.BAD_REQUEST, message: `Invalid profile: ${profile}` });

  let bestLegIdx = 0;
  let bestDetour = Infinity;

  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    const detour =
      haversineM(leg.from, poi) +
      haversineM(poi, leg.to) -
      haversineM(leg.from, leg.to);
    if (detour < bestDetour) {
      bestDetour = detour;
      bestLegIdx = i;
    }
  }

  const targetLeg = legs[bestLegIdx];

  let legA, legB;
  try {
    const [resA, resB] = await Promise.all([
      fetchORSDirections(profileConfig.orsProfile, [targetLeg.from, poi], {}),
      fetchORSDirections(profileConfig.orsProfile, [poi, targetLeg.to], {}),
    ]);
    const featA = resA.features?.[0];
    const featB = resB.features?.[0];
    if (!featA || !featB) throw new Error("ORS returned no route for leg");

    const dataA = orsFeatureToRouteData(featA);
    const dataB = orsFeatureToRouteData(featB);

    legA = { from: targetLeg.from, to: poi, ...dataA };
    legB = { from: poi, to: targetLeg.to, ...dataB };
  } catch (err) {
    return sendError(res, {
      ...Errors.EXTERNAL_SERVICE_ERROR,
      message: `POI insertion failed: ${err.message}`,
    });
  }

  const newLegs = [
    ...legs.slice(0, bestLegIdx),
    legA,
    legB,
    ...legs.slice(bestLegIdx + 1),
  ];

  const sf = profileConfig.speedFactor ?? 1;
  return sendSuccess(res, Success.ROUTE_GENERATED, {
    legs: newLegs.map((leg) => ({
      from: leg.from,
      to: leg.to,
      distance_km: leg.distance_km,
      duration_s: Math.round(leg.duration_s * sf),
      ascent_m: leg.ascent_m,
      descent_m: leg.descent_m,
      geometry: {
        type: "LineString",
        coordinates: leg.coords ?? leg.geometry?.coordinates,
      },
    })),
  });
});

const SUGGESTION_LIMIT = 15;
const SUGGESTION_CORRIDOR_M = 800;

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

export const aiReroute = asyncHandler(async (req, res) => {
  const { start, end, distance, profile, elevationPreference, waypoints } = req.body;

  const profileConfig = PROFILE_CONFIGS[profile];
  if (!profileConfig)
    return sendError(res, { ...Errors.BAD_REQUEST, message: `Invalid profile: ${profile}` });

  const orsProfile = profileConfig.orsProfile;
  const orsElevOpts = buildORSElevationOpts(elevationPreference, orsProfile);
  const hasEnd = Array.isArray(end) && end.length === 2;

  try {
    let routeData;
    if (hasEnd) {
      const locs = [start, ...waypoints, end];
      const radiuses =
        waypoints.length > 0
          ? [-1, ...waypoints.map(() => 1500), -1]
          : undefined;
      const orsResult = await fetchORSDirections(
        orsProfile,
        locs,
        radiuses ? { ...orsElevOpts, radiuses } : orsElevOpts,
      );
      const feat = orsResult.features?.[0];
      if (!feat) throw new Error("ORS returned no route");
      routeData = orsFeatureToRouteData(feat);
    } else {
      const loopResult = await generateLoop({
        start,
        targetM: distance,
        orsProfile,
        orsElevOpts,
        stops: waypoints,
      });
      routeData = loopResult.routeData;
    }

    const sf = profileConfig.speedFactor ?? 1;
    return sendSuccess(res, Success.ROUTE_GENERATED, {
      routes: [
        {
          label: "recommended",
          description: "AI Tour Guide route",
          profile,
          distance_km: routeData.distance_km,
          duration_s: Math.round(routeData.duration_s * sf),
          ascent_m: routeData.ascent_m,
          descent_m: routeData.descent_m,
          geometry: { type: "LineString", coordinates: routeData.coords },
          bbox: routeBbox(routeData.coords),
          elevation_profile: routeData.elevArr,
          maneuvers: routeData.maneuvers,
          pois: [],
        },
      ],
    });
  } catch (err) {
    return sendError(res, {
      ...Errors.EXTERNAL_SERVICE_ERROR,
      message: `AI reroute failed: ${err.message}`,
    });
  }
});

export const loopPoiSuggestions = asyncHandler(async (req, res) => {
  const { routeCoords, poiTypes, max } = req.body;

  if (!ORS_API_KEY) {
    return sendError(res, {
      ...Errors.EXTERNAL_SERVICE_ERROR,
      message: "ORS_API_KEY is not configured",
    });
  }

  const groupIds = [
    ...new Set(
      poiTypes.flatMap((t) => ORS_CATEGORY_GROUP_MAP[t.toLowerCase()] ?? []),
    ),
  ].slice(0, 5);

  let raw = [];
  try {
    raw = await fetchRoutePois(routeCoords, groupIds, SUGGESTION_CORRIDOR_M);
  } catch (err) {
    return sendError(res, {
      ...Errors.EXTERNAL_SERVICE_ERROR,
      message: `POI fetch failed: ${err.message}`,
    });
  }

  const features = raw.map((f, i) => normOrsPoiFeature(f, i)).filter(Boolean);
  if (!features.length) {
    return sendSuccess(res, Success.ROUTE_GENERATED, { suggestions: [] });
  }

  const anchors = thinForInsertion(routeCoords, 50);

  const ranked = features
    .filter((f) => f.properties.name) // hide unnamed dots
    .map((f) => {
      const coords = f.geometry.coordinates;
      const addedM = cheapestInsertionAddedM(coords, anchors);
      const quality = poiQualityScore(f);
      const score = quality - addedM / 200;
      return { feature: f, addedKm: +(addedM / 1000).toFixed(2), score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(Math.max(max, 1), 30));

  return sendSuccess(res, Success.ROUTE_GENERATED, {
    suggestions: ranked.map((r) => ({
      ...r.feature,
      properties: { ...r.feature.properties, added_km: r.addedKm },
    })),
  });
});
