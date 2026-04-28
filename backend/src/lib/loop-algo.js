import { haversineM } from "./geo.js";
import {
  fetchElevations,
  fetchAreaPOIs,
  fetchORSDirections,
  orsFeatureToRouteData,
} from "./ors.js";
import { solveTspLoop } from "./loop-tsp.js";

const TAIL_FRACTION = 0.2;

const DISTANCE_TOLERANCE = 0.12;

const MAX_SCALE_PASSES = 4;

const MAX_CLEAN_ITERATIONS = 8;

export { fetchAreaPOIs };

function latLngDistKm(a, b) {
  return haversineM([a.lng, a.lat], [b.lng, b.lat]) / 1000;
}

function toLngLat([lng, lat]) {
  return { lat, lng };
}

function toORS({ lat, lng }) {
  return [lng, lat];
}

function circleRoute(base, lengthM, travelHeading, rotation) {
  const radius = lengthM / (2 * Math.PI);
  const circlePoints = 4;
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

function rectangleRoute(base, lengthM, travelHeading, rotation) {
  const rlPoints = [];
  const maxRatio = 5;
  const minRatio = 1 / maxRatio;
  const ratio = Math.random() * (maxRatio - minRatio) + minRatio;
  const width = lengthM / (2 * ratio + 2);
  const height = width * ratio;
  const diagonal = Math.sqrt(width * width + height * height);
  const theta = Math.acos(height / diagonal);

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

  const sign = rotation === "clockwise" ? -1 : 1;
  const cosLat = Math.cos((base.lat * Math.PI) / 180);

  const pushPoint = (angle, dist) => {
    const dx = dist * Math.cos(angle);
    const dy = dist * Math.sin(angle);
    rlPoints.push({
      lat: base.lat + dy / 110540,
      lng: base.lng + dx / (111320 * cosLat),
    });
  };

  pushPoint(direction, height);
  pushPoint(sign * theta + direction, diagonal);
  pushPoint((sign * Math.PI) / 2 + direction, width);

  return rlPoints;
}

function fig8Route(base, lengthM, travelHeading, rotation) {
  const radius = lengthM / 4 / Math.PI;
  const circlePoints = 3;
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

  const buildLobe = (lobeDir, sign) => {
    const cosLat = Math.cos((base.lat * Math.PI) / 180);
    const dx0 = radius * Math.cos(lobeDir);
    const dy0 = radius * Math.sin(lobeDir);
    const center = {
      lat: base.lat + dy0 / 110540,
      lng: base.lng + dx0 / (111320 * cosLat),
    };
    const deg = [lobeDir + Math.PI];
    for (let i = 1; i < circlePoints + 1; i++) {
      deg.push(deg[i - 1] + (sign * 2 * Math.PI) / (circlePoints + 1));
      const dx = radius * Math.cos(deg[i]);
      const dy = radius * Math.sin(deg[i]);
      rlPoints.push({
        lat: center.lat + dy / 110540,
        lng:
          center.lng + dx / (111320 * Math.cos((center.lat * Math.PI) / 180)),
      });
    }
  };

  const sign1 = rotation === "clockwise" ? -1 : 1;
  buildLobe(direction, sign1);
  buildLobe(direction + Math.PI, -sign1);

  return rlPoints;
}

function pickShape(shape) {
  if (shape && shape !== "random") return shape;
  const options = ["circular", "rectangular", "figure8"];
  return options[Math.floor(Math.random() * options.length)];
}

function generateGuidePoints(
  base,
  targetM,
  shape,
  travelHeading = 0,
  rotation = "clockwise",
) {
  const s = pickShape(shape);
  if (s === "rectangular")
    return {
      points: rectangleRoute(base, targetM, travelHeading, rotation),
      shape: s,
    };
  if (s === "figure8")
    return {
      points: fig8Route(base, targetM, travelHeading, rotation),
      shape: s,
    };
  return {
    points: circleRoute(base, targetM, travelHeading, rotation),
    shape: s,
  };
}

function cleanTails(coords) {
  if (!coords || coords.length < 4) {
    return { newCoords: coords ?? [], cleanedCount: 0, distKm: 0 };
  }

  const cumDist = [0];
  for (let i = 1; i < coords.length; i++) {
    cumDist.push(cumDist[i - 1] + latLngDistKm(coords[i - 1], coords[i]));
  }
  const totalDist = cumDist[cumDist.length - 1];

  const pLclose = new Array(coords.length);
  const pLsep = new Array(coords.length);
  for (let i = 0; i < coords.length; i++) {
    let closest = Infinity;
    let closestJ = i + 1;
    for (let j = i + 1; j < coords.length; j++) {
      const d = latLngDistKm(coords[i], coords[j]);
      if (d < closest) {
        closest = d;
        closestJ = j;
      }
    }
    pLclose[i] = closestJ;
    pLsep[i] = closest;
  }

  const keep = new Array(coords.length).fill(false);
  let i = 0;
  while (i < coords.length) {
    keep[i] = true;
    const jump = pLclose[i];
    if (jump !== i + 1) {
      const tailSize = (cumDist[jump] - cumDist[i]) / totalDist;
      if (tailSize < TAIL_FRACTION) {
        i = jump;
        continue;
      }
    }
    i++;
  }
  keep[0] = true;
  keep[coords.length - 1] = true;

  const newCoords = coords.filter((_, idx) => keep[idx]);
  const cleanedCount = coords.length - newCoords.length;

  let distKm = 0;
  for (let i = 1; i < newCoords.length; i++) {
    distKm += latLngDistKm(newCoords[i - 1], newCoords[i]);
  }

  return { newCoords, cleanedCount, distKm };
}

function snapWaypointsToPath(waypoints, pathCoords) {
  return waypoints.map((wp) => {
    let best = pathCoords[0];
    let bestDist = latLngDistKm(wp, pathCoords[0]);
    for (const pt of pathCoords) {
      const d = latLngDistKm(wp, pt);
      if (d < bestDist) {
        bestDist = d;
        best = pt;
      }
    }
    return best;
  });
}

async function routeThrough(start, waypoints, orsProfile, orsElevOpts) {
  const lngLatStart = toORS(start);
  const allPts = [lngLatStart, ...waypoints.map(toORS), lngLatStart];
  const ors = await fetchORSDirections(orsProfile, allPts, orsElevOpts);
  const feat = ors.features?.[0];
  if (!feat) throw new Error("ORS returned no route");
  return orsFeatureToRouteData(feat);
}

async function runCleanLoop(start, initialWaypoints, orsProfile, orsElevOpts) {
  let routeData = await routeThrough(
    start,
    initialWaypoints,
    orsProfile,
    orsElevOpts,
  );
  let waypoints = [...initialWaypoints];
  let iterations = 0;
  let lastCleaned = -1;
  let lastTotal = -1;

  while (iterations < MAX_CLEAN_ITERATIONS) {
    iterations++;

    const coords = routeData.coords.map(toLngLat);
    const { newCoords, cleanedCount, distKm } = cleanTails(coords);

    if (
      cleanedCount === 0 ||
      (cleanedCount === lastCleaned && newCoords.length === lastTotal)
    ) {
      break;
    }

    lastCleaned = cleanedCount;
    lastTotal = newCoords.length;

    waypoints = snapWaypointsToPath(waypoints, newCoords);

    routeData = await routeThrough(start, waypoints, orsProfile, orsElevOpts);
  }

  return { routeData, waypoints };
}

function scaleGuidePointsFromOrigin(start, guidePoints, scaleFactor) {
  return guidePoints.map((wp) => {
    const dlat = (wp.lat - start.lat) * scaleFactor;
    const dlng = (wp.lng - start.lng) * scaleFactor;
    return { lat: start.lat + dlat, lng: start.lng + dlng };
  });
}

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
    const { routeData, waypoints: cleanedGuide } = await runCleanLoop(
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
      best = { routeData, waypoints: cleanedGuide };
    }

    if (offRatio <= DISTANCE_TOLERANCE) break;

    const scale = targetM / actualM;
    guidePoints = scaleGuidePointsFromOrigin(start, cleanedGuide, scale);
  }

  return best;
}

