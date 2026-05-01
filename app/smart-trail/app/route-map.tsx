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
  Alert,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import {
  MapView,
  Camera,
  ShapeSource,
  LineLayer,
  CircleLayer,
  SymbolLayer,
  UserLocation,
  setAccessToken,
  type CameraRef,
} from "@maplibre/maplibre-react-native";
import { Colors } from "@/constants/theme";
import { useAuthStore } from "@/store/use-auth-store";
import { useSavedRoutesStore } from "@/store/use-saved-routes-store";
import i18n from "@/lib/i18n";
import { useTranslation } from "@/hooks/use-translation";
import { useLoadedRoute } from "@/hooks/use-loaded-route";
import type {
  SaveRouteInput,
  Coords,
  PoiFeature,
  GenParams,
  RouteVariant,
  RoutePayload,
  LoopMeta,
} from "@/types/route";
import { exportGpx, ExportCancelledError } from "@/lib/gpx-export";
import {
  ROUTE_COLORS,
  notifyLoopMeta,
  poiDisplayName,
} from "@/lib/route-map-helpers";
import { PoiDetailPanel } from "@/components/route-map/poi-detail-panel";
import { PoiListPanel } from "@/components/route-map/poi-list-panel";
import { RouteStatsPanel } from "@/components/route-map/route-stats-panel";
import { SaveRouteModal } from "@/components/route-map/save-route-modal";
import { ExportGpxDialog } from "@/components/route-map/export-gpx-dialog";

setAccessToken(null);

const MAP_STYLE_LIGHT = "https://tiles.openfreemap.org/styles/liberty";
const MAP_STYLE_DARK =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

