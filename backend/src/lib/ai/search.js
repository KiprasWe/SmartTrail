// lib/ai/search.js — zone-aware ORS category POI search.
//
// PRIMARY source for category and mixed modes. Searches Google Places using
// exact category types from decomposed intents — returns only what the user
// asked for, no noise. Uses wider radius than the zone so the route naturally
// bends to reach good POIs rather than being constrained to the skeleton.

import { searchPlacesForAllIntents } from "../places.js";
import { dedupPois } from "./shared.js";

export async function searchIntentsByZone(intents, zones, placesCtx) {
  if (!intents.length || !zones.length) return [];

  console.log(
    `[aiRouting] ORS category search: ${intents.length} intents x ${zones.length} zones`,
  );

  const allResults = [];

  for (const intent of intents) {
    const intentResults = [];
    const seenIds = new Set();

    let targetZones;
    if (intent.location_scope === "at_start")
      targetZones = zones.filter((z) => z.isStart);
    else if (intent.location_scope === "at_end")
      targetZones = zones.filter((z) => z.isEnd);
    else if (intent.location_scope === "in_area")
      targetZones = zones.filter((z) => z.isEnd);
    else targetZones = zones;

    for (const zone of targetZones) {
      if (intentResults.length >= intent.count) break;
      const pois = await searchPlacesForAllIntents([intent], {
        ...placesCtx,
        searchCenter: zone.searchCenter,
        searchRadiusM: zone.searchRadius * 1.5,
      }).catch(() => []);

      for (const poi of pois) {
        if (!seenIds.has(poi.place_id) && intentResults.length < intent.count) {
          seenIds.add(poi.place_id);
          intentResults.push(poi);
        }
      }
    }

    allResults.push(...intentResults);
  }

  const pois = dedupPois(allResults);
  console.log(
    `[aiRouting] ORS category search: ${pois.length} POIs — ${pois.map((p) => p.name).join(" | ") || "(none)"}`,
  );
  return pois;
}
