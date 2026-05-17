import { fetchORSDirections, orsFeatureToRouteData } from "./ors.js";
import { solveTspLoop } from "./loop-tsp.js";
import { latLngDistKm, toORS } from "./geo.js";
import {
  DISTANCE_TOLERANCE,
  MAX_SCALE_PASSES,
  SCALE_DAMPING,
  MAX_TAIL_CLEAN_PASSES,
  TAIL_SIZE_THRESHOLD,
} from "../config/tuning.js";

// Used by generateGuidePoints.
// Builds 6 points on a circle offset from `base`, oriented by heading/rotation
// — the raw geometric skeleton every loop is grown from.
function circleRoute(base, lengthM, travelHeading, rotation) {
  const radius = lengthM / (2 * Math.PI);
  const circlePoints = 6;
  const deg = [];
  const rlPoints = [];

  let direction = Math.random() * 2 * Math.PI;
  if (travelHeading === 1)
    direction = (Math.random() * Math.PI) / 4 + (3 * Math.PI) / 8;
  else if (travelHeading === 2)
    direction = (Math.random() * Math.PI) / 4 + (1 * Math.PI) / 8;
  else if (travelHeading === 3)
    direction = (Math.random() * Math.PI) / 4 - Math.PI / 8;
  else if (travelHeading === 4)
    direction = (Math.random() * Math.PI) / 4 + (13 * Math.PI) / 8;
  else if (travelHeading === 5)
    direction = (Math.random() * Math.PI) / 4 + (11 * Math.PI) / 8;
  else if (travelHeading === 6)
    direction = (Math.random() * Math.PI) / 4 + (9 * Math.PI) / 8;
  else if (travelHeading === 7)
    direction = (Math.random() * Math.PI) / 4 + (7 * Math.PI) / 8;
  else if (travelHeading === 8)
    direction = (Math.random() * Math.PI) / 4 + (5 * Math.PI) / 8;

  const dx0 = radius * Math.cos(direction);
  const dy0 = radius * Math.sin(direction);
  const center = {
    lat: base.lat + dy0 / 110540,
    lng: base.lng + dx0 / (111320 * Math.cos((base.lat * Math.PI) / 180)),
  };

  deg.push(direction + Math.PI);
  const sign = rotation === "clockwise" ? -1 : 1;

  for (let i = 1; i < circlePoints + 1; i++) {
    deg.push(deg[i - 1] + (sign * 2 * Math.PI) / (circlePoints + 1));
    const dx = radius * Math.cos(deg[i]);
    const dy = radius * Math.sin(deg[i]);
    rlPoints.push({
      lat: center.lat + dy / 110540,
      lng: center.lng + dx / (111320 * Math.cos((center.lat * Math.PI) / 180)),
    });
  }
  return rlPoints;
}

// Used by generatePureLoop + generateLoopWithStops.
// Thin wrapper over circleRoute that tags the points with a shape label.
function generateGuidePoints(
  base,
  targetM,
  travelHeading = 0,
  rotation = "clockwise",
) {
  return {
    points: circleRoute(base, targetM, travelHeading, rotation),
    shape: "circular",
  };
}

// Used by applyTailCleaning.
// Strips "tails" — out-and-back overlap spurs where the route doubles back on
// itself — from a routed polyline, keeping the loop clean.
function detectAndRemoveTails(coords) {
  const n = coords.length;
  if (n < 4) return { newCoords: coords, cleanedUp: 0 };

  const pts = coords.map(([lng, lat]) => ({ lat, lng }));

  const cumDist = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    cumDist[i] = cumDist[i - 1] + latLngDistKm(pts[i - 1], pts[i]);
  }
  const totalKm = cumDist[n - 1];
  if (totalKm === 0) return { newCoords: coords, cleanedUp: 0 };

  const closestAhead = new Int32Array(n);
  for (let i = 0; i < n - 1; i++) {
    let bestDist = Infinity;
    let bestJ = i + 1;
    for (let j = i + 1; j < n; j++) {
      const d = latLngDistKm(pts[i], pts[j]);
      if (d < bestDist) {
        bestDist = d;
        bestJ = j;
      }
    }
    closestAhead[i] = bestJ;
  }
  closestAhead[n - 1] = n - 1;

  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;

  for (let i = 0; i < n - 1; ) {
    keep[i] = 1;
    const ci = closestAhead[i];
    if (ci - i !== 1) {
      const tailSize = (cumDist[ci] - cumDist[i]) / totalKm;
      if (tailSize < TAIL_SIZE_THRESHOLD) {
        i = ci;
        continue;
      }
    }
    i++;
  }

  const newCoords = coords.filter((_, i) => keep[i]);
  return { newCoords, cleanedUp: coords.length - newCoords.length };
}

