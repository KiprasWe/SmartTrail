import React, { useRef, useEffect, useState, useMemo, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
  PermissionsAndroid,
  useColorScheme,
  StatusBar,
  Animated,
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Switch,
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
  UserLocation,
  setAccessToken,
  type CameraRef,
} from "@maplibre/maplibre-react-native";
import { Colors } from "@/constants/theme";
import { useAuthStore } from "@/store/use-auth-store";
import { useSavedRoutesStore } from "@/store/use-saved-routes-store";
import { useWeatherStore } from "@/store/use-weather-store";
import { sampleRoutePoints } from "@/lib/weather";
import { WeatherCard } from "@/components/weather/weather-card";
import type { WeatherSnapshot } from "@/types/weather";
import i18n from "@/lib/i18n";
import { useTranslation } from "@/hooks/use-translation";
import type { RouteMode, SaveRouteInput } from "@/types/route";
import { shareGpx } from "@/lib/gpx-export";

setAccessToken(null);

const OSM_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const ROUTE_COLORS = ["#16A34A", "#3B82F6", "#F59E0B"];

// ─── Types ────────────────────────────────────────────────────────────────────

type Coords = [number, number];

interface GenParams {
  mode: "a_to_b" | "loop" | "ai";
  start: Coords;
  end?: Coords;
  distance?: number;
  profile: string;
  elevationPreference: string;
  poiTypes: string[];
  waypoints?: Coords[];
}

interface Poi {
  type: "Feature";
  geometry: { type: "Point"; coordinates: Coords };
  properties: {
    id: number;
    name: string | null;
    category: string | null;
    distance_from_route: number;
    // AI / Google Places enrichment (only present for AI mode)
    place_id?: string | null;
    ai_description?: string | null;
    rating?: number | null;
    user_rating_count?: number | null;
    formatted_address?: string | null;
    website_uri?: string | null;
    google_maps_uri?: string | null;
    editorial_summary?: string | null;
    photo_name?: string | null;
  };
}

interface RouteVariant {
  label: string;
  description: string;
  profile: string;
  distance_km: number;
  duration_s: number;
  ascent_m: number;
  descent_m: number;
  geometry: { type: "LineString"; coordinates: Coords[] };
  bbox: [number, number, number, number];
  pois: Poi[];
  overlap_ratio?: number;
}

