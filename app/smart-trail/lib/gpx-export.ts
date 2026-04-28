import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

type Coords = [number, number]; // [lng, lat]

export interface GpxWaypoint {
  name: string;
  lat: number;
  lng: number;
  description?: string | null;
}

export interface GpxRouteInput {
  title: string;
  coordinates: Coords[];
  startLat: number;
  startLng: number;
  waypoints?: GpxWaypoint[];
}

function escapeXml(str: string): string {
  return str.replace(
    /[<>&'"]/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        "'": "&apos;",
        '"': "&quot;",
      })[c] ?? c,
  );
}

function buildGpx({
  title,
  coordinates,
  startLat,
  startLng,
  waypoints,
}: GpxRouteInput): string {
  const safeName = escapeXml(title);

  const trkpts = coordinates
    .map(
      ([lng, lat]) =>
        `    <trkpt lat="${lat.toFixed(7)}" lon="${lng.toFixed(7)}"/>`,
    )
    .join("\n");

  const wpts = (waypoints ?? [])
    .map((w) => {
      const wName = escapeXml(w.name);
      const descEl = w.description
        ? `\n    <desc>${escapeXml(w.description)}</desc>`
        : "";
      return `  <wpt lat="${w.lat.toFixed(7)}" lon="${w.lng.toFixed(7)}">\n    <name>${wName}</name>${descEl}\n  </wpt>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="SmartTrail"
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${safeName}</name>
  </metadata>
  <wpt lat="${startLat.toFixed(7)}" lon="${startLng.toFixed(7)}">
    <name>Start — ${safeName}</name>
  </wpt>
${wpts ? wpts + "\n" : ""}  <trk>
    <name>${safeName}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}

function safeFilename(name: string): string {
  return (
    name
      .replace(/[^a-zA-Z0-9_\-\s]/g, "")
      .trim()
      .replace(/\s+/g, "_")
      .slice(0, 60) || "route"
  );
}

export class ExportCancelledError extends Error {
  constructor() {
    super("cancelled");
    this.name = "ExportCancelledError";
  }
}

export async function exportGpx(
  input: GpxRouteInput,
  filenameOverride?: string,
): Promise<void> {
  if (!input.coordinates || input.coordinates.length === 0) {
    throw new Error("Route has no coordinates.");
  }

  const gpxContent = buildGpx(input);
  const rawName = filenameOverride?.trim() || safeFilename(input.title);
  const filename = rawName.endsWith(".gpx") ? rawName : `${rawName}.gpx`;

  // Write to cache, then open the native share sheet.
  // On Android the user can save to Downloads, Drive, etc.
  // On iOS they get Files, AirDrop, etc.
  const file = new File(Paths.cache, filename);
  if (file.exists) file.delete();
  file.create();
  file.write(gpxContent);

  const available = await Sharing.isAvailableAsync();
  if (!available) throw new Error("Sharing is not available on this device.");

  await Sharing.shareAsync(file.uri, {
    mimeType: "application/gpx+xml",
    UTI: "public.gpx",
    dialogTitle: `Save ${filename}`,
  });
}
