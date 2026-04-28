// lib/ai/zones.js — spatial segmentation of A→B routes.
//
// A→B routes are divided into N zones (3/4/5 depending on distance) so
// discovery and category search can be scattered along the corridor instead
// of bunched at one point. Loops use a single "throughout the loop" zone
// built in the pipeline — they don't go through this module.

import { haversineM } from "../geo.js";

export function numZones(distanceKm) {
  if (distanceKm < 50) return 3;
  if (distanceKm < 120) return 4;
  return 5;
}

export function buildRouteZones(skeletonCoords, distanceKm, start, end) {
  const n = numZones(distanceKm);

  const cumul = [0];
  for (let i = 1; i < skeletonCoords.length; i++) {
    cumul.push(
      cumul[i - 1] + haversineM(skeletonCoords[i - 1], skeletonCoords[i]),
    );
  }
  const totalM = cumul[cumul.length - 1];

  const fractions = Array.from({ length: n }, (_, i) => i / (n - 1));
  const anchors = fractions.map((f) => {
    const target = f * totalM;
    let i = 0;
    while (i < cumul.length - 1 && cumul[i + 1] < target) i++;
    return skeletonCoords[i];
  });

  const zoneSpanM = totalM / (n - 1);

  const ZONE_LABELS_3 = [
    "near the start",
    "along the corridor",
    "near the destination",
  ];
  const ZONE_LABELS_4 = [
    "near the start",
    "in the first half",
    "in the second half",
    "near the destination",
  ];
  const ZONE_LABELS_5 = [
    "near the start",
    "in the early corridor",
    "midway through",
    "in the late corridor",
    "near the destination",
  ];
  const labelSets = { 3: ZONE_LABELS_3, 4: ZONE_LABELS_4, 5: ZONE_LABELS_5 };
  const labels = labelSets[n] ?? ZONE_LABELS_3;

  anchors[0] = start;
  anchors[n - 1] = end;

  return anchors.map((anchor, i) => {
    const isEndpoint = i === 0 || i === n - 1;
    const radius = isEndpoint
      ? Math.max(4_000, Math.min(8_000, zoneSpanM * 0.4))
      : Math.max(5_000, zoneSpanM * 0.6);
    return {
      label: labels[i] ?? `zone ${i + 1}`,
      anchor,
      searchCenter: anchor,
      searchRadius: radius,
      fraction: fractions[i],
      isStart: i === 0,
      isEnd: i === n - 1,
      isCorridor: i > 0 && i < n - 1,
    };
  });
}
