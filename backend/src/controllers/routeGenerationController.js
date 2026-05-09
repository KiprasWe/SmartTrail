import { asyncHandler } from "../utils/asyncHandler.js";
import { sendError, sendSuccess, Errors, Success } from "../utils/responses.js";
import { PROFILE_CONFIGS, calcDuration } from "../lib/profiles.js";
import { routeBbox, haversineM } from "../lib/geo.js";
import { optimizeWaypointSequence } from "../lib/waypoint-optimize.js";
import {
  fetchORSDirections,
  orsFeatureToRouteData,
  buildORSElevationOpts,
  fetchRoutePois,
  filterUnreachablePois,
} from "../lib/ors.js";
import { generateLoop } from "../lib/loop-algo.js";
import { genai, GEMINI_MODEL, extractJsonArray } from "../lib/ai/shared.js";

const ORS_API_KEY = process.env.ORS_API_KEY;

const ORS_CATEGORY_MAP = {
  nature:      { groupIds: [330],  categoryIds: [279, 280] },
  tourism:     { groupIds: [],     categoryIds: [627, 335, 623] },
  historic:    { groupIds: [220],  categoryIds: [] },
  food:        { groupIds: [560],  categoryIds: [] },
  arts_culture:{ groupIds: [130],  categoryIds: [621] },
  leisure: {
    groupIds: [260],
    categoryIds: [],
    // Fetch the full group 260 but post-filter to these sub-categories only,
    // excluding adult venues, casinos, strip clubs, etc.
    catFilter: {
      rangeMin: 261, rangeMax: 310,
      allowed: new Set([262,263,264,265,266,267,268,269,270,271,272,273,274,275,
                        276,277,278,279,280,281,282,283,284,285,286,287,288,289,
                        290,291,292,293,294,295,296,297,299,300,301,304,305,306,
                        308,309,310]),
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
      category, // "park", "restaurant", etc.
    },
  };
}

