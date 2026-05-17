import { useRef, useEffect, useState, useMemo, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  PermissionsAndroid,
  useColorScheme,
  StatusBar,
  ActivityIndicator,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import {
  MapView,
  Camera,
  UserLocation,
  setAccessToken,
  type CameraRef,
} from "@maplibre/maplibre-react-native";
import { Colors } from "@/constants/theme";
import { t } from "@/lib/i18n";
import { useLoadedRoute } from "@/hooks/use-loaded-route";
import { usePoiRerouter } from "@/hooks/use-poi-rerouter";
import { useRouteSave } from "@/hooks/use-route-save";
import { useRouteExport } from "@/hooks/use-route-export";
import type {
  Coords,
  GenParams,
  PoiFeature,
  RoutePayload,
  RouteVariant,
} from "@/types/route";
import { notifyLoopMeta } from "@/lib/route-map-helpers";
import { MAP_STYLE_DARK, MAP_STYLE_LIGHT } from "@/lib/offline-map";
import { PoiDetailPanel } from "@/components/route-map/poi-detail-panel";
import { PoiListPanel } from "@/components/route-map/poi-list-panel";
import { RouteStatsPanel } from "@/components/route-map/route-stats-panel";
import { SaveRouteModal } from "@/components/route-map/save-route-modal";
import { ExportGpxDialog } from "@/components/route-map/export-gpx-dialog";
import { RouteLayers } from "@/components/route-map/route-layers";

setAccessToken(null);

const LOOP_COORD_TOLERANCE = 0.0005;
function geometryLooksLikeLoop(coords: Coords[]): boolean {
  if (coords.length < 2) return false;
  const first = coords[0];
  const last = coords[coords.length - 1];
  return (
    Math.abs(first[0] - last[0]) < LOOP_COORD_TOLERANCE &&
    Math.abs(first[1] - last[1]) < LOOP_COORD_TOLERANCE
  );
}

export default function RouteMapScreen() {
  const scheme = useColorScheme() ?? "light";
  const c = Colors[scheme];
  const insets = useSafeAreaInsets();
  const isDark = scheme === "dark";

  const params = useLocalSearchParams<{
    payload?: string;
    genParams?: string;
    savedId?: string;
  }>();

  const initialPayload = useMemo(
    () =>
      params.payload ? (JSON.parse(params.payload) as RoutePayload) : null,
    [params.payload],
  );
  const genParams = useMemo(
    () =>
      params.genParams ? (JSON.parse(params.genParams) as GenParams) : null,
    [params.genParams],
  );
  const routeSessionKey = useMemo(
    () => (params.payload ?? params.savedId ?? "") as string,
    [params.payload, params.savedId],
  );

  const { payload, loading: loadingSaved } = useLoadedRoute({
    savedId: params.savedId,
    initialPayload,
  });

  const [routes, setRoutes] = useState<RouteVariant[]>(payload?.routes ?? []);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const loopControlPoints = initialPayload?.controlPoints ?? [];

  useEffect(() => {
    if (payload?.routes) {
      setRoutes(payload.routes);
      setSelectedIndex(0);
    }
  }, [payload]);

  const loopMetaNotifiedRef = useRef(false);
  useEffect(() => {
    if (loopMetaNotifiedRef.current) return;
    if (notifyLoopMeta(initialPayload?.loop_meta, t)) {
      loopMetaNotifiedRef.current = true;
    }
  }, [initialPayload]);

  const variant = routes[selectedIndex] ?? null;

  const isLoop = useMemo(() => {
    if (genParams?.mode === "loop") return true;
    if (genParams?.mode === "ai" && !genParams.end) return true;
    if (payload?.loop_meta) return true;
    return geometryLooksLikeLoop(variant?.geometry?.coordinates ?? []);
  }, [genParams, payload, variant]);

  const handleVariantUpdated = useCallback(
    (next: RouteVariant) => {
      setRoutes((prev) => {
        const arr = [...prev];
        arr[selectedIndex] = next;
        return arr;
      });
      
      fittedVariantRef.current = -1;
    },
    [selectedIndex],
  );

  const { waypoints, waypointPois, isRegenerating, isWaypoint, toggleWaypoint } =
    usePoiRerouter({
      variant,
      genParams,
      isLoop,
      loopControlPoints,
      routeSessionKey,
      onVariantUpdated: handleVariantUpdated,
    });

  const pois = useMemo(
    () => (variant?.pois ?? []).filter((p) => p.properties.name),
    [variant],
  );

  const routePois = useMemo(() => {
    if (!genParams) return pois;
    const wpKey = (cd: Coords) => `${cd[0].toFixed(6)},${cd[1].toFixed(6)}`;
    const wpSet = new Set(waypoints.map(wpKey));
    const fromVariant = pois.filter((p) =>
      wpSet.has(wpKey(p.geometry.coordinates as Coords)),
    );
    const variantIds = new Set(fromVariant.map((p) => p.properties.id));
    const extra = waypointPois.filter(
      (p) => p.properties.name && !variantIds.has(p.properties.id),
    );
    return [...fromVariant, ...extra];
  }, [genParams, pois, waypoints, waypointPois]);

  const saveCtrl = useRouteSave({
    variant,
    genParams,
    routePois,
    initialSavedId: params.savedId,
  });
  const exportCtrl = useRouteExport({ variant, routePois });

  const cameraRef = useRef<CameraRef>(null);
  const fittedVariantRef = useRef<number>(-1);
  const [mapReady, setMapReady] = useState(false);

  const [showPois, setShowPois] = useState(false);
  const [selectedPoi, setSelectedPoi] = useState<PoiFeature | null>(null);

  useEffect(() => {
    if (Platform.OS === "android") {
      PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      );
    }
  }, []);

  useEffect(() => {
    if (!variant || !mapReady) return;
    if (fittedVariantRef.current === selectedIndex) return;
    fittedVariantRef.current = selectedIndex;
    const [minLng, minLat, maxLng, maxLat] = variant.bbox;
    cameraRef.current?.fitBounds([maxLng, maxLat], [minLng, minLat], 60, 400);
  }, [selectedIndex, mapReady, variant]);

  if (loadingSaved) {
    return (
      <View style={[styles.root, styles.centered, { backgroundColor: c.bg }]}>
        <ActivityIndicator color={c.tint} />
      </View>
    );
  }

  if (!payload || !variant) {
    return (
      <View style={[styles.root, styles.centered, { backgroundColor: c.bg }]}>
        <Ionicons name="map-outline" size={40} color={c.muted} />
        <Text style={[styles.emptyText, { color: c.muted }]}>
          {t("route-map.no-route")}
        </Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.backLink}>
          <Text style={{ color: c.tint, fontWeight: "600" }}>
            {t("route-map.go-back")}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  const handleSelectPoi = (poi: PoiFeature) => {
    setSelectedPoi(poi);
    cameraRef.current?.flyTo(poi.geometry.coordinates, 400);
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />

      <MapView
        style={styles.map}
        mapStyle={isDark ? MAP_STYLE_DARK : MAP_STYLE_LIGHT}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={false}
        onDidFinishLoadingMap={() => setMapReady(true)}
      >
        <Camera ref={cameraRef} />

        {mapReady && (
          <RouteLayers
            routes={routes}
            selectedIndex={selectedIndex}
            isLoop={isLoop}
            pois={pois}
            isDark={isDark}
            mapReady={mapReady}
            onSelectPoi={handleSelectPoi}
          />
        )}

        <UserLocation visible animated showsUserHeadingIndicator />
      </MapView>

      <View style={[styles.topControls, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity
          style={[styles.iconBtn, { backgroundColor: c.bg }]}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={20} color={c.text} />
        </TouchableOpacity>

        <View style={styles.topControlsRight}>
          <TouchableOpacity
            style={[
              styles.iconBtn,
              { backgroundColor: saveCtrl.savedRouteId ? c.tint : c.bg },
            ]}
            onPress={saveCtrl.openModal}
            disabled={!!saveCtrl.savedRouteId || saveCtrl.isSaving}
          >
            <Ionicons
              name={saveCtrl.savedRouteId ? "bookmark" : "bookmark-outline"}
              size={20}
              color={saveCtrl.savedRouteId ? "#fff" : c.tint}
            />
          </TouchableOpacity>

          {pois.length > 0 && (
            <TouchableOpacity
              style={[
                styles.iconBtn,
                { backgroundColor: showPois ? "#F59E0B" : c.bg },
              ]}
              onPress={() => {
                setShowPois((v) => !v);
                setSelectedPoi(null);
              }}
            >
              <Ionicons
                name="location-outline"
                size={20}
                color={showPois ? "#fff" : "#F59E0B"}
              />
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.iconBtn, { backgroundColor: c.bg }]}
            onPress={exportCtrl.openDialog}
            disabled={exportCtrl.isExporting || routes.length === 0}
          >
            {exportCtrl.isExporting ? (
              <ActivityIndicator size="small" color={c.tint} />
            ) : (
              <Ionicons name="download-outline" size={20} color={c.tint} />
            )}
          </TouchableOpacity>
        </View>
      </View>

      <PoiDetailPanel
        selectedPoi={selectedPoi}
        genParams={genParams}
        isWaypoint={isWaypoint}
        onToggleWaypoint={toggleWaypoint}
        isRegenerating={isRegenerating}
        onClose={() => setSelectedPoi(null)}
        bottomInset={insets.bottom}
        colors={c}
      />

      {!selectedPoi && showPois && (
        <PoiListPanel
          pois={pois}
          onSelect={(poi) => {
            setSelectedPoi(poi);
            setShowPois(false);
            cameraRef.current?.flyTo(poi.geometry.coordinates, 400);
          }}
          onClose={() => setShowPois(false)}
          bottomInset={insets.bottom}
          colors={c}
        />
      )}

      {!selectedPoi && !showPois && (
        <RouteStatsPanel
          variant={variant}
          bottomInset={insets.bottom}
          colors={c}
        />
      )}

      <SaveRouteModal
        visible={saveCtrl.modalOpen}
        onClose={saveCtrl.closeModal}
        title={saveCtrl.title}
        onTitleChange={saveCtrl.setTitle}
        description={saveCtrl.description}
        onDescriptionChange={saveCtrl.setDescription}
        saving={saveCtrl.isSaving}
        onSave={saveCtrl.save}
        colors={c}
      />

      <ExportGpxDialog
        visible={exportCtrl.dialogOpen}
        onClose={exportCtrl.closeDialog}
        filename={exportCtrl.filename}
        onFilenameChange={exportCtrl.setFilename}
        onConfirm={exportCtrl.confirm}
        colors={c}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { alignItems: "center", justifyContent: "center", gap: 12 },
  map: { flex: 1 },
  emptyText: { fontSize: 15 },
  backLink: { marginTop: 4 },

  topControls: {
    position: "absolute",
    top: 0,
    left: 16,
    right: 16,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  topControlsRight: { flexDirection: "row", gap: 10 },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
});
