// lib/loop-algo.js — Petal loop generation algorithm
//
// For each candidate compass bearing we build a teardrop with three anchors
// (outbound, apex, return). Each anchor is then nudged within a small local
// radius to land on more interesting terrain (elevation + nearby POIs).

import { haversineM, computeDestination } from "./geo.js";
import { fetchElevations, fetchAreaPOIs } from "./ors.js";

// ─── Constants ────────────────────────────────────────────────────────────────

// Typical road detour factor per profile (actual routed ÷ straight-line distance).
// Used to back-calculate circle radius from target distance.
export const DETOUR_FACTOR = {
  "foot-walking": 1.35,
  "foot-hiking": 1.45,
  running: 1.25,
  "cycling-regular": 1.25,
  "cycling-road": 1.2,
  "cycling-mountain": 1.5,
  "cycling-electric": 1.22,
};

export const NUM_BEARINGS = 8; // candidate petal directions to try (every 45°)
const PERTURBATIONS_PER_ANCHOR = 5; // small nudges around each anchor for scoring
const PERTURBATION_RADIUS_M = 600; // radius of the local nudge circle
export const KEEP_TOP_VARIANTS = 3; // how many final variants to return
// ORS corridor buffer ladder for petal return leg.
export const BUFFER_LADDER = [0.0015, 0.001, 0.0006, 0.0002, 0];

// Max candidate points sampled from the outbound leg for scoring.
const LOOP_SCORE_SAMPLE_LIMIT = 200;
// POI proximity radius used when scoring loop anchor perturbations.
const PERTURBATION_POI_RADIUS_M = 500;

// ─── Petal builder ────────────────────────────────────────────────────────────

// Build a lat/lng rectangle (SW/NE corners) around [lng, lat] with a half-side
// length in metres. Used as a hard bounding box for Google Places
// `locationRestriction.rectangle`. Degree-per-metre conversion uses a standard
// 111 320 m per degree of latitude; longitude degrees shrink with cos(lat).

// Build a teardrop / "petal" shape pointing in `bearingDeg` from start.
// Returns anchor points for the outbound leg, a split apex pair, and the return.
//
// Key improvement over the single-apex design: instead of both legs converging
// to the same GPS coordinate (which forces the same roads at the loop top),
// we use TWO apex points offset perpendicular to `bearingDeg`:
//   apexOut — outbound leg aims for the right side of the apex
//   apexRet — return leg starts from the left side of the apex
//
// deltaDeg = 40: wider fan from start than the old 25° so outbound/return roads
// diverge earlier and the router has more road-network space.
export function buildPetalWaypoints(
  start,
  targetDistM,
  bearingDeg,
  detour,
  deltaDeg = 40,
) {
  const budget = targetDistM / detour;
  const rOut = 0.28 * budget;
  const rApex = 0.44 * budget;
  const rRet = 0.28 * budget;

  const lateralM = Math.min(Math.max(budget * 0.1, 100), 800);

  const apexCenter = computeDestination(start, (bearingDeg + 360) % 360, rApex);

  return {
    bearing: bearingDeg,
    budget,
    outbound: computeDestination(
      start,
      (bearingDeg + deltaDeg + 360) % 360,
      rOut,
    ),
    apex: apexCenter,
    apexOut: computeDestination(apexCenter, (bearingDeg + 90) % 360, lateralM),
    apexRet: computeDestination(
      apexCenter,
      (bearingDeg - 90 + 360) % 360,
      lateralM,
    ),
    return: computeDestination(
      start,
      (bearingDeg - deltaDeg + 360) % 360,
      rRet,
    ),
  };
}

// ─── Overlap scoring ──────────────────────────────────────────────────────────

