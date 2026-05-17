import { haversineM, routeBbox } from "../geo.js";
import { generateLoop } from "../loop-algo.js";
import {
  reverseGeocodePlaceName,
  searchAreaByCategories,
  collectORSFilters,
} from "../places.js";
import {
  orsFeatureToRouteData,
  buildProfileOpts,
  filterUnreachablePois,
} from "../ors.js";
import { PROFILE_CONFIGS, calcDuration } from "../profiles.js";
import { PipelineError, Errors } from "../../utils/responses.js";
import { dedupPois, ORS_API_KEY, PROFILE_FALLBACK_THEME } from "./shared.js";
import { classifyAndDecompose } from "./classify.js";
import {
  ORS_WAYPOINT_CAP,
  AI_SPLICE_MAX_DETOUR_KM,
  AI_SPLICE_BUDGET_FRACTION,
  AI_SPLICE_BUDGET_FLOOR_KM,
  AI_SPLICE_BUDGET_MAX_FRACTION,
  AI_SPLICE_MIN_STOPS,
  AI_SPLICE_MAX_COUNT,
} from "../../config/tuning.js";
import { tourGuideCurate } from "./curate.js";
import { splicePoiIntoRoute } from "../poi-splice.js";
import {
  sortPoisAlongLine,
  sortPoisAroundLoop,
  enrichedPoiToFeature,
  fetchORSWithFallback,
} from "./waypoints.js";
import { resolveNamedPlacesWithGrounding } from "./grounding.js";

// Used by pickLoopTravelHeading.
// Parses an EN/LT directional phrase from free text into a 1-8 compass
// heading (0 = none), e.g. "south of the city" -> 5.
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

// Used by runAiPipeline (loop trips only).
// Prefers a travel_heading from the classified intents, else infers one
// from the raw preferences text.
function pickLoopTravelHeading({ preferences, intents, lang }) {
  const fromIntents = Array.isArray(intents)
    ? intents.find((i) => Number(i?.travel_heading) > 0)?.travel_heading
    : 0;
  const intentHeading = Math.max(0, Math.min(Number(fromIntents) || 0, 8));
  if (intentHeading) return intentHeading;
  return inferTravelHeadingFromText(preferences, lang);
}

