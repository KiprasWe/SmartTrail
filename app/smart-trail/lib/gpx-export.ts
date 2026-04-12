// lib/gpx-export.ts

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
  return str.replace(/[<>&'"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c] ?? c),
  );
}

function buildGpx({ title, coordinates, startLat, startLng, waypoints }: GpxRouteInput): string {
  const safeName = escapeXml(title);

  const trkpts = coordinates
    .map(([lng, lat]) => `    <trkpt lat="${lat.toFixed(7)}" lon="${lng.toFixed(7)}"/>`)
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

function safeFilename(title: string): string {
  return title
    .replace(/[^a-zA-Z0-9_\-\s]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 40) || "route";
}

export async function shareGpx(input: GpxRouteInput): Promise<void> {
  if (!input.coordinates || input.coordinates.length === 0) {
    throw new Error("Route has no coordinates.");
  }

  const gpxContent = buildGpx(input);
  const filename = `${safeFilename(input.title)}.gpx`;

  // SDK 54 / expo-file-system v19+ new API
  const file = new File(Paths.cache, filename);

  // Delete any stale file from a previous export with the same name
  if (file.exists) {
    file.delete();
  }
  file.create();
  file.write(gpxContent);

  // isAvailableAsync returns false on some Android emulators but
  // shareAsync itself still works — just attempt it regardless.
  await Sharing.shareAsync(file.uri, {
    mimeType: "application/gpx+xml",
    dialogTitle: `Export "${input.title}"`,
    UTI: "com.topografix.gpx", // iOS only, ignored on Android
  });
}
