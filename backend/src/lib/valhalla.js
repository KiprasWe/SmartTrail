// lib/valhalla.js — Valhalla routing API helpers
//
// Used for A-to-B routing. Valhalla has first-class use_hills and use_roads
// costing options — cycling profiles strongly prefer bike lanes/paths over
// car roads (use_roads:0.1), and elevation preference re-routes rather than
// just labelling an already-generated path.

import { fetchWithRetry } from "../utils/http.js";
import { computeAscentDescent } from "./geo.js";

const VALHALLA_URL = "https://valhalla1.openstreetmap.de";
const TIMEOUT_ROUTING_MS = 30_000;

// Valhalla encodes shape as polyline6 (precision 1e6, lat/lng order).
export function decodePolyline6(encoded) {
  const coords = [];
  let index = 0,
    lat = 0,
    lng = 0;
  while (index < encoded.length) {
    let b,
      shift = 0,
      result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    coords.push([lng / 1e6, lat / 1e6]); // → GeoJSON [lng, lat]
  }
  return coords;
}

export async function fetchValhalla(
  costing,
  locations,
  costingOptions = {},
  opts = {},
) {
  const body = {
    locations: locations.map(([lng, lat]) => ({ lon: lng, lat })),
    costing,
    costing_options: { [costing]: costingOptions },
    elevation_interval: 30,
    units: "km",
    language: "en-US",
    ...(opts.alternates > 0 && { alternates: opts.alternates }),
  };
  const res = await fetchWithRetry(
    `${VALHALLA_URL}/route`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    { timeoutMs: TIMEOUT_ROUTING_MS },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Valhalla error (${res.status}): ${text}`);
  }
  return res.json();
}

// Fetch real elevation values for an array of [lng, lat] coords using
// Valhalla's /height endpoint. Samples up to 200 points to stay under limits.
// Returns [] on failure so callers can degrade gracefully.
export async function fetchValhallaHeight(coords) {
  const stride = Math.max(1, Math.floor(coords.length / 200));
  const sampled = coords.filter((_, i) => i % stride === 0);
  try {
    const res = await fetchWithRetry(
      `${VALHALLA_URL}/height`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shape: sampled.map(([lng, lat]) => ({ lon: lng, lat })),
          height_precision: 0,
        }),
      },
      { timeoutMs: 10_000 },
    );
    if (!res.ok) return [];
    const json = await res.json();
    return json.height ?? [];
  } catch {
    return [];
  }
}

export function valhallaToRouteData(trip) {
  const leg = trip.legs[0];
  const coords = decodePolyline6(leg.shape);
  const elevArr = leg.elevation ?? [];
  const { ascent_m, descent_m } = computeAscentDescent(elevArr);
  const maneuvers = (leg.maneuvers ?? []).map((m) => ({
    instruction: m.instruction ?? "",
    type: m.type ?? 0,
    distance_km: +(m.length ?? 0).toFixed(3),
    duration_s: Math.round(m.time ?? 0),
  }));
  return {
    coords,
    elevArr,
    ascent_m,
    descent_m,
    maneuvers,
    distance_km: +trip.summary.length.toFixed(3),
    duration_s: Math.round(trip.summary.time),
  };
}

// Enrich route data with real elevation from /height if elevArr is missing.
export async function enrichWithElevation(data) {
  if (data.elevArr.length > 0) return data;
  const elevArr = await fetchValhallaHeight(data.coords);
  const { ascent_m, descent_m } = computeAscentDescent(elevArr);
  return { ...data, elevArr, ascent_m, descent_m };
}
