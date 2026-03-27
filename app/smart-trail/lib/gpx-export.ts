// lib/gpx-export.ts
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import type { OrsRoute } from "@/store/route-store";

function decodePolyline(encoded: string): [number, number][] {
  const coords: [number, number][] = [];
  let index = 0,
    lat = 0,
    lng = 0;
  while (index < encoded.length) {
    let shift = 0,
      result = 0,
      byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    coords.push([lng / 1e5, lat / 1e5]);
  }
  return coords;
}

function buildGpx(
  coords: [number, number][],
  name: string,
  description = "",
): string {
  const points = coords
    .map(([lon, lat]) => `    <trkpt lat="${lat}" lon="${lon}"></trkpt>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="SmartTrail" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${escapeXml(name)}</name>
    <desc>${escapeXml(description)}</desc>
  </metadata>
  <trk>
    <name>${escapeXml(name)}</name>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function exportRouteAsGpx(
  route: OrsRoute,
  name: string,
  description = "",
): Promise<void> {
  const coords =
    typeof route.geometry === "string"
      ? decodePolyline(route.geometry)
      : ((route.geometry as any)?.coordinates ?? []);

  const gpx = buildGpx(coords as [number, number][], name, description);
  const filename = `SmartTrail-${name.replace(/[^a-z0-9]/gi, "_").slice(0, 40)}-${Date.now()}.gpx`;
  const path = (FileSystem.cacheDirectory ?? "") + filename;

  await FileSystem.writeAsStringAsync(path, gpx, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) throw new Error("Sharing is not available on this device.");

  await Sharing.shareAsync(path, {
    mimeType: "application/gpx+xml",
    dialogTitle: "Export route as GPX",
    UTI: "com.topografix.gpx",
  });
}
