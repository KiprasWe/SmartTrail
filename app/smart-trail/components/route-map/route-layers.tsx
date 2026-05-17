import { useMemo } from "react";
import {
  ShapeSource,
  LineLayer,
  CircleLayer,
  SymbolLayer,
} from "@maplibre/maplibre-react-native";
import { ROUTE_COLORS, poiDisplayName } from "@/lib/route-map-helpers";
import { t } from "@/lib/i18n";
import type { Coords, PoiFeature, RouteVariant } from "@/types/route";

type Props = {
  routes: RouteVariant[];
  selectedIndex: number;
  isLoop: boolean;
  pois: PoiFeature[];
  isDark: boolean;
  mapReady: boolean;
  
  onSelectPoi: (poi: PoiFeature) => void;
};

export function RouteLayers({
  routes,
  selectedIndex,
  isLoop,
  pois,
  isDark,
  mapReady,
  onSelectPoi,
}: Props) {
  const variant = routes[selectedIndex] ?? null;

  const startEndGeoJSON = useMemo(() => {
    if (!variant || !mapReady) return null;
    const coords = variant.geometry?.coordinates;
    if (!coords?.length) return null;
    const startCoord = coords[0] as Coords;
    const endCoord = coords[coords.length - 1] as Coords;
    if (isLoop) {
      return {
        type: "FeatureCollection" as const,
        features: [
          {
            type: "Feature" as const,
            geometry: { type: "Point" as const, coordinates: startCoord },
            properties: { markerType: "start_finish", label: "S" },
          },
        ],
      };
    }
    return {
      type: "FeatureCollection" as const,
      features: [
        {
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: startCoord },
          properties: { markerType: "start", label: "S" },
        },
        {
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: endCoord },
          properties: { markerType: "finish", label: "F" },
        },
      ],
    };
  }, [variant, isLoop, mapReady]);

  const poiGeoJSON = useMemo(() => {
    if (!pois.length) return null;
    const features = pois.map((p) => ({
      ...p,
      properties: {
        ...p.properties,
        display_name:
          poiDisplayName(p.properties.name, p.properties.category, t) ??
          p.properties.name ??
          "",
      },
    }));
    return { type: "FeatureCollection" as const, features };
  }, [pois]);

  return (
    <>
      {routes.map((r, i) =>
        !r.geometry?.coordinates?.length ? null : (
        <ShapeSource
          key={`route-${i}`}
          id={`route-source-${i}`}
          shape={{ type: "Feature", geometry: r.geometry, properties: {} }}
        >
          <LineLayer
            id={`route-line-${i}`}
            style={{
              lineColor:
                i === selectedIndex
                  ? ROUTE_COLORS[i % ROUTE_COLORS.length]
                  : "#aaaaaa",
              lineWidth: i === selectedIndex ? 5 : 2,
              lineCap: "round",
              lineJoin: "round",
              lineOpacity: i === selectedIndex ? 1 : 0.35,
            }}
          />
          {i === selectedIndex && (
            <SymbolLayer
              id={`route-arrows-${i}`}
              style={{
                symbolPlacement: "line",
                symbolSpacing: 120,
                textField: ">",
                textSize: 22,
                textColor: "#ffffff",
                textFont: ["Noto Sans Regular"],
                textRotationAlignment: "map",
                textKeepUpright: false,
                textOpacity: 0.9,
              }}
            />
          )}
        </ShapeSource>
      ))}

      {startEndGeoJSON && (
        <ShapeSource id="start-end-source" shape={startEndGeoJSON}>
          <CircleLayer
            id="start-end-circles"
            style={{
              circleRadius: 8,
              circleColor: [
                "match",
                ["get", "markerType"],
                "start",
                "#22c55e",
                "finish",
                "#ef4444",
                "#f59e0b",
              ] as any,
              circleStrokeWidth: 2.5,
              circleStrokeColor: "#ffffff",
            }}
          />
        </ShapeSource>
      )}

      {poiGeoJSON && (
        <ShapeSource
          id="pois-source"
          shape={poiGeoJSON}
          onPress={(e) => {
            const f = e.features?.[0];
            if (!f) return;
            const found = pois.find(
              (p) => p.properties.id === f.properties?.id,
            );
            if (found) onSelectPoi(found);
          }}
        >
          <CircleLayer
            id="pois-layer"
            style={{
              circleRadius: 8,
              circleColor: "#F59E0B",
              circleStrokeWidth: 2.5,
              circleStrokeColor: "#ffffff",
            }}
          />
          <SymbolLayer
            id="pois-label-layer"
            style={{
              textField: "{display_name}",
              textFont: ["Noto Sans Regular"],
              textSize: 11,
              textOffset: [0, 1.6],
              textAnchor: "top",
              textColor: isDark ? "#f0f0f0" : "#1a1a1a",
              textHaloColor: isDark ? "#1a1a1a" : "#ffffff",
              textHaloWidth: 2,
              textOptional: true,
            }}
          />
        </ShapeSource>
      )}
    </>
  );
}
