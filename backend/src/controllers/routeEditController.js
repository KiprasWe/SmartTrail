import { asyncHandler } from "../utils/asyncHandler.js";
import { sendError, sendSuccess, Errors, Success } from "../utils/responses.js";
import { PROFILE_CONFIGS, calcDuration } from "../lib/profiles.js";
import { routeBbox, haversineM } from "../lib/geo.js";
import { optimizeWaypointSequence } from "../lib/waypoint-optimize.js";
import {
  fetchORSDirections,
  orsFeatureToRouteData,
  buildProfileOpts,
} from "../lib/ors.js";
import { UNSPLICE_DIST_THRESHOLD_M } from "../config/tuning.js";
import { splicePoiIntoRoute } from "../lib/poi-splice.js";

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

export const splicePoi = asyncHandler(async (req, res) => {
  const { routeCoords, elevArr, poi, profile, elevationPreference, currentStats } = req.body;
  const { distance_km: origDistKm, duration_s: origDurS, ascent_m: origAscent, descent_m: origDescent } = currentStats;

  const profileConfig = PROFILE_CONFIGS[profile];
  if (!profileConfig)
    return sendError(res, { ...Errors.BAD_REQUEST, message: `Invalid profile: ${profile}` });

  const orsProfile = profileConfig.orsProfile;
  const orsElevOpts = buildProfileOpts(profileConfig, elevationPreference);

  let spliced;
  try {
    spliced = await splicePoiIntoRoute({
      routeCoords,
      elevArr,
      poi,
      orsProfile,
      orsElevOpts,
      profileConfig,
      currentStats,
    });
  } catch (err) {
    return sendError(res, {
      ...Errors.EXTERNAL_SERVICE_ERROR,
      message: `POI splice failed: ${err.message}`,
    });
  }

  return sendSuccess(res, Success.ROUTE_GENERATED, {
    routes: [{
      profile,
      distance_km: spliced.distance_km,
      duration_s: spliced.duration_s,
      ascent_m: spliced.ascent_m,
      descent_m: spliced.descent_m,
      geometry: { type: "LineString", coordinates: spliced.coords },
      bbox: routeBbox(spliced.coords),
      elevation_profile: spliced.elevArr,
    }],
  });
});

export const unsplicePoi = asyncHandler(async (req, res) => {
  const { routeCoords, elevArr, poi, profile, elevationPreference, currentStats } = req.body;
  const { distance_km: origDistKm, duration_s: origDurS, ascent_m: origAscent, descent_m: origDescent } = currentStats;

  const profileConfig = PROFILE_CONFIGS[profile];
  if (!profileConfig)
    return sendError(res, { ...Errors.BAD_REQUEST, message: `Invalid profile: ${profile}` });

  const orsProfile = profileConfig.orsProfile;
  const orsElevOpts = buildProfileOpts(profileConfig, elevationPreference);

  let closestIdx = 0;
  let minDist = Infinity;
  for (let i = 0; i < routeCoords.length; i++) {
    const d = haversineM(poi, routeCoords[i]);
    if (d < minDist) { minDist = d; closestIdx = i; }
  }

  let aIdx = closestIdx;
  while (aIdx > 0 && haversineM(poi, routeCoords[aIdx]) < UNSPLICE_DIST_THRESHOLD_M) {
    aIdx--;
  }

  let bIdx = closestIdx;
  while (bIdx < routeCoords.length - 1 && haversineM(poi, routeCoords[bIdx]) < UNSPLICE_DIST_THRESHOLD_M) {
    bIdx++;
  }

  if (aIdx >= bIdx) {
    return sendError(res, { ...Errors.BAD_REQUEST, message: "Cannot locate POI detour on route" });
  }

  const A = routeCoords[aIdx];
  const B = routeCoords[bIdx];

  let seg;
  try {
    const resAB = await fetchORSDirections(orsProfile, [A, B], orsElevOpts);
    const featAB = resAB.features?.[0];
    if (!featAB) throw new Error("ORS returned no route for unsplice segment");
    seg = orsFeatureToRouteData(featAB);
  } catch (err) {
    return sendError(res, {
      ...Errors.EXTERNAL_SERVICE_ERROR,
      message: `POI unsplice failed: ${err.message}`,
    });
  }

  const newCoords = [
    ...routeCoords.slice(0, aIdx),
    ...seg.coords,
    ...routeCoords.slice(bIdx + 1),
  ];

  let newElevArr = null;
  if (Array.isArray(elevArr) && elevArr.length === routeCoords.length) {
    newElevArr = [
      ...elevArr.slice(0, aIdx),
      ...seg.elevArr,
      ...elevArr.slice(bIdx + 1),
    ];
  }

  let replacedDistKm = 0;
  for (let i = aIdx; i < bIdx; i++) {
    replacedDistKm += haversineM(routeCoords[i], routeCoords[i + 1]) / 1000;
  }
  const newDistKm = +(Math.max(0, origDistKm - replacedDistKm) + seg.distance_km).toFixed(2);

  const replacedDurRatio = origDistKm > 0 ? replacedDistKm / origDistKm : 0;
  const newOrsSeconds = Math.round(origDurS * (1 - replacedDurRatio)) + seg.duration_s;
  const duration_s = calcDuration(newDistKm, newOrsSeconds, profileConfig);

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
    ascent_m = Math.round(Math.max(0, origAscent * (1 - ratio)) + seg.ascent_m);
    descent_m = Math.round(Math.max(0, origDescent * (1 - ratio)) + seg.descent_m);
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
    }],
  });
});
