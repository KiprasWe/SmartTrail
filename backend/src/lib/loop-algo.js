import {
  fetchORSDirections,
  orsFeatureToRouteData,
} from "./ors.js";
import { solveTspLoop } from "./loop-tsp.js";

const DISTANCE_TOLERANCE = 0.07;
const MAX_SCALE_PASSES = 6;
const SCALE_DAMPING = 0.8; // exponent < 1 prevents oscillation
const MAX_TAIL_CLEAN_PASSES = 5;
const TAIL_SIZE_THRESHOLD = 0.2; // sections < 20% of total route are treated as tails

function latLngDistKm(a, b) {
  const dLat = (a.lat - b.lat) * 110.54;
  const dLng = (a.lng - b.lng) * 111.32 * Math.cos((a.lat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

function toLngLat([lng, lat]) {
  return { lat, lng };
}

function toORS({ lat, lng }) {
  return [lng, lat];
}

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

function generateGuidePoints(base, targetM, travelHeading = 0, rotation = "clockwise") {
  return {
    points: circleRoute(base, targetM, travelHeading, rotation),
    shape: "circular",
  };
}

// Scans the dense ORS route coords for "tail" segments — sections where the route
// backtracks over itself (the route passes close to a later point, forming a lollipop).
// Any such section that is shorter than TAIL_SIZE_THRESHOLD of the total route is removed.
// Ported from RouteLoops (serverCodeOsm.js cleanTails / clientCode.js iterative loop).
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

  // For each point find the index of the closest *subsequent* point.
  const closestAhead = new Int32Array(n);
  for (let i = 0; i < n - 1; i++) {
    let bestDist = Infinity;
    let bestJ = i + 1;
    for (let j = i + 1; j < n; j++) {
      const d = latLngDistKm(pts[i], pts[j]);
      if (d < bestDist) { bestDist = d; bestJ = j; }
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

// For each guide waypoint {lat, lng} find the closest coord [lng, lat] in the
// tail-cleaned path and return it as the new guide position.
function snapWaypointsToCoords(waypoints, coords) {
  if (!coords.length) return waypoints;
  return waypoints.map((wp) => {
    let bestDist = Infinity;
    let best = coords[0];
    for (const c of coords) {
      const d = latLngDistKm(wp, { lat: c[1], lng: c[0] });
      if (d < bestDist) { bestDist = d; best = c; }
    }
    return { lat: best[1], lng: best[0] };
  });
}

// Iteratively removes tails from a routed loop:
//   1. Detect and strip tail segments from the dense ORS coords.
//   2. Snap guide points to the cleaned path (stops are not moved).
//   3. Re-route — ORS should now stay on the tail-free path.
//   4. Repeat until stable or MAX_TAIL_CLEAN_PASSES is reached.
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

    console.log(`[cleanTails] pass ${pass + 1}: removed ${cleanedUp} overlapping points, re-routing`);

    currentGuide = snapWaypointsToCoords(currentGuide, newCoords);

    if (pinnedStops.length > 0) {
      const { sequence: waypoints, insertIdx } = insertStopsCluster(start, currentGuide, pinnedStops);
      const snapRadiuses = waypoints.map((_, i) => {
        const posInSeq = i - insertIdx;
        return posInSeq >= 0 && posInSeq < pinnedStops.length ? 350 : 3000;
      });
      routeData = await routeThrough(start, waypoints, orsProfile, orsElevOpts, snapRadiuses);
    } else {
      routeData = await routeThrough(start, currentGuide, orsProfile, orsElevOpts);
    }
  }

  return { routeData, guidePoints: currentGuide };
}

// Re-routes a loop that already has control points through one or more new
// stops by routing each guide-point segment individually and stitching the
// results together. This prevents ORS from finding cross-segment shortcuts
// when the new stop happens to lie on a road that cuts through the loop.
async function rerouteLoopWithStops(start, guidePoints, stops, orsProfile, orsElevOpts) {
  // Build the ordered point sequence: start, guide points, stops inserted at
  // cheapest positions, then back to start.
  const segPoints = [start, ...guidePoints, start];
  // Parallel array: true = user-placed stop (needs tight snap), false = guide/start point (needs wide snap).
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

  // Route every consecutive pair in parallel — each call sees only its own
  // two endpoints, so ORS cannot find a shortcut that spans multiple segments.
  // Guide/start points keep the same 3000 m snap used during original loop
  // generation; user stops use a tight 350 m snap to honour their position.
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

  // Stitch all segment geometries into one continuous route.
  const coords = [];
  const elevArr = [];
  const maneuvers = [];
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
    maneuvers.push(...(seg.maneuvers ?? []));
    distKm += seg.distance_km;
    durationS += seg.duration_s;
    ascentM += seg.ascent_m;
    descentM += seg.descent_m;
  }

  return {
    coords,
    elevArr,
    maneuvers,
    distance_km: +distKm.toFixed(2),
    duration_s: Math.round(durationS),
    ascent_m: Math.round(ascentM),
    descent_m: Math.round(descentM),
  };
}

// Insert each stop individually at cheapest position — used only when the
// caller has already provided explicit control points (user-drawn path).
function insertStopsIntoGuidePoints(start, guidePoints, stops) {
  const sequence = [...guidePoints];

  for (const stop of stops) {
    let bestIdx = 0;
    let bestCost = Infinity;

    for (let i = 0; i <= sequence.length; i++) {
      const prev = i === 0 ? start : sequence[i - 1];
      const next = i === sequence.length ? start : sequence[i];
      const cost =
        latLngDistKm(prev, stop) +
        latLngDistKm(stop, next) -
        latLngDistKm(prev, next);
      if (cost < bestCost) {
        bestCost = cost;
        bestIdx = i;
      }
    }

    sequence.splice(bestIdx, 0, stop);
  }

  return sequence;
}

// Insert the entire ordered stop sequence as one contiguous block at the
// single gap in the guide-point loop that costs the least aerial detour.
// Treating stops as a block prevents the zigzag/backtracking that happens
// when individual stops are scattered at different positions around the loop:
// the route enters the stop cluster once, visits all stops in order, then
// continues along the loop — no weaving back and forth across the loop path.
function insertStopsCluster(start, guidePoints, orderedStops) {
  if (orderedStops.length === 0) return { sequence: [...guidePoints], insertIdx: 0 };

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

// snapRadiuses: per-waypoint snap radius in metres (excluding start/end).
// Guide points use 3000 m (may be off-road); user stops use 350 m (near roads).
// Defaults to 3000 m for all waypoints when omitted.
async function routeThrough(
  start,
  waypoints,
  orsProfile,
  orsElevOpts,
  snapRadiuses,
) {
  const lngLatStart = toORS(start);
  const allPts = [lngLatStart, ...waypoints.map(toORS), lngLatStart];
  const radiuses = [
    -1,
    ...(snapRadiuses ?? waypoints.map(() => 3000)),
    -1,
  ];
  const ors = await fetchORSDirections(orsProfile, allPts, {
    ...orsElevOpts,
    radiuses,
  });
  const feat = ors.features?.[0];
  if (!feat) throw new Error("ORS returned no route");
  return orsFeatureToRouteData(feat);
}

function scaleGuidePointsFromOrigin(start, guidePoints, scaleFactor) {
  return guidePoints.map((wp) => {
    const dlat = (wp.lat - start.lat) * scaleFactor;
    const dlng = (wp.lng - start.lng) * scaleFactor;
    return { lat: start.lat + dlat, lng: start.lng + dlng };
  });
}

// Route through guide points and scale until distance converges.
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
      offRatio <
        Math.abs(best.routeData.distance_km * 1000 - targetM) / targetM
    ) {
      best = { routeData, waypoints: guidePoints };
    }

    if (offRatio <= DISTANCE_TOLERANCE) break;

    const scale = Math.pow(targetM / actualM, SCALE_DAMPING);
    guidePoints = scaleGuidePointsFromOrigin(start, guidePoints, scale);
  }

  return best;
}

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

  // When stops already account for ≥75% of the target distance, inserting them
  // into a guide-point loop creates a lollipop that tail-cleaning destroys
  // repeatedly. Route directly through the stops instead — the result is a
  // clean loop that visits all requested places without backtracking.
  const snappedToMin = tsp.minDistanceM > targetM * 0.75;
  const effectiveTargetM = snappedToMin ? tsp.minDistanceM : targetM;
  const pinnedStops = tsp.orderedStops.map(([lng, lat]) => ({ lat, lng }));

  // Stops dominate the distance: route directly through them.
  // Use a tight 350 m snap so ORS honours the stop positions rather than
  // jumping to a distant road — matching the snap used in the scaling path.
  if (snappedToMin) {
    const stopRadiuses = pinnedStops.map(() => 350);
    const routeData = await routeThrough(
      startLatLng,
      pinnedStops,
      orsProfile,
      orsElevOpts,
      stopRadiuses,
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

  // Size the initial loop shape for the distance budget after stops are
  // accounted for. Stops consume roughly tsp.minDistanceM, so the loop
  // geometry only needs to cover the remainder. This makes the first ORS call
  // land close to the target and minimises wasted scaling passes.
  const loopBudgetM = Math.max(
    effectiveTargetM * 0.25,
    effectiveTargetM - tsp.minDistanceM,
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
    // Insert the entire stop sequence as one block at the gap in the loop
    // that naturally passes closest to the stop cluster. This keeps the
    // guide-point arc intact on both sides so ORS never has to zigzag
    // between synthetic geometry and user stops.
    const { sequence: waypoints, insertIdx } = insertStopsCluster(
      startLatLng,
      guidePoints,
      pinnedStops,
    );

    // Guide points (geometric, may be off-road) get a wide 3 km snap so ORS
    // can always find a road. User-placed stops get a tight 350 m snap so ORS
    // honours their position rather than jumping to a distant road.
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

    if (
      best === null ||
      offRatio <
        Math.abs(best.routeData.distance_km * 1000 - effectiveTargetM) /
          effectiveTargetM
    ) {
      best = { routeData, guidePoints };
    }

    if (offRatio <= DISTANCE_TOLERANCE) break;

    // Scale only the guide-point "portion" of the route. Stops are fixed
    // geographic points — they don't move when guide points scale, so using
    // the total distance ratio overcorrects. Isolate the guide contribution.
    const stopBudgetM = Math.min(tsp.minDistanceM, actualM * 0.9);
    const guideActualM = Math.max(1, actualM - stopBudgetM);
    const guideBudgetM = Math.max(1, effectiveTargetM - stopBudgetM);
    const scale = Math.max(0.3, Math.min(3.0, Math.pow(guideBudgetM / guideActualM, SCALE_DAMPING)));
    guidePoints = scaleGuidePointsFromOrigin(startLatLng, guidePoints, scale);
  }

  if (!best) throw new Error("ORS returned no route for stops loop");

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

    // When stops are present, route each guide-point segment individually so
    // ORS cannot exploit a road shortcut near the new stop to collapse large
    // portions of the loop. Each segment call sees only its own two endpoints.
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
