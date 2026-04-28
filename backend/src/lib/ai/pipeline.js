// lib/ai/pipeline.js — AI route-generation orchestrator.
//
// Six stages, each emitted over SSE via onStage():
//   1. routing_skeleton — real ORS route we can build zones against
//   2. ai_pois          — reverse geocode + mode-conditional POI discovery
//   3. (mode detection — not a stage, runs with Stage 2)
//   4. (named resolution — not a stage, runs inline)
//   5. enriching        — intent decomp + ORS category search + pool assembly
//   6. curating         — Gemini tour-guide curation
//   7. routing          — final ORS call (A→B) or generateLoop() (loop)
//
// Keep this file a thin orchestrator. Anything that doesn't need the full
// pipeline state should move into one of the ai/* modules.

import { haversineM, routeBbox, polylineCorridorFilter } from "../geo.js";
import { generateLoop } from "../loop-algo.js";
import { reverseGeocodePlaceName, discoverAllPois } from "../places.js";
import { fetchORSDirections, orsFeatureToRouteData, buildORSElevationOpts } from "../ors.js";
import { PROFILE_CONFIGS } from "../profiles.js";
import { PipelineError, Errors } from "../../utils/responses.js";

import {
  dedupPois,
  genai,
  GEMINI_MODEL,
  ORS_API_KEY,
  ORS_WAYPOINT_CAP,
  PROFILE_FALLBACK_THEME,
} from "./shared.js";
import { buildRouteZones } from "./zones.js";
import {
  detectMode,
  runNamedPoiPrepass,
  getEffectiveTripDistance,
  decomposeIntent,
} from "./classify.js";
import { searchIntentsByZone } from "./search.js";
import { tourGuideCurate } from "./curate.js";
import {
  snapToSkeleton,
  sortPoisAlongLine,
  sortPoisAroundLoop,
  enrichedPoiToFeature,
  fetchORSWithFallback,
} from "./waypoints.js";
import { filterReachablePois } from "./reachability.js";