// Compute the fraction of the outbound leg that runs within `thresholdM` of
// the return leg. Result is in [0, 1] — lower is better (less self-overlap).
export function computeOverlapRatio(outCoords, returnCoords, thresholdM = 25) {
  if (!outCoords?.length || !returnCoords?.length) return 0;

  const cellSize = 0.001; // ~0.001° lat ≈ 111 m
  const buckets = new Map();
  const key = (cx, cy) => `${cx}|${cy}`;
  for (const [lng, lat] of returnCoords) {
    const cx = Math.floor(lng / cellSize);
    const cy = Math.floor(lat / cellSize);
    const k = key(cx, cy);
    let arr = buckets.get(k);
    if (!arr) {
      arr = [];
      buckets.set(k, arr);
    }
    arr.push([lng, lat]);
  }

  const targetSamples = Math.min(outCoords.length, LOOP_SCORE_SAMPLE_LIMIT);
  const step = Math.max(1, Math.floor(outCoords.length / targetSamples));
  let hits = 0;
  let samples = 0;

  for (let i = 0; i < outCoords.length; i += step) {
    const p = outCoords[i];
    samples++;
    const cx = Math.floor(p[0] / cellSize);
    const cy = Math.floor(p[1] / cellSize);
    let hit = false;
    outer: for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const arr = buckets.get(key(cx + dx, cy + dy));
        if (!arr) continue;
        for (const q of arr) {
          if (haversineM(p, q) <= thresholdM) {
            hit = true;
            break outer;
          }
        }
      }
    }
    if (hit) hits++;
  }

  return samples ? hits / samples : 0;
}

// ─── Perturbation scoring ─────────────────────────────────────────────────────

// Score local perturbations around a single anchor and pick the best one.
// Scoring formula: 0.6 elevation + 0.4 POI proximity.
function pickBestPerturbation(
  anchor,
  elevations,
  areaPOIs,
  elevPref,
  candidates,
) {
  const validElevs = elevations.filter((e) => Number.isFinite(e) && e !== 0);
  const elevMin = validElevs.length ? Math.min(...validElevs) : 0;
  const elevMax = validElevs.length ? Math.max(...validElevs) : 1;
  const elevRange = Math.max(elevMax - elevMin, 1);

  const elevMean = elevations.length
    ? elevations.reduce((s, e) => s + (e ?? 0), 0) / elevations.length
    : 0;

  let best = anchor;
  let bestScore = -Infinity;
  for (let i = 0; i < candidates.length; i++) {
    const elev = elevations[i] ?? 0;
    let elevScore;
    if (elevPref === "flat") {
      elevScore = 1 - Math.abs(elev - elevMin) / elevRange;
    } else if (elevPref === "optimal") {
      const heightScore = (elev - elevMin) / elevRange;
      const varietyScore = Math.abs(elev - elevMean) / elevRange;
      elevScore = heightScore * 0.7 + varietyScore * 0.3;
    } else {
      // "hilly" — purely maximise elevation
      elevScore = (elev - elevMin) / elevRange;
    }
    const nearbyPOIs = areaPOIs.filter(
      (poi) => haversineM(poi, candidates[i]) <= PERTURBATION_POI_RADIUS_M,
    ).length;
    const poiScore = Math.min(nearbyPOIs / 3, 1);
    const score = elevScore * 0.6 + poiScore * 0.4;
    if (score > bestScore) {
      bestScore = score;
      best = candidates[i];
    }
  }
  return best;
}

// For one petal (3 anchors), generate small perturbations around each anchor
// and pick the best one per anchor by elevation + POI score.
export async function scoreAndPickPetalAnchors(petal, areaPOIs, elevPref) {
  const anchors = [petal.outbound, petal.apex, petal.return];

  const allCandidates = [];
  const perAnchorCandidates = anchors.map((anchor) => {
    const cands = [anchor];
    for (let k = 1; k < PERTURBATIONS_PER_ANCHOR; k++) {
      const bearing = (k * (360 / (PERTURBATIONS_PER_ANCHOR - 1))) % 360;
      cands.push(computeDestination(anchor, bearing, PERTURBATION_RADIUS_M));
    }
    allCandidates.push(...cands);
    return cands;
  });

  const allElevations = await fetchElevations(allCandidates);

  const result = [];
  let offset = 0;
  for (let i = 0; i < anchors.length; i++) {
    const cands = perAnchorCandidates[i];
    const elevs = allElevations.slice(offset, offset + cands.length);
    offset += cands.length;
    result.push(
      pickBestPerturbation(anchors[i], elevs, areaPOIs, elevPref, cands),
    );
  }

  // Re-derive the split apex from the chosen (nudged) apex center.
  const bestApex = result[1];
  const lateralM = Math.min(Math.max(petal.budget * 0.1, 100), 800);
  const apexOut = computeDestination(
    bestApex,
    (petal.bearing + 90) % 360,
    lateralM,
  );
  const apexRet = computeDestination(
    bestApex,
    (petal.bearing - 90 + 360) % 360,
    lateralM,
  );

  return { outbound: result[0], apexOut, apexRet, return: result[2] };
}

// Re-export area POI fetching for use in loop routing controller.
export { fetchAreaPOIs };
