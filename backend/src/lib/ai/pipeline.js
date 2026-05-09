// lib/ai/pipeline.js — AI route-generation orchestrator.
//
// Stages:
//   1. ai_pois    — classify intent + reverse geocode + ground named places
//   2. enriching  — ORS corridor search + build curation pool
//   3. curating   — Gemini tour-guide curation
//   4. routing    — final ORS call with selected waypoints
//
// Gemini calls per request:
//   category mode: 2  (classifyAndDecompose + tourGuideCurate)
//   named mode:    2  (classifyAndDecompose + Maps grounding)
//   mixed mode:    3  (classifyAndDecompose + Maps grounding + tourGuideCurate)

import { haversineM, routeBbox } from "../geo.js";
import { generateLoop } from "../loop-algo.js";
import {
  reverseGeocodePlaceName,
  searchAreaByCategories,
  collectCategoryIds,
} from "../places.js";
import {
  orsFeatureToRouteData,
  buildORSElevationOpts,
} from "../ors.js";
import { PROFILE_CONFIGS, calcDuration } from "../profiles.js";
import { PipelineError, Errors } from "../../utils/responses.js";
import {
  dedupPois,
  ORS_API_KEY,
  ORS_WAYPOINT_CAP,
  PROFILE_FALLBACK_THEME,
} from "./shared.js";
import { createAiTrace } from "./trace.js";
import { classifyAndDecompose } from "./classify.js";
import { tourGuideCurate } from "./curate.js";
import {
  sortPoisAlongLine,
  sortPoisAroundLoop,
  enrichedPoiToFeature,
  fetchORSWithFallback,
} from "./waypoints.js";
import { resolveNamedPlacesWithGrounding } from "./grounding.js";

function dedupPoisWithTrace(pois, trace, label = "dedup") {
  if (!Array.isArray(pois) || !trace?.enabled) return dedupPois(pois);
  const before = pois.length;
  const byId = new Map();
  const duplicates = [];
  for (const p of pois) {
    const id = p?.place_id;
    if (!id) continue;
    if (byId.has(id)) duplicates.push(p);
    else byId.set(id, p);
  }
  const deduped = dedupPois(pois);
  trace.summary(label, {
    before,
    after: deduped.length,
    dropped_count: before - deduped.length,
    duplicate_place_ids_sample: duplicates
      .map((p) => p?.place_id)
      .filter(Boolean)
      .slice(0, 40),
  });
  return deduped;
}

function inferTravelHeadingFromText(text, lang = "en") {
  if (!text || typeof text !== "string") return 0;
  const t = text.toLowerCase();
  const has = (re) => re.test(t);

  if (has(/\b(north[\s-]?east|ne)\b/)) return 2;
  if (has(/\b(south[\s-]?east|se)\b/)) return 4;
  if (has(/\b(south[\s-]?west|sw)\b/)) return 6;
  if (has(/\b(north[\s-]?west|nw)\b/)) return 8;
  if (has(/\bnorth(ern)?\b/)) return 1;
  if (has(/\beast(ern)?\b/)) return 3;
  if (has(/\bsouth(ern)?\b/)) return 5;
  if (has(/\bwest(ern)?\b/)) return 7;

  if (lang === "lt") {
    if (has(/šiaur(?:ė|es|ėje|in|inę|inėj|inėje)/)) return 1;
    if (has(/piet(?:ūs|u|uose|in|inę|inėj|inėje)/)) return 5;
    if (has(/ryt(?:ai|ų|uose|in|inę|inėj|inėje)/)) return 3;
    if (has(/vakar(?:ai|ų|uose|in|inę|inėj|inėje)/)) return 7;
  }

  return 0;
}

function pickLoopTravelHeading({ preferences, intents, lang }) {
  const fromIntents = Array.isArray(intents)
    ? intents.find((i) => Number(i?.travel_heading) > 0)?.travel_heading
    : 0;
  const intentHeading = Math.max(0, Math.min(Number(fromIntents) || 0, 8));
  if (intentHeading) return intentHeading;
  return inferTravelHeadingFromText(preferences, lang);
}

