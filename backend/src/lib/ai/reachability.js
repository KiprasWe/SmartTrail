// lib/ai/reachability.js — drop POIs separated from the route by barriers.
//
// Uses the ORS matrix API to compare straight-line vs routed distance from
// each POI to its nearest skeleton sample. A ratio > DETOUR_RATIO_MAX (or a
// routed distance > MAX_ROUTED_M) means the POI is on the other side of a
// river, fenced-off area, or similar obstacle — reaching it would blow up the
// route. POIs within ALWAYS_KEEP_M of the skeleton bypass the check entirely.
//
// Runs only for mixed mode — category-only searches are already near-corridor,
// and named anchors are always preserved.

import { haversineM } from "../geo.js";
import { dedupPois, ORS_API_KEY } from "./shared.js";

export async function filterReachablePois(
  pois,
  skeletonCoords,
  orsProfile,
  distanceKm,
) {
  if (!pois.length || !skeletonCoords?.length) return pois;

  // Sample skeleton points as sources (every ~2km to keep matrix small)
  const stepSize = Math.max(1, Math.floor(skeletonCoords.length / 10));
  const sources = skeletonCoords.filter((_, i) => i % stepSize === 0);

  // Only check POIs that are within straight-line range but might be across a barrier
  // POIs very close (<300m straight line) are always kept
  const ALWAYS_KEEP_M = 300;
  const alwaysKeep = pois.filter((p) =>
    sources.some((s) => haversineM(s, [p.lng, p.lat]) < ALWAYS_KEEP_M),
  );
  const toCheck = pois.filter(
    (p) => !sources.some((s) => haversineM(s, [p.lng, p.lat]) < ALWAYS_KEEP_M),
  );

  if (!toCheck.length) return pois;

  try {
    const locations = [
      ...sources.map((s) => s),
      ...toCheck.map((p) => [p.lng, p.lat]),
    ];

    const res = await fetch(
      "https://api.openrouteservice.org/v2/matrix/" + orsProfile,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: ORS_API_KEY,
        },
        body: JSON.stringify({
          locations,
          sources: sources.map((_, i) => i),
          destinations: toCheck.map((_, i) => sources.length + i),
          metrics: ["distance"],
          resolve_locations: false,
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );

    if (!res.ok) {
      console.warn(
        `[reachability] Matrix HTTP ${res.status} — skipping filter`,
      );
      return pois;
    }

    const data = await res.json();
    const distances = data.distances;

    const DETOUR_RATIO_MAX = 3.0;
    const MAX_ROUTED_M = Math.max(3000, distanceKm * 200);

    const reachable = toCheck.filter((poi, destIdx) => {
      let minRoutedM = Infinity;
      let minStraightM = Infinity;

      for (let srcIdx = 0; srcIdx < sources.length; srcIdx++) {
        const routed = distances[srcIdx]?.[destIdx];
        if (routed != null && routed < minRoutedM) {
          minRoutedM = routed;
          minStraightM = haversineM(sources[srcIdx], [poi.lng, poi.lat]);
        }
      }

      if (minRoutedM === Infinity) {
        console.log(
          `[reachability] Unreachable: "${poi.name}" — no route found`,
        );
        return false;
      }

      const ratio = minStraightM > 0 ? minRoutedM / minStraightM : 1;

      if (ratio > DETOUR_RATIO_MAX || minRoutedM > MAX_ROUTED_M) {
        console.log(
          `[reachability] Dropped "${poi.name}" — routed ${(minRoutedM / 1000).toFixed(1)}km ` +
            `vs straight ${(minStraightM / 1000).toFixed(1)}km (ratio ${ratio.toFixed(1)}x)`,
        );
        return false;
      }

      return true;
    });

    console.log(
      `[reachability] ${toCheck.length} checked → ${reachable.length} reachable ` +
        `(${toCheck.length - reachable.length} dropped as barrier-blocked)`,
    );

    return dedupPois([...alwaysKeep, ...reachable]);
  } catch (err) {
    console.warn(
      `[reachability] Matrix failed: ${err.message} — skipping filter`,
    );
    return pois;
  }
}
