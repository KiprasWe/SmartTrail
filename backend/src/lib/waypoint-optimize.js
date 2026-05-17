import { haversineM } from "./geo.js";

// Used by optimizeWaypointSequence.
// Dedupes a coord list by ~6-decimal key, skipping malformed entries.
function uniqCoords(coords) {
  const seen = new Set();
  const out = [];
  for (const c of coords) {
    if (!Array.isArray(c) || c.length !== 2) continue;
    const k = `${c[0].toFixed(6)},${c[1].toFixed(6)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

// Used by twoOptOpenPath.
// Total metres of an open path start -> path... -> end (haversine).
function pathCost(path, start, end) {
  let cost = 0;
  let prev = start;
  for (const p of path) {
    cost += haversineM(prev, p);
    prev = p;
  }
  cost += haversineM(prev, end);
  return cost;
}

// Used by optimizeWaypointSequence.
// Greedy nearest-neighbor ordering from `start` — the initial tour 2-opt
// then refines.
function nearestNeighborInit(wps, start) {
  const remaining = [...wps];
  const out = [];
  let cur = start;
  while (remaining.length) {
    let bestIdx = 0;
    let bestD = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineM(cur, remaining[i]);
      if (d < bestD) {
        bestD = d;
        bestIdx = i;
      }
    }
    const [picked] = remaining.splice(bestIdx, 1);
    out.push(picked);
    cur = picked;
  }
  return out;
}

// Used by optimizeWaypointSequence.
// 2-opt local search (segment reversals) minimizing pathCost for a fixed
// start/end, capped at maxIters passes.
function twoOptOpenPath(path, start, end, maxIters = 80) {
  if (path.length < 4) return path;
  let best = [...path];
  let bestCost = pathCost(best, start, end);
  let improved = true;
  let iter = 0;

  while (improved && iter++ < maxIters) {
    improved = false;
    for (let i = 0; i < best.length - 2; i++) {
      for (let k = i + 1; k < best.length - 1; k++) {
        const candidate = [
          ...best.slice(0, i),
          ...best.slice(i, k + 1).reverse(),
          ...best.slice(k + 1),
        ];
        const c = pathCost(candidate, start, end);
        if (c + 0.1 < bestCost) {
          best = candidate;
          bestCost = c;
          improved = true;
        }
      }
    }
  }
  return best;
}

// Exported — module entry point. Used by routeEditController.
// Orders user waypoints to shorten the route: dedupe -> nearest-neighbor
// init -> 2-opt (end is `start` for loops).
export function optimizeWaypointSequence({ waypoints, start, end, isLoop }) {
  const uniq = uniqCoords(Array.isArray(waypoints) ? waypoints : []);
  if (uniq.length <= 2) return uniq;

  const effectiveEnd = isLoop ? start : end;
  const init = nearestNeighborInit(uniq, start);
  return twoOptOpenPath(init, start, effectiveEnd);
}