function centroidOf(points) {
  const n = points.length;
  const lat = points.reduce((s, p) => s + p.lat, 0) / n;
  const lng = points.reduce((s, p) => s + p.lng, 0) / n;
  return { lat, lng };
}

function bearingFromOrigin(origin, point) {
  const dlat = point.lat - origin.lat;
  const dlng = point.lng - origin.lng;
  return Math.atan2(dlng, dlat);
}

function sortByBearing(points, origin) {
  return [...points].sort(
    (a, b) => bearingFromOrigin(origin, a) - bearingFromOrigin(origin, b),
  );
}

function buildPaddingGuidePoints(start, orderedStops, gapM) {
  if (orderedStops.length === 0) return [];

  const c = centroidOf(orderedStops);
  const mainBearing = Math.atan2(c.lng - start.lng, c.lat - start.lat);
  const perpBearing = mainBearing + Math.PI / 2;
  const cosLat = Math.cos((start.lat * Math.PI) / 180);

  const minRadius = 300; // metres
  const radius = Math.max(minRadius, Math.min(Math.abs(gapM) / 2.6, 20_000));

  const makePoint = (bearing, r) => ({
    lat: start.lat + (r * Math.cos(bearing)) / 110540,
    lng: start.lng + (r * Math.sin(bearing)) / (111320 * cosLat),
  });

  if (gapM < 3_000) {
    return [makePoint(perpBearing, radius)];
  }
  return [
    makePoint(perpBearing, radius),
    makePoint(perpBearing + Math.PI, radius),
  ];
}

