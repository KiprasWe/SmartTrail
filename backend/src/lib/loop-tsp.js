import { fetchWithRetry } from "../utils/http.js";
import { haversineM } from "./geo.js";

const ORS_API_KEY = process.env.ORS_API_KEY;
const ORS_MATRIX_URL = "https://api.openrouteservice.org/v2/matrix";
const HELD_KARP_LIMIT = 9;

export async function fetchORSMatrix(orsProfile, locations) {
  if (!ORS_API_KEY) throw new Error("ORS_API_KEY is not set");
  if (locations.length < 2) throw new Error("matrix needs ≥ 2 points");

  const url = `${ORS_MATRIX_URL}/${orsProfile}`;
  const res = await fetchWithRetry(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: ORS_API_KEY,
      },
      body: JSON.stringify({
        locations,
        metrics: ["distance", "duration"],
        units: "m",
      }),
    },
    { timeoutMs: 20_000 },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ORS matrix error (${res.status}): ${text}`);
  }
  const json = await res.json();
  return { distances: json.distances ?? [], durations: json.durations ?? [] };
}

function heldKarp(distMatrix) {
  const N = distMatrix.length;
  if (N <= 2) {
    if (N === 2)
      return { order: [1], distance: distMatrix[0][1] + distMatrix[1][0] };
    return { order: [], distance: 0 };
  }
  const stops = N - 1;
  const FULL = (1 << stops) - 1;

  const dp = new Array(1 << stops);
  const parent = new Array(1 << stops);
  for (let m = 0; m <= FULL; m++) {
    dp[m] = new Float64Array(stops).fill(Infinity);
    parent[m] = new Int8Array(stops).fill(-1);
  }
  for (let i = 0; i < stops; i++) {
    dp[1 << i][i] = distMatrix[0][i + 1];
  }

  for (let mask = 1; mask <= FULL; mask++) {
    for (let i = 0; i < stops; i++) {
      if (!(mask & (1 << i)) || !isFinite(dp[mask][i])) continue;
      for (let j = 0; j < stops; j++) {
        if (mask & (1 << j)) continue;
        const nextMask = mask | (1 << j);
        const cost = dp[mask][i] + distMatrix[i + 1][j + 1];
        if (cost < dp[nextMask][j]) {
          dp[nextMask][j] = cost;
          parent[nextMask][j] = i;
        }
      }
    }
  }

  let bestEnd = 0;
  let bestCost = Infinity;
  for (let i = 0; i < stops; i++) {
    const cost = dp[FULL][i] + distMatrix[i + 1][0];
    if (cost < bestCost) {
      bestCost = cost;
      bestEnd = i;
    }
  }

  const order = new Array(stops);
  let mask = FULL;
  let cur = bestEnd;
  for (let pos = stops - 1; pos >= 0; pos--) {
    order[pos] = cur + 1;
    const prev = parent[mask][cur];
    mask ^= 1 << cur;
    cur = prev;
    if (cur < 0) break;
  }

  return { order, distance: bestCost };
}

function nearestNeighbor(distMatrix) {
  const N = distMatrix.length;
  const visited = new Uint8Array(N);
  visited[0] = 1;
  const order = [];
  let cur = 0;
  let total = 0;
  for (let step = 1; step < N; step++) {
    let best = -1;
    let bestDist = Infinity;
    for (let j = 1; j < N; j++) {
      if (visited[j]) continue;
      if (distMatrix[cur][j] < bestDist) {
        bestDist = distMatrix[cur][j];
        best = j;
      }
    }
    visited[best] = 1;
    order.push(best);
    total += bestDist;
    cur = best;
  }
  total += distMatrix[cur][0];
  return { order, distance: total };
}

function tourCost(distMatrix, order) {
  let cost = distMatrix[0][order[0]];
  for (let i = 0; i < order.length - 1; i++) {
    cost += distMatrix[order[i]][order[i + 1]];
  }
  cost += distMatrix[order[order.length - 1]][0];
  return cost;
}

function twoOpt(distMatrix, initialOrder) {
  const order = [...initialOrder];
  let improved = true;
  let passes = 0;
  while (improved && passes < 20) {
    improved = false;
    passes++;
    for (let i = 0; i < order.length - 1; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const a = i === 0 ? 0 : order[i - 1];
        const b = order[i];
        const c = order[j];
        const d = j === order.length - 1 ? 0 : order[j + 1];
        const before = distMatrix[a][b] + distMatrix[c][d];
        const after = distMatrix[a][c] + distMatrix[b][d];
        if (after + 1e-6 < before) {
          let lo = i;
          let hi = j;
          while (lo < hi) {
            const tmp = order[lo];
            order[lo] = order[hi];
            order[hi] = tmp;
            lo++;
            hi--;
          }
          improved = true;
        }
      }
    }
  }
  return { order, distance: tourCost(distMatrix, order) };
}

export async function solveTspLoop(start, stops, orsProfile) {
  if (!stops?.length) {
    return {
      orderedStops: [],
      minDistanceM: 0,
      minDurationS: 0,
      matrix: null,
    };
  }

  const locs = [start, ...stops];
  const { distances, durations } = await fetchORSMatrix(orsProfile, locs);

  for (let i = 0; i < locs.length; i++) {
    for (let j = 0; j < locs.length; j++) {
      if (distances[i]?.[j] == null) {
        distances[i][j] = haversineM(locs[i], locs[j]) * 1.4;
      }
    }
  }

  const result =
    stops.length <= HELD_KARP_LIMIT
      ? heldKarp(distances)
      : twoOpt(distances, nearestNeighbor(distances).order);

  const orderedStops = result.order.map((idx) => stops[idx - 1]);

  let durationS = durations?.[0]?.[result.order[0]] ?? 0;
  for (let i = 0; i < result.order.length - 1; i++) {
    durationS += durations?.[result.order[i]]?.[result.order[i + 1]] ?? 0;
  }
  durationS += durations?.[result.order[result.order.length - 1]]?.[0] ?? 0;

  return {
    orderedStops,
    minDistanceM: Math.round(result.distance),
    minDurationS: Math.round(durationS),
    matrix: { distances, durations },
  };
}