export default function RouteMapScreen() {
  const scheme = useColorScheme() ?? "light";
  const c = Colors[scheme];
  const insets = useSafeAreaInsets();
  const isDark = scheme === "dark";
  const { t: tr } = useTranslation();

  const params = useLocalSearchParams<{
    payload?: string;
    genParams?: string;
    savedId?: string;
    publicId?: string;
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

  const { payload, loading: loadingSaved } = useLoadedRoute({
    savedId: params.savedId,
    publicId: params.publicId,
    initialPayload,
  });

  const token = useAuthStore((s) => s.token);

  const [routes, setRoutes] = useState<RouteVariant[]>(payload?.routes ?? []);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [waypoints, setWaypoints] = useState<Coords[]>([]);
  const [waypointPois, setWaypointPois] = useState<PoiFeature[]>([]);
  const [loopControlPoints, setLoopControlPoints] = useState<Coords[]>(
    initialPayload?.controlPoints ?? [],
  );

  // Sync routes when a saved/public route resolves asynchronously
  useEffect(() => {
    if (payload?.routes) {
      setRoutes(payload.routes);
      setSelectedIndex(0);
    }
  }, [payload]);

  // Tracks whether we've already shown a loop_meta toast for this navigation
  // so re-rendering the screen doesn't re-pop the same alert.
  const loopMetaNotifiedRef = useRef(false);
  useEffect(() => {
    if (loopMetaNotifiedRef.current) return;
    if (notifyLoopMeta(initialPayload?.loop_meta, tr)) {
      loopMetaNotifiedRef.current = true;
    }
  }, [initialPayload, tr]);

  const [isRegenerating, setIsRegenerating] = useState(false);
  const [showPois, setShowPois] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [selectedPoi, setSelectedPoi] = useState<PoiFeature | null>(null);

  // Save-route modal
  const saveRoute = useSavedRoutesStore((s) => s.save);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveTitle, setSaveTitle] = useState("");
  const [saveDescription, setSaveDescription] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportFilename, setExportFilename] = useState("");

  const openExportDialog = useCallback(() => {
    const today = new Date().toISOString().slice(0, 10);
    setExportFilename(`route_${today}`);
    setExportDialogOpen(true);
  }, []);

  const [savedRouteId, setSavedRouteId] = useState<string | null>(
    params.savedId ?? null,
  );

  const variant = routes[selectedIndex] ?? null;
  const cameraRef = useRef<CameraRef>(null);
  // Track which variant we've already fitted so POI state changes never re-trigger fitBounds
  const fittedVariantRef = useRef<number>(-1);

  // Stable pois reference — only recomputes when the variant changes, not on every render
  const pois = useMemo(
    () => (variant?.pois ?? []).filter((p) => p.properties.name),
    [variant],
  );

  // POIs that are actually part of the route — used for GPX export and DB save.
  // Saved/public routes: all stored pois (already filtered at save time).
  // AI mode: essential pois + any optional ones the user toggled on.
  // Manual modes: only pois the user explicitly added as waypoints (by object, not coords).
  const routePois = useMemo(() => {
    if (!genParams) {
      return (variant?.pois ?? []).filter((p) => p.properties.name);
    }
    if (genParams.mode === "ai") {
      const essential = (variant?.pois ?? []).filter(
        (p) => p.properties.essential === true && p.properties.name,
      );
      const essentialIds = new Set(essential.map((p) => p.properties.id));
      const toggled = waypointPois.filter(
        (p) => !essentialIds.has(p.properties.id) && p.properties.name,
      );
      return [...essential, ...toggled];
    }
    return waypointPois.filter((p) => p.properties.name);
  }, [variant, waypointPois, genParams]);

  const handleConfirmExport = useCallback(async () => {
    const route = routes[selectedIndex];
    if (!route) return;
    setExportDialogOpen(false);
    setIsExporting(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const filename = exportFilename.trim() || `route_${today}`;
      const gpxWaypoints = routePois.map((p) => ({
        name: p.properties.name!,
        lat: p.geometry.coordinates[1],
        lng: p.geometry.coordinates[0],
        description:
          p.properties.ai_description ??
          p.properties.editorial_summary ??
          p.properties.category ??
          undefined,
      }));

      await exportGpx(
        {
          title: filename,
          coordinates: route.geometry.coordinates as [number, number][],
          startLat: route.geometry.coordinates[0][1],
          startLng: route.geometry.coordinates[0][0],
          waypoints: gpxWaypoints.length > 0 ? gpxWaypoints : undefined,
        },
        filename,
      );
      Alert.alert(
        tr("route-map.export-gpx"),
        tr("route-map.export-gpx-success"),
      );
    } catch (err) {
      if (err instanceof ExportCancelledError) return;
      console.error("[GPX export]", err);
      Alert.alert(tr("route-map.export-gpx"), tr("route-map.export-gpx-error"));
    } finally {
      setIsExporting(false);
    }
  }, [routes, selectedIndex, exportFilename, routePois, tr]);

  const isWaypoint = useCallback(
    (poi: PoiFeature) =>
      waypoints.some(
        (w) =>
          w[0] === poi.geometry.coordinates[0] &&
          w[1] === poi.geometry.coordinates[1],
      ),
    [waypoints],
  );

  const handleToggleWaypoint = useCallback(
    async (poi: PoiFeature) => {
      if (!genParams || !variant) return;

      const coords = poi.geometry.coordinates as Coords;
      const removing = isWaypoint(poi);
      const newWaypoints = removing
        ? waypoints.filter((w) => !(w[0] === coords[0] && w[1] === coords[1]))
        : [...waypoints, coords];

      setWaypoints(newWaypoints);
      setWaypointPois((prev) =>
        removing
          ? prev.filter((p) => p.properties.id !== poi.properties.id)
          : [...prev, poi],
      );
      setIsRegenerating(true);

      try {
        let endpoint: string;
        let body: Record<string, unknown>;
        let newRoute: RouteVariant;

        if (genParams.mode === "ai") {
          // AI mode: lightweight reroute through current essential POIs ± toggled one.
          // We don't re-run Gemini — just update the ORS route geometry and flip the
          // essential flag on the toggled POI in the existing POI list.
          const essentialCoords = (variant.pois ?? [])
            .filter((p) => p.properties.essential)
            .map((p) => p.geometry.coordinates as Coords);

          const newEssentialCoords = removing
            ? essentialCoords.filter(
                (w) => !(w[0] === coords[0] && w[1] === coords[1]),
              )
            : [...essentialCoords, coords];

          endpoint = `${process.env.EXPO_PUBLIC_API_URL}/routes/generate-ai/reroute`;
          body = {
            start: genParams.start,
            ...(genParams.end
              ? { end: genParams.end }
              : { distance: genParams.distance }),
            profile: genParams.profile,
            elevationPreference: genParams.elevationPreference,
            waypoints: newEssentialCoords,
          };

          const res = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify(body),
          });

          const json = await res.json();
          if (!res.ok || json.status !== "success")
            throw new Error(json.message ?? "Failed");

          newRoute = json.data.routes[0];

          // Restore all existing POI markers with the toggled POI's essential
          // flag flipped. Route geometry updates, POI list stays intact.
          newRoute.pois = (variant.pois ?? []).map((p) => {
            const c = p.geometry.coordinates;
            const isToggled = c[0] === coords[0] && c[1] === coords[1];
            if (!isToggled) return p;
            return {
              ...p,
              properties: { ...p.properties, essential: !removing },
            };
          });
        } else {
          // A→B / loop mode: regenerate through the new waypoint set
          endpoint =
            genParams.mode === "loop"
              ? `${process.env.EXPO_PUBLIC_API_URL}/routes/generate-loop`
              : `${process.env.EXPO_PUBLIC_API_URL}/routes/generate`;

          body = {
            ...genParams,
            waypoints: newWaypoints,
            variantLabel: variant.label,
          };
          if (genParams.mode === "loop" && loopControlPoints.length > 0) {
            body.controlPoints = loopControlPoints;
          }

          const res = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify(body),
          });

          const json = await res.json();
          if (!res.ok || json.status !== "success")
            throw new Error(json.message ?? "Failed");

          if (
            genParams.mode === "loop" &&
            Array.isArray(json.data.controlPoints)
          ) {
            setLoopControlPoints(json.data.controlPoints);
          }
          if (genParams.mode === "loop") {
            notifyLoopMeta(json.data.loop_meta as LoopMeta | undefined, tr);
          }

          newRoute = json.data.routes[0];
        }

        setRoutes((prev) => {
          const next = [...prev];
          next[selectedIndex] = newRoute;
          return next;
        });
        fittedVariantRef.current = -1;
      } catch (err: unknown) {
        setWaypoints(waypoints); // revert
        const msg =
          err instanceof Error ? err.message : tr("route-map.load-error");
        Alert.alert(tr("common.error"), msg);
      } finally {
        setIsRegenerating(false);
      }
    },
    [
      genParams,
      variant,
      waypoints,
      isWaypoint,
      selectedIndex,
      token,
      loopControlPoints,
      tr,
    ],
  );

  // ─── Save route ─────────────────────────────────────────────────────────────
  //
  // Map the backend's generator response (snake_case, km/s units) into the
  // camelCase schema expected by POST /routes/saved (int metres/seconds).
  const buildSavePayload = useCallback(
    (title: string, description: string): SaveRouteInput | null => {
      if (!variant || !genParams) return null;

      // Backend mode enum is uppercased; AI mode currently isn't carried in
      // genParams (only a_to_b / loop come from the map screen), but future-proof it.
      return {
        title: title.trim(),
        description: description.trim() || undefined,
        transport: genParams.profile,
        distance: Math.round(variant.distance_km * 1000),
        duration: Math.round(variant.duration_s),
        ascent: Math.round(variant.ascent_m),
        descent: Math.round(variant.descent_m),
        geometry: variant.geometry,
        bbox: variant.bbox,
        elevationProfile: variant.elevation_profile ?? undefined,
        pois: routePois.length > 0 ? routePois : undefined,
      };
    },
    [variant, genParams, routePois],
  );

  // Pre-fill the title with something sensible when the modal opens.
  const openSaveModal = useCallback(() => {
    if (!variant) return;
    const km = variant.distance_km.toFixed(1);
    const prettyProfile = variant.profile
      .replace(/^foot-/, "")
      .replace(/^cycling-/, "")
      .replace(/-/g, " ");
    const defaultTitle =
      genParams?.mode === "loop"
        ? `${prettyProfile} loop · ${km} km`
        : `${prettyProfile} · ${km} km`;
    setSaveTitle(defaultTitle);
    setSaveDescription("");
    setSaveModalOpen(true);
  }, [variant, genParams]);

  const handleSave = useCallback(async () => {
    const saveInput = buildSavePayload(saveTitle, saveDescription);
    if (!saveInput) return;
    if (!saveInput.title) {
      Alert.alert(
        tr("route-map.title-required"),
        tr("route-map.title-required-body"),
      );
      return;
    }
    setIsSaving(true);
    try {
      const saved = await saveRoute(saveInput);
      setSavedRouteId(saved.id);
      setSaveModalOpen(false);
    } catch (err: unknown) {
      const e = err as {
        response?: { data?: { code?: string } };
        message?: string;
      };
      Alert.alert(
        tr("route-map.save-error"),
        e?.response?.data?.code ?? e?.message ?? "Please try again.",
      );
    } finally {
      setIsSaving(false);
    }
  }, [buildSavePayload, saveTitle, saveDescription, saveRoute, tr]);

  const poiGeoJSON = useMemo(() => {
    if (!pois.length) return null;
    const features = pois.map((p) => ({
      ...p,
      properties: {
        ...p.properties,
        display_name:
          poiDisplayName(p.properties.name, p.properties.category, tr) ??
          p.properties.name ??
          "",
      },
    }));
    return { type: "FeatureCollection" as const, features };
  }, [pois, tr]);

  useEffect(() => {
    if (Platform.OS === "android") {
      PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      );
    }
  }, []);

  // Fit camera to selected route bbox — only once per variant, never again (so POI
  // open/close or any other state change cannot trigger a re-fit / zoom-out)
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
          {tr("route-map.no-route")}
        </Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.backLink}>
          <Text style={{ color: c.tint, fontWeight: "600" }}>
            {tr("route-map.go-back")}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />

      {/* ── Map ── */}
      <MapView
        style={styles.map}
        mapStyle={isDark ? MAP_STYLE_DARK : MAP_STYLE_LIGHT}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={false}
        onDidFinishLoadingMap={() => setMapReady(true)}
      >
        <Camera ref={cameraRef} />

        {routes.map((r, i) => (
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
          </ShapeSource>
        ))}

        {poiGeoJSON && mapReady && (
          <ShapeSource
            id="pois-source"
            shape={poiGeoJSON}
            onPress={(e) => {
              const f = e.features?.[0];
              if (!f) return;
              const found = pois.find(
                (p) => p.properties.id === f.properties?.id,
              );
              if (found) {
                setSelectedPoi(found);
                cameraRef.current?.flyTo(found.geometry.coordinates, 400);
              }
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

        <UserLocation visible animated showsUserHeadingIndicator />
      </MapView>

      {/* ── Top controls ── */}
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
              { backgroundColor: savedRouteId ? c.tint : c.bg },
            ]}
            onPress={openSaveModal}
            disabled={!!savedRouteId || isSaving}
          >
            <Ionicons
              name={savedRouteId ? "bookmark" : "bookmark-outline"}
              size={20}
              color={savedRouteId ? "#fff" : c.tint}
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
            onPress={openExportDialog}
            disabled={isExporting || routes.length === 0}
          >
            {isExporting ? (
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
        onToggleWaypoint={handleToggleWaypoint}
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
          routes={routes}
          selectedIndex={selectedIndex}
          onSelectVariant={(i) => {
            setSelectedIndex(i);
            setSelectedPoi(null);
          }}
          poisCount={pois.length}
          bottomInset={insets.bottom}
          colors={c}
        />
      )}

      <SaveRouteModal
        visible={saveModalOpen}
        onClose={() => setSaveModalOpen(false)}
        title={saveTitle}
        onTitleChange={setSaveTitle}
        description={saveDescription}
        onDescriptionChange={setSaveDescription}
        saving={isSaving}
        onSave={handleSave}
        colors={c}
      />

      <ExportGpxDialog
        visible={exportDialogOpen}
        onClose={() => setExportDialogOpen(false)}
        filename={exportFilename}
        onFilenameChange={setExportFilename}
        onConfirm={handleConfirmExport}
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
