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

export function latLngDistKm(a, b) {
  const dLat = (a.lat - b.lat) * 110.54;
  const dLng = (a.lng - b.lng) * 111.32 * Math.cos((a.lat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

export function toORS({ lat, lng }) {
  return [lng, lat];
}

export function thinCoords(coords, maxPts = 100) {
  if (coords.length <= maxPts) return coords;
  const step = (coords.length - 1) / (maxPts - 1);
  return Array.from({ length: maxPts }, (_, i) => coords[Math.round(i * step)]);
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
  const simplified = douglasPeucker(coords, 0.0001);
  if (simplified.length <= maxPoints) return simplified;
  const stride = Math.ceil(simplified.length / maxPoints);
  const out = [];
  for (let i = 0; i < simplified.length; i += stride) out.push(simplified[i]);
  const last = simplified[simplified.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}
