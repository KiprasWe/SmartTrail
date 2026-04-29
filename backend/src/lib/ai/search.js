// lib/ai/search.js — zone-aware ORS category POI search.
//
// PRIMARY source for category and mixed modes. Searches Google Places using
// exact category types from decomposed intents — returns only what the user
// asked for, no noise. Uses wider radius than the zone so the route naturally
// bends to reach good POIs rather than being constrained to the skeleton.
//
// When an intent has specific_area set (e.g. "eat in Kaunas"), the city is
// geocoded via Nominatim and used as the search center instead of the nearest
// zone — so the search actually lands in Kaunas.

import { searchPlacesForAllIntents, geocodeCity, searchCorridorByType } from "../places.js";
import { dedupPois } from "./shared.js";

export async function searchIntentsByZone(intents, zones, placesCtx, skeletonCoords = null) {
  if (!intents.length || !zones.length) return [];

  console.log(
    `[aiRouting] ORS category search: ${intents.length} intents x ${zones.length} zones`,
  );

  const allResults = [];

  for (const intent of intents) {
    const intentResults = [];
    const seenIds = new Set();

    // For in_area with a specific_area, geocode the city to get the real center.
    // This fixes the case where the user says "eat in Kaunas" but Kaunas is
    // not the route endpoint — previously the end zone was used instead.
    let specificCenter = null;
    if (intent.location_scope === "in_area" && intent.specific_area) {
      specificCenter = await geocodeCity(
        intent.specific_area,
        placesCtx.lang,
      ).catch(() => null);
      if (specificCenter) {
        console.log(
          `[aiRouting] in_area "${intent.specific_area}" geocoded → ` +
            `[${specificCenter.map((v) => v.toFixed(4)).join(", ")}]`,
        );
      } else {
        console.warn(
          `[aiRouting] in_area geocode failed for "${intent.specific_area}" — falling back to end zone`,
        );
      }
    }

    // along_route: scan the full skeleton polyline via Overpass instead of
    // the ORS zone anchors — ORS caps buffer at 2km which leaves huge gaps
    // on long rural routes.
    const useCorridorSearch =
      !specificCenter &&
      intent.location_scope === "along_route" &&
      skeletonCoords?.length > 2;

    if (useCorridorSearch) {
      const pois = await searchCorridorByType(
        skeletonCoords,
        intent.places_type,
        3_000,
        intent.count ?? 20,
      ).catch(() => []);

      for (const poi of pois) {
        if (!seenIds.has(poi.place_id)) {
          seenIds.add(poi.place_id);
          intentResults.push(poi);
        }
      }
    } else {
      let targetZones;
      if (specificCenter) {
        // Synthetic single-zone centred on the geocoded city (8 km radius)
        targetZones = [
          {
            searchCenter: specificCenter,
            searchRadius: 8_000,
            isStart: false,
            isEnd: false,
            isCorridor: false,
          },
        ];
      } else if (intent.location_scope === "at_start") {
        targetZones = zones.filter((z) => z.isStart);
      } else if (intent.location_scope === "at_end") {
        targetZones = zones.filter((z) => z.isEnd);
      } else if (intent.location_scope === "in_area") {
        targetZones = zones.filter((z) => z.isEnd);
      } else {
        targetZones = zones;
      }

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
            // Tag POIs from specific-area intents so corridor filter skips them
            intentResults.push(
              specificCenter ? { ...poi, _fromSpecificArea: true } : poi,
            );
          }
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