async function runCleanLoopWithPins(
  start,
  guidePoints,
  pinnedPoints,
  orsProfile,
  orsElevOpts,
) {
  const merged = sortByBearing([...guidePoints, ...pinnedPoints], start);

  let routeData = await routeThrough(start, merged, orsProfile, orsElevOpts);
  let currentGuide = [...guidePoints];
  let iterations = 0;
  let lastCleaned = -1;
  let lastTotal = -1;

  while (iterations < MAX_CLEAN_ITERATIONS) {
    iterations++;

    const coords = routeData.coords.map(toLngLat);
    const { newCoords, cleanedCount } = cleanTailsWithPins(
      coords,
      pinnedPoints,
    );

    if (
      cleanedCount === 0 ||
      (cleanedCount === lastCleaned && newCoords.length === lastTotal)
    ) {
      break;
    }

    lastCleaned = cleanedCount;
    lastTotal = newCoords.length;

    currentGuide = snapWaypointsToPath(currentGuide, newCoords);

    const nextMerged = sortByBearing([...currentGuide, ...pinnedPoints], start);
    routeData = await routeThrough(start, nextMerged, orsProfile, orsElevOpts);
  }

  return { routeData, guidePoints: currentGuide };
}
function cleanTailsWithPins(coords, pinnedPoints) {
  if (!coords || coords.length < 4) {
    return { newCoords: coords ?? [], cleanedCount: 0 };
  }

  const SNAP_DIST_KM = 0.05;
  const pinnedIndices = new Set();
  for (let i = 0; i < coords.length; i++) {
    for (const pin of pinnedPoints) {
      if (latLngDistKm(coords[i], pin) <= SNAP_DIST_KM) {
        pinnedIndices.add(i);
        break;
      }
    }
  }

  const cumDist = [0];
  for (let i = 1; i < coords.length; i++) {
    cumDist.push(cumDist[i - 1] + latLngDistKm(coords[i - 1], coords[i]));
  }
  const totalDist = cumDist[cumDist.length - 1];

  const pLclose = new Array(coords.length);
  for (let i = 0; i < coords.length; i++) {
    let closest = Infinity;
    let closestJ = i + 1;
    for (let j = i + 1; j < coords.length; j++) {
      const d = latLngDistKm(coords[i], coords[j]);
      if (d < closest) {
        closest = d;
        closestJ = j;
      }
    }
    pLclose[i] = closestJ;
  }

  const keep = new Array(coords.length).fill(false);
  let i = 0;
  while (i < coords.length) {
    keep[i] = true;
    const jump = pLclose[i];
    if (jump !== i + 1) {
      const tailSize = (cumDist[jump] - cumDist[i]) / totalDist;
      if (tailSize < TAIL_FRACTION) {
        let hasPinnedInTail = false;
        for (let k = i + 1; k < jump; k++) {
          if (pinnedIndices.has(k)) {
            hasPinnedInTail = true;
            break;
          }
        }
        if (!hasPinnedInTail) {
          i = jump;
          continue;
        }
      }
    }
    i++;
  }
  keep[0] = true;
  keep[coords.length - 1] = true;

  const newCoords = coords.filter((_, idx) => keep[idx]);
  return { newCoords, cleanedCount: coords.length - newCoords.length };
}

