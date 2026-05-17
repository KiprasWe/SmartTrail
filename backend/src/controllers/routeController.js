import { asyncHandler } from "../utils/asyncHandler.js";
import { sendError, sendSuccess, Errors, Success } from "../utils/responses.js";
import { PROFILE_CONFIGS, calcDuration } from "../lib/profiles.js";
import { routeBbox, haversineM } from "../lib/geo.js";
import {
  fetchORSDirections,
  orsFeatureToRouteData,
  buildProfileOpts,
} from "../lib/ors.js";
import { generateLoop } from "../lib/loop-algo.js";
import {
  fetchPoiFeatures,
  filterPoiFeaturesByReachability,
  geminiSelectPois,
} from "../lib/poi-select.js";
import { ORS_API_KEY } from "../config/env.js";

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

  const { coords, elevArr, ascent_m, descent_m, distance_km } = pickedData;
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

  const { distance_km, ascent_m, descent_m, coords, elevArr } =
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
        pois,
        ...(result.meta.overlap_ratio != null && {
          overlap_ratio: result.meta.overlap_ratio,
        }),
      },
    ],
  });
});