interface Payload {
  profile: string;
  elevation_preference: string;
  routes: RouteVariant[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDist(km: number) {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

function formatTime(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m} min`;
}

const CATEGORY_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  // sustenance / food group
  cafe: "cafe-outline",
  coffee: "cafe-outline",
  restaurant: "restaurant-outline",
  bar: "wine-outline",
  pub: "wine-outline",
  "fast food": "fast-food-outline",
  // natural group
  natural: "leaf-outline",
  park: "leaf-outline",
  nature: "leaf-outline",
  waterfall: "water-outline",
  spring: "water-outline",
  water: "water-outline",
  beach: "sunny-outline",
  peak: "triangle-outline",
  cliff: "triangle-outline",
  cave: "moon-outline",
  // tourism group
  tourism: "eye-outline",
  viewpoint: "eye-outline",
  attraction: "star-outline",
  information: "information-circle-outline",
  // historic group
  historic: "flag-outline",
  monument: "flag-outline",
  memorial: "flag-outline",
  castle: "business-outline",
  ruins: "business-outline",
  // arts & culture group
  museum: "color-palette-outline",
  gallery: "color-palette-outline",
  theatre: "musical-notes-outline",
  cinema: "film-outline",
  // leisure group
  leisure: "basketball-outline",
  sports: "basketball-outline",
  "sports centre": "basketball-outline",
  "picnic site": "umbrella-outline",
  playground: "happy-outline",
  // facilities group
  toilet: "body-outline",
  bench: "body-outline",
  drinking: "water-outline",
};

// Builds a URL pointing at our backend's Google Places photo proxy. The proxy
// resolves the photoName to the actual image and 302-redirects, so RN's <Image>
// just follows it transparently. The API key never touches the client.
function placePhotoUrl(photoName: string, height = 400, width = 400) {
  const base = process.env.EXPO_PUBLIC_API_URL;
  return `${base}/places/photo?name=${encodeURIComponent(photoName)}&maxHeight=${height}&maxWidth=${width}`;
}

async function openExternal(url?: string | null) {
  if (!url) return;
  try {
    const can = await Linking.canOpenURL(url);
    if (can) await Linking.openURL(url);
  } catch {
    // ignore
  }
}

function poiIcon(category: string | null): keyof typeof Ionicons.glyphMap {
  if (!category) return "location-outline";
  const lower = category.toLowerCase();
  for (const [key, icon] of Object.entries(CATEGORY_ICONS)) {
    if (lower.includes(key)) return icon;
  }
  return "location-outline";
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function RouteMapScreen() {
  const scheme = useColorScheme() ?? "light";
  const t = Colors[scheme];
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
    () => (params.payload ? (JSON.parse(params.payload) as Payload) : null),
    [params.payload],
  );
  const genParams = useMemo(
    () => (params.genParams ? (JSON.parse(params.genParams) as GenParams) : null),
    [params.genParams],
  );
  // If opened from a saved-route card, resolve the payload asynchronously
  // (cache-first, so it works offline)
  const [payload, setPayload] = useState<Payload | null>(initialPayload);

  const token = useAuthStore((s) => s.token);

  const [routes, setRoutes] = useState<RouteVariant[]>(payload?.routes ?? []);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [waypoints, setWaypoints] = useState<Coords[]>([]);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [showPois, setShowPois] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [selectedPoi, setSelectedPoi] = useState<Poi | null>(null);

  // Save-route modal
  const saveRoute = useSavedRoutesStore((s) => s.save);
  const getSavedById = useSavedRoutesStore((s) => s.getById);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveTitle, setSaveTitle] = useState("");
  const [saveDescription, setSaveDescription] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const handleExportGpx = useCallback(async () => {
    const route = routes[selectedIndex];
    if (!route) return;
    setIsExporting(true);
    try {
      const gpxWaypoints = (route.pois ?? [])
        .filter((p) => p.properties.name)
        .map((p) => ({
          name: p.properties.name!,
          lat: p.geometry.coordinates[1],
          lng: p.geometry.coordinates[0],
          description: p.properties.ai_description ?? p.properties.editorial_summary ?? p.properties.category ?? undefined,
        }));

      await shareGpx({
        title: saveTitle || route.label || "SmartTrail Route",
        coordinates: route.geometry.coordinates as [number, number][],
        startLat: route.geometry.coordinates[0][1],
        startLng: route.geometry.coordinates[0][0],
        waypoints: gpxWaypoints.length > 0 ? gpxWaypoints : undefined,
      });
    } catch (err) {
      console.error("[GPX export]", err);
      Alert.alert(tr("route-map.export-gpx"), tr("route-map.export-gpx-error"));
    } finally {
      setIsExporting(false);
    }
  }, [routes, selectedIndex, saveTitle, tr]);

  const handleNavigateToStart = useCallback(async () => {
    const route = routes[selectedIndex];
    if (!route) return;
    const [startLng, startLat] = route.geometry.coordinates[0];
    // Use geo: URI on Android (opens any navigation app via intent),
    // maps: URI on iOS (opens Apple Maps; Google Maps also registers for it).
    const url = Platform.OS === "android"
      ? `geo:${startLat},${startLng}?q=${startLat},${startLng}`
      : `maps://?daddr=${startLat},${startLng}`;
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      } else {
        // Fallback: Google Maps universal web URL works on both platforms
        await Linking.openURL(
          `https://www.google.com/maps/dir/?api=1&destination=${startLat},${startLng}`,
        );
      }
    } catch {
      Alert.alert(tr("route-map.navigate-to-start"), tr("route-map.navigate-to-start-error"));
    }
  }, [routes, selectedIndex, tr]);

  // Whether the user wants this route published to the Discover feed.
  // Default false — sharing is explicit and opt-in per route.
  const [saveIsPublic, setSaveIsPublic] = useState(false);
  const [savedRouteId, setSavedRouteId] = useState<string | null>(
    params.savedId ?? null,
  );
  const [loadingSaved, setLoadingSaved] = useState(
    !!params.savedId || !!params.publicId,
  );
  // When viewing a public route from Discover, we're in read-only mode:
  // the save button becomes "Save to my list" and the regenerate controls
  // are hidden.
  const [publicRouteMeta, setPublicRouteMeta] = useState<{
    id: string;
    authorUsername: string | null;
  } | null>(null);

  // Load a public community route by id (tap-through from Discover). Fetches
  // /routes/public/:id and turns it into the single-variant Payload shape.
  const authFetch = useAuthStore((s) => s.authFetch);
  useEffect(() => {
    if (!params.publicId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await authFetch(`/routes/public/${params.publicId}`);
        if (cancelled) return;
        const pub = data.data.route;
        if (!pub) {
          setLoadingSaved(false);
          Alert.alert(tr("route-map.route-not-found"), tr("route-map.route-unavailable"));
          return;
        }
        const variantShape: RouteVariant = {
          label: pub.variantLabel ?? "public",
          description: pub.description ?? "",
          profile: pub.transport,
          distance_km: pub.distance / 1000,
          duration_s: pub.duration,
          ascent_m: pub.ascent ?? 0,
          descent_m: pub.descent ?? 0,
          geometry: pub.geometry,
          bbox: pub.bbox,
          pois: Array.isArray(pub.pois) ? (pub.pois as Poi[]) : [],
        };
        setPayload({
          profile: pub.transport,
          elevation_preference: "optimal",
          routes: [variantShape],
        });
        setRoutes([variantShape]);
        setSelectedIndex(0);
        setPublicRouteMeta({
          id: pub.id,
          authorUsername: pub.author?.username ?? null,
        });
        setLoadingSaved(false);
      } catch (err: any) {
        if (cancelled) return;
        setLoadingSaved(false);
        Alert.alert(
          tr("route-map.load-error"),
          err?.response?.data?.code ?? err?.message ?? "Unknown error",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.publicId, authFetch]);

  // Load a saved route by id (tap-through from profile). This resolves from
  // the AsyncStorage cache first so it works offline, then silently refreshes.
  useEffect(() => {
    if (!params.savedId) return;
    let cancelled = false;
    (async () => {
      const saved = await getSavedById(params.savedId!);
      if (cancelled) return;
      if (!saved) {
        setLoadingSaved(false);
        Alert.alert(tr("route-map.route-not-found"), tr("route-map.saved-route-unavailable"));
        return;
      }
      // Build a single-variant Payload the rest of the screen can consume.
      const variantShape: RouteVariant = {
        label: saved.variantLabel ?? "saved",
        description: saved.description ?? "",
        profile: saved.transport,
        distance_km: saved.distance / 1000,
        duration_s: saved.duration,
        ascent_m: saved.ascent ?? 0,
        descent_m: saved.descent ?? 0,
        geometry: saved.geometry,
        bbox: saved.bbox,
        pois: Array.isArray(saved.pois) ? (saved.pois as Poi[]) : [],
      };
      setPayload({
        profile: saved.transport,
        elevation_preference: "optimal",
        routes: [variantShape],
      });
      setRoutes([variantShape]);
      setSelectedIndex(0);
      setLoadingSaved(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [params.savedId, getSavedById]);

  const variant = routes[selectedIndex] ?? null;
  const cameraRef = useRef<CameraRef>(null);
  // Track which variant we've already fitted so POI state changes never re-trigger fitBounds
  const fittedVariantRef = useRef<number>(-1);

  // Stable pois reference — only recomputes when the variant changes, not on every render
  const pois = useMemo(
    () => (variant?.pois ?? []).filter((p) => p.properties.name),
    [variant],
  );

  const isWaypoint = useCallback(
    (poi: Poi) =>
      waypoints.some(
        (w) => w[0] === poi.geometry.coordinates[0] && w[1] === poi.geometry.coordinates[1],
      ),
    [waypoints],
  );

  const handleToggleWaypoint = useCallback(
    async (poi: Poi) => {
      if (!genParams || !variant) return;

      const coords = poi.geometry.coordinates as Coords;
      const removing = isWaypoint(poi);
      const newWaypoints = removing
        ? waypoints.filter((w) => !(w[0] === coords[0] && w[1] === coords[1]))
        : [...waypoints, coords];

      setWaypoints(newWaypoints);
      setIsRegenerating(true);

      try {
        const endpoint =
          genParams.mode === "loop"
            ? `${process.env.EXPO_PUBLIC_API_URL}/routes/generate-loop`
            : `${process.env.EXPO_PUBLIC_API_URL}/routes/generate`;

        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            ...genParams,
            waypoints: newWaypoints,
            variantLabel: variant.label,
          }),
        });

        const json = await res.json();
        if (!res.ok || json.status !== "success") throw new Error(json.message ?? "Failed");

        const newRoute: RouteVariant = json.data.routes[0];
        setRoutes((prev) => {
          const next = [...prev];
          next[selectedIndex] = newRoute;
          return next;
        });
        // Force camera to re-fit the updated route
        fittedVariantRef.current = -1;
      } catch (e: any) {
        setWaypoints(waypoints); // revert
        Alert.alert(tr("common.error"), e.message ?? tr("route-map.load-error"));
      } finally {
        setIsRegenerating(false);
      }
    },
    [genParams, variant, waypoints, isWaypoint, selectedIndex, token],
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
      const modeMap: Record<string, RouteMode> = {
        a_to_b: "A_TO_B",
        loop: "LOOP",
        ai: "AI",
      };
      const mode = modeMap[genParams.mode] ?? "A_TO_B";

      return {
        title: title.trim(),
        description: description.trim() || undefined,
        mode,
        transport: variant.profile,
        distance: Math.round(variant.distance_km * 1000),
        duration: Math.round(variant.duration_s),
        ascent: Math.round(variant.ascent_m),
        descent: Math.round(variant.descent_m),
        geometry: variant.geometry,
        bbox: variant.bbox,
        elevationProfile: (variant as any).elevation_profile ?? undefined,
        instructions: (variant as any).maneuvers ?? undefined,
        startLat: genParams.start[1],
        startLng: genParams.start[0],
        endLat: genParams.end?.[1],
        endLng: genParams.end?.[0],
        pois: variant.pois ?? undefined,
        variantLabel: variant.label,
        isPublic: saveIsPublic,
      };
    },
    [variant, genParams, saveIsPublic],
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
    setSaveIsPublic(false); // Default to private — sharing is explicit per route
    setSaveModalOpen(true);
  }, [variant, genParams]);

  const handleSave = useCallback(async () => {
    const payload = buildSavePayload(saveTitle, saveDescription);
    if (!payload) return;
    if (!payload.title) {
      Alert.alert(tr("route-map.title-required"), tr("route-map.title-required-body"));
      return;
    }
    setIsSaving(true);
    try {
      const saved = await saveRoute(payload);
      setSavedRouteId(saved.id);
      setSaveModalOpen(false);
    } catch (e: any) {
      Alert.alert(
        tr("route-map.save-error"),
        e?.response?.data?.code ?? e?.message ?? "Please try again.",
      );
    } finally {
      setIsSaving(false);
    }
  }, [buildSavePayload, saveTitle, saveDescription, saveRoute]);

  // Animate POI panel in/out
  const poiPanelAnim = useRef(new Animated.Value(200)).current;
  useEffect(() => {
    Animated.spring(poiPanelAnim, {
      toValue: selectedPoi ? 0 : 200,
      useNativeDriver: true,
      damping: 20,
      stiffness: 200,
    }).start();
  }, [selectedPoi]);

  const poiGeoJSON = useMemo(
    () =>
      pois.length
        ? ({ type: "FeatureCollection", features: pois } as const)
        : null,
    [pois],
  );

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

  // ─── Weather ────────────────────────────────────────────────────────────────
  //
  // Fetch forecast for start (and optionally mid + end) of the currently
  // selected variant. Uses the client-side Zustand cache so switching between
  // variants of the same route is free. Non-blocking — if the fetch fails we
  // silently render nothing.
  const getWeather = useWeatherStore((s) => s.getWeather);
  const [weather, setWeather] = useState<(WeatherSnapshot | null)[]>([]);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const weatherPoints = useMemo(
    () =>
      variant
        ? sampleRoutePoints(variant.geometry.coordinates, variant.distance_km)
        : [],
    [variant],
  );

  useEffect(() => {
    if (weatherPoints.length === 0) return;
    let cancelled = false;
    setWeatherLoading(true);
    getWeather(weatherPoints)
      .then((snaps) => {
        if (cancelled) return;
        setWeather(snaps);
      })
      .finally(() => {
        if (!cancelled) setWeatherLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [weatherPoints, getWeather]);

  const weatherPointLabels = useMemo(() => {
    const n = weatherPoints.length;
    if (n <= 1) return undefined;
    if (n === 2)
      return [
        i18n.t("weather.start", { defaultValue: "Start" }),
        i18n.t("weather.end", { defaultValue: "End" }),
      ];
    return [
      i18n.t("weather.start", { defaultValue: "Start" }),
      i18n.t("weather.mid", { defaultValue: "Mid" }),
      i18n.t("weather.end", { defaultValue: "End" }),
    ];
  }, [weatherPoints.length]);

  if (loadingSaved) {
    return (
      <View style={[styles.root, styles.centered, { backgroundColor: t.bg }]}>
        <ActivityIndicator color={t.tint} />
      </View>
    );
  }

  if (!payload || !variant) {
    return (
      <View style={[styles.root, styles.centered, { backgroundColor: t.bg }]}>
        <Ionicons name="map-outline" size={40} color={t.muted} />
        <Text style={[styles.emptyText, { color: t.muted }]}>
          {tr("route-map.no-route")}
        </Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.backLink}>
          <Text style={{ color: t.tint, fontWeight: "600" }}>{tr("route-map.go-back")}</Text>
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
        mapStyle={OSM_STYLE}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={false}
        onDidFinishLoadingMap={() => setMapReady(true)}
      >
        <Camera ref={cameraRef} />

        {/* Route polylines */}
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

        {/* POI markers — stable id, shape prop updated reactively by MapLibre */}
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
              if (found) setSelectedPoi(found);
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
          </ShapeSource>
        )}

        <UserLocation visible animated showsUserHeadingIndicator />
      </MapView>

      {/* ── Top controls ── */}
      <View style={[styles.topControls, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity
          style={[styles.iconBtn, { backgroundColor: t.bg }]}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={20} color={t.text} />
        </TouchableOpacity>

        <View style={styles.topControlsRight}>
          <TouchableOpacity
            style={[
              styles.iconBtn,
              {
                backgroundColor: savedRouteId ? t.tint : t.bg,
              },
            ]}
            onPress={openSaveModal}
            disabled={!!savedRouteId || isSaving}
          >
            <Ionicons
              name={savedRouteId ? "bookmark" : "bookmark-outline"}
              size={20}
              color={savedRouteId ? "#fff" : t.tint}
            />
          </TouchableOpacity>

          {pois.length > 0 && (
            <TouchableOpacity
              style={[
                styles.iconBtn,
                {
                  backgroundColor: showPois ? "#F59E0B" : t.bg,
                },
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

          {/* Navigate to start */}
          <TouchableOpacity
            style={[styles.iconBtn, { backgroundColor: t.bg }]}
            onPress={handleNavigateToStart}
            disabled={routes.length === 0}
          >
            <Ionicons name="navigate-outline" size={20} color={t.tint} />
          </TouchableOpacity>

          {/* Export GPX */}
          <TouchableOpacity
            style={[styles.iconBtn, { backgroundColor: t.bg }]}
            onPress={handleExportGpx}
            disabled={isExporting || routes.length === 0}
          >
            {isExporting ? (
              <ActivityIndicator size="small" color={t.tint} />
            ) : (
              <Ionicons name="share-outline" size={20} color={t.tint} />
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* ── POI detail panel ── */}
      <Animated.View
        style={[
          styles.poiPanel,
          {
            backgroundColor: t.bg,
            borderColor: t.border,
            paddingBottom: insets.bottom + 12,
            transform: [{ translateY: poiPanelAnim }],
          },
        ]}
        pointerEvents={selectedPoi ? "auto" : "none"}
      >
        {selectedPoi &&
          (() => {
            const props = selectedPoi.properties;
            const isAi = !!props.place_id || genParams?.mode === "ai";
            const description =
              props.editorial_summary ?? props.ai_description ?? null;
            const photoUri = props.photo_name
              ? placePhotoUrl(props.photo_name, 320, 640)
              : null;

            return (
              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 4 }}
              >
                {/* Photo */}
                {photoUri && (
                  <View style={styles.poiPhotoWrap}>
                    <Image
                      source={{ uri: photoUri }}
                      style={styles.poiPhoto}
                      resizeMode="cover"
                    />
                    <TouchableOpacity
                      onPress={() => setSelectedPoi(null)}
                      hitSlop={10}
                      style={styles.poiPhotoClose}
                    >
                      <Ionicons name="close" size={18} color="#fff" />
                    </TouchableOpacity>
                  </View>
                )}

                <View style={styles.poiPanelHeader}>
                  {!photoUri && (
                    <View
                      style={[
                        styles.poiIconWrap,
                        {
                          backgroundColor: "#F59E0B18",
                          borderColor: "#F59E0B40",
                        },
                      ]}
                    >
                      <Ionicons
                        name={poiIcon(props.category)}
                        size={20}
                        color="#F59E0B"
                      />
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[styles.poiName, { color: t.text }]}
                      numberOfLines={2}
                    >
                      {props.name}
                    </Text>
                    {props.category && (
                      <Text
                        style={[styles.poiCategory, { color: t.muted }]}
                        numberOfLines={1}
                      >
                        {props.category.replace(/_/g, " ")}
                      </Text>
                    )}
                  </View>
                  {!photoUri && (
                    <TouchableOpacity
                      onPress={() => setSelectedPoi(null)}
                      hitSlop={10}
                      style={styles.poiClose}
                    >
                      <Ionicons name="close" size={20} color={t.muted} />
                    </TouchableOpacity>
                  )}
                </View>

                {/* Rating row */}
                {typeof props.rating === "number" && (
                  <View style={styles.poiRatingRow}>
                    <Ionicons name="star" size={14} color="#F59E0B" />
                    <Text style={[styles.poiRatingValue, { color: t.text }]}>
                      {props.rating.toFixed(1)}
                    </Text>
                    {typeof props.user_rating_count === "number" && (
                      <Text style={[styles.poiRatingCount, { color: t.muted }]}>
                        ({props.user_rating_count.toLocaleString()})
                      </Text>
                    )}
                  </View>
                )}

                {/* Description */}
                {description && (
                  <Text
                    style={[styles.poiDescription, { color: t.text }]}
                    numberOfLines={4}
                  >
                    {description}
                  </Text>
                )}

                {/* Address */}
                {props.formatted_address && (
                  <View style={styles.poiInfoRow}>
                    <Ionicons name="location-outline" size={14} color={t.muted} />
                    <Text
                      style={[styles.poiInfoText, { color: t.muted }]}
                      numberOfLines={2}
                    >
                      {props.formatted_address}
                    </Text>
                  </View>
                )}

                {/* Distance from route — only for ORS-discovered POIs */}
                {!isAi && (
                  <View style={[styles.poiMeta, { borderTopColor: t.border }]}>
                    <View style={styles.poiMetaItem}>
                      <Ionicons
                        name="navigate-outline"
                        size={14}
                        color={t.muted}
                      />
                      <Text style={[styles.poiMetaText, { color: t.muted }]}>
                        {tr("route-map.from-route", {
                          distance: formatDist(
                            (props.distance_from_route ?? 0) / 1000,
                          ),
                        })}
                      </Text>
                    </View>
                  </View>
                )}

                {/* External links — Maps + Website */}
                {(props.google_maps_uri || props.website_uri) && (
                  <View style={styles.poiLinkRow}>
                    {props.google_maps_uri && (
                      <TouchableOpacity
                        style={[
                          styles.poiLinkBtn,
                          {
                            backgroundColor: t.surface,
                            borderColor: t.border,
                          },
                        ]}
                        onPress={() => openExternal(props.google_maps_uri)}
                        activeOpacity={0.75}
                      >
                        <Ionicons name="map-outline" size={15} color={t.tint} />
                        <Text
                          style={[styles.poiLinkText, { color: t.tint }]}
                        >
                          {tr("route-map.open-in-maps")}
                        </Text>
                      </TouchableOpacity>
                    )}
                    {props.website_uri && (
                      <TouchableOpacity
                        style={[
                          styles.poiLinkBtn,
                          {
                            backgroundColor: t.surface,
                            borderColor: t.border,
                          },
                        ]}
                        onPress={() => openExternal(props.website_uri)}
                        activeOpacity={0.75}
                      >
                        <Ionicons name="globe-outline" size={15} color={t.tint} />
                        <Text
                          style={[styles.poiLinkText, { color: t.tint }]}
                        >
                          {tr("route-map.website")}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}

                {/* Add/Remove waypoint — only for non-AI POIs (AI POIs are
                    already routed through, so toggling them doesn't apply) */}
                {genParams && !isAi && (
                  <TouchableOpacity
                    style={[
                      styles.waypointBtn,
                      {
                        backgroundColor: isWaypoint(selectedPoi)
                          ? t.danger + "15"
                          : t.tint + "15",
                        borderColor: isWaypoint(selectedPoi)
                          ? t.danger
                          : t.tint,
                      },
                    ]}
                    onPress={() => handleToggleWaypoint(selectedPoi)}
                    disabled={isRegenerating}
                    activeOpacity={0.75}
                  >
                    {isRegenerating ? (
                      <ActivityIndicator
                        size="small"
                        color={isWaypoint(selectedPoi) ? t.danger : t.tint}
                      />
                    ) : (
                      <>
                        <Ionicons
                          name={
                            isWaypoint(selectedPoi)
                              ? "remove-circle-outline"
                              : "add-circle-outline"
                          }
                          size={16}
                          color={
                            isWaypoint(selectedPoi) ? t.danger : t.tint
                          }
                        />
                        <Text
                          style={[
                            styles.waypointBtnText,
                            {
                              color: isWaypoint(selectedPoi)
                                ? t.danger
                                : t.tint,
                            },
                          ]}
                        >
                          {isWaypoint(selectedPoi)
                            ? tr("route-map.remove-from-route")
                            : tr("route-map.add-to-route")}
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                )}
              </ScrollView>
            );
          })()}
      </Animated.View>

      {/* ── POI list panel ── */}
      {!selectedPoi && showPois && (
        <View
          style={[
            styles.bottomPanel,
            {
              backgroundColor: t.bg,
              borderTopColor: t.border,
              paddingBottom: insets.bottom + 8,
              maxHeight: 340,
            },
          ]}
        >
          <View style={styles.panelHeader}>
            <Text style={[styles.panelTitle, { color: t.text }]}>
              {tr("route-map.nearby-places")}
            </Text>
            <TouchableOpacity onPress={() => setShowPois(false)} hitSlop={8}>
              <Ionicons name="close" size={20} color={t.muted} />
            </TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            {pois.map((poi, i) => (
              <TouchableOpacity
                key={poi.properties.id ?? i}
                style={[
                  styles.poiRow,
                  i < pois.length - 1 && {
                    borderBottomColor: t.border,
                    borderBottomWidth: StyleSheet.hairlineWidth,
                  },
                ]}
                activeOpacity={0.7}
                onPress={() => {
                  setSelectedPoi(poi);
                  setShowPois(false);
                }}
              >
                <View
                  style={[
                    styles.poiRowIcon,
                    { backgroundColor: "#F59E0B18", borderColor: "#F59E0B40" },
                  ]}
                >
                  <Ionicons
                    name={poiIcon(poi.properties.category)}
                    size={16}
                    color="#F59E0B"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={[styles.poiRowName, { color: t.text }]}
                    numberOfLines={1}
                  >
                    {poi.properties.name}
                  </Text>
                  {poi.properties.category && (
                    <Text
                      style={[styles.poiRowCategory, { color: t.muted }]}
                      numberOfLines={1}
                    >
                      {poi.properties.category}
                    </Text>
                  )}
                </View>
                <Text style={[styles.poiRowDist, { color: t.muted }]}>
                  {formatDist((poi.properties.distance_from_route ?? 0) / 1000)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* ── Stats + variant selector ── */}
      {!selectedPoi && !showPois && (
        <View
          style={[
            styles.bottomPanel,
            {
              backgroundColor: t.bg,
              borderTopColor: t.border,
              paddingBottom: insets.bottom + 8,
            },
          ]}
        >
          {(weather.length > 0 || weatherLoading) && (
            <WeatherCard
              snapshots={weather}
              loading={weatherLoading}
              pointLabels={weatherPointLabels}
            />
          )}

          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Ionicons name="map-outline" size={14} color={t.muted} />
              <Text style={[styles.statValue, { color: t.text }]}>
                {formatDist(variant.distance_km)}
              </Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: t.border }]} />
            <View style={styles.stat}>
              <Ionicons name="time-outline" size={14} color={t.muted} />
              <Text style={[styles.statValue, { color: t.text }]}>
                {formatTime(variant.duration_s)}
              </Text>
            </View>
            {variant.ascent_m > 0 && (
              <>
                <View
                  style={[styles.statDivider, { backgroundColor: t.border }]}
                />
                <View style={styles.stat}>
                  <Ionicons
                    name="trending-up-outline"
                    size={14}
                    color={t.muted}
                  />
                  <Text style={[styles.statValue, { color: t.text }]}>
                    {variant.ascent_m} m
                  </Text>
                </View>
              </>
            )}

            {pois.length > 0 && (
              <>
                <View
                  style={[styles.statDivider, { backgroundColor: t.border }]}
                />
                <View style={styles.stat}>
                  <Ionicons name="location-outline" size={14} color="#F59E0B" />
                  <Text style={[styles.statValue, { color: t.text }]}>
                    {pois.length}
                  </Text>
                </View>
              </>
            )}
          </View>

          {routes.length > 1 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.variantScroll}
            >
              {routes.map((r, i) => {
                const active = i === selectedIndex;
                const color = ROUTE_COLORS[i % ROUTE_COLORS.length];
                return (
                  <TouchableOpacity
                    key={i}
                    style={[
                      styles.variantCard,
                      {
                        backgroundColor: active ? t.surface : t.bg,
                        borderColor: active ? color : t.border,
                      },
                    ]}
                    onPress={() => {
                      setSelectedIndex(i);
                      setSelectedPoi(null);
                    }}
                    activeOpacity={0.8}
                  >
                    <View
                      style={[styles.variantDot, { backgroundColor: color }]}
                    />
                    <View>
                      <Text style={[styles.variantLabel, { color: t.text }]}>
                        {r.label.charAt(0).toUpperCase() + r.label.slice(1)}
                      </Text>
                      <Text style={[styles.variantMeta, { color: t.muted }]}>
                        {formatDist(r.distance_km)} · {formatTime(r.duration_s)}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </View>
      )}

      {/* ── Save route modal ── */}
      <Modal
        visible={saveModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => !isSaving && setSaveModalOpen(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => !isSaving && setSaveModalOpen(false)}
          />
          <View
            style={[
              styles.modalCard,
              { backgroundColor: t.bg, borderColor: t.border },
            ]}
          >
            <Text style={[styles.modalTitle, { color: t.text }]}>
              {tr("route-map.save-modal-title")}
            </Text>
            <Text style={[styles.modalSubtitle, { color: t.muted }]}>
              {tr("route-map.save-modal-subtitle")}
            </Text>

            <Text style={[styles.modalLabel, { color: t.muted }]}>{tr("route-map.save-modal-title-label")}</Text>
            <TextInput
              value={saveTitle}
              onChangeText={setSaveTitle}
              placeholder={tr("route-map.save-modal-title-placeholder")}
              placeholderTextColor={t.muted}
              maxLength={100}
              style={[
                styles.modalInput,
                {
                  color: t.text,
                  backgroundColor: t.surface,
                  borderColor: t.border,
                },
              ]}
            />

            <Text style={[styles.modalLabel, { color: t.muted }]}>
              {tr("route-map.save-modal-description-label")}
            </Text>
            <TextInput
              value={saveDescription}
              onChangeText={setSaveDescription}
              placeholder={tr("route-map.save-modal-description-placeholder")}
              placeholderTextColor={t.muted}
              maxLength={500}
              multiline
              style={[
                styles.modalInput,
                styles.modalInputMultiline,
                {
                  color: t.text,
                  backgroundColor: t.surface,
                  borderColor: t.border,
                },
              ]}
            />

            {/* Share publicly toggle — opt-in per route. When on, this route
                appears in the Discover feed for users near the start point. */}
            <View style={styles.publicToggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.publicToggleLabel, { color: t.text }]}>
                  {tr("route-map.save-modal-share-label")}
                </Text>
                <Text
                  style={[styles.publicToggleHint, { color: t.muted }]}
                  numberOfLines={2}
                >
                  {tr("route-map.save-modal-share-hint")}
                </Text>
              </View>
              <Switch
                value={saveIsPublic}
                onValueChange={setSaveIsPublic}
                trackColor={{ false: t.border, true: t.tint }}
                thumbColor="#fff"
              />
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, { borderColor: t.border }]}
                onPress={() => setSaveModalOpen(false)}
                disabled={isSaving}
              >
                <Text style={{ color: t.text, fontWeight: "600" }}>{tr("common.cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalBtn,
                  styles.modalBtnPrimary,
                  { backgroundColor: t.tint, borderColor: t.tint },
                ]}
                onPress={handleSave}
                disabled={isSaving || !saveTitle.trim()}
              >
                {isSaving ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={{ color: "#fff", fontWeight: "700" }}>{tr("common.save")}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

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
  topControlsRight: {
    flexDirection: "row",
    gap: 10,
  },
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

  // POI detail panel — slides up from bottom
  poiPanel: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 16,
    paddingHorizontal: 16,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -2 },
    elevation: 8,
  },
  poiPanelHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  poiIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  poiName: { fontSize: 16, fontWeight: "700" },
  poiCategory: { fontSize: 13, marginTop: 2 },
  poiClose: {
    padding: 4,
  },
  poiMeta: {
    flexDirection: "row",
    gap: 16,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  waypointBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  waypointBtnText: { fontSize: 14, fontWeight: "600" },
  poiMetaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  poiMetaText: { fontSize: 13 },

  // Photo header (AI / Google Places POIs)
  poiPhotoWrap: {
    position: "relative",
    marginHorizontal: -16,
    marginTop: -16,
    marginBottom: 12,
  },
  poiPhoto: {
    width: "100%",
    height: 180,
    backgroundColor: "#00000010",
  },
  poiPhotoClose: {
    position: "absolute",
    top: 12,
    right: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },

  // Rating row
  poiRatingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 10,
  },
  poiRatingValue: { fontSize: 14, fontWeight: "700" },
  poiRatingCount: { fontSize: 12 },

  // Description
  poiDescription: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 10,
  },

  // Info rows (address, etc.)
  poiInfoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    marginTop: 10,
  },
  poiInfoText: { fontSize: 12, flex: 1, lineHeight: 17 },

  // External link buttons
  poiLinkRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },
  poiLinkBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  poiLinkText: { fontSize: 13, fontWeight: "600" },

  bottomPanel: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 12,
    paddingHorizontal: 16,
    gap: 12,
  },
  statsRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  stat: { flexDirection: "row", alignItems: "center", gap: 5 },
  statValue: { fontSize: 15, fontWeight: "600" },
  statDivider: { width: 1, height: 14 },

  variantScroll: { paddingBottom: 4, gap: 10 },
  variantCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    minWidth: 140,
  },
  variantDot: { width: 10, height: 10, borderRadius: 5 },
  variantLabel: { fontSize: 14, fontWeight: "600" },
  variantMeta: { fontSize: 12, marginTop: 2 },

  panelHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  panelTitle: { fontSize: 16, fontWeight: "700" },

  poiRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 11,
  },
  poiRowIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  poiRowName: { fontSize: 14, fontWeight: "600" },
  poiRowCategory: { fontSize: 12, marginTop: 1 },
  poiRowDist: { fontSize: 12, flexShrink: 0 },

  // Save route modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  modalCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 20,
    gap: 4,
  },
  modalTitle: { fontSize: 18, fontWeight: "700" },
  modalSubtitle: { fontSize: 13, marginBottom: 8 },
  modalLabel: {
    fontSize: 12,
    fontWeight: "600",
    marginTop: 10,
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  modalInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  modalInputMultiline: {
    minHeight: 72,
    textAlignVertical: "top",
  },
  publicToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 14,
  },
  publicToggleLabel: {
    fontSize: 14,
    fontWeight: "700",
  },
  publicToggleHint: {
    fontSize: 12,
    marginTop: 2,
  },
  modalActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 18,
  },
  modalBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  modalBtnPrimary: {},
});
