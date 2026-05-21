import { haversineM } from "./geo.js";
import { calcDuration } from "./profiles.js";
import { fetchORSDirections, orsFeatureToRouteData } from "./ors.js";
import { SPLICE_BUFFER_M } from "../config/tuning.js";

export async function splicePoiIntoRoute({
  routeCoords,
  elevArr,
  poi,
  orsProfile,
  orsElevOpts,
  profileConfig,
  currentStats,
}) {
  const {
    distance_km: origDistKm,
    duration_s: origDurS,
    ascent_m: origAscent,
    descent_m: origDescent,
  } = currentStats;

  let closestIdx = 0;
  let minDist = Infinity;
  for (let i = 0; i < routeCoords.length; i++) {
    const d = haversineM(poi, routeCoords[i]);
    if (d < minDist) {
      minDist = d;
      closestIdx = i;
    }
  }

  let aIdx = closestIdx;
  let acc = 0;
  while (aIdx > 0 && acc < SPLICE_BUFFER_M) {
    acc += haversineM(routeCoords[aIdx], routeCoords[aIdx - 1]);
    aIdx--;
  }

  let bIdx = closestIdx;
  acc = 0;
  while (bIdx < routeCoords.length - 1 && acc < SPLICE_BUFFER_M) {
    acc += haversineM(routeCoords[bIdx], routeCoords[bIdx + 1]);
    bIdx++;
  }

  const A = routeCoords[aIdx];
  const B = routeCoords[bIdx];

  const [resA, resB] = await Promise.all([
    fetchORSDirections(orsProfile, [A, poi], orsElevOpts),
    fetchORSDirections(orsProfile, [poi, B], orsElevOpts),
  ]);
  const featA = resA.features?.[0];
  const featB = resB.features?.[0];
  if (!featA || !featB)
    throw new Error("ORS returned no route for splice segment");
  const segA = orsFeatureToRouteData(featA);
  const segB = orsFeatureToRouteData(featB);

  const newCoords = [
    ...routeCoords.slice(0, aIdx),
    ...segA.coords,
    ...segB.coords.slice(1),
    ...routeCoords.slice(bIdx + 1),
  ];

  let newElevArr = null;
  if (Array.isArray(elevArr) && elevArr.length === routeCoords.length) {
    newElevArr = [
      ...elevArr.slice(0, aIdx),
      ...segA.elevArr,
      ...segB.elevArr.slice(1),
      ...elevArr.slice(bIdx + 1),
    ];
  }

  let replacedDistKm = 0;
  for (let i = aIdx; i < bIdx; i++) {
    replacedDistKm += haversineM(routeCoords[i], routeCoords[i + 1]) / 1000;
  }
  const newDistKm = +(
    Math.max(0, origDistKm - replacedDistKm) +
    segA.distance_km +
    segB.distance_km
  ).toFixed(2);

  const replacedDurRatio = origDistKm > 0 ? replacedDistKm / origDistKm : 0;
  const newOrsSeconds =
    Math.round(origDurS * (1 - replacedDurRatio)) +
    segA.duration_s +
    segB.duration_s;
  const duration_s = calcDuration(newDistKm, newOrsSeconds, profileConfig);

  let ascent_m, descent_m;
  if (newElevArr) {
    let up = 0,
      down = 0;
    for (let i = 0; i < newElevArr.length - 1; i++) {
      const diff = newElevArr[i + 1] - newElevArr[i];
      if (diff > 0) up += diff;
      else down -= diff;
    }
    ascent_m = Math.round(up);
    descent_m = Math.round(down);
  } else {
    const ratio = origDistKm > 0 ? replacedDistKm / origDistKm : 0;
    ascent_m = Math.round(
      Math.max(0, origAscent * (1 - ratio)) + segA.ascent_m + segB.ascent_m,
    );
    descent_m = Math.round(
      Math.max(0, origDescent * (1 - ratio)) + segA.descent_m + segB.descent_m,
    );
  }

  return {
    coords: newCoords,
    elevArr: newElevArr,
    distance_km: newDistKm,
    duration_s,
    ascent_m,
    descent_m,
    detour_delta_km: +(
      segA.distance_km +
      segB.distance_km -
      replacedDistKm
    ).toFixed(2),
  };
}