// Adapts GeoJSON POI features for filterUnreachablePois (which expects {lng, lat} objects),
// runs the matrix filter, then returns the original features that survived.
async function filterPoiFeaturesByReachability(features, routeCoords, orsProfile) {
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

async function geminiSelectPois(pois, count, routeCoords) {
  if (!count || pois.length <= count) return pois;
  if (!genai) return rankAndLimitPoisFallback(pois, count, routeCoords);

  const poiList = pois
    .map((f, i) => {
      const p = f.properties;
      const pct = poiRouteProgress(f.geometry.coordinates, routeCoords);
      return `[${i}] ${p.name ?? "unnamed"} (${p.category ?? "unknown"}) — route position: ${pct}%`;
    })
    .join("\n");

  const prompt = [
    `You are a travel guide. A user is planning a route and wants to visit exactly ${count} POI(s).`,
    `Each POI has a "route position" (0% = start, 100% = end) showing where along the route it sits.`,
    `Select the ${count} most interesting and worth-visiting places, ensuring they are spread out along the full length of the route.`,
    `Avoid picking POIs that are all clustered near the same route position — aim for variety across the whole route.`,
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

// Merges per-profile ORS options (avoid_features, weightings, preference) with
// elevation-specific opts so both take effect on every request.
function buildProfileOpts(profileConfig, elevPref) {
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

async function fetchPoiFeatures(routeCoords, poiTypes) {
  if (!poiTypes.length) return [];
  const { groupIds, categoryIds, catFilters } = buildPoiParams(poiTypes);
  console.log(`[poi-fetch] types=${poiTypes} → groupIds=${groupIds} categoryIds=${categoryIds}`);
  if (!groupIds.length && !categoryIds.length) return [];
  const raw = await fetchRoutePois(routeCoords, { groupIds, categoryIds });
  const filtered = applyCatFilters(raw, catFilters);
  const normed = filtered.map((f, i) => normOrsPoiFeature(f, i)).filter(Boolean);
  console.log(`[poi-fetch] ${raw.length} raw → ${filtered.length} after cat filter → ${normed.length} named`);
  return normed;
}

export const directRouting = asyncHandler(async (req, res) => {
  const {
    start,
    end,
    profile,
    poiTypes,
    poiCount,
    elevationPreference,
    waypoints,
  } = req.body;

  if (!ORS_API_KEY) {
    return sendError(res, {
      ...Errors.EXTERNAL_SERVICE_ERROR,
      message: "ORS_API_KEY is not configured",
    });
  }

  const profileConfig = PROFILE_CONFIGS[profile];
  if (!profileConfig)
    return sendError(res, {
      ...Errors.BAD_REQUEST,
      message: `Invalid profile: ${profile}`,
    });

  const locations = [start, ...waypoints, end];

  const results = await Promise.allSettled(
    ["flat", "moderate", "hilly"].map((level) =>
      fetchORSDirections(
        profileConfig.orsProfile,
        locations,
        buildProfileOpts(profileConfig, level),
      ).then((r) => {
        const feat = r.features?.[0];
        return feat ? orsFeatureToRouteData(feat) : null;
      }),
    ),
  );

  const candidates = results
    .filter((r) => r.status === "fulfilled" && r.value !== null)
    .map((r) => r.value);

  if (!candidates.length) {
    const firstErr = results.find((r) => r.status === "rejected");
    return sendError(res, {
      ...Errors.EXTERNAL_SERVICE_ERROR,
      message: `Route generation failed: ${firstErr?.reason?.message ?? "ORS returned no route"}`,
    });
  }

  const sorted = [...candidates].sort((a, b) => a.ascent_m - b.ascent_m);
  const last = sorted.length - 1;
  const pickIdx = { flat: 0, moderate: Math.floor(last / 2), hilly: last };
  const pickedData =
    sorted[pickIdx[elevationPreference] ?? Math.floor(last / 2)];

  console.log(
    `[directRouting] elevation pick (${elevationPreference}): ` +
      sorted.map((c) => `${c.ascent_m}m`).join(" / ") +
      ` → chose ${pickedData.ascent_m}m`,
  );

  const { coords, elevArr, ascent_m, descent_m, maneuvers, distance_km } =
    pickedData;
  const duration_s = calcDuration(
    distance_km,
    pickedData.duration_s,
    profileConfig,
  );

  const rawPois = await fetchPoiFeatures(coords, poiTypes);
  const reachablePois = await filterPoiFeaturesByReachability(
    rawPois,
    coords,
    profileConfig.orsProfile,
  );
  const pois = await geminiSelectPois(reachablePois, poiCount, coords);

  return sendSuccess(res, Success.ROUTE_GENERATED, {
    profile,
    elevation_preference: elevationPreference,
    routes: [
      {
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
      },
    ],
  });
});

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
    travelHeading = 0,
    rotation = "clockwise",
  } = req.body;

  if (!ORS_API_KEY) {
    return sendError(res, {
      ...Errors.EXTERNAL_SERVICE_ERROR,
      message: "ORS_API_KEY is not configured",
    });
  }

  const profileConfig = PROFILE_CONFIGS[profile];
  if (!profileConfig)
    return sendError(res, {
      ...Errors.BAD_REQUEST,
      message: `Invalid profile: ${profile}`,
    });

  const orsProfile = profileConfig.orsProfile;
  const farthestStopM = waypoints.length
    ? Math.max(...waypoints.map((w) => haversineM(start, w)))
    : 0;
  const stopForcesExtension = farthestStopM > distance * 1.5;

  let result;
  try {
    if (controlPoints?.length > 0) {
      result = await generateLoop({
        start,
        targetM: distance,
        orsProfile,
        orsElevOpts: buildProfileOpts(profileConfig, elevationPreference),
        stops: waypoints,
        controlPoints,
        travelHeading,
        rotation,
      });
    } else {
      const results = await Promise.allSettled(
        ["flat", "moderate", "hilly"].map((level) =>
          generateLoop({
            start,
            targetM: distance,
            orsProfile,
            orsElevOpts: buildProfileOpts(profileConfig, level),
            stops: waypoints,
            travelHeading,
            rotation,
          }),
        ),
      );

      const candidates = results
        .filter((r) => r.status === "fulfilled")
        .map((r) => r.value);

      if (!candidates.length) {
        const firstErr = results.find((r) => r.status === "rejected");
        throw new Error(
          firstErr?.reason?.message ?? "All loop generation attempts failed",
        );
      }

      const sorted = [...candidates].sort(
        (a, b) => a.routeData.ascent_m - b.routeData.ascent_m,
      );
      const last = sorted.length - 1;
      const pickIdx = { flat: 0, moderate: Math.floor(last / 2), hilly: last };
      result = sorted[pickIdx[elevationPreference] ?? Math.floor(last / 2)];

      console.log(
        `[loopRouting] elevation pick (${elevationPreference}): ` +
          sorted.map((r) => `${r.routeData.ascent_m}m`).join(" / ") +
          ` → chose ${result.routeData.ascent_m}m`,
      );
    }
  } catch (err) {
    console.error(
      `[loopRouting] FAIL profile=${profile} target_km=${(distance / 1000).toFixed(2)} ` +
        `stops=${waypoints.length} controlPoints=${controlPoints?.length ?? 0} ` +
        `start=[${start.join(",")}] elev=${elevationPreference}\n` +
        (err.stack ?? err.message),
    );
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
  const reachablePois = await filterPoiFeaturesByReachability(
    rawPois,
    result.routeData.coords,
    orsProfile,
  );
  const pois = await geminiSelectPois(
    reachablePois,
    poiCount,
    result.routeData.coords,
  );

  const { distance_km, ascent_m, descent_m, coords, elevArr, maneuvers } =
    result.routeData;
  const duration_s = calcDuration(
    distance_km,
    result.routeData.duration_s,
    profileConfig,
  );

  return sendSuccess(res, Success.ROUTE_GENERATED, {
    profile,
    elevation_preference: elevationPreference,
    controlPoints: result.controlPoints,
    loop_meta: meta,
    routes: [
      {
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
        ...(result.meta.overlap_ratio != null && {
          overlap_ratio: result.meta.overlap_ratio,
        }),
      },
    ],
  });
});

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

export const rerouteDirect = asyncHandler(async (req, res) => {
  const { start, end, profile, elevationPreference, waypoints } = req.body;

  const profileConfig = PROFILE_CONFIGS[profile];
  if (!profileConfig)
    return sendError(res, {
      ...Errors.BAD_REQUEST,
      message: `Invalid profile: ${profile}`,
    });

  const orsProfile = profileConfig.orsProfile;
  const orsElevOpts = buildProfileOpts(profileConfig, elevationPreference);

  try {
    const orderedWaypoints = optimizeWaypointSequence({
      waypoints,
      start,
      end,
      isLoop: false,
    });
    const locs = [start, ...orderedWaypoints, end];
    const radiuses =
      orderedWaypoints.length > 0
        ? [-1, ...orderedWaypoints.map(() => 1500), -1]
        : undefined;
    const orsResult = await fetchORSDirections(
      orsProfile,
      locs,
      radiuses ? { ...orsElevOpts, radiuses } : orsElevOpts,
    );
    const feat = orsResult.features?.[0];
    if (!feat) throw new Error("ORS returned no route");
    const routeData = orsFeatureToRouteData(feat);

    return sendSuccess(res, Success.ROUTE_GENERATED, {
      routes: [
        {
          profile,
          distance_km: routeData.distance_km,
          duration_s: calcDuration(
            routeData.distance_km,
            routeData.duration_s,
            profileConfig,
          ),
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
      message: `Direct reroute failed: ${err.message}`,
    });
  }
});

export const rerouteLoop = asyncHandler(async (req, res) => {
  const {
    start,
    distance,
    profile,
    elevationPreference,
    waypoints,
    controlPoints,
    travelHeading = 0,
    rotation = "clockwise",
  } = req.body;

  const profileConfig = PROFILE_CONFIGS[profile];
  if (!profileConfig)
    return sendError(res, {
      ...Errors.BAD_REQUEST,
      message: `Invalid profile: ${profile}`,
    });

  const orsProfile = profileConfig.orsProfile;
  const orsElevOpts = buildProfileOpts(profileConfig, elevationPreference);

  try {
    const orderedWaypoints = optimizeWaypointSequence({
      waypoints,
      start,
      end: start,
      isLoop: true,
    });
    const loopResult = await generateLoop({
      start,
      targetM: distance,
      orsProfile,
      orsElevOpts,
      stops: orderedWaypoints,
      controlPoints: Array.isArray(controlPoints) ? controlPoints : [],
      travelHeading,
      rotation,
    });
    const routeData = loopResult.routeData;

    return sendSuccess(res, Success.ROUTE_GENERATED, {
      routes: [
        {
          profile,
          distance_km: routeData.distance_km,
          duration_s: calcDuration(
            routeData.distance_km,
            routeData.duration_s,
            profileConfig,
          ),
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
      message: `Loop reroute failed: ${err.message}`,
    });
  }
});

const SPLICE_BUFFER_M = 200;

export const splicePoi = asyncHandler(async (req, res) => {
  const { routeCoords, elevArr, poi, profile, elevationPreference, currentStats } = req.body;
  const { distance_km: origDistKm, duration_s: origDurS, ascent_m: origAscent, descent_m: origDescent } = currentStats;

  const profileConfig = PROFILE_CONFIGS[profile];
  if (!profileConfig)
    return sendError(res, { ...Errors.BAD_REQUEST, message: `Invalid profile: ${profile}` });

  const orsProfile = profileConfig.orsProfile;
  const orsElevOpts = buildProfileOpts(profileConfig, elevationPreference);

  // Find closest route coord to poi
  let closestIdx = 0;
  let minDist = Infinity;
  for (let i = 0; i < routeCoords.length; i++) {
    const d = haversineM(poi, routeCoords[i]);
    if (d < minDist) { minDist = d; closestIdx = i; }
  }

  // Walk backward ≥ SPLICE_BUFFER_M to find anchor A
  let aIdx = closestIdx;
  let acc = 0;
  while (aIdx > 0 && acc < SPLICE_BUFFER_M) {
    acc += haversineM(routeCoords[aIdx], routeCoords[aIdx - 1]);
    aIdx--;
  }

  // Walk forward ≥ SPLICE_BUFFER_M to find anchor B
  let bIdx = closestIdx;
  acc = 0;
  while (bIdx < routeCoords.length - 1 && acc < SPLICE_BUFFER_M) {
    acc += haversineM(routeCoords[bIdx], routeCoords[bIdx + 1]);
    bIdx++;
  }

  const A = routeCoords[aIdx];
  const B = routeCoords[bIdx];

  let segA, segB;
  try {
    const [resA, resB] = await Promise.all([
      fetchORSDirections(orsProfile, [A, poi], orsElevOpts),
      fetchORSDirections(orsProfile, [poi, B], orsElevOpts),
    ]);
    const featA = resA.features?.[0];
    const featB = resB.features?.[0];
    if (!featA || !featB) throw new Error("ORS returned no route for splice segment");
    segA = orsFeatureToRouteData(featA);
    segB = orsFeatureToRouteData(featB);
  } catch (err) {
    return sendError(res, {
      ...Errors.EXTERNAL_SERVICE_ERROR,
      message: `POI splice failed: ${err.message}`,
    });
  }

  // Stitch geometry: prefix + A→P + P→B (skip duplicate P) + suffix
  const newCoords = [
    ...routeCoords.slice(0, aIdx),
    ...segA.coords,
    ...segB.coords.slice(1),
    ...routeCoords.slice(bIdx + 1),
  ];

  // Stitch elevation array if provided and length-aligned
  let newElevArr = null;
  if (Array.isArray(elevArr) && elevArr.length === routeCoords.length) {
    newElevArr = [
      ...elevArr.slice(0, aIdx),
      ...segA.elevArr,
      ...segB.elevArr.slice(1),
      ...elevArr.slice(bIdx + 1),
    ];
  }

  // Distance delta: subtract replaced segment, add new segments
  let replacedDistKm = 0;
  for (let i = aIdx; i < bIdx; i++) {
    replacedDistKm += haversineM(routeCoords[i], routeCoords[i + 1]) / 1000;
  }
  const newDistKm = +(Math.max(0, origDistKm - replacedDistKm) + segA.distance_km + segB.distance_km).toFixed(2);

  // Duration: remove proportional share of replaced segment, add new segments
  const replacedDurRatio = origDistKm > 0 ? replacedDistKm / origDistKm : 0;
  const newOrsSeconds = Math.round(origDurS * (1 - replacedDurRatio)) + segA.duration_s + segB.duration_s;
  const duration_s = calcDuration(newDistKm, newOrsSeconds, profileConfig);

  // Ascent/descent: exact from stitched elevArr, or proportional fallback
  let ascent_m, descent_m;
  if (newElevArr) {
    let up = 0, down = 0;
    for (let i = 0; i < newElevArr.length - 1; i++) {
      const diff = newElevArr[i + 1] - newElevArr[i];
      if (diff > 0) up += diff; else down -= diff;
    }
    ascent_m = Math.round(up);
    descent_m = Math.round(down);
  } else {
    const ratio = origDistKm > 0 ? replacedDistKm / origDistKm : 0;
    ascent_m = Math.round(Math.max(0, origAscent * (1 - ratio)) + segA.ascent_m + segB.ascent_m);
    descent_m = Math.round(Math.max(0, origDescent * (1 - ratio)) + segA.descent_m + segB.descent_m);
  }

  return sendSuccess(res, Success.ROUTE_GENERATED, {
    routes: [{
      profile,
      distance_km: newDistKm,
      duration_s,
      ascent_m,
      descent_m,
      geometry: { type: "LineString", coordinates: newCoords },
      bbox: routeBbox(newCoords),
      elevation_profile: newElevArr,
      maneuvers: [],
    }],
  });
});
