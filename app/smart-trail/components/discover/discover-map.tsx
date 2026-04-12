// components/discover/discover-map.tsx

import React, { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, useColorScheme } from "react-native";
import {
  MapView,
  Camera,
  ShapeSource,
  CircleLayer,
  SymbolLayer,
  UserLocation,
  type CameraRef,
} from "@maplibre/maplibre-react-native";
import { Colors } from "@/constants/theme";
import type { DiscoverRoute } from "@/types/discover";

const OSM_STYLE = "https://tiles.openfreemap.org/styles/liberty";

interface Props {
  routes: DiscoverRoute[];
  centerCoordinate: [number, number]; // [lng, lat]
  onSelectRoute: (route: DiscoverRoute) => void;
  onRegionChanged: (center: { lat: number; lng: number }) => void;
}

export function DiscoverMap({
  routes,
  centerCoordinate,
  onSelectRoute,
  onRegionChanged,
}: Props) {
  const scheme = useColorScheme() ?? "light";
  const t = Colors[scheme];
  const shapeSourceRef = useRef<React.ElementRef<typeof ShapeSource>>(null);
  const cameraRef = useRef<CameraRef>(null);
  const [mapReady, setMapReady] = useState(false);

  // Track the last coordinates we actually moved the camera to so we don't
  // re-trigger setCamera on every parent re-render (centerCoordinate is a new
  // array reference each render even if the values haven't changed).
  const lastCenterRef = useRef<[number, number] | null>(null);

  // Gate that prevents us from forwarding onRegionDidChange events fired
  // before our initial setCamera has landed (they would clobber the center).
  const initialCenteredRef = useRef(false);

  useEffect(() => {
    if (!mapReady) return;

    const [lng, lat] = centerCoordinate;
    const prev = lastCenterRef.current;

    // Skip if coordinates haven't actually changed (avoids constant re-panning
    // that also kept resetting the initialCenteredRef timeout).
    if (prev && prev[0] === lng && prev[1] === lat) return;

    lastCenterRef.current = [lng, lat];
    initialCenteredRef.current = false;

    cameraRef.current?.setCamera({
      centerCoordinate,
      zoomLevel: 12,
      animationDuration: prev ? 600 : 0,
      animationMode: "easeTo",
    });

    const tm = setTimeout(() => {
      initialCenteredRef.current = true;
    }, 400);
    return () => clearTimeout(tm);
  }, [mapReady, centerCoordinate]);

  const featureCollection = useMemo(() => ({
    type: "FeatureCollection" as const,
    features: routes.map((r) => ({
      type: "Feature" as const,
      id: r.id,
      properties: { id: r.id, title: r.title, saveCount: r.saveCount },
      geometry: {
        type: "Point" as const,
        coordinates: [r.startLng, r.startLat],
      },
    })),
  }), [routes]);

  const routeById = useMemo(
    () => new Map(routes.map((r) => [r.id, r])),
    [routes],
  );

  const handlePress = async (e: any) => {
    const feature = e?.features?.[0];
    if (!feature) return;

    if (feature.properties?.cluster) {
      try {
        const zoom = await shapeSourceRef.current?.getClusterExpansionZoom(feature);
        cameraRef.current?.setCamera({
          centerCoordinate: feature.geometry.coordinates,
          zoomLevel: zoom ?? 14,
          animationDuration: 400,
          animationMode: "easeTo",
        });
      } catch {
        // ignore
      }
      return;
    }

    const id = feature.properties?.id;
    const route = id ? routeById.get(id) : null;
    if (route) onSelectRoute(route);
  };

  return (
    <MapView
      style={styles.map}
      mapStyle={OSM_STYLE}
      compassEnabled={false}
      attributionEnabled={false}
      logoEnabled={false}
      onDidFinishLoadingMap={() => setMapReady(true)}
      onRegionDidChange={(e: any) => {
        if (!initialCenteredRef.current) return;
        const c = e?.geometry?.coordinates;
        if (Array.isArray(c) && c.length === 2) {
          onRegionChanged({ lat: c[1], lng: c[0] });
        }
      }}
    >
      <Camera ref={cameraRef} />
      <UserLocation visible />

      {/* Key changes whenever routes.length changes — this forces ShapeSource
          to remount with fresh data, working around a MapLibre RN v10 bug
          where shape prop updates are not reliably applied to an already-
          mounted source with an initial empty FeatureCollection. */}
      <ShapeSource
        key={`discover-routes-${routes.length}`}
        ref={shapeSourceRef}
        id="discover-routes"
        shape={featureCollection}
        cluster
        clusterRadius={50}
        clusterMaxZoomLevel={14}
        onPress={handlePress}
      >
        {/* Cluster bubbles */}
        <CircleLayer
          id="discover-clusters"
          filter={["has", "point_count"]}
          style={{
            circleRadius: [
              "step", ["get", "point_count"],
              18, 10, 22, 50, 28,
            ],
            circleColor: t.tint,
            circleStrokeWidth: 2,
            circleStrokeColor: "#ffffff",
            circleOpacity: 0.9,
          }}
        />
        <SymbolLayer
          id="discover-cluster-count"
          filter={["has", "point_count"]}
          style={{
            textField: ["get", "point_count_abbreviated"],
            textSize: 13,
            textColor: "#ffffff",
          }}
        />

        {/* Individual route pins */}
        <CircleLayer
          id="discover-unclustered"
          filter={["!", ["has", "point_count"]]}
          style={{
            circleRadius: 8,
            circleColor: t.tint,
            circleStrokeWidth: 2,
            circleStrokeColor: "#ffffff",
          }}
        />
      </ShapeSource>
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: { flex: 1 },
});
