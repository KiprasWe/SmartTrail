// controllers/routeGenerationController.js — directRouting and loopRouting handlers

import { asyncHandler } from "../utils/asyncHandler.js";
import { sendError, sendSuccess, Errors, Success } from "../utils/responses.js";
import { PROFILE_CONFIGS } from "../lib/profiles.js";
import { routeBbox, computeAscentDescent } from "../lib/geo.js";
import {
  fetchORSDirections,
  fetchORSRoundTrip,
  orsFeatureToRouteData,
  buildORSElevationOpts,
  fetchRoutePois,
} from "../lib/ors.js";

const ORS_API_KEY = process.env.ORS_API_KEY;

// ─── ORS POI helpers ──────────────────────────────────────────────────────────

// Valid ORS category_group_ids: 100,120,130,150,160,190,200,220,260,330,360,390,420,560,580,620
// Max 5 per request — deduplication handled in fetchPoiFeatures.
const ORS_CATEGORY_GROUP_MAP = {
  nature:        [330],
  tourism:       [220, 330],
  historic:      [220],
  food:          [100],
  arts_culture:  [220],
  leisure:       [620],
  facilities:    [200],
  public_places: [200],
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
      name: props.osm_tags?.name || props.name || catEntry?.category_name || null,
      category: catEntry?.category_name ?? null,
      rating: null,
      user_rating_count: null,
      photo_name: null,
      editorial_summary: null,
    },
  };
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

// ─── A-to-B routing ───────────────────────────────────────────────────────────