async function generatePureLoop({
  start,
  targetM,
  orsProfile,
  orsElevOpts,
  shape,
  travelHeading,
  rotation,
}) {
  const startLatLng = { lat: start[1], lng: start[0] };

  const { points: guidePoints, shape: usedShape } = generateGuidePoints(
    startLatLng,
    targetM,
    shape,
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

  return {
    routeData: result.routeData,
    controlPoints: result.waypoints.map(toORS),
    orderedStops: [],
    meta: {
      requested_km: +(targetM / 1000).toFixed(2),
      actual_km: result.routeData.distance_km,
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
}) {
  const startLatLng = { lat: start[1], lng: start[0] };

  const tsp = await solveTspLoop(start, stops, orsProfile);
  const minKm = +(tsp.minDistanceM / 1000).toFixed(2);

  const snappedToMin = tsp.minDistanceM > targetM * 1.1;
  const effectiveTargetM = snappedToMin ? tsp.minDistanceM : targetM;

  const pinnedStops = tsp.orderedStops.map(([lng, lat]) => ({ lat, lng }));

  const gapM = Math.max(0, effectiveTargetM - tsp.minDistanceM);
  let guidePoints = buildPaddingGuidePoints(startLatLng, pinnedStops, gapM);

  let best = null;
  for (let pass = 0; pass < MAX_SCALE_PASSES; pass++) {
    const { routeData, guidePoints: cleanedGuide } = await runCleanLoopWithPins(
      startLatLng,
      guidePoints,
      pinnedStops,
      orsProfile,
      orsElevOpts,
    );

    const actualM = routeData.distance_km * 1000;
    const offRatio = Math.abs(actualM - effectiveTargetM) / effectiveTargetM;

    if (
      best === null ||
      offRatio <
        Math.abs(best.routeData.distance_km * 1000 - effectiveTargetM) /
          effectiveTargetM
    ) {
      best = { routeData, guidePoints: cleanedGuide };
    }

    if (offRatio <= DISTANCE_TOLERANCE || guidePoints.length === 0) break;

    const scale = effectiveTargetM / actualM;
    guidePoints = scaleGuidePointsFromOrigin(startLatLng, cleanedGuide, scale);
  }

  if (!best) throw new Error("ORS returned no route for stops loop");

  return {
    routeData: best.routeData,
    controlPoints: best.guidePoints.map(toORS),
    orderedStops: tsp.orderedStops,
    meta: {
      requested_km: +(targetM / 1000).toFixed(2),
      actual_km: best.routeData.distance_km,
      min_distance_km: minKm,
      snapped_to_min: snappedToMin,
      auto_extended: false,
      overlap_ratio: null,
      shape: null,
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
  shape = "random",
  travelHeading = 0,
  rotation = "clockwise",
}) {
  if (controlPoints.length > 0) {
    const startLatLng = { lat: start[1], lng: start[0] };
    const guideLatLng = controlPoints.map(([lng, lat]) => ({ lat, lng }));
    const pinnedLatLng = stops.map(([lng, lat]) => ({ lat, lng }));

    const { routeData, guidePoints: cleanedGuide } = await runCleanLoopWithPins(
      startLatLng,
      guideLatLng,
      pinnedLatLng,
      orsProfile,
      orsElevOpts,
    );

    return {
      routeData,
      controlPoints: cleanedGuide.map(toORS),
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
    });
  }

  return generatePureLoop({
    start,
    targetM,
    orsProfile,
    orsElevOpts,
    shape,
    travelHeading,
    rotation,
  });
}
