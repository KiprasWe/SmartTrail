// components/saved-routes/route-preview.tsx
//
// Tiny SVG silhouette of a route — used for saved-route list thumbnails
// (Strava/Komoot style). Takes [lng, lat] coordinates + a bbox and projects
// them into the given pixel box, preserving aspect ratio at the route's
// latitude (equirectangular scale via cos(avgLat)).

import React, { useMemo } from "react";
import { View, StyleSheet } from "react-native";
import Svg, { Polyline, Circle } from "react-native-svg";
import type { Coords } from "@/types/route";

interface Props {
  coords: Coords[] | null | undefined;
  bbox?: [number, number, number, number] | null; // [minLng, minLat, maxLng, maxLat]
  width: number;
  height: number;
  color: string;
  backgroundColor?: string;
  strokeWidth?: number;
}

export function RoutePreview({
  coords,
  bbox,
  width,
  height,
  color,
  backgroundColor = "transparent",
  strokeWidth = 2.5,
}: Props) {
  const points = useMemo(() => {
    if (!coords || coords.length < 2) return null;

    // Derive bbox from coords if not supplied
    let minLng = bbox?.[0];
    let minLat = bbox?.[1];
    let maxLng = bbox?.[2];
    let maxLat = bbox?.[3];
    if (
      minLng == null ||
      minLat == null ||
      maxLng == null ||
      maxLat == null
    ) {
      minLng = Infinity;
      minLat = Infinity;
      maxLng = -Infinity;
      maxLat = -Infinity;
      for (const [lng, lat] of coords) {
        if (lng < minLng) minLng = lng;
        if (lat < minLat) minLat = lat;
        if (lng > maxLng) maxLng = lng;
        if (lat > maxLat) maxLat = lat;
      }
    }

    const padding = strokeWidth + 2;
    const innerW = Math.max(1, width - padding * 2);
    const innerH = Math.max(1, height - padding * 2);

    // Correct for longitude compression at this latitude — otherwise a
    // north-south route at 55°N would look ~2x taller than it should relative
    // to an east-west route of the same straight-line distance.
    const avgLat = (minLat + maxLat) / 2;
    const lngScale = Math.cos((avgLat * Math.PI) / 180);

    const spanX = Math.max(1e-9, (maxLng - minLng) * lngScale);
    const spanY = Math.max(1e-9, maxLat - minLat);

    // Fit the whole route inside the box with uniform scale + center
    const scale = Math.min(innerW / spanX, innerH / spanY);
    const drawW = spanX * scale;
    const drawH = spanY * scale;
    const offsetX = padding + (innerW - drawW) / 2;
    const offsetY = padding + (innerH - drawH) / 2;

    // Flip Y (north = up)
    const projected: [number, number][] = coords.map(([lng, lat]) => [
      offsetX + (lng - minLng!) * lngScale * scale,
      offsetY + drawH - (lat - minLat!) * scale,
    ]);

    return {
      polyline: projected.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" "),
      start: projected[0],
      end: projected[projected.length - 1],
    };
  }, [coords, bbox, width, height, strokeWidth]);

  if (!points) {
    return <View style={{ width, height, backgroundColor }} />;
  }

  return (
    <View style={[styles.wrap, { width, height, backgroundColor }]}>
      <Svg width={width} height={height}>
        <Polyline
          points={points.polyline}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Start dot */}
        <Circle
          cx={points.start[0]}
          cy={points.start[1]}
          r={strokeWidth}
          fill={color}
        />
        {/* End dot (hollow) */}
        <Circle
          cx={points.end[0]}
          cy={points.end[1]}
          r={strokeWidth}
          fill="#ffffff"
          stroke={color}
          strokeWidth={1.5}
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 10,
    overflow: "hidden",
  },
});
