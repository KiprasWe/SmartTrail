// controllers/routeGenerationController.js — directRouting and loopRouting handlers

import { asyncHandler } from "../utils/asyncHandler.js";
import { sendError, sendSuccess, Errors, Success } from "../utils/responses.js";
import { PROFILE_CONFIGS } from "../lib/profiles.js";
import { routeBbox, computeAscentDescent } from "../lib/geo.js";
import {
  fetchValhalla,
  valhallaToRouteData,
  enrichWithElevation,
} from "../lib/valhalla.js";
import {
  fetchORSDirections,
  buildAvoidMultiPolygon,
  orsFeatureToRouteData,
} from "../lib/ors.js";
import { fetchPOIsGooglePlaces } from "../lib/places.js";
import {
  DETOUR_FACTOR,
  NUM_BEARINGS,
  KEEP_TOP_VARIANTS,
  BUFFER_LADDER,
  buildPetalWaypoints,
  computeOverlapRatio,
  scoreAndPickPetalAnchors,
  fetchAreaPOIs,
} from "../lib/loop-algo.js";

const ORS_API_KEY = process.env.ORS_API_KEY;

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

  const { valhalla: valhallaConfig } = profileConfig;
  const locations = [start, ...waypoints, end];

  // Single Valhalla call with alternates:2 → up to 3 geometrically distinct routes.
  // Enrich each with real elevation via /height (fallback when elevation_interval
  // is not populated by the public instance), sort by actual ascent_m, pick best.
  const wantAlternates =
    elevationPreference !== "optimal" && waypoints.length === 0;

  let pickedData;
  try {
    const json = await fetchValhalla(
      valhallaConfig.costing,
      locations,
      valhallaConfig.options,
      { alternates: wantAlternates ? 2 : 0 },
    );

    const trips = [json.trip, ...((json.alternates ?? []).map((a) => a.trip))];

    if (wantAlternates && trips.length > 1) {
      const allData = await Promise.all(
        trips.map((trip) => enrichWithElevation(valhallaToRouteData(trip))),
      );
      const sorted = [...allData].sort((a, b) => a.ascent_m - b.ascent_m);
      if (elevationPreference === "flat") pickedData = sorted[0];
      else if (elevationPreference === "hilly")
        pickedData = sorted[sorted.length - 1];
      else pickedData = sorted[Math.floor(sorted.length / 2)]; // auto → middle
    } else {
      pickedData = await enrichWithElevation(valhallaToRouteData(json.trip));
    }
  } catch (err) {
    return sendError(res, {
      ...Errors.EXTERNAL_SERVICE_ERROR,
      message: `Route generation failed: ${err.message}`,
    });
  }

  const { coords, elevArr, ascent_m, descent_m, maneuvers, distance_km, duration_s } =
    pickedData;

  const pois = await fetchPOIsGooglePlaces(coords, poiTypes);

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
// No waypoints: petal algorithm builds teardrop loops in NUM_BEARINGS compass
// directions, routes each one as outbound + return with corridor exclusion,
// scores self-overlap, and returns the best variants.
//
// Waypoints provided: ORS routes start→stops, then returns with alternatives.

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

  // ── Branch: waypoints provided → ORS Directions ──────────────────────────────
  if (waypoints.length > 0) {
    const orsProfile = profileConfig.orsProfile;
    if (!ORS_API_KEY) {
      return sendError(res, {
        ...Errors.EXTERNAL_SERVICE_ERROR,
        message: "ORS_API_KEY is not configured",
      });
    }

    const lastWaypoint = waypoints[waypoints.length - 1];

    let outboundFeature;
    try {
      const outboundJson = await fetchORSDirections(orsProfile, [start, ...waypoints]);
      outboundFeature = outboundJson.features?.[0];
      if (!outboundFeature) throw new Error("ORS returned no outbound feature");
    } catch (err) {
      return sendError(res, {
        ...Errors.EXTERNAL_SERVICE_ERROR,
        message: `Outbound routing failed: ${err.message}`,
      });
    }
    const outboundData = orsFeatureToRouteData(outboundFeature);

    const RETURN_BUFFER_LADDER = [0.0015, 0.001, 0.0006, 0.0003, 0];
    let returnFeatures = [];
    let lastErr = null;
    for (const bufferDeg of RETURN_BUFFER_LADDER) {
      try {
        const avoidPolys =
          bufferDeg > 0
            ? buildAvoidMultiPolygon(outboundData.coords, bufferDeg)
            : null;
        const returnJson = await fetchORSDirections(
          orsProfile,
          [lastWaypoint, start],
          {
            alternativeRoutes: {
              target_count: 3,
              share_factor: 0.4,
              weight_factor: 2.0,
            },
            ...(avoidPolys && { options: { avoid_polygons: avoidPolys } }),
          },
        );
        returnFeatures = returnJson.features ?? [];
        if (returnFeatures.length) break;
      } catch (err) {
        lastErr = err;
      }
    }

    if (!returnFeatures.length) {
      return sendError(res, {
        ...Errors.EXTERNAL_SERVICE_ERROR,
        message: `Return routing failed: ${lastErr?.message ?? "no alternatives"}`,
      });
    }

    const variants = await Promise.all(
      returnFeatures.map(async (retFeat) => {
        const ret = orsFeatureToRouteData(retFeat);
        const coords = [...outboundData.coords, ...ret.coords.slice(1)];
        const elev = [...outboundData.elevArr, ...ret.elevArr.slice(1)];
        const maneuvers = [...outboundData.maneuvers, ...ret.maneuvers];
        const distance_km = +(outboundData.distance_km + ret.distance_km).toFixed(2);
        const duration_s = outboundData.duration_s + ret.duration_s;
        const ascent_m = outboundData.ascent_m + ret.ascent_m;
        const descent_m = outboundData.descent_m + ret.descent_m;
        const pois = await fetchPOIsGooglePlaces(coords, poiTypes);

        return {
          label: "loop",
          description: "Loop route",
          profile: profileConfig.label,
          distance_km,
          duration_s,
          ascent_m,
          descent_m,
          geometry: { type: "LineString", coordinates: coords },
          bbox: routeBbox(coords),
          elevation_profile: elev,
          maneuvers,
          pois,
          poi_routed: false,
        };
      }),
    );

    if (elevationPreference === "flat") {
      variants.sort((a, b) => a.ascent_m - b.ascent_m);
      variants.forEach((r, i) => {
        r.label = ["flattest", "alternative", "scenic"][i] ?? `alt_${i}`;
        r.description =
          ["Flattest loop", "Alternative loop", "Scenic loop"][i] ??
          "Alternative loop";
      });
    } else if (elevationPreference === "hilly") {
      variants.sort((a, b) => b.ascent_m - a.ascent_m);
      variants.forEach((r, i) => {
        r.label = ["hilliest", "moderate", "scenic"][i] ?? `alt_${i}`;
        r.description =
          ["Most elevation gain", "Moderate elevation", "Scenic loop"][i] ??
          "Alternative loop";
      });
    } else {
      variants.forEach((r, i) => {
        r.label = ["balanced", "alternative", "scenic"][i] ?? `alt_${i}`;
        r.description =
          ["Balanced loop", "Alternative loop", "Scenic loop"][i] ??
          "Alternative loop";
      });
    }

    console.log(
      `[loopRouting waypoints] returned ${variants.length} ORS variants — distances: ${variants.map((v) => v.distance_km).join(", ")} km`,
    );

    return sendSuccess(res, Success.ROUTE_GENERATED, {
      profile,
      elevation_preference: elevationPreference,
      poi_types_requested: poiTypes,
      routes: variants,
    });
  }

  // ── No waypoints → petal algorithm ──────────────────────────────────────────

  if (!ORS_API_KEY) {
    return sendError(res, {
      ...Errors.EXTERNAL_SERVICE_ERROR,
      message: "ORS_API_KEY is not configured",
    });
  }

  const detour = DETOUR_FACTOR[profile] ?? 1.35;
  const orsProfile = profileConfig.orsProfile;

  const bearings = Array.from(
    { length: NUM_BEARINGS },
    (_, i) => (i * 360) / NUM_BEARINGS,
  );
  const rawPetals = bearings.map((bearing) =>
    buildPetalWaypoints(start, distance, bearing, detour),
  );

  const areaRadius = (distance / detour) * 0.5;
  let areaPOIs = [];
  try {
    areaPOIs = await fetchAreaPOIs(start, areaRadius);
  } catch {
    areaPOIs = [];
  }

  let petals;
  try {
    petals = await Promise.all(
      rawPetals.map((p) =>
        scoreAndPickPetalAnchors(p, areaPOIs, elevationPreference),
      ),
    );
  } catch (err) {
    return sendError(res, {
      ...Errors.EXTERNAL_SERVICE_ERROR,
      message: `Loop waypoint generation failed: ${err.message}`,
    });
  }

  console.log(
    `[loopRouting] generated ${petals.length} petals for distance=${distance}m profile=${profile}`,
  );

  async function routePetal(petal) {
    const outboundLocs = [start, petal.outbound, petal.apexOut, petal.apexRet];
    const returnLocs = [petal.apexRet, petal.return, start];

    let outboundData;
    try {
      const outJson = await fetchORSDirections(orsProfile, outboundLocs);
      const feat = outJson.features?.[0];
      if (!feat) throw new Error("ORS returned no outbound feature");
      outboundData = orsFeatureToRouteData(feat);
    } catch (err) {
      throw new Error(`outbound leg failed: ${err.message}`);
    }

    for (const bufferDeg of BUFFER_LADDER) {
      try {
        const avoidPolys =
          bufferDeg > 0
            ? buildAvoidMultiPolygon(outboundData.coords, bufferDeg)
            : null;
        const retJson = await fetchORSDirections(orsProfile, returnLocs, {
          ...(avoidPolys && { options: { avoid_polygons: avoidPolys } }),
        });
        const retFeat = retJson.features?.[0];
        if (!retFeat) continue;
        const returnData = orsFeatureToRouteData(retFeat);
        const overlap_ratio = computeOverlapRatio(
          outboundData.coords,
          returnData.coords,
          25,
        );
        return { outboundData, returnData, overlap_ratio };
      } catch {
        // Try next buffer width.
      }
    }
    throw new Error("all buffer ladder attempts failed");
  }

  const routeResults = await Promise.allSettled(
    petals.map((petal) => routePetal(petal)),
  );
  const successful = routeResults
    .map((r, i) => ({ r, petal: petals[i] }))
    .filter(({ r }) => r.status === "fulfilled");

  if (!successful.length) {
    const msg = routeResults.find((r) => r.status === "rejected")?.reason?.message;
    return sendError(res, {
      ...Errors.EXTERNAL_SERVICE_ERROR,
      message: `All loop variants failed: ${msg}`,
    });
  }

  const targetKm = distance / 1000;

  function toCandidateObject({ outboundData, returnData, overlap_ratio }) {
    const coords = [...outboundData.coords, ...returnData.coords.slice(1)];
    const elevArr = [...outboundData.elevArr, ...returnData.elevArr.slice(1)];
    const maneuvers = [...outboundData.maneuvers, ...returnData.maneuvers];
    const distance_km = +(outboundData.distance_km + returnData.distance_km).toFixed(2);
    const duration_s = outboundData.duration_s + returnData.duration_s;
    const { ascent_m, descent_m } = computeAscentDescent(elevArr);
    const distanceError = Math.abs(distance_km - targetKm) / targetKm;
    return {
      coords,
      elevArr,
      maneuvers,
      distance_km,
      duration_s,
      ascent_m,
      descent_m,
      overlap_ratio,
      distanceError,
      compositeScore: 0.6 * overlap_ratio + 0.4 * distanceError,
    };
  }

  let candidates = successful
    .map(({ r }) => toCandidateObject(r.value))
    .filter((c) => c.distanceError <= 0.35)
    .sort((a, b) => a.compositeScore - b.compositeScore)
    .slice(0, KEEP_TOP_VARIANTS);

  // ── Adaptive retry ────────────────────────────────────────────────────────────
  if (candidates.length > 0 && candidates.every((c) => c.overlap_ratio > 0.65)) {
    console.log(
      `[loopRouting] all ${candidates.length} candidates have overlap > 0.65, retrying with deltaDeg=55`,
    );
    try {
      const wideRawPetals = bearings.map((b) =>
        buildPetalWaypoints(start, distance, b, detour, 55),
      );
      const widePetals = await Promise.all(
        wideRawPetals.map((p) =>
          scoreAndPickPetalAnchors(p, areaPOIs, elevationPreference),
        ),
      );
      const wideResults = await Promise.allSettled(
        widePetals.map((petal) => routePetal(petal)),
      );
      const wideSuccessful = wideResults
        .filter((r) => r.status === "fulfilled")
        .map((r) => toCandidateObject(r.value))
        .filter((c) => c.distanceError <= 0.35);

      if (wideSuccessful.length) {
        const merged = [...candidates, ...wideSuccessful];
        merged.sort((a, b) => a.compositeScore - b.compositeScore);
        candidates = merged.slice(0, KEEP_TOP_VARIANTS);
        console.log(
          `[loopRouting] after wide retry — best overlap: ${candidates[0].overlap_ratio.toFixed(2)}`,
        );
      }
    } catch (err) {
      console.warn(`[loopRouting] wide retry failed: ${err.message}`);
    }
  }

  if (!candidates.length) {
    // Fallback: use lowest-overlap regardless of distance.
    const fallback = successful
      .map(({ r }) => {
        const { outboundData, returnData, overlap_ratio } = r.value;
        const coords = [...outboundData.coords, ...returnData.coords.slice(1)];
        const elevArr = [...outboundData.elevArr, ...returnData.elevArr.slice(1)];
        const maneuvers = [...outboundData.maneuvers, ...returnData.maneuvers];
        const distance_km = +(outboundData.distance_km + returnData.distance_km).toFixed(2);
        const duration_s = outboundData.duration_s + returnData.duration_s;
        const { ascent_m, descent_m } = computeAscentDescent(elevArr);
        return { coords, elevArr, maneuvers, distance_km, duration_s, ascent_m, descent_m, overlap_ratio };
      })
      .sort((a, b) => a.overlap_ratio - b.overlap_ratio)
      .slice(0, KEEP_TOP_VARIANTS);
    candidates.push(...fallback);
  }

  console.log(
    `[loopRouting] kept ${candidates.length} variants — overlaps: ${candidates.map((c) => c.overlap_ratio.toFixed(2)).join(", ")}`,
  );

  const routes = await Promise.all(
    candidates.map(async (c, idx) => {
      const pois = await fetchPOIsGooglePlaces(c.coords, poiTypes);
      return {
        label: `loop_${idx}`,
        description: "Loop route",
        profile: profileConfig.label,
        distance_km: c.distance_km,
        duration_s: c.duration_s,
        ascent_m: c.ascent_m,
        descent_m: c.descent_m,
        geometry: { type: "LineString", coordinates: c.coords },
        bbox: routeBbox(c.coords),
        elevation_profile: c.elevArr,
        maneuvers: c.maneuvers,
        pois,
        overlap_ratio: +c.overlap_ratio.toFixed(3),
      };
    }),
  );

  if (elevationPreference === "flat") {
    routes.sort((a, b) => a.ascent_m - b.ascent_m);
    routes.forEach((r, i) => {
      r.label = ["flattest", "alternative", "scenic"][i];
      r.description = ["Flattest loop", "Alternative loop", "Scenic loop"][i];
    });
  } else if (elevationPreference === "hilly") {
    routes.sort((a, b) => b.ascent_m - a.ascent_m);
    routes.forEach((r, i) => {
      r.label = ["hilliest", "moderate", "scenic"][i];
      r.description = ["Most elevation gain", "Moderate elevation", "Scenic loop"][i];
    });
  } else {
    routes.forEach((r, i) => {
      r.label = ["balanced", "alternative", "scenic"][i];
      r.description = ["Balanced loop", "Alternative loop", "Scenic loop"][i];
    });
  }

  return sendSuccess(res, Success.ROUTE_GENERATED, {
    profile,
    elevation_preference: elevationPreference,
    poi_types_requested: poiTypes,
    routes,
  });
});