export async function runAiPipeline(params, { onStage = () => {} } = {}) {
  const {
    start,
    end,
    distance,
    waypoints: userWaypointCoords = [],
    profile = "foot-walking",
    elevationPreference = "moderate",
    area,
    preferences,
    lang = "en",
  } = params;

  const profileConfig = PROFILE_CONFIGS[profile];
  if (!profileConfig)
    throw new PipelineError(Errors.BAD_REQUEST, `Invalid profile.`);
  if (!Array.isArray(start) || start.length !== 2)
    throw new PipelineError(Errors.BAD_REQUEST, "start must be a [lng, lat] array");

  const hasEnd = Array.isArray(end) && end.length === 2;
  if (!hasEnd && !(typeof distance === "number" && distance >= 500))
    throw new PipelineError(Errors.BAD_REQUEST, "Either end or distance (>=500m) is required");
  if (!ORS_API_KEY)
    throw new PipelineError(Errors.EXTERNAL_SERVICE_ERROR, "ORS_API_KEY is not configured");

  const tripDistanceM = hasEnd ? haversineM(start, end) : (distance ?? 10_000);
  const distanceKm = tripDistanceM / 1_000;
  const { orsProfile, label: profileLabel } = profileConfig;
  const orsElevOpts = buildORSElevationOpts(elevationPreference, orsProfile);

  const validUserWaypointCoords = (Array.isArray(userWaypointCoords) ? userWaypointCoords : [])
    .filter((w) => Array.isArray(w) && w.length === 2 && isFinite(w[0]) && isFinite(w[1]));

  const trace = createAiTrace();
  trace.stage("start", {
    hasEnd,
    profile,
    elevationPreference,
    distanceKm,
    user_waypoints_count: validUserWaypointCoords.length,
    lang,
  });

  onStage("ai_pois");
  trace.stage("ai_pois");

  const [placeStart, placeEnd] = await Promise.all([
    reverseGeocodePlaceName(start, lang).catch(() => null),
    hasEnd ? reverseGeocodePlaceName(end, lang).catch(() => null) : Promise.resolve(null),
  ]);

  if (placeStart) console.log(`[aiRouting] start → "${placeStart}"`);
  if (placeEnd)   console.log(`[aiRouting] end   → "${placeEnd}"`);
  console.log(`[aiRouting] prompt → "${preferences?.trim() || "(none)"}"`);

  const classified = await classifyAndDecompose({
    preferences, profileLabel, area, hasEnd,
    placeStart, placeEnd, distanceKm, lang,
    trace,
  });
  const { mode } = classified;
  const normalizePlaceToken = (s) =>
    String(s ?? "")
      .trim()
      .toLowerCase()
      .replace(/[.,/#!$%^&*;:{}=\-_`~()'"“”‘’]/g, "")
      .replace(/\s+/g, " ");

  // If the user mentions the start/end city names in preferences ("Vilnius", "Trakai"),
  // Gemini can treat them as "named places". We already know start/end from coordinates,
  // so we remove these to avoid committing redundant anchors.
  const startToken = normalizePlaceToken(placeStart);
  const endToken = normalizePlaceToken(placeEnd);
  const namedPlaces = (classified.namedPlaces ?? []).filter((n) => {
    const t = normalizePlaceToken(n);
    if (!t) return false;
    if (startToken && t === startToken) return false;
    if (endToken && t === endToken) return false;
    return true;
  });

  const intents = classified.intents.length
    ? classified.intents
    : mode !== "named"
      ? [{
          theme: PROFILE_FALLBACK_THEME[profileLabel] ?? "scenic viewpoints and landmarks",
          places_type: "tourism",
          count: 8,
          travel_heading: 0,
        }]
      : [];

  const loopTravelHeading = !hasEnd
    ? pickLoopTravelHeading({ preferences, intents, lang })
    : 0;

  console.log(
    `[aiRouting] Mode: ${mode.toUpperCase()} | named: [${namedPlaces.join(", ")}] | intents: ${intents.length}`,
  );
  if (intents.length) {
    console.log(
      `[aiRouting] categories:\n` +
        intents.map((i) => `  • ${i.places_type || "(any)"} — "${i.theme}" (count=${i.count})`).join("\n"),
    );
  }

  onStage("enriching");
  trace.stage("enriching", {
    mode,
    named_places_count: namedPlaces.length,
    intents_count: intents.length,
  });

  const tripBbox = hasEnd ? routeBbox([start, end]) : null;

  const [groundedNamedPois, categoryPois] = await Promise.all([
    (mode === "named" || mode === "mixed") && namedPlaces.length
      ? resolveNamedPlacesWithGrounding(namedPlaces, start, {
          lang,
          bbox: tripBbox,
          maxCandidates: 3,
          trace,
        })
      : Promise.resolve([]),

    mode !== "named" && intents.length
      ? searchAreaByCategories(
          start,
          hasEnd ? end : null,
          tripDistanceM,
          collectCategoryIds(intents),
          hasEnd,
          trace,
        ).catch((err) => {
          console.warn(`[aiRouting] Area search failed: ${err.message}`);
          return [];
        })
      : Promise.resolve([]),
  ]);

  if (namedPlaces.length > 0 && groundedNamedPois.length < namedPlaces.length) {
    const found = new Set(groundedNamedPois.map((p) => p.name.toLowerCase()));
    const missing = namedPlaces.filter((n) => !found.has(n.toLowerCase()));
    if (missing.length > 0)
      console.warn(`[aiRouting] Could not locate: ${missing.join(", ")} — proceeding without them`);
  }

  console.log(
    `[aiRouting] POIs — category: ${categoryPois.length}, named: ${groundedNamedPois.length}`,
  );
  trace.summary("poi_sources", {
    mode,
    named_requested: namedPlaces,
    named_resolved_count: groundedNamedPois.length,
    category_pois_count: categoryPois.length,
    category_group_ids: mode !== "named" ? collectCategoryIds(intents) : [],
  });

  const userWaypoints = validUserWaypointCoords.map(([lng, lat]) => ({
    lng, lat, name: "Must-stop", description: null, place_id: null,
    formatted_address: null, rating: null, user_rating_count: null,
    website_uri: null, google_maps_uri: null, types: [], primary_type: null,
    editorial_summary: null, photo_name: null, guide_note: null,
    essential: true, _isUserWaypoint: true,
  }));

  let enrichedPool;
  if (mode === "named") {
    enrichedPool = groundedNamedPois;
  } else if (mode === "mixed") {
    enrichedPool = dedupPoisWithTrace([...groundedNamedPois, ...categoryPois], trace, "dedup_enriched_pool_mixed");
  } else {
    enrichedPool = categoryPois;
  }
  trace.summary("enriched_pool", {
    mode,
    enriched_pool_count: enrichedPool.length,
    grounded_named_count: groundedNamedPois.length,
    category_count: categoryPois.length,
  });

  if (!enrichedPool.length && !userWaypoints.length)
    throw new PipelineError(Errors.AI_GENERATION_FAILED, "No usable POIs found");

  onStage("curating");
  trace.stage("curating");

  // Named places are always committed (essential); only category pool goes to Gemini
  const committedPois = groundedNamedPois.map((p) => ({ ...p, essential: true }));
  const committedIds = new Set(committedPois.map((p) => p.place_id));
  const curationPoolLimit = 1000;
  const curationCandidates = enrichedPool.filter((p) => !committedIds.has(p.place_id));

  const scoreCurationPoi = (p) => {
    const hasWebsite = typeof p.website_uri === "string" && p.website_uri.trim().length > 0;
    const hasWiki =
      (typeof p.wikipedia_uri === "string" && p.wikipedia_uri.trim().length > 0) ||
      (typeof p.wikidata === "string" && p.wikidata.trim().length > 0);
    const rating = Number.isFinite(p.rating) ? p.rating : 0;
    const pop = Number.isFinite(p.user_rating_count) ? Math.log10(1 + Math.max(0, p.user_rating_count)) : 0;
    // Strongly prefer POIs with rich metadata (website/wiki) to reduce random low-signal places.
    return (hasWebsite ? 100 : 0) + (hasWiki ? 140 : 0) + rating * 10 + pop * 6;
  };

  const rankedCurationCandidates = [...curationCandidates]
    .map((p) => ({ p, score: scoreCurationPoi(p) }))
    .sort((a, b) => b.score - a.score);

  const curationPool = rankedCurationCandidates.slice(0, curationPoolLimit).map(({ p }) => p);
  const userNamedPlaceIds = new Set(groundedNamedPois.filter((p) => p.place_id).map((p) => p.place_id));
  trace.summary("curation_pool", {
    committed_count: committedPois.length,
    enriched_pool_count: enrichedPool.length,
    curation_pool_count: curationPool.length,
    curation_pool_trimmed_to: curationPoolLimit,
    curation_candidates_count: curationCandidates.length,
    user_waypoints_count: userWaypoints.length,
  });

  // Optional verbose dump to inspect what made it into the Gemini pool.
  // Enable with: AI_TRACE=1 AI_TRACE_POOL_DUMP=1
  const poolDumpEnabled = String(process.env.AI_TRACE_POOL_DUMP ?? "").trim() === "1";
  if (trace.enabled && poolDumpEnabled) {
    const dumpN = Math.max(0, Math.min(Number(process.env.AI_TRACE_POOL_DUMP_N) || 60, 500));
    const cutN = Math.max(0, Math.min(Number(process.env.AI_TRACE_POOL_DUMP_CUT_N) || 20, 200));
    const top = rankedCurationCandidates.slice(0, dumpN);
    const cut = rankedCurationCandidates.slice(curationPoolLimit, curationPoolLimit + cutN);

    const row = ({ p, score }, idx, kind) => {
      const hasWebsite = typeof p.website_uri === "string" && p.website_uri.trim().length > 0;
      const hasWiki =
        (typeof p.wikipedia_uri === "string" && p.wikipedia_uri.trim().length > 0) ||
        (typeof p.wikidata === "string" && p.wikidata.trim().length > 0);
      return {
        kind, // "included_top" or "cut_after_limit"
        rank: idx + 1,
        score,
        place_id: p.place_id ?? null,
        name: p.name ?? null,
        primary_type: p.primary_type ?? null,
        website_uri: hasWebsite ? p.website_uri : null,
        wikipedia_uri: p.wikipedia_uri ?? null,
        wikidata: p.wikidata ?? null,
        meta_flags: { hasWebsite, hasWiki },
        rating: p.rating ?? null,
        user_rating_count: p.user_rating_count ?? null,
      };
    };

    console.log(
      `[aiPool] ${JSON.stringify({
        traceId: trace.id,
        stage: "pre_gemini_pool",
        limit: curationPoolLimit,
        candidates: rankedCurationCandidates.length,
        dumpTopN: top.length,
        dumpCutN: cut.length,
      })}`,
    );
    top.forEach((x, i) => console.log(`[aiPool] ${JSON.stringify(row(x, i, "included_top"))}`));
    cut.forEach((x, i) => console.log(`[aiPool] ${JSON.stringify(row(x, i, "cut_after_limit"))}`));
  }

  let finalPois;

  if (curationPool.length > 0) {
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
      namedPois: groundedNamedPois,
      userNamedPlaceIds,
      trace,
    });

    if (curatedPois) {
      finalPois = dedupPoisWithTrace(
        [...committedPois, ...curatedPois, ...userWaypoints],
        trace,
        "dedup_final_pois_after_curation",
      );
      console.log(`[aiRouting] Curation: ${finalPois.length} total stops`);
      trace.summary("final_pois_after_curation", {
        final_count: finalPois.length,
        committed_count: committedPois.length,
        curated_count: curatedPois.length,
        user_waypoints_count: userWaypoints.length,
      });
    } else {
      console.warn("[aiRouting] Curation failed — falling back to rating rank");
      const maxStops = Math.max(2, Math.min(Math.round(distanceKm / 4), 12));
      const budget = Math.max(0, maxStops - committedPois.length);
      const ranked = [...enrichedPool]
        .filter((p) => !committedIds.has(p.place_id))
        .sort((a, b) =>
          (b.rating ?? 0) - (a.rating ?? 0) ||
          (b.user_rating_count ?? 0) - (a.user_rating_count ?? 0),
        )
        .map((p, i) => ({
          ...p,
          guide_note: null,
          essential: userNamedPlaceIds.has(p.place_id) ? true : i < budget,
        }));
      finalPois = dedupPois([...committedPois, ...ranked, ...userWaypoints]);
      console.log(`[aiRouting] Fallback rank: ${finalPois.length} stops`);
      trace.summary("final_pois_after_fallback_rank", {
        maxStops,
        budget_for_ai_essential: budget,
        final_count: finalPois.length,
        committed_count: committedPois.length,
        ranked_count: ranked.length,
        user_waypoints_count: userWaypoints.length,
      });
    }
  } else {
    finalPois = dedupPoisWithTrace(
      [...committedPois, ...userWaypoints],
      trace,
      "dedup_final_pois_named_only",
    );
  }

  const allSorted = hasEnd
    ? sortPoisAlongLine(finalPois, start, end)
    : sortPoisAroundLoop(finalPois, start);

  const essentialOrdered = allSorted.filter((p) => p.essential);
  const userWaypointsInEssential = essentialOrdered.filter((p) => p._isUserWaypoint);
  const aiEssentialOrdered = essentialOrdered.filter((p) => !p._isUserWaypoint);
  // Ensure every essential stop actually influences the routed path.
  // Otherwise short trips can mark something "essential" but then drop it from ORS waypoints.
  const computedCap = Math.round(distanceKm / 7);
  const essentialCount = essentialOrdered.length;
  const waypointCap = Math.max(2, Math.min(Math.max(computedCap, essentialCount), ORS_WAYPOINT_CAP));
  const waypointPois = [
    ...userWaypointsInEssential,
    ...aiEssentialOrdered.slice(0, waypointCap - userWaypointsInEssential.length),
  ];
  const droppedEssentialDueToCap = aiEssentialOrdered.slice(
    Math.max(0, waypointCap - userWaypointsInEssential.length),
  );
  if (droppedEssentialDueToCap.length) {
    droppedEssentialDueToCap.slice(0, 40).forEach((p) =>
      trace.poiDecision("waypoint_drop_due_to_cap", p, { reason: "ors_waypoint_cap" }),
    );
  }
  const waypointCoords = waypointPois.map((p) => [p.lng, p.lat]);
  trace.summary("waypoint_selection", {
    essential_total: essentialOrdered.length,
    essential_user_waypoints: userWaypointsInEssential.length,
    essential_ai: aiEssentialOrdered.length,
    waypoint_cap: waypointCap,
    waypoint_selected: waypointPois.length,
    waypoint_dropped_due_to_cap: droppedEssentialDueToCap.length,
  });

  // Mark which POIs are actual ORS waypoints so the frontend seeds correctly.
  const waypointPlaceIds = new Set(waypointPois.map((p) => p.place_id).filter(Boolean));
  const poiFeatures = allSorted.map((poi, i) => {
    const feat = enrichedPoiToFeature(poi, i);
    feat.properties.is_route_waypoint = waypointPlaceIds.has(poi.place_id);
    return feat;
  });

  console.log(`[aiRouting] Routing through ${waypointCoords.length} waypoints`);
  trace.metric("ors_waypoints_count", waypointCoords.length, { waypoint_cap: waypointCap });

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
      throw new PipelineError(Errors.EXTERNAL_SERVICE_ERROR, `Route generation failed: ${err.message}`);
    }
    const feature = orsResult.features?.[0];
    if (!feature)
      throw new PipelineError(Errors.EXTERNAL_SERVICE_ERROR, "ORS returned no route");
    const routeData = orsFeatureToRouteData(feature);
    console.log(`[aiRouting] A→B final: ${routeData.distance_km} km`);
    return {
      profile,
      elevation_preference: elevationPreference,
      poi_types_requested: [],
      routing_mode: mode,
      ai_plan: { pois: poiFeatures },
      routes: [{
        profile,
        distance_km: routeData.distance_km,
        duration_s: calcDuration(routeData.distance_km, routeData.duration_s, profileConfig),
        ascent_m: routeData.ascent_m,
        descent_m: routeData.descent_m,
        geometry: { type: "LineString", coordinates: routeData.coords },
        bbox: routeBbox(routeData.coords),
        elevation_profile: routeData.elevArr,
        maneuvers: routeData.maneuvers,
        pois: poiFeatures,
      }],
    };
  }

  onStage("routing", { mode: "loop" });
  let loopResult;
  try {
    loopResult = await generateLoop({
      start,
      targetM: tripDistanceM,
      orsProfile,
      orsElevOpts,
      stops: waypointCoords,
      travelHeading: loopTravelHeading,
    });
  } catch (err) {
    throw new PipelineError(Errors.EXTERNAL_SERVICE_ERROR, `Loop routing failed: ${err.message}`);
  }
  const loopData = loopResult.routeData;
  console.log(
    `[aiRouting] Loop final: ${loopData.distance_km} km | requested: ${distanceKm.toFixed(1)} km | ` +
      `accuracy: ${((loopData.distance_km / distanceKm) * 100).toFixed(0)}%`,
  );
  return {
    profile,
    elevation_preference: elevationPreference,
    poi_types_requested: [],
    routing_mode: mode,
    ai_plan: { pois: poiFeatures },
    controlPoints: loopResult.controlPoints,
    loop_meta: loopResult.meta,
    routes: [{
      profile,
      distance_km: loopData.distance_km,
      duration_s: calcDuration(loopData.distance_km, loopData.duration_s, profileConfig),
      ascent_m: loopData.ascent_m,
      descent_m: loopData.descent_m,
      geometry: { type: "LineString", coordinates: loopData.coords },
      bbox: routeBbox(loopData.coords),
      elevation_profile: loopData.elevArr,
      maneuvers: loopData.maneuvers,
      pois: poiFeatures,
      ...(loopResult.meta.overlap_ratio != null && { overlap_ratio: loopResult.meta.overlap_ratio }),
    }],
  };
}
