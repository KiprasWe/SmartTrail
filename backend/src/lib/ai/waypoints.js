// lib/ai/waypoints.js — waypoint shaping helpers used by the pipeline.
//
//   snapToSkeleton      — pull a POI onto the nearest skeleton point if close
//   sortPoisAlongLine   — project POIs onto start→end line for A→B ordering
//   sortPoisAroundLoop  — greedy nearest-neighbour ordering for loops
//   enrichedPoiToFeature — convert internal POI to GeoJSON feature for client
//   fetchORSWithFallback — call ORS directions, drop unroutable waypoints
//                          one at a time instead of failing the whole request

import { haversineM } from "../geo.js";
import { fetchORSDirections } from "../ors.js";

// ─── Snap ─────────────────────────────────────────────────────────────────────

const SNAP_THRESHOLD_M = {
  "foot-walking": 150,
  "foot-hiking": 200,
  running: 100,
  "cycling-regular": 250,
  "cycling-road": 350,
  "cycling-mountain": 300,
  "cycling-electric": 280,
};

export function snapToSkeleton(coord, skeletonCoords, profile) {
  const threshold = SNAP_THRESHOLD_M[profile] ?? 200;
  let bestDist = Infinity;
  let bestCoord = null;
  for (const sk of skeletonCoords) {
    const d = haversineM(coord, sk);
    if (d < bestDist) {
      bestDist = d;
      bestCoord = sk;
    }
  }
  return bestCoord && bestDist <= threshold ? bestCoord : coord;
}

// ─── Ordering ─────────────────────────────────────────────────────────────────

export function sortPoisAlongLine(pois, start, end) {
  const [sx, sy] = start;
  const dx = end[0] - sx,
    dy = end[1] - sy;
  const lenSq = dx * dx + dy * dy || 1;
  return [...pois]
    .map((p) => ({ p, t: ((p.lng - sx) * dx + (p.lat - sy) * dy) / lenSq }))
    .sort((a, b) => a.t - b.t)
    .map(({ p }) => p);
}

export function sortPoisAroundLoop(pois, start) {
  if (pois.length <= 1) return [...pois];
  const remaining = [...pois];
  const sorted = [];
  let [curLng, curLat] = start;
  while (remaining.length) {
    let bestIdx = 0,
      bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineM(
        [curLng, curLat],
        [remaining[i].lng, remaining[i].lat],
      );
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const next = remaining.splice(bestIdx, 1)[0];
    sorted.push(next);
    curLng = next.lng;
    curLat = next.lat;
  }
  return sorted;
}

// ─── Feature output ──────────────────────────────────────────────────────────

export function enrichedPoiToFeature(poi, i) {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [poi.lng, poi.lat] },
    properties: {
      id: i,
      name: poi.name ?? null,
      category: poi.primary_type ?? poi.types?.[0] ?? null,
      distance_from_route: 0,
      guide_note: poi.guide_note ?? null,
      ai_description:
        poi.guide_note ?? poi.editorial_summary ?? poi.description ?? null,
      essential: poi.essential ?? false,
      rating: poi.rating,
      user_rating_count: poi.user_rating_count,
      formatted_address: poi.formatted_address,
      website_uri: poi.website_uri,
      google_maps_uri: poi.google_maps_uri,
      editorial_summary: poi.editorial_summary,
      photo_name: poi.photo_name,
      place_id: poi.place_id,
      user_named: poi._userNamed ?? false,
      gap_fill: poi._gapFill ?? false,
    },
  };
}

// ─── ORS routing with waypoint fallback ──────────────────────────────────────
// If ORS rejects a waypoint as unroutable (error mentions "coordinate N"), drop
// that waypoint and retry. protectedCount prevents dropping user/named anchors.

export async function fetchORSWithFallback(
  orsProfile,
  startCoord,
  midCoords,
  endCoord,
  opts = {},
  protectedCount = 0,
) {
  let waypoints = [...midCoords];
  for (;;) {
    try {
      const full = endCoord
        ? [startCoord, ...waypoints, endCoord]
        : [startCoord, ...waypoints];
      const radiuses =
        protectedCount > 0
          ? full.map((_, i) => (i >= 1 && i <= protectedCount ? 1500 : -1))
          : null;
      return await fetchORSDirections(orsProfile, full, {
        ...opts,
        ...(radiuses && { radiuses }),
      });
    } catch (err) {
      const match = err.message.match(/coordinate\s+(\d+)/i);
      if (!match) throw err;
      const absIdx = parseInt(match[1], 10);
      const wpIdx = absIdx - 1;
      if (wpIdx < 0 || wpIdx >= waypoints.length || wpIdx < protectedCount)
        throw err;
      console.warn(
        `[aiRouting] ORS 2010: dropping unroutable waypoint at position ${absIdx}`,
      );
      waypoints = waypoints.filter((_, i) => i !== wpIdx);
      if (!waypoints.length) throw err;
    }
  }
}
