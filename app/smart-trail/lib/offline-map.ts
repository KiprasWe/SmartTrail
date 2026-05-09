import { OfflineManager } from "@maplibre/maplibre-react-native";

export const MAP_STYLE_LIGHT = "https://tiles.openfreemap.org/styles/liberty";
export const MAP_STYLE_DARK =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

const packName = (routeId: string, style: "light" | "dark") =>
  `smarttrail_${routeId}_${style}`;

export async function downloadOfflinePack(
  routeId: string,
  bbox: [number, number, number, number],
): Promise<void> {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const bounds: [[number, number], [number, number]] = [
    [maxLng, maxLat],
    [minLng, minLat],
  ];

  for (const [key, styleURL] of [
    ["light", MAP_STYLE_LIGHT],
    ["dark", MAP_STYLE_DARK],
  ] as const) {
    const name = packName(routeId, key);
    try {
      const existing = await OfflineManager.getPack(name);
      if (existing) continue;
      await OfflineManager.createPack(
        { name, styleURL, bounds, minZoom: 10, maxZoom: 14 },
        () => {},
        () => {},
      );
    } catch {}
  }
}

export async function deleteOfflinePack(routeId: string): Promise<void> {
  for (const style of ["light", "dark"] as const) {
    try {
      await OfflineManager.deletePack(packName(routeId, style));
    } catch {}
  }
}

export async function deleteAllOfflinePacks(
  routeIds: string[],
): Promise<void> {
  await Promise.all(routeIds.map(deleteOfflinePack));
}