// Used by applyTailCleaning.
// After tails are removed, snaps the guide points onto the nearest surviving
// route coords so the next re-route stays anchored to the cleaned path.
function snapWaypointsToCoords(waypoints, coords) {
  if (!coords.length) return waypoints;
  return waypoints.map((wp) => {
    let bestDist = Infinity;
    let best = coords[0];
    for (const c of coords) {
      const d = latLngDistKm(wp, { lat: c[1], lng: c[0] });
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    return { lat: best[1], lng: best[0] };
  });
}

// Used by generatePureLoop + generateLoopWithStops.
// Iterates detectAndRemoveTails -> snap -> re-route until the route stops
// changing (or MAX_TAIL_CLEAN_PASSES), returning the cleaned route + guides.
async function applyTailCleaning(
  initialRouteData,
  start,
  guidePoints,
  orsProfile,
  orsElevOpts,
  pinnedStops = [],
) {
  let routeData = initialRouteData;
  let currentGuide = guidePoints;
  let lastCleaned = -1;
  let lastTotal = -1;

  for (let pass = 0; pass < MAX_TAIL_CLEAN_PASSES; pass++) {
    const { newCoords, cleanedUp } = detectAndRemoveTails(routeData.coords);

    if (cleanedUp === 0) break;
    if (cleanedUp === lastCleaned && newCoords.length === lastTotal) break;
    lastCleaned = cleanedUp;
    lastTotal = newCoords.length;

    console.log(
      `[cleanTails] pass ${pass + 1}: removed ${cleanedUp} overlapping points, re-routing`,
    );

    currentGuide = snapWaypointsToCoords(currentGuide, newCoords);

    if (pinnedStops.length > 0) {
      const { sequence: waypoints, insertIdx } = insertStopsCluster(
        start,
        currentGuide,
        pinnedStops,
      );
      const snapRadiuses = waypoints.map((_, i) => {
        const posInSeq = i - insertIdx;
        return posInSeq >= 0 && posInSeq < pinnedStops.length ? 350 : 3000;
      });
      routeData = await routeThrough(
        start,
        waypoints,
        orsProfile,
        orsElevOpts,
        snapRadiuses,
      );
    } else {
      routeData = await routeThrough(
        start,
        currentGuide,
        orsProfile,
        orsElevOpts,
      );
    }
  }

  return { routeData, guidePoints: currentGuide };
}

// Used by generateLoop (the edited control-points + stops branch).
// Re-routes an existing/edited loop segment-by-segment, splicing each pinned
// stop in at its cheapest-insertion position with tight snap radius.
async function rerouteLoopWithStops(
  start,
  guidePoints,
  stops,
  orsProfile,
  orsElevOpts,
) {
  const segPoints = [start, ...guidePoints, start];

  const isStop = new Array(segPoints.length).fill(false);

  for (const stop of stops) {
    let bestIdx = 0;
    let bestCost = Infinity;
    for (let i = 0; i < segPoints.length - 1; i++) {
      const cost =
        latLngDistKm(segPoints[i], stop) +
        latLngDistKm(stop, segPoints[i + 1]) -
        latLngDistKm(segPoints[i], segPoints[i + 1]);
      if (cost < bestCost) {
        bestCost = cost;
        bestIdx = i;
      }
    }
    segPoints.splice(bestIdx + 1, 0, stop);
    isStop.splice(bestIdx + 1, 0, true);
  }

  const segResults = await Promise.all(
    segPoints.slice(0, -1).map((pt, i) => {
      const fromSnap = isStop[i] ? 350 : 3000;
      const toSnap = isStop[i + 1] ? 350 : 3000;
      return fetchORSDirections(
        orsProfile,
        [toORS(pt), toORS(segPoints[i + 1])],
        { ...orsElevOpts, radiuses: [fromSnap, toSnap] },
      );
    }),
  );

  const coords = [];
  const elevArr = [];
  let distKm = 0;
  let durationS = 0;
  let ascentM = 0;
  let descentM = 0;

  for (let i = 0; i < segResults.length; i++) {
    const feat = segResults[i]?.features?.[0];
    if (!feat) throw new Error(`ORS returned no route for loop segment ${i}`);
    const seg = orsFeatureToRouteData(feat);
    if (coords.length > 0) {
      coords.push(...seg.coords.slice(1));
      elevArr.push(...seg.elevArr.slice(1));
    } else {
      coords.push(...seg.coords);
      elevArr.push(...seg.elevArr);
    }
    distKm += seg.distance_km;
    durationS += seg.duration_s;
    ascentM += seg.ascent_m;
    descentM += seg.descent_m;
  }

  return {
    coords,
    elevArr,
    distance_km: +distKm.toFixed(2),
    duration_s: Math.round(durationS),
    ascent_m: Math.round(ascentM),
    descent_m: Math.round(descentM),
  };
}

// Used by applyTailCleaning, correctiveRescale, generateLoopWithStops.
// Inserts all ordered stops as one contiguous block at the cheapest-insertion
// index, returning the merged sequence + where the block was inserted.
function insertStopsCluster(start, guidePoints, orderedStops) {
  if (orderedStops.length === 0)
    return { sequence: [...guidePoints], insertIdx: 0 };

  const firstStop = orderedStops[0];
  const lastStop = orderedStops[orderedStops.length - 1];

  let bestIdx = 0;
  let bestCost = Infinity;

  for (let i = 0; i <= guidePoints.length; i++) {
    const prev = i === 0 ? start : guidePoints[i - 1];
    const next = i === guidePoints.length ? start : guidePoints[i];
    const cost =
      latLngDistKm(prev, firstStop) +
      latLngDistKm(lastStop, next) -
      latLngDistKm(prev, next);
    if (cost < bestCost) {
      bestCost = cost;
      bestIdx = i;
    }
  }

  const sequence = [...guidePoints];
  sequence.splice(bestIdx, 0, ...orderedStops);
  return { sequence, insertIdx: bestIdx };
}

// Used by applyTailCleaning, generateWithScaling, correctiveRescale, generateLoopWithStops, generateLoop.
// Single ORS call routing start -> waypoints -> start (closed loop), with
// optional per-point snap radii; returns parsed routeData.
async function routeThrough(
  start,
  waypoints,
  orsProfile,
  orsElevOpts,
  snapRadiuses,
) {
  const lngLatStart = toORS(start);
  const allPts = [lngLatStart, ...waypoints.map(toORS), lngLatStart];
  const radiuses = [-1, ...(snapRadiuses ?? waypoints.map(() => 3000)), -1];
  const ors = await fetchORSDirections(orsProfile, allPts, {
    ...orsElevOpts,
    radiuses,
  });
  const feat = ors.features?.[0];
  if (!feat) throw new Error("ORS returned no route");
  return orsFeatureToRouteData(feat);
}

// Used by generateWithScaling, correctiveRescale, generateLoopWithStops.
// Radially scales guide points around `start` to grow/shrink the loop's
// length toward the target distance.
function scaleGuidePointsFromOrigin(start, guidePoints, scaleFactor) {
  return guidePoints.map((wp) => {
    const dlat = (wp.lat - start.lat) * scaleFactor;
    const dlng = (wp.lng - start.lng) * scaleFactor;
    return { lat: start.lat + dlat, lng: start.lng + dlng };
  });
}

// Used by generatePureLoop.
// Repeatedly routes + radially rescales the guide points until the routed
// distance is within DISTANCE_TOLERANCE of target (or MAX_SCALE_PASSES).
async function generateWithScaling(
  start,
  initialGuidePoints,
  targetM,
  orsProfile,
  orsElevOpts,
) {
  let guidePoints = initialGuidePoints;
  let best = null;

  for (let pass = 0; pass < MAX_SCALE_PASSES; pass++) {
    const routeData = await routeThrough(
      start,
      guidePoints,
      orsProfile,
      orsElevOpts,
    );
    const actualM = routeData.distance_km * 1000;
    const offRatio = Math.abs(actualM - targetM) / targetM;

    if (
      best === null ||
      offRatio < Math.abs(best.routeData.distance_km * 1000 - targetM) / targetM
    ) {
      best = { routeData, waypoints: guidePoints };
    }

    if (offRatio <= DISTANCE_TOLERANCE) break;

    const scale = Math.pow(targetM / actualM, SCALE_DAMPING);
    guidePoints = scaleGuidePointsFromOrigin(start, guidePoints, scale);
  }

  return best;
}

// Used by generatePureLoop + generateLoopWithStops.
// Tail cleaning only ever shortens the loop and never re-scales, so a route
// that was on-target after scaling can come out well under target once spurs
// are stripped. This does ONE corrective re-scale of the cleaned guide points
// back toward target (re-routing once), and keeps whichever of the cleaned vs.
// corrected route is closer to target. Note: the corrective grow can reintroduce
// minor overlap that won't be re-cleaned — accepted as a bounded trade-off.
async function correctiveRescale(
  cleanedRouteData,
  cleanedGuidePoints,
  start,
  targetM,
  orsProfile,
  orsElevOpts,
  pinnedStops = [],
) {
  const cleanedActualM = cleanedRouteData.distance_km * 1000;
  const cleanedOff = Math.abs(cleanedActualM - targetM) / targetM;
  if (cleanedOff <= DISTANCE_TOLERANCE || cleanedActualM <= 0) {
    return { routeData: cleanedRouteData, guidePoints: cleanedGuidePoints };
  }

  const scale = Math.max(
    0.3,
    Math.min(3.0, Math.pow(targetM / cleanedActualM, SCALE_DAMPING)),
  );
  const correctedGuide = scaleGuidePointsFromOrigin(
    start,
    cleanedGuidePoints,
    scale,
  );

  try {
    let correctedRouteData;
    if (pinnedStops.length > 0) {
      const { sequence: waypoints, insertIdx } = insertStopsCluster(
        start,
        correctedGuide,
        pinnedStops,
      );
      const snapRadiuses = waypoints.map((_, i) => {
        const posInSeq = i - insertIdx;
        return posInSeq >= 0 && posInSeq < pinnedStops.length ? 350 : 3000;
      });
      correctedRouteData = await routeThrough(
        start,
        waypoints,
        orsProfile,
        orsElevOpts,
        snapRadiuses,
      );
    } else {
      correctedRouteData = await routeThrough(
        start,
        correctedGuide,
        orsProfile,
        orsElevOpts,
      );
    }

    const correctedOff =
      Math.abs(correctedRouteData.distance_km * 1000 - targetM) / targetM;
    console.log(
      `[correctiveRescale] cleaned=${cleanedRouteData.distance_km}km ` +
        `(off ${(cleanedOff * 100).toFixed(0)}%) → scale=${scale.toFixed(3)} → ` +
        `corrected=${correctedRouteData.distance_km}km (off ${(correctedOff * 100).toFixed(0)}%)` +
        `${correctedOff < cleanedOff ? " — kept corrected" : " — kept cleaned"}`,
    );

    if (correctedOff < cleanedOff) {
      return { routeData: correctedRouteData, guidePoints: correctedGuide };
    }
  } catch (err) {
    console.warn(`[correctiveRescale] failed: ${err.message}`);
  }

  return { routeData: cleanedRouteData, guidePoints: cleanedGuidePoints };
}

// Used by generateLoop (no stops, no control points).
// Full pipeline for a plain loop: circle skeleton -> scale to target -> tail clean.
async function generatePureLoop({
  start,
  targetM,
  orsProfile,
  orsElevOpts,
  travelHeading,
  rotation,
}) {
  const startLatLng = { lat: start[1], lng: start[0] };

  const { points: guidePoints, shape: usedShape } = generateGuidePoints(
    startLatLng,
    targetM,
    travelHeading,
    rotation,
  );

  const result = await generateWithScaling(
    startLatLng,
    guidePoints,
    targetM,
    orsProfile,
    orsElevOpts,
  );

  if (!result) throw new Error("All loop generation attempts failed");

  let finalRouteData = result.routeData;
  let finalGuidePoints = result.waypoints;

  try {
    const cleaned = await applyTailCleaning(
      result.routeData,
      startLatLng,
      result.waypoints,
      orsProfile,
      orsElevOpts,
    );
    finalRouteData = cleaned.routeData;
    finalGuidePoints = cleaned.guidePoints;

    const corrected = await correctiveRescale(
      finalRouteData,
      finalGuidePoints,
      startLatLng,
      targetM,
      orsProfile,
      orsElevOpts,
    );
    finalRouteData = corrected.routeData;
    finalGuidePoints = corrected.guidePoints;
  } catch (err) {
    console.warn(`[cleanTails] pure loop cleaning failed: ${err.message}`);
  }

  return {
    routeData: finalRouteData,
    controlPoints: finalGuidePoints.map(toORS),
    orderedStops: [],
    meta: {
      requested_km: +(targetM / 1000).toFixed(2),
      actual_km: finalRouteData.distance_km,
      shape: usedShape,
      min_distance_km: null,
      snapped_to_min: false,
      auto_extended: false,
      overlap_ratio: null,
    },
  };
}

// Used by generateLoop (has stops, no control points).
// TSP-orders the stops, then either snaps to the TSP minimum or grows a loop
// around them (insert cluster -> scale -> tail clean) to hit the target.
async function generateLoopWithStops({
  start,
  targetM,
  stops,
  orsProfile,
  orsElevOpts,
  travelHeading,
  rotation,
}) {
  const startLatLng = { lat: start[1], lng: start[0] };

  const tsp = await solveTspLoop(start, stops, orsProfile);
  const minKm = +(tsp.minDistanceM / 1000).toFixed(2);

  const snappedToMin = tsp.minDistanceM > targetM * 0.75;
  const effectiveTargetM = snappedToMin ? tsp.minDistanceM : targetM;
  const pinnedStops = tsp.orderedStops.map(([lng, lat]) => ({ lat, lng }));

  console.log(
    `[loopStops] target=${(targetM / 1000).toFixed(1)}km tspMin=${(tsp.minDistanceM / 1000).toFixed(2)}km ` +
      `snapThreshold=${((targetM * 0.75) / 1000).toFixed(1)}km → ${snappedToMin ? "SNAP-TO-MIN (ignore target)" : "GROW circle to target"} ` +
      `(effectiveTarget=${(effectiveTargetM / 1000).toFixed(1)}km, ${pinnedStops.length} pinned stops)`,
  );

  if (snappedToMin) {
    const stopRadiuses = pinnedStops.map(() => 350);
    const routeData = await routeThrough(
      startLatLng,
      pinnedStops,
      orsProfile,
      orsElevOpts,
      stopRadiuses,
    );
    console.log(
      `[loopStops] SNAP path: routed start→${pinnedStops.length} stops→start = ${routeData.distance_km}km (no target scaling applied)`,
    );
    return {
      routeData,
      controlPoints: [],
      orderedStops: tsp.orderedStops,
      meta: {
        requested_km: +(targetM / 1000).toFixed(2),
        actual_km: routeData.distance_km,
        min_distance_km: minKm,
        snapped_to_min: tsp.minDistanceM > targetM,
        auto_extended: false,
        overlap_ratio: null,
        shape: null,
      },
    };
  }

  const loopBudgetM = Math.max(
    effectiveTargetM * 0.25,
    effectiveTargetM - tsp.minDistanceM,
  );
  console.log(
    `[loopStops] GROW path: loopBudget=${(loopBudgetM / 1000).toFixed(2)}km ` +
      `(circle skeleton circumference; padding added on top of ${(tsp.minDistanceM / 1000).toFixed(2)}km stop loop)`,
  );

  const { points: shapePoints, shape: usedShape } = generateGuidePoints(
    startLatLng,
    loopBudgetM,
    travelHeading,
    rotation,
  );
  let guidePoints = shapePoints;
  let best = null;

  for (let pass = 0; pass < MAX_SCALE_PASSES; pass++) {
    const { sequence: waypoints, insertIdx } = insertStopsCluster(
      startLatLng,
      guidePoints,
      pinnedStops,
    );

    const snapRadiuses = waypoints.map((_, i) => {
      const posInSeq = i - insertIdx;
      return posInSeq >= 0 && posInSeq < pinnedStops.length ? 350 : 3000;
    });

    const routeData = await routeThrough(
      startLatLng,
      waypoints,
      orsProfile,
      orsElevOpts,
      snapRadiuses,
    );
    const actualM = routeData.distance_km * 1000;
    const offRatio = Math.abs(actualM - effectiveTargetM) / effectiveTargetM;

    const isBest =
      best === null ||
      offRatio <
        Math.abs(best.routeData.distance_km * 1000 - effectiveTargetM) /
          effectiveTargetM;
    if (isBest) {
      best = { routeData, guidePoints };
    }

    if (offRatio <= DISTANCE_TOLERANCE) {
      console.log(
        `[loopStops] scale pass ${pass + 1}: actual=${routeData.distance_km}km off=${(offRatio * 100).toFixed(0)}% → within tolerance, stop`,
      );
      break;
    }

    const stopBudgetM = Math.min(tsp.minDistanceM, actualM * 0.9);
    const guideActualM = Math.max(1, actualM - stopBudgetM);
    const guideBudgetM = Math.max(1, effectiveTargetM - stopBudgetM);
    const scale = Math.max(
      0.3,
      Math.min(3.0, Math.pow(guideBudgetM / guideActualM, SCALE_DAMPING)),
    );
    console.log(
      `[loopStops] scale pass ${pass + 1}: actual=${routeData.distance_km}km off=${(offRatio * 100).toFixed(0)}%` +
        `${isBest ? " (best)" : ""} | stopBudget=${(stopBudgetM / 1000).toFixed(1)}km ` +
        `guideActual=${(guideActualM / 1000).toFixed(1)}km guideBudget=${(guideBudgetM / 1000).toFixed(1)}km → scale=${scale.toFixed(3)}`,
    );
    guidePoints = scaleGuidePointsFromOrigin(startLatLng, guidePoints, scale);
  }

  if (!best) throw new Error("ORS returned no route for stops loop");

  console.log(
    `[loopStops] GROW best before tail-clean: ${best.routeData.distance_km}km ` +
      `(target ${(effectiveTargetM / 1000).toFixed(1)}km, off ${(((best.routeData.distance_km * 1000 - effectiveTargetM) / effectiveTargetM) * 100).toFixed(0)}%)`,
  );

  let finalRouteData = best.routeData;
  let finalGuidePoints = best.guidePoints;

  try {
    const cleaned = await applyTailCleaning(
      best.routeData,
      startLatLng,
      best.guidePoints,
      orsProfile,
      orsElevOpts,
      pinnedStops,
    );
    finalRouteData = cleaned.routeData;
    finalGuidePoints = cleaned.guidePoints;

    const corrected = await correctiveRescale(
      finalRouteData,
      finalGuidePoints,
      startLatLng,
      effectiveTargetM,
      orsProfile,
      orsElevOpts,
      pinnedStops,
    );
    finalRouteData = corrected.routeData;
    finalGuidePoints = corrected.guidePoints;
  } catch (err) {
    console.warn(`[cleanTails] stops loop cleaning failed: ${err.message}`);
  }

  return {
    routeData: finalRouteData,
    controlPoints: finalGuidePoints.map(toORS),
    orderedStops: tsp.orderedStops,
    meta: {
      requested_km: +(targetM / 1000).toFixed(2),
      actual_km: finalRouteData.distance_km,
      min_distance_km: minKm,
      snapped_to_min: false,
      auto_extended: false,
      overlap_ratio: null,
      shape: usedShape,
    },
  };
}

// Exported — the module's main entry point.
// Used by routeController (loopRouting) and ai/pipeline.js. Dispatches to one
// of three paths: edited control-points, stops, or plain pure loop.
export async function generateLoop({
  start,
  targetM,
  orsProfile,
  orsElevOpts = {},
  stops = [],
  controlPoints = [],
  travelHeading = 0,
  rotation = "clockwise",
}) {
  if (controlPoints.length > 0) {
    const startLatLng = { lat: start[1], lng: start[0] };
    const guideLatLng = controlPoints.map(([lng, lat]) => ({ lat, lng }));
    const pinnedLatLng = stops.map(([lng, lat]) => ({ lat, lng }));

    const routeData =
      pinnedLatLng.length > 0
        ? await rerouteLoopWithStops(
            startLatLng,
            guideLatLng,
            pinnedLatLng,
            orsProfile,
            orsElevOpts,
          )
        : await routeThrough(startLatLng, guideLatLng, orsProfile, orsElevOpts);

    return {
      routeData,
      controlPoints: guideLatLng.map(toORS),
      orderedStops: stops,
      meta: {
        requested_km: +(targetM / 1000).toFixed(2),
        actual_km: routeData.distance_km,
        shape: null,
        min_distance_km: null,
        snapped_to_min: false,
        auto_extended: false,
        overlap_ratio: null,
      },
    };
  }

  if (stops.length > 0) {
    return generateLoopWithStops({
      start,
      targetM,
      stops,
      orsProfile,
      orsElevOpts,
      travelHeading,
      rotation,
    });
  }

  return generatePureLoop({
    start,
    targetM,
    orsProfile,
    orsElevOpts,
    travelHeading,
    rotation,
  });
}
