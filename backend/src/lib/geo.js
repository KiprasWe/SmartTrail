export const METRES_PER_DEG_LAT = 111_320;

export function computeAscentDescent(elevArr) {
  let ascent = 0,
    descent = 0;
  for (let i = 1; i < elevArr.length; i++) {
    const diff = elevArr[i] - elevArr[i - 1];
    if (diff > 0) ascent += diff;
    else descent -= diff;
  }
  return { ascent_m: Math.round(ascent), descent_m: Math.round(descent) };
}

export function routeBbox(coords) {
  const lngs = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);
  return [
    Math.min(...lngs),
    Math.min(...lats),
    Math.max(...lngs),
    Math.max(...lats),
  ];
}

export function haversineM([lng1, lat1], [lng2, lat2]) {
  const R = 6_371_000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function thinCoords(coords, maxPts = 100) {
  if (coords.length <= maxPts) return coords;
  const step = (coords.length - 1) / (maxPts - 1);
  return Array.from({ length: maxPts }, (_, i) => coords[Math.round(i * step)]);
}

export function minDistToRoute(point, routeCoords, stride = 5) {
  let min = Infinity;
  for (let i = 0; i < routeCoords.length; i += stride) {
    const d = haversineM(point, routeCoords[i]);
    if (d < min) min = d;
  }
  return min;
}

export function computeDestination([lng, lat], bearing_deg, distance_m) {
  const R = 6_371_000;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lng * Math.PI) / 180;
  const θ = (bearing_deg * Math.PI) / 180;
  const δ = distance_m / R;
  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ),
  );
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2),
    );
  return [(λ2 * 180) / Math.PI, (φ2 * 180) / Math.PI];
}

export function bboxFromCenter([lng, lat], radiusM) {
  const latDelta = radiusM / METRES_PER_DEG_LAT;
  const lngDelta =
    radiusM / (METRES_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180) || 1);
  return {
    low: { latitude: lat - latDelta, longitude: lng - lngDelta },
    high: { latitude: lat + latDelta, longitude: lng + lngDelta },
  };
}

export function bboxFromCorridor(start, end, bufferM) {
  const minLat = Math.min(start[1], end[1]);
  const maxLat = Math.max(start[1], end[1]);
  const minLng = Math.min(start[0], end[0]);
  const maxLng = Math.max(start[0], end[0]);
  const midLat = (minLat + maxLat) / 2;
  const latBuffer = bufferM / METRES_PER_DEG_LAT;
  const lngBuffer =
    bufferM / (METRES_PER_DEG_LAT * Math.cos((midLat * Math.PI) / 180) || 1);
  return {
    low: { latitude: minLat - latBuffer, longitude: minLng - lngBuffer },
    high: { latitude: maxLat + latBuffer, longitude: maxLng + lngBuffer },
  };
}

export function boundingBox(lat, lng, radiusKm) {
  const latDelta = radiusKm / 111;
  const lngDelta =
    radiusKm / (111 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta,
  };
}

export function toLocalXY([lng, lat], [originLng, originLat]) {
  const R = 6_371_000;
  const dLat = ((lat - originLat) * Math.PI) / 180;
  const dLng = ((lng - originLng) * Math.PI) / 180;
  return [dLng * R * Math.cos((originLat * Math.PI) / 180), dLat * R];
}

export function corridorFilter(pois, start, end, corridorHalfWidthM = 3_000) {
  const e = toLocalXY(end, start);
  const lenSq = e[0] * e[0] + e[1] * e[1];
  if (lenSq < 1) return pois;
  const kept = [];
  const dropped = [];
  for (const poi of pois) {
    const p = toLocalXY([poi.lng, poi.lat], start);
    const t = (p[0] * e[0] + p[1] * e[1]) / lenSq;
    if (t < -0.1 || t > 1.05) {
      dropped.push({
        name: poi.name,
        reason: `behind/past route (t=${t.toFixed(2)})`,
      });
      continue;
    }
    const projX = t * e[0];
    const projY = t * e[1];
    const perp = Math.hypot(p[0] - projX, p[1] - projY);
    if (perp > corridorHalfWidthM) {
      dropped.push({
        name: poi.name,
        reason: `too far from route (${Math.round(perp)}m)`,
      });
      continue;
    }
    kept.push(poi);
  }
  if (dropped.length) {
    console.log(
      `[corridor] dropped ${dropped.length}:`,
      dropped.map((d) => `${d.name} — ${d.reason}`).join(" | "),
    );
  }
  return kept;
}