// Exported — the AI routing orchestrator. Used by aiRouteController.js
// (and mocked in controller tests).
// End-to-end stages: geocode start/end -> classifyAndDecompose (mode +
// intents) -> ground named places + searchAreaByCategories -> reachability
// filter -> tourGuideCurate (with rating-rank fallback) -> sort + cap
// waypoints -> route via fetchORSWithFallback (A→B) or generateLoop.
// onStage(name, meta?) reports progress; throws PipelineError on failure.
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
  const orsElevOpts = buildProfileOpts(profileConfig, elevationPreference);

  const validUserWaypointCoords = (
    Array.isArray(userWaypointCoords) ? userWaypointCoords : []
  ).filter(
    (w) =>
      Array.isArray(w) && w.length === 2 && isFinite(w[0]) && isFinite(w[1]),
  );

  onStage("ai_pois");

  const [placeStart, placeEnd] = await Promise.all([
    reverseGeocodePlaceName(start, lang).catch(() => null),
    hasEnd
      ? reverseGeocodePlaceName(end, lang).catch(() => null)
      : Promise.resolve(null),
  ]);

  if (placeStart) console.log(`[aiRouting] start → "${placeStart}"`);
  if (placeEnd) console.log(`[aiRouting] end   → "${placeEnd}"`);
  console.log(`[aiRouting] prompt → "${preferences?.trim() || "(none)"}"`);

  const classified = await classifyAndDecompose({
    preferences,
    profileLabel,
    area,
    hasEnd,
    placeStart,
    placeEnd,
    distanceKm,
    lang,
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
      ? [
          {
            theme:
              PROFILE_FALLBACK_THEME[profileLabel] ??
              "scenic viewpoints and landmarks",
            places_type: "tourism",
            count: 8,
            travel_heading: 0,
            subcategories: [],
          },
        ]
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
        intents
          .map((i) => {
            const subs = i.subcategories?.length
              ? ` subs=[${i.subcategories.join(",")}]`
              : "";
            return `  • ${i.places_type || "(any)"} — "${i.theme}" (count=${i.count})${subs}`;
          })
          .join("\n"),
    );
  }

  onStage("enriching");

  // Named-place grounding uses no bbox restriction (same as loop mode): the
  // start coord is only a soft anchor, so a user's "must" place is found
  // anywhere it confidently resolves rather than being silently dropped for
  // sitting off the straight start→end corridor. The reachability filter
  // still guards against truly unreachable matches.
  const tripBbox = null;

  // Named places are grounded first: they are must-stops that shape the
  // route geometry, so their coordinates are needed before routing.
  const groundedNamedPois =
    (mode === "named" || mode === "mixed") && namedPlaces.length
      ? await resolveNamedPlacesWithGrounding(namedPlaces, start, {
          lang,
          bbox: tripBbox,
          maxCandidates: 3,
        }).catch((err) => {
          console.warn(`[aiRouting] Named grounding failed: ${err.message}`);
          return [];
        })
      : [];

  if (namedPlaces.length > 0 && groundedNamedPois.length < namedPlaces.length) {
    const found = new Set(groundedNamedPois.map((p) => p.name.toLowerCase()));
    const missing = namedPlaces.filter((n) => !found.has(n.toLowerCase()));
    if (missing.length > 0)
      console.warn(
        `[aiRouting] Could not locate: ${missing.join(", ")} — proceeding without them`,
      );
  }

  // A→B baseline route ("skeleton"): start → must-stops → end via ORS,
  // computed before POI search so POIs are scanned along the real road
  // corridor instead of a straight crow-flies line. Null until built (or if
  // the baseline call fails), in which case anchors fall back to the
  // straight start→end interpolation.
  let baselineCoords = null;

  const buildReachAnchors = () => {
    if (!hasEnd) return [start];
    const stepM = 2_500;
    if (Array.isArray(baselineCoords) && baselineCoords.length >= 2) {
      const pts = [baselineCoords[0]];
      let acc = 0;
      for (let i = 1; i < baselineCoords.length; i++) {
        acc += haversineM(baselineCoords[i - 1], baselineCoords[i]);
        if (acc >= stepM) {
          pts.push(baselineCoords[i]);
          acc = 0;
        }
      }
      const last = baselineCoords[baselineCoords.length - 1];
      if (pts[pts.length - 1] !== last) pts.push(last);
      return pts;
    }
    const totalM = haversineM(start, end);
    const n = Math.min(8, Math.max(2, Math.ceil(totalM / stepM)));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      pts.push([
        start[0] + (end[0] - start[0]) * t,
        start[1] + (end[1] - start[1]) * t,
      ]);
    }
    return pts;
  };

  const AI_REACH_RATIO = 2.0;

  const runReachability = async (pois, label) => {
    if (!pois.length) return pois;
    const reachAnchors = buildReachAnchors();
    try {
      const before = pois.length;
      const kept = await filterUnreachablePois(
        orsProfile,
        reachAnchors,
        pois,
        AI_REACH_RATIO,
      );
      const dropped = before - kept.length;
      if (dropped > 0) {
        console.log(
          `[aiRouting] Reachability filter (${label}): kept ${kept.length}/${before} (dropped ${dropped} barrier-blocked, anchors=${reachAnchors.length}, ratio<=${AI_REACH_RATIO})`,
        );
      }
      return kept;
    } catch (err) {
      console.warn(
        `[aiRouting] Reachability filter (${label}) failed: ${err.message} — keeping all`,
      );
      return pois;
    }
  };

  const reachableNamedPois = await runReachability(groundedNamedPois, "named");

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

  // LOOP: build the route from must-stops (user waypoints + named places)
  // FIRST, then scan POIs along the actual routed polyline. Curated POIs are
  // overlays and never re-route. A→B keeps the straight start→end corridor
  // scan and routes through curated essentials (unchanged).
  let loopResult = null;
  let categoryPois = [];
  if (!hasEnd) {
    const mustStopCoords = [
      ...validUserWaypointCoords,
      ...reachableNamedPois.map((p) => [p.lng, p.lat]),
    ];
    onStage("routing", { mode: "loop" });
    try {
      loopResult = await generateLoop({
        start,
        targetM: tripDistanceM,
        orsProfile,
        orsElevOpts,
        stops: mustStopCoords,
        travelHeading: loopTravelHeading,
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
        `accuracy: ${((loopData.distance_km / distanceKm) * 100).toFixed(0)}%`,
    );
    console.log(
      `[aiRouting] loop_meta: snapped_to_min=${loopResult.meta.snapped_to_min} ` +
        `min_distance_km=${loopResult.meta.min_distance_km} shape=${loopResult.meta.shape} ` +
        `auto_extended=${loopResult.meta.auto_extended}`,
    );

    onStage("ai_pois");
    categoryPois =
      mode !== "named" && intents.length
        ? await searchAreaByCategories(
            start,
            null,
            tripDistanceM,
            collectORSFilters(intents),
            false,
            loopData.coords,
          ).catch((err) => {
            console.warn(`[aiRouting] Area search failed: ${err.message}`);
            return [];
          })
        : [];
  } else {
    // Build the A→B baseline route through the guaranteed must-stops
    // (user waypoints + grounded named places), then end. POIs are scanned
    // along this real road corridor. User waypoints are protected so a bad
    // named-place coord can't knock them out. On failure we degrade to the
    // straight start→end line (baselineCoords stays null).
    const mustStopCoords = [
      ...validUserWaypointCoords,
      ...reachableNamedPois.map((p) => [p.lng, p.lat]),
    ];
    onStage("routing", { mode: "a_to_b" });
    try {
      const baselineOrs = await fetchORSWithFallback(
        orsProfile,
        start,
        mustStopCoords,
        end,
        orsElevOpts,
        validUserWaypointCoords.length,
      );
      const baselineFeature = baselineOrs.features?.[0];
      if (baselineFeature) {
        baselineCoords = orsFeatureToRouteData(baselineFeature).coords;
        console.log(
          `[aiRouting] A→B baseline: ${baselineCoords.length} pts through ${mustStopCoords.length} must-stops`,
        );
      }
    } catch (err) {
      console.warn(
        `[aiRouting] A→B baseline failed: ${err.message} — falling back to straight-line corridor`,
      );
    }

    onStage("ai_pois");
    categoryPois =
      mode !== "named" && intents.length
        ? await searchAreaByCategories(
            start,
            end,
            tripDistanceM,
            collectORSFilters(intents),
            true,
            null,
            baselineCoords,
          ).catch((err) => {
            console.warn(`[aiRouting] Area search failed: ${err.message}`);
            return [];
          })
        : [];
  }

  console.log(
    `[aiRouting] POIs — category: ${categoryPois.length}, named: ${groundedNamedPois.length}`,
  );

  const reachableCategoryPois = await runReachability(categoryPois, "category");

  let enrichedPool;
  if (mode === "named") {
    enrichedPool = reachableNamedPois;
  } else if (mode === "mixed") {
    enrichedPool = dedupPois([...reachableNamedPois, ...reachableCategoryPois]);
  } else {
    enrichedPool = reachableCategoryPois;
  }

  if (hasEnd && !enrichedPool.length && !userWaypoints.length)
    throw new PipelineError(
      Errors.AI_GENERATION_FAILED,
      "No usable POIs found",
    );

  onStage("curating");

  // Named places are always committed (essential); only category pool goes to Gemini
  const committedPois = reachableNamedPois.map((p) => ({
    ...p,
    essential: true,
  }));
  const committedIds = new Set(committedPois.map((p) => p.place_id));
  const curationPoolLimit = 1000;
  const curationCandidates = enrichedPool.filter(
    (p) => !committedIds.has(p.place_id),
  );

  const scoreCurationPoi = (p) => {
    const hasWebsite =
      typeof p.website_uri === "string" && p.website_uri.trim().length > 0;
    const hasWiki =
      (typeof p.wikipedia_uri === "string" &&
        p.wikipedia_uri.trim().length > 0) ||
      (typeof p.wikidata === "string" && p.wikidata.trim().length > 0);
    const rating = Number.isFinite(p.rating) ? p.rating : 0;
    const pop = Number.isFinite(p.user_rating_count)
      ? Math.log10(1 + Math.max(0, p.user_rating_count))
      : 0;
    // Strongly prefer POIs with rich metadata (website/wiki) to reduce random low-signal places.
    return (hasWebsite ? 100 : 0) + (hasWiki ? 140 : 0) + rating * 10 + pop * 6;
  };

  const rankedCurationCandidates = [...curationCandidates]
    .map((p) => ({ p, score: scoreCurationPoi(p) }))
    .sort((a, b) => b.score - a.score);

  const curationPool = rankedCurationCandidates
    .slice(0, curationPoolLimit)
    .map(({ p }) => p);
  const userNamedPlaceIds = new Set(
    reachableNamedPois.filter((p) => p.place_id).map((p) => p.place_id),
  );

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
      namedPois: reachableNamedPois,
      userNamedPlaceIds,
    });

    if (curatedPois) {
      finalPois = dedupPois([
        ...committedPois,
        ...curatedPois,
        ...userWaypoints,
      ]);
      console.log(`[aiRouting] Curation: ${finalPois.length} total stops`);
    } else {
      console.warn("[aiRouting] Curation failed — falling back to rating rank");
      const maxStops = Math.max(2, Math.min(Math.round(distanceKm / 4), 12));
      const budget = Math.max(0, maxStops - committedPois.length);
      const ranked = [...enrichedPool]
        .filter((p) => !committedIds.has(p.place_id))
        .sort(
          (a, b) =>
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
    }
  } else {
    finalPois = dedupPois([...committedPois, ...userWaypoints]);
  }

  const allSorted = hasEnd
    ? sortPoisAlongLine(finalPois, start, end)
    : sortPoisAroundLoop(finalPois, start);

  // ---- LOOP: route was built from must-stops. Now fold in curated
  // essentials that lie close to that route (Option C): each is spliced in
  // only if its detour cost is under the per-POI cap, stopping once the
  // cumulative added length exceeds the budget or the count cap is hit.
  // Far-flung essentials stay as overlays. is_route_waypoint is true for
  // must-stops + successfully spliced essentials.
  if (!hasEnd) {
    const mustStopIds = new Set(
      reachableNamedPois.filter((p) => p.place_id).map((p) => p.place_id),
    );
    const isMustStop = (poi) =>
      poi._isUserWaypoint === true ||
      (poi.place_id != null && mustStopIds.has(poi.place_id));

    const loopData = loopResult.routeData;
    let routeOut = {
      coords: loopData.coords,
      elevArr: loopData.elevArr,
      distance_km: loopData.distance_km,
      duration_s: calcDuration(
        loopData.distance_km,
        loopData.duration_s,
        profileConfig,
      ),
      ascent_m: loopData.ascent_m,
      descent_m: loopData.descent_m,
    };

    // Splice essentials importance-first so marquee stops get first claim
    // on the budget (loop order would let whoever is first around the loop
    // starve a better stop). Budget is clamped with a floor so short routes
    // aren't starved and a ceiling so tiny routes don't balloon.
    const splicedKeys = new Set();
    const budgetKm = Math.min(
      distanceKm * AI_SPLICE_BUDGET_MAX_FRACTION,
      Math.max(
        AI_SPLICE_BUDGET_FLOOR_KM,
        distanceKm * AI_SPLICE_BUDGET_FRACTION,
      ),
    );
    const spliceCandidates = allSorted
      .filter((p) => p.essential && !isMustStop(p))
      .sort((a, b) => scoreCurationPoi(b) - scoreCurationPoi(a));
    let addedKm = 0;
    let spliceCount = 0;
    for (const poi of spliceCandidates) {
      if (spliceCount >= AI_SPLICE_MAX_COUNT) break;
      // Budget only starts rejecting once the best-effort minimum is met.
      if (spliceCount >= AI_SPLICE_MIN_STOPS && addedKm >= budgetKm) break;
      if (!Number.isFinite(poi.lng) || !Number.isFinite(poi.lat)) continue;
      try {
        const spliced = await splicePoiIntoRoute({
          routeCoords: routeOut.coords,
          elevArr: routeOut.elevArr,
          poi: [poi.lng, poi.lat],
          orsProfile,
          orsElevOpts,
          profileConfig,
          currentStats: {
            distance_km: routeOut.distance_km,
            duration_s: routeOut.duration_s,
            ascent_m: routeOut.ascent_m,
            descent_m: routeOut.descent_m,
          },
        });
        if (spliced.detour_delta_km > AI_SPLICE_MAX_DETOUR_KM) {
          console.log(
            `[aiRouting] splice skip "${poi.name}" — detour +${spliced.detour_delta_km}km > ${AI_SPLICE_MAX_DETOUR_KM}km`,
          );
          continue;
        }
        const overBudget =
          addedKm + Math.max(0, spliced.detour_delta_km) > budgetKm;
        if (overBudget && spliceCount >= AI_SPLICE_MIN_STOPS) {
          console.log(
            `[aiRouting] splice skip "${poi.name}" — would exceed budget (${addedKm.toFixed(1)}/${budgetKm.toFixed(1)}km), min ${AI_SPLICE_MIN_STOPS} already met`,
          );
          continue;
        }
        routeOut = { ...spliced };
        addedKm += Math.max(0, spliced.detour_delta_km);
        spliceCount++;
        splicedKeys.add(poi.place_id ?? `${poi.lng},${poi.lat}`);
        console.log(
          `[aiRouting] splice in "${poi.name}" +${spliced.detour_delta_km}km → ${routeOut.distance_km}km`,
        );
      } catch (err) {
        console.warn(
          `[aiRouting] splice failed "${poi.name}": ${err.message} — left as overlay`,
        );
      }
    }

    const poiFeatures = allSorted.map((poi, i) => {
      const feat = enrichedPoiToFeature(poi, i);
      feat.properties.is_route_waypoint =
        isMustStop(poi) ||
        splicedKeys.has(poi.place_id ?? `${poi.lng},${poi.lat}`);
      return feat;
    });
    const waypointCount = poiFeatures.filter(
      (f) => f.properties.is_route_waypoint,
    ).length;
    console.log(
      `[aiRouting] Loop routed waypoints: ${waypointCount} ` +
        `(${spliceCount} essentials spliced, +${addedKm.toFixed(1)}km) | ` +
        `overlay POIs: ${poiFeatures.length - waypointCount} | final ${routeOut.distance_km}km`,
    );

    return {
      profile,
      elevation_preference: elevationPreference,
      poi_types_requested: [],
      routing_mode: mode,
      ai_plan: { pois: poiFeatures },
      controlPoints: loopResult.controlPoints,
      loop_meta: { ...loopResult.meta, actual_km: routeOut.distance_km },
      routes: [
        {
          profile,
          distance_km: routeOut.distance_km,
          duration_s: routeOut.duration_s,
          ascent_m: routeOut.ascent_m,
          descent_m: routeOut.descent_m,
          geometry: { type: "LineString", coordinates: routeOut.coords },
          bbox: routeBbox(routeOut.coords),
          elevation_profile: routeOut.elevArr,
          pois: poiFeatures,
          ...(loopResult.meta.overlap_ratio != null && {
            overlap_ratio: loopResult.meta.overlap_ratio,
          }),
        },
      ],
    };
  }

  // ---- A→B: curated essentials become ORS waypoints (unchanged) ----
  const essentialOrdered = allSorted.filter((p) => p.essential);
  const userWaypointsInEssential = essentialOrdered.filter(
    (p) => p._isUserWaypoint,
  );
  const aiEssentialOrdered = essentialOrdered.filter((p) => !p._isUserWaypoint);
  // Ensure every essential stop actually influences the routed path.
  // Otherwise short trips can mark something "essential" but then drop it from ORS waypoints.
  const computedCap = Math.round(distanceKm / 7);
  const essentialCount = essentialOrdered.length;
  const waypointCap = Math.max(
    2,
    Math.min(Math.max(computedCap, essentialCount), ORS_WAYPOINT_CAP),
  );
  const waypointPois = [
    ...userWaypointsInEssential,
    ...aiEssentialOrdered.slice(
      0,
      waypointCap - userWaypointsInEssential.length,
    ),
  ];
  const waypointCoords = waypointPois.map((p) => [p.lng, p.lat]);

  // Mark which POIs are actual ORS waypoints so the frontend seeds correctly.
  const waypointPlaceIds = new Set(
    waypointPois.map((p) => p.place_id).filter(Boolean),
  );
  const poiFeatures = allSorted.map((poi, i) => {
    const feat = enrichedPoiToFeature(poi, i);
    feat.properties.is_route_waypoint = waypointPlaceIds.has(poi.place_id);
    return feat;
  });

  console.log(`[aiRouting] Routing through ${waypointCoords.length} waypoints`);

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
  console.log(`[aiRouting] A→B final: ${routeData.distance_km} km`);
  return {
    profile,
    elevation_preference: elevationPreference,
    poi_types_requested: [],
    routing_mode: mode,
    ai_plan: { pois: poiFeatures },
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
        pois: poiFeatures,
      },
    ],
  };
}