export async function runAiPipeline(params, { onStage = () => {} } = {}) {
  const {
    start,
    end,
    distance,
    waypoints: userWaypointCoords = [],
    profile = "foot-walking",
    elevationPreference = "optimal",
    area,
    preferences,
    lang = "en",
  } = params;

  // ── Validate ──
  const profileConfig = PROFILE_CONFIGS[profile];
  if (!profileConfig)
    throw new PipelineError(Errors.BAD_REQUEST, `Invalid profile.`);
  if (!Array.isArray(start) || start.length !== 2)
    throw new PipelineError(
      Errors.BAD_REQUEST,
      "start must be a [lng, lat] array",
    );

  const hasEnd = Array.isArray(end) && end.length === 2;
  if (!hasEnd && !(typeof distance === "number" && distance >= 500))
    throw new PipelineError(
      Errors.BAD_REQUEST,
      "Either end or distance (>=500m) is required",
    );
  if (!ORS_API_KEY)
    throw new PipelineError(
      Errors.EXTERNAL_SERVICE_ERROR,
      "ORS_API_KEY is not configured",
    );

  const tripDistanceM = hasEnd ? haversineM(start, end) : (distance ?? 10_000);
  const distanceKm = tripDistanceM / 1_000;
  const { orsProfile, label: profileLabel } = profileConfig;
  const orsElevOpts = buildORSElevationOpts(elevationPreference, orsProfile);

  const validUserWaypointCoords = (
    Array.isArray(userWaypointCoords) ? userWaypointCoords : []
  ).filter(
    (w) =>
      Array.isArray(w) && w.length === 2 && isFinite(w[0]) && isFinite(w[1]),
  );

  // ── Stage 1: Route skeleton ───────────────────────────────────────────────
  // Build the skeleton first so we have real geographic anchors for discovery.
  //
  // A→B: single ORS call through any user stops.
  // Loop: use the unified loop-algo generator (cleanTails + scaling + TSP
  //   for stops / circle|rectangle|figure8 for pure loops). The skeleton we
  //   get back is a real, routable loop — same shape the final route will
  //   take — so zones + discovery are built against it rather than a petal.
  onStage("routing_skeleton");

  let skeletonCoords = null;
  let skeletonDistanceM = 0;

  if (hasEnd) {
    try {
      const locs = [start, ...validUserWaypointCoords, end];
      const radiuses =
        validUserWaypointCoords.length > 0
          ? [-1, ...validUserWaypointCoords.map(() => 1500), -1]
          : undefined;
      const base = await fetchORSDirections(
        orsProfile,
        locs,
        radiuses ? { radiuses } : {},
      );
      const feat = base.features?.[0];
      skeletonCoords =
        feat?.geometry?.coordinates?.map((c) => [c[0], c[1]]) ?? null;
      skeletonDistanceM = feat?.properties?.summary?.distance ?? 0;
    } catch (err) {
      console.warn("[aiRouting] A→B skeleton failed:", err.message);
    }
  } else {
    try {
      const loopSkeleton = await generateLoop({
        start,
        targetM: tripDistanceM,
        orsProfile,
        orsElevOpts,
        stops: validUserWaypointCoords,
      });
      skeletonCoords = loopSkeleton.routeData.coords;
      skeletonDistanceM = loopSkeleton.routeData.distance_km * 1000;
    } catch (err) {
      console.warn(
        "[aiRouting] Loop skeleton via loop-algo failed:",
        err.message,
      );
    }
  }

  // ── Build geographic zones (needed for discovery bbox) ────────────────────
  let zones;
  if (hasEnd && skeletonCoords) {
    zones = buildRouteZones(skeletonCoords, distanceKm, start, end);
    console.log(
      `[aiRouting] Zones (${zones.length}): ${zones.map((z) => `"${z.label}" r=${(z.searchRadius / 1000).toFixed(1)}km`).join(" | ")}`,
    );
  } else {
    // Loop: use the skeleton coords (if we have them) to derive a search
    // centre + radius that actually matches the loop extent. Falls back to
    // haversine loop-radius if the skeleton call failed.
    const loopRadius = tripDistanceM / (2 * Math.PI);
    let loopCenter = start;
    let loopSearchRadius = Math.max(3_000, loopRadius * 1.5);

    if (skeletonCoords?.length) {
      let sumLng = 0;
      let sumLat = 0;
      for (const [lng, lat] of skeletonCoords) {
        sumLng += lng;
        sumLat += lat;
      }
      loopCenter = [
        sumLng / skeletonCoords.length,
        sumLat / skeletonCoords.length,
      ];
      const maxRadiusFromCenter = skeletonCoords.reduce(
        (max, c) => Math.max(max, haversineM(loopCenter, c)),
        0,
      );
      loopSearchRadius = Math.max(3_000, maxRadiusFromCenter * 1.2);
    }

    zones = [
      {
        label: "throughout the loop",
        anchor: loopCenter,
        searchCenter: loopCenter,
        searchRadius: loopSearchRadius,
        fraction: 0.5,
        isStart: true,
        isEnd: false,
        isCorridor: false,
      },
    ];
  }

  // ── Stage 2: Reverse geocode + mode-conditional discovery ──────────────────
  //
  // CATEGORY mode: skip broad Overpass discovery entirely — ORS category search
  //   is the primary source (runs in Stage 5). No noise, no corridor filter needed.
  //
  // NAMED / MIXED mode: run Overpass discovery first so Gemini can match user's
  //   free-text names against real OSM names (e.g. "pypliu" → "Pyplių piliakalnis").
  //
  // We don't know the mode yet, so we run a lightweight mode pre-check first
  // (just detects named vs category from the raw text, no pool needed), then
  // conditionally run discovery.
  onStage("ai_pois");

  const [placeStart, placeEnd] = await Promise.all([
    reverseGeocodePlaceName(start, lang).catch(() => null),
    hasEnd
      ? reverseGeocodePlaceName(end, lang).catch(() => null)
      : Promise.resolve(null),
  ]);

  if (placeStart) console.log(`[aiRouting] start → "${placeStart}"`);
  if (placeEnd) console.log(`[aiRouting] end   → "${placeEnd}"`);

  // Quick pre-check: does this request mention any named places?
  // We pass an empty pool — Gemini just classifies the text, no matching needed.
  const preCheck = await detectMode(preferences, genai, GEMINI_MODEL, []);
  const needsDiscovery = preCheck.mode === "named" || preCheck.mode === "mixed";

  const discoveredPois = await discoverAllPois({ start, end, hasEnd, zones });
  console.log(
    `[aiRouting] Discovery: ${discoveredPois.length} POIs (${needsDiscovery ? "named/mixed mode" : "category corridor fallback"})`,
  );

  // ── Stage 3: Mode detection — named/mixed gets real pool for name matching ──
  const { mode, namedPlaces, hasCategories } = needsDiscovery
    ? await detectMode(preferences, genai, GEMINI_MODEL, discoveredPois)
    : preCheck;

  console.log(
    `[aiRouting] Mode: ${mode.toUpperCase()} | named: [${namedPlaces.join(", ")}] | categories: ${hasCategories}`,
  );

  // ── Stage 4: Resolve named POIs against the pool ──────────────────────────
  const routeCenter = hasEnd
    ? [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]
    : start;

  const namedPois =
    mode === "named" || mode === "mixed"
      ? await runNamedPoiPrepass(
          namedPlaces,
          { routeCenter, start, end, hasEnd, lang },
          discoveredPois,
        )
      : [];

  const userNamedPlaceIds = new Set(
    namedPois.filter((p) => p.place_id).map((p) => p.place_id),
  );

  console.log(
    `[aiRouting] Named POI resolution: ${namedPois.length}/${namedPlaces.length} found`,
  );

  const effectiveTripDistanceM = getEffectiveTripDistance(
    tripDistanceM,
    namedPois.length,
  );
  const distanceCapped = effectiveTripDistanceM !== Infinity;

  console.log(
    `[aiRouting] Skeleton: ${(skeletonDistanceM / 1000).toFixed(1)} km | requested: ${distanceKm.toFixed(1)} km | ` +
      (distanceCapped
        ? `budget: ${((tripDistanceM - skeletonDistanceM) / 1000).toFixed(1)} km`
        : `budget: uncapped`),
  );

  const placesCtx = { start, end, hasEnd, lang };

  // ── Stage 5: Intent decomposition + POI search ────────────────────────────
  //
  // CATEGORY mode: intents → ORS category search (targeted, type-filtered).
  //   This IS the primary POI source. No discovery pool, no corridor filter.
  //   The route will be built through these POIs, widening as needed.
  //
  // NAMED mode: no intent search at all. Named POIs are the entire route.
  //   No gap fill — user knows exactly what they want.
  //
  // MIXED mode: named anchors already resolved. ORS category search fills
  //   gaps between anchors for the generic category parts of the request.
  onStage("enriching");

  const intents =
    mode !== "named"
      ? await decomposeIntent({
          mode,
          profileLabel,
          preferences,
          area,
          hasEnd,
          placeStart,
          placeEnd,
          distanceKm,
          lang,
          namedPlaces,
        }).catch(() => [])
      : [];

  const effectiveIntents = intents.length
    ? intents
    : mode === "category"
      ? [
          {
            theme:
              PROFILE_FALLBACK_THEME[profileLabel] ??
              "scenic viewpoints and landmarks",
            places_type: "tourist_attraction",
            location_scope: hasEnd ? "along_route" : "at_start",
            specific_area: "",
            count: 8,
          },
        ]
      : [];

  const categoryPois =
    mode !== "named" && effectiveIntents.length
      ? await searchIntentsByZone(effectiveIntents, zones, placesCtx)
      : [];

  console.log(
    `[aiRouting] Pool sources — category: ${categoryPois.length}, named: ${namedPois.length}, discovered: ${discoveredPois.length}`,
  );

  // ── User coordinate waypoints (always essential) ──
  const userWaypoints = validUserWaypointCoords.map(([lng, lat]) => ({
    lng,
    lat,
    name: "Must-stop",
    description: null,
    place_id: null,
    formatted_address: null,
    rating: null,
    user_rating_count: null,
    website_uri: null,
    google_maps_uri: null,
    types: [],
    primary_type: null,
    editorial_summary: null,
    photo_name: null,
    guide_note: null,
    essential: true,
    _isUserWaypoint: true,
  }));

  // ── Pool assembly — different strategy per mode ───────────────────────────
  //
  // CATEGORY: ORS category results only. No corridor filter — the route
  //   rebuilds through the waypoints, naturally widening to reach them.
  //   Loop detour filter still applies to keep loops sane.
  //
  // NAMED: named POIs only. No filler, no extras.
  //
  // MIXED: named anchors + category POIs for the gaps. Corridor filter
  //   applied only to category POIs (named anchors always bypass it).
  let enrichedPool;

  if (mode === "category") {
    const corridorCoords = skeletonCoords ?? (hasEnd ? [start, end] : [start]);
    const filteredDiscovered = skeletonCoords
      ? polylineCorridorFilter(discoveredPois, corridorCoords)
      : discoveredPois;

    // Always merge Overpass: ORS POI buffer is capped at 2km per zone, so
    // 3-zone routes have large gaps between covered areas. Overpass covers
    // the full corridor bbox and Gemini curation trims it to what fits.
    enrichedPool = dedupPois([...categoryPois, ...filteredDiscovered]);
    console.log(
      `[aiRouting] Category pool: ${categoryPois.length} ORS + ${filteredDiscovered.length} Overpass corridor (${enrichedPool.length} total)`,
    );
  } else if (mode === "named") {
    enrichedPool = namedPois;
  } else {
    const corridorCoords = skeletonCoords ?? (hasEnd ? [start, end] : [start]);
    const filteredCategoryPois = skeletonCoords
      ? polylineCorridorFilter(categoryPois, corridorCoords)
      : categoryPois;

    const mixedPool = dedupPois([...namedPois, ...filteredCategoryPois]);

    const namedIds = new Set(namedPois.map((p) => p.place_id));
    const reachabilityChecked = await filterReachablePois(
      mixedPool.filter((p) => !namedIds.has(p.place_id)),
      skeletonCoords,
      orsProfile,
      distanceKm,
    ).catch((err) => {
      console.warn(
        `[reachability] Failed, using unfiltered pool: ${err.message}`,
      );
      return mixedPool.filter((p) => !namedIds.has(p.place_id));
    });

    enrichedPool = dedupPois([...namedPois, ...reachabilityChecked]);
    console.log(
      `[aiRouting] Mixed pool: ${namedPois.length} anchors + ${reachabilityChecked.length} category (from ${categoryPois.length})`,
    );
  }

  const allPois = dedupPois([...enrichedPool, ...userWaypoints]);
  console.log(
    `[aiRouting] POI pool: ${allPois.length} total — ${allPois.map((p) => p.name).join(" | ") || "(none)"}`,
  );

  if (!enrichedPool.length && !userWaypoints.length) {
    throw new PipelineError(
      Errors.AI_GENERATION_FAILED,
      "No usable POIs found",
    );
  }

  // ── Stage 6: Curation ─────────────────────────────────────────────────────
  // Gemini now curates from real verified places — no hallucinated names,
  // no mismatched coordinates. The full place list is in its context.
  onStage("curating");

  const committedPois = namedPois.map((p) => ({ ...p, essential: true }));
  const committedIds = new Set(committedPois.map((p) => p.place_id));

  const curationPool = enrichedPool.filter(
    (p) => !committedIds.has(p.place_id),
  );

  let finalPois;
  const curatedPois = await tourGuideCurate({
    pois: curationPool,
    profileLabel,
    preferences,
    placeStart,
    placeEnd,
    hasEnd,
    distanceKm,
    lang,
    mode,
    namedPois,
    userNamedPlaceIds,
  });

  if (curatedPois) {
    finalPois = dedupPois([...committedPois, ...curatedPois, ...userWaypoints]);
    console.log(
      `[aiRouting] Using Gemini curation (${finalPois.length} total stops)`,
    );
  } else {
    console.warn("[aiRouting] Curation failed — falling back to rating rank");

    // ~1 stop per 4 km, hard-capped at 12. Committed/named/user waypoints
    // always survive; only AI essentials consume the budget.
    const maxEssentialStops = Math.max(
      2,
      Math.min(Math.round(distanceKm / 4), 12),
    );
    const aiEssentialBudget = Math.max(
      0,
      maxEssentialStops - committedPois.length,
    );

    const ranked = [...enrichedPool]
      .filter((p) => !committedIds.has(p.place_id))
      .sort(
        (a, b) =>
          (b.rating ?? 0) - (a.rating ?? 0) ||
          (b.user_rating_count ?? 0) - (a.user_rating_count ?? 0),
      );
    const rankedWithFlags = ranked.map((p, i) => ({
      ...p,
      guide_note: null,
      essential: userNamedPlaceIds.has(p.place_id)
        ? true
        : i < aiEssentialBudget,
    }));

    finalPois = dedupPois([
      ...committedPois,
      ...rankedWithFlags,
      ...userWaypoints,
    ]);
    console.log(
      `[aiRouting] Fallback rank: ${finalPois.length} stops ` +
        `(${committedPois.length} committed + ${aiEssentialBudget} AI-essential)`,
    );
  }

  // ── Sort and build features ──
  const allSorted = hasEnd
    ? sortPoisAlongLine(finalPois, start, end)
    : sortPoisAroundLoop(finalPois, start);

  const poiFeatures = allSorted.map(enrichedPoiToFeature);

  const essentialOrdered = allSorted.filter((p) => p.essential);
  const userWaypointsInEssential = essentialOrdered.filter(
    (p) => p._isUserWaypoint,
  );
  const aiEssentialOrdered = essentialOrdered.filter((p) => !p._isUserWaypoint);
  // For A→B: sortPoisAlongLine gives a good projection-based order.
  // For loops: generateLoop's internal TSP re-orders stops anyway.
  const waypointPois = [
    ...userWaypointsInEssential,
    ...aiEssentialOrdered.slice(
      0,
      ORS_WAYPOINT_CAP - userWaypointsInEssential.length,
    ),
  ];

  const waypointCoords = waypointPois.map((p) => {
    // Category mode: never snap — the route should bend through the POI,
    // not the POI be dragged back to the skeleton.
    // Named/user waypoints: always use exact coords.
    if (
      mode === "category" ||
      p._isUserWaypoint ||
      p._userNamed ||
      !skeletonCoords
    )
      return [p.lng, p.lat];
    return snapToSkeleton([p.lng, p.lat], skeletonCoords, profile);
  });

  console.log(
    `[aiRouting] Routing through ${waypointCoords.length} waypoints (${finalPois.length - waypointCoords.length} optional on map)`,
  );

  // ── A→B routing ──
  if (hasEnd) {
    onStage("routing", { mode: "a_to_b" });
    let orsResult;
    try {
      orsResult = await fetchORSWithFallback(
        orsProfile,
        start,
        waypointCoords,
        end,
        orsElevOpts,
        userWaypointsInEssential.length,
      );
    } catch (err) {
      throw new PipelineError(
        Errors.EXTERNAL_SERVICE_ERROR,
        `Route generation failed: ${err.message}`,
      );
    }
    const feature = orsResult.features?.[0];
    if (!feature)
      throw new PipelineError(
        Errors.EXTERNAL_SERVICE_ERROR,
        "ORS returned no route",
      );
    const routeData = orsFeatureToRouteData(feature);
    console.log(
      `[aiRouting] A→B final: ${routeData.distance_km} km (skeleton was ${(skeletonDistanceM / 1000).toFixed(1)} km)`,
    );
    return {
      profile,
      elevation_preference: elevationPreference,
      poi_types_requested: [],
      routing_mode: mode,
      ai_plan: { pois: poiFeatures },
      routes: [
        {
          label: "recommended",
          description: "AI Tour Guide route",
          profile: profileLabel,
          distance_km: routeData.distance_km,
          duration_s: routeData.duration_s,
          ascent_m: routeData.ascent_m,
          descent_m: routeData.descent_m,
          geometry: { type: "LineString", coordinates: routeData.coords },
          bbox: routeBbox(routeData.coords),
          elevation_profile: routeData.elevArr,
          maneuvers: routeData.maneuvers,
          pois: poiFeatures,
        },
      ],
    };
  }

  // ── Loop routing ──
  onStage("routing", { mode: "loop" });
  let loopResult;
  try {
    loopResult = await generateLoop({
      start,
      targetM: tripDistanceM,
      orsProfile,
      orsElevOpts,
      stops: waypointCoords,
    });
  } catch (err) {
    throw new PipelineError(
      Errors.EXTERNAL_SERVICE_ERROR,
      `Loop routing failed: ${err.message}`,
    );
  }
  const loopData = loopResult.routeData;
  console.log(
    `[aiRouting] Loop final: ${loopData.distance_km} km | requested: ${distanceKm.toFixed(1)} km | ` +
      `accuracy: ${((loopData.distance_km / distanceKm) * 100).toFixed(0)}% | ascent: ${loopData.ascent_m} m`,
  );
  return {
    profile,
    elevation_preference: elevationPreference,
    poi_types_requested: [],
    routing_mode: mode,
    ai_plan: { pois: poiFeatures },
    controlPoints: loopResult.controlPoints,
    loop_meta: loopResult.meta,
    routes: [
      {
        label: "loop",
        description: "AI Tour Guide loop",
        profile: profileLabel,
        distance_km: loopData.distance_km,
        duration_s: loopData.duration_s,
        ascent_m: loopData.ascent_m,
        descent_m: loopData.descent_m,
        geometry: { type: "LineString", coordinates: loopData.coords },
        bbox: routeBbox(loopData.coords),
        elevation_profile: loopData.elevArr,
        maneuvers: loopData.maneuvers,
        pois: poiFeatures,
        ...(loopResult.meta.overlap_ratio != null && {
          overlap_ratio: loopResult.meta.overlap_ratio,
        }),
      },
    ],
  };
}