function pointToSegmentM(point, segA, segB) {
  const p = toLocalXY(point, segA);
  const e = toLocalXY(segB, segA);
  const lenSq = e[0] * e[0] + e[1] * e[1];
  if (lenSq < 1) return Math.hypot(p[0], p[1]); // degenerate segment
  const t = Math.max(0, Math.min(1, (p[0] * e[0] + p[1] * e[1]) / lenSq));
  return Math.hypot(p[0] - t * e[0], p[1] - t * e[1]);
}

export function polylineCorridorFilter(pois, routeCoords, halfWidthM = 3_000) {
  const thinned = thinCoords(routeCoords, 150);
  const kept = [];
  const dropped = [];
  for (const poi of pois) {
    const pt = [poi.lng, poi.lat];
    let minDist = Infinity;
    for (let i = 0; i < thinned.length - 1; i++) {
      const d = pointToSegmentM(pt, thinned[i], thinned[i + 1]);
      if (d < minDist) minDist = d;
      if (minDist === 0) break;
    }
    if (minDist <= halfWidthM) {
      kept.push(poi);
    } else {
      dropped.push({ name: poi.name, dist: Math.round(minDist) });
    }
  }
  if (dropped.length) {
    console.log(
      `[polylineCorridor] dropped ${dropped.length}:`,
      dropped.map((d) => `${d.name} — ${d.dist}m from route`).join(" | "),
    );
  }
  return kept;
}

export function douglasPeucker(coords, epsilon) {
  if (coords.length <= 2) return coords;
  const keep = new Uint8Array(coords.length);
  keep[0] = 1;
  keep[coords.length - 1] = 1;
  const stack = [[0, coords.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop();
    const [x1, y1] = coords[start];
    const [x2, y2] = coords[end];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy || 1;
    let maxDist = 0;
    let maxIdx = start;
    for (let i = start + 1; i < end; i++) {
      const [px, py] = coords[i];
      const t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
      const projX = x1 + t * dx - px;
      const projY = y1 + t * dy - py;
      const dist = Math.sqrt(projX * projX + projY * projY);
      if (dist > maxDist) {
        maxDist = dist;
        maxIdx = i;
      }
    }
    if (maxDist > epsilon) {
      keep[maxIdx] = 1;
      stack.push([start, maxIdx], [maxIdx, end]);
    }
  }
  return coords.filter((_, i) => keep[i]);
}

export function simplifyForThumbnail(geometry, maxPoints = 64) {
  const coords = geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length === 0) return null;
  if (coords.length <= maxPoints) return coords;
  // 0.0001° ≈ 11 m — good starting epsilon for route silhouettes
  const simplified = douglasPeucker(coords, 0.0001);
  if (simplified.length <= maxPoints) return simplified;
  // Still too many points — stride-sample the DP result
  const stride = Math.ceil(simplified.length / maxPoints);
  const out = [];
  for (let i = 0; i < simplified.length; i += stride) out.push(simplified[i]);
  const last = simplified[simplified.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

export function generateLoopControlPoints(
  start,
  targetDistanceM,
  N,
  rotationOffsetDeg = 0,
) {
  const ROAD_FACTOR = 0.65;
  const R = (targetDistanceM * ROAD_FACTOR) / (2 * N * Math.sin(Math.PI / N));

  const centre = computeDestination(start, rotationOffsetDeg, R);

  const baseBearing = (rotationOffsetDeg + 180) % 360;
  const cps = [];
  for (let i = 1; i < N; i++) {
    const bearing = (baseBearing + i * (360 / N)) % 360;
    cps.push(computeDestination(centre, bearing, R));
  }
  return cps;
}

export function sortByBearingFromOrigin(points, [originLng, originLat]) {
  function bearingTo([lng, lat]) {
    const dLng = ((lng - originLng) * Math.PI) / 180;
    const lat1 = (originLat * Math.PI) / 180;
    const lat2 = (lat * Math.PI) / 180;
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x =
      Math.cos(lat1) * Math.sin(lat2) -
      Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  }
  return [...points].sort((a, b) => bearingTo(a) - bearingTo(b));
}

export function sortWaypointsByRouteOrder(waypoints, routeCoords) {
  const indexed = waypoints.map((wp) => {
    let minDist = Infinity;
    let closestIdx = 0;
    for (let i = 0; i < routeCoords.length; i++) {
      const d = haversineM(wp, routeCoords[i]);
      if (d < minDist) {
        minDist = d;
        closestIdx = i;
      }
    }
    return { wp, closestIdx, minDist };
  });
  indexed.sort((a, b) => a.closestIdx - b.closestIdx);
  return indexed.map((x) => x.wp);
}