export const directRouting = asyncHandler(async (req, res) => {
  const {
    start,
    end,
    profile = "walking",
    poiTypes = [],
    elevationPreference = "optimal",
    waypoints = [],
    variantLabel,
  } = req.body;

  const profileConfig = PROFILE_CONFIGS[profile];
  if (!profileConfig) {
    return sendError(res, {
      ...Errors.BAD_REQUEST,
      message: `Invalid profile. Allowed: ${Object.keys(PROFILE_CONFIGS).join(", ")}`,
    });
  }

  if (
    !Array.isArray(start) ||
    start.length !== 2 ||
    !Array.isArray(end) ||
    end.length !== 2
  ) {
    return sendError(res, {
      ...Errors.BAD_REQUEST,
      message: "start and end must be [lng, lat] arrays",
    });
  }

  if (!["flat", "optimal", "hilly", "auto"].includes(elevationPreference)) {
    return sendError(res, {
      ...Errors.BAD_REQUEST,
      message: "elevationPreference must be flat | optimal | hilly | auto",
    });
  }

  const locations = [start, ...waypoints, end];
  const orsElevOpts = buildORSElevationOpts(elevationPreference, profileConfig.orsProfile);
  const needsElevPick = elevationPreference === "flat" || elevationPreference === "hilly";

  let pickedData;
  try {
    // For simple A→B (no intermediate waypoints) with a flat/hilly preference,
    // request up to 3 alternative routes and pick the one with the least/most
    // ascent. ORS alternative_routes only works with exactly 2 coordinates.
    if (waypoints.length === 0 && needsElevPick) {
      const orsResult = await fetchORSDirections(
        profileConfig.orsProfile,
        locations,
        {
          ...orsElevOpts,
          alternativeRoutes: { target_count: 3, weight_factor: 1.6, share_factor: 0.4 },
        },
      );
      const features = orsResult.features ?? [];
      if (!features.length) throw new Error("ORS returned no route");

      const candidates = features.map((f) => orsFeatureToRouteData(f));
      pickedData = candidates.reduce((best, c) =>
        elevationPreference === "flat"
          ? (c.ascent_m < best.ascent_m ? c : best)
          : (c.ascent_m > best.ascent_m ? c : best),
      );

      console.log(
        `[directRouting] picked ${elevationPreference} from ${candidates.length} alternatives — ` +
        `ascents: ${candidates.map((c) => c.ascent_m + "m").join(" / ")} → chose ${pickedData.ascent_m}m`,
      );
    } else {
      // With waypoints or optimal/auto: single route with ORS elevation opts
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

  const { coords, elevArr, ascent_m, descent_m, maneuvers, distance_km, duration_s } =
    pickedData;

  const pois = await fetchPoiFeatures(coords, poiTypes);

  const route = {
    label: "recommended",
    description: "Recommended route",
    profile: profileConfig.label,
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

// ─── Loop (round-trip) routing ────────────────────────────────────────────────
//
// No waypoints: ORS round_trip option — targets the requested distance directly
// and generates a circular route. Multiple seeds explored in parallel; the
// result closest to the target distance is returned.
//
// Waypoints provided: routed as a single closed polygon [start → stops → start].
// Distance is determined by the stops the user chose.

export const loopRouting = asyncHandler(async (req, res) => {
  const {
    start,
    distance,
    profile = "foot-walking",
    poiTypes = [],
    elevationPreference = "optimal",
    waypoints = [],
  } = req.body;

  const profileConfig = PROFILE_CONFIGS[profile];
  if (!profileConfig) {
    return sendError(res, {
      ...Errors.BAD_REQUEST,
      message: `Invalid profile. Allowed: ${Object.keys(PROFILE_CONFIGS).join(", ")}`,
    });
  }

  if (typeof distance !== "number" || distance < 500 || distance > 200_000) {
    return sendError(res, {
      ...Errors.BAD_REQUEST,
      message: "distance must be between 500 m and 200 000 m",
    });
  }

  if (!ORS_API_KEY) {
    return sendError(res, {
      ...Errors.EXTERNAL_SERVICE_ERROR,
      message: "ORS_API_KEY is not configured",
    });
  }

  const orsProfile = profileConfig.orsProfile;
  const orsElevOpts = buildORSElevationOpts(elevationPreference, orsProfile);

  // ── With waypoints: single closed-loop call through user's stops ─────────────
  if (waypoints.length > 0) {
    let routeData;
    try {
      const orsResult = await fetchORSDirections(
        orsProfile,
        [start, ...waypoints, start],
        orsElevOpts,
      );
      const feat = orsResult.features?.[0];
      if (!feat) throw new Error("ORS returned no route");
      routeData = orsFeatureToRouteData(feat);
    } catch (err) {
      return sendError(res, {
        ...Errors.EXTERNAL_SERVICE_ERROR,
        message: `Loop routing failed: ${err.message}`,
      });
    }

    const pois = await fetchPoiFeatures(routeData.coords, poiTypes);
    console.log(
      `[loopRouting waypoints] distance=${routeData.distance_km} km ascent=${routeData.ascent_m} m`,
    );

    return sendSuccess(res, Success.ROUTE_GENERATED, {
      profile,
      elevation_preference: elevationPreference,
      poi_types_requested: poiTypes,
      routes: [
        {
          label: "loop",
          description: "Loop route",
          profile: profileConfig.label,
          distance_km: routeData.distance_km,
          duration_s: routeData.duration_s,
          ascent_m: routeData.ascent_m,
          descent_m: routeData.descent_m,
          geometry: { type: "LineString", coordinates: routeData.coords },
          bbox: routeBbox(routeData.coords),
          elevation_profile: routeData.elevArr,
          maneuvers: routeData.maneuvers,
          pois,
        },
      ],
    });
  }

  // ── No waypoints: ORS round_trip, multiple seeds → pick closest to target ────
  const SEEDS = [0, 1, 2, 3, 4];
  const results = await Promise.allSettled(
    SEEDS.map((seed) => fetchORSRoundTrip(orsProfile, start, distance, seed, orsElevOpts)),
  );

  const candidates = results
    .filter((r) => r.status === "fulfilled")
    .flatMap((r) => r.value.features ?? [])
    .map((f) => orsFeatureToRouteData(f))
    .filter((c) => c.distance_km > 0);

  if (!candidates.length) {
    const err = results.find((r) => r.status === "rejected")?.reason;
    return sendError(res, {
      ...Errors.EXTERNAL_SERVICE_ERROR,
      message: `Loop generation failed: ${err?.message ?? "ORS returned no routes"}`,
    });
  }

  const targetKm = distance / 1000;
  const best = candidates.sort(
    (a, b) =>
      Math.abs(a.distance_km - targetKm) - Math.abs(b.distance_km - targetKm),
  )[0];

  console.log(
    `[loopRouting] best — distance=${best.distance_km} km (target ${targetKm} km) ascent=${best.ascent_m} m`,
  );

  const pois = await fetchPoiFeatures(best.coords, poiTypes);

  return sendSuccess(res, Success.ROUTE_GENERATED, {
    profile,
    elevation_preference: elevationPreference,
    poi_types_requested: poiTypes,
    routes: [
      {
        label: "loop",
        description: "Loop route",
        profile: profileConfig.label,
        distance_km: best.distance_km,
        duration_s: best.duration_s,
        ascent_m: best.ascent_m,
        descent_m: best.descent_m,
        geometry: { type: "LineString", coordinates: best.coords },
        bbox: routeBbox(best.coords),
        elevation_profile: best.elevArr,
        maneuvers: best.maneuvers,
        pois,
      },
    ],
  });
});
