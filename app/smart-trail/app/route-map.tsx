// @refresh reset
// app/route-map.tsx
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  Linking,
  useColorScheme,
  Dimensions,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useRouter, useLocalSearchParams } from "expo-router";
import {
  MapView,
  Camera,
  UserLocation,
  ShapeSource,
  LineLayer,
  PointAnnotation,
  type CameraRef,
} from "@maplibre/maplibre-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors } from "@/constants/theme";
import { routeStore, type RoutePayload } from "@/store/route-store";
import { savedRoutesStore } from "@/store/saved-routes-store";
import { exportRouteAsGpx } from "@/lib/gpx-export";

const { width: SW } = Dimensions.get("window");
const ACCENT = "#4f8ef7";
const ROUTE_COLORS = ["#4f8ef7", "#ff9f0a", "#30d158"];

const osmStyle = (isDark: boolean): string =>
  isDark
    ? "https://tiles.openfreemap.org/styles/dark"
    : "https://tiles.openfreemap.org/styles/liberty";

// ─── Types ────────────────────────────────────────────────────────────────────

interface EnrichedPOI {
  name: string;
  description: string;
  tip?: string;
  rating?: number;
  review_count?: number;
  duration_minutes?: number;
  photos?: string[];
  is_open_now?: boolean | null;
  opening_hours?: string[] | null;
  website?: string | null;
  editorial_summary?: string | null;
  wikipedia_summary?: string | null;
  wikipedia_url?: string | null;
  enriched_by?: "google_places" | "wikipedia";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDistance(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}
function fmtDuration(s: number) {
  const m = Math.round(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`;
}

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

function boundsFromCoords(coords: [number, number][]) {
  const lngs = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);
  return {
    ne: [Math.max(...lngs), Math.max(...lats)] as [number, number],
    sw: [Math.min(...lngs), Math.min(...lats)] as [number, number],
    center: [
      (Math.min(...lngs) + Math.max(...lngs)) / 2,
      (Math.min(...lats) + Math.max(...lats)) / 2,
    ] as [number, number],
  };
}

function renderStars(rating: number) {
  const full = Math.floor(rating);
  const half = rating - full >= 0.5 ? 1 : 0;
  const empty = 5 - full - half;
  return "★".repeat(full) + (half ? "½" : "") + "☆".repeat(empty);
}

// ─── RouteMapScreen ───────────────────────────────────────────────────────────

export default function RouteMapScreen() {
  const scheme = useColorScheme() ?? "light";
  const t = Colors[scheme];
  const isDark = scheme === "dark";
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraRef>(null);
  const isFirstFit = useRef(true);
  const { savedId } = useLocalSearchParams<{ savedId?: string }>();
  const isSavedMode = !!savedId;

  const [savedPayload, setSavedPayload] = useState<RoutePayload | null>(null);
  const [savedTitle, setSavedTitle] = useState<string>("");
  const [loadingSaved, setLoadingSaved] = useState(isSavedMode);
  const [selectedIdx, setSelectedIdx] = useState<number | undefined>(
    isSavedMode ? undefined : 0,
  );

  useEffect(() => {
    if (!savedId) return;
    savedRoutesStore.getById(savedId).then((entry) => {
      if (entry) {
        setSavedPayload(entry.payload);
        setSavedTitle(entry.title);
        setSelectedIdx(entry.selectedIdx ?? 0);
      } else {
        setSelectedIdx(0);
      }
      setLoadingSaved(false);
    });
  }, [savedId]);

  const payload = isSavedMode ? savedPayload : routeStore.get();
  const routes: any[] = payload?.route?.routes ?? [];
  const isRoundTrip = payload?.mode === "round_trip";
  const isAIRoute = payload?.mode === "ai_route";

  const aiWaypoints: EnrichedPOI[] = payload?.plan?.waypoints ?? [];
  const aiStart: EnrichedPOI | null = isAIRoute
    ? (payload?.plan?.start ?? null)
    : null;
  const aiEnd: EnrichedPOI | null =
    isAIRoute && !isRoundTrip ? (payload?.plan?.end ?? null) : null;

  const [mapReady, setMapReady] = useState(false);
  const [selectedPOI, setSelectedPOI] = useState<EnrichedPOI | null>(null);
  const [photoIdx, setPhotoIdx] = useState(0);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  const activeIdx = selectedIdx ?? 0;

  // Reset photo index when a new POI is selected
  useEffect(() => {
    setPhotoIdx(0);
  }, [selectedPOI?.name]);

  const handleSave = useCallback(async () => {
    if (!payload || !routes.length) return;
    setSaving(true);
    try {
      const route = routes[activeIdx];
      const title =
        isAIRoute && payload.plan?.title
          ? payload.plan.title
          : isRoundTrip
            ? "Round Trip"
            : "A → B Route";
      await savedRoutesStore.save({
        title,
        mode: payload.mode,
        distance: route.summary.distance,
        duration: route.summary.duration,
        selectedIdx: activeIdx,
        payload,
      });
      Alert.alert("Saved", `"${title}" has been saved to your routes.`);
    } catch {
      Alert.alert("Error", "Could not save route.");
    } finally {
      setSaving(false);
    }
  }, [payload, routes, activeIdx, isAIRoute, isRoundTrip]);

  const handleExport = useCallback(async () => {
    if (!payload || !routes.length) return;
    setExporting(true);
    try {
      const route = routes[activeIdx];
      const title =
        savedTitle ||
        (isAIRoute && payload.plan?.title
          ? payload.plan.title
          : "SmartTrail Route");
      const description =
        isAIRoute && payload.plan?.description ? payload.plan.description : "";
      await exportRouteAsGpx(route, title, description);
    } catch (err: any) {
      Alert.alert("Export failed", err.message ?? "Could not export route.");
    } finally {
      setExporting(false);
    }
  }, [payload, routes, activeIdx, savedTitle, isAIRoute]);

  const onMapReady = useCallback(() => setMapReady(true), []);

  const decodedCoords: [number, number][][] = useMemo(
    () =>
      routes.map((r) =>
        typeof r.geometry === "string"
          ? decodePolyline(r.geometry)
          : ((r.geometry?.coordinates ?? []) as [number, number][]),
      ),
    [routes],
  );

  useEffect(() => {
    if (!mapReady || !cameraRef.current) return;
    const coords = decodedCoords[activeIdx];
    if (!coords?.length) return;
    const { ne, sw } = boundsFromCoords(coords);
    const duration = isFirstFit.current ? 0 : 600;
    isFirstFit.current = false;
    cameraRef.current.fitBounds(ne, sw, [80, 40, 300, 40], duration);
  }, [activeIdx, mapReady, decodedCoords]);

  const initialCenter = useMemo(() => {
    const coords = decodedCoords[0];
    if (!coords?.length) return [-74.006, 40.7128] as [number, number];
    return boundsFromCoords(coords).center;
  }, [decodedCoords]);

  const stableCamera = useMemo(
    () => (
      <Camera
        ref={cameraRef}
        defaultSettings={{ centerCoordinate: initialCenter, zoomLevel: 12 }}
      />
    ),
    [],
  );

  const cardBg = isDark ? "#1e1e20" : "#ffffff";
  const borderCol = isDark ? "#2c2c2e" : "#e5e5ea";
  const sheetBg = isDark ? "#101012" : "#f8f8fa";

  const sheetHeight = 14 + 60 + 110 + 65 + insets.bottom + 12;

  // POI card height varies based on content
  const hasPhoto = (selectedPOI?.photos?.length ?? 0) > 0;
  const hasHours = (selectedPOI?.opening_hours?.length ?? 0) > 0;
  const poiCardHeight =
    (hasPhoto ? 180 : 0) +
    60 + // header + description
    (selectedPOI?.tip ? 44 : 0) +
    (hasHours ? 44 : 0) +
    60; // meta row + padding

  if (loadingSaved) {
    return (
      <View
        style={[
          styles.root,
          {
            backgroundColor: t.bg,
            justifyContent: "center",
            alignItems: "center",
          },
        ]}
      >
        <ActivityIndicator color={t.tint} />
      </View>
    );
  }

  if (!payload || !routes.length) {
    return (
      <View
        style={[
          styles.root,
          {
            backgroundColor: t.bg,
            justifyContent: "center",
            alignItems: "center",
          },
        ]}
      >
        <Text style={{ color: t.muted, marginBottom: 16 }}>
          No routes to display.
        </Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={{ color: ACCENT, fontWeight: "600" }}>← Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* ── Map ── */}
      <MapView
        style={StyleSheet.absoluteFill}
        mapStyle={osmStyle(isDark)}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={false}
        onDidFinishLoadingMap={onMapReady}
      >
        {stableCamera}
        <UserLocation visible androidRenderMode="compass" />

        {decodedCoords.map((coords, i) => {
          const color = ROUTE_COLORS[i % ROUTE_COLORS.length];
          const active = i === activeIdx;
          return (
            <ShapeSource
              key={`route-${i}`}
              id={`route-source-${i}`}
              shape={{
                type: "Feature",
                geometry: { type: "LineString", coordinates: coords },
                properties: { index: i },
              }}
              onPress={() => setSelectedIdx(i)}
            >
              <LineLayer
                id={`route-casing-${i}`}
                style={{
                  lineColor: "#ffffff",
                  lineWidth: active ? 7 : 0,
                  lineCap: "round",
                  lineJoin: "round",
                  lineOpacity: active ? 0.55 : 0,
                }}
                belowLayerID={`route-line-${i}`}
              />
              <LineLayer
                id={`route-line-${i}`}
                style={{
                  lineColor: active ? color : "#aaaaaa",
                  lineWidth: active ? 4.5 : 2,
                  lineCap: "round",
                  lineJoin: "round",
                  lineOpacity: active ? 1 : 0.45,
                  ...(active ? {} : { lineDasharray: [2, 2] }),
                }}
              />
            </ShapeSource>
          );
        })}

        {payload.start && (
          <PointAnnotation
            id="marker-start"
            coordinate={[payload.start.lng, payload.start.lat]}
          >
            <MapPin label={isRoundTrip ? "A·B" : "A"} color="#22c55e" />
          </PointAnnotation>
        )}
        {!isRoundTrip && payload.end && (
          <PointAnnotation
            id="marker-end"
            coordinate={[payload.end.lng, payload.end.lat]}
          >
            <MapPin label="B" color={ACCENT} />
          </PointAnnotation>
        )}

        {isAIRoute && aiStart?.lat != null && (
          <PointAnnotation
            id="poi-start"
            coordinate={[(aiStart as any).lng, (aiStart as any).lat]}
            onSelected={() => setSelectedPOI(aiStart)}
          >
            <POIMarker label="S" color="#22c55e" />
          </PointAnnotation>
        )}

        {isAIRoute &&
          aiWaypoints.map((wp: any, i: number) => (
            <PointAnnotation
              key={`poi-${i}`}
              id={`poi-${i}`}
              coordinate={[wp.lng, wp.lat]}
              onSelected={() => setSelectedPOI(wp)}
            >
              <POIMarker label={String(i + 1)} color="#f97316" />
            </PointAnnotation>
          ))}

        {isAIRoute && !isRoundTrip && aiEnd?.lat != null && (
          <PointAnnotation
            id="poi-end"
            coordinate={[(aiEnd as any).lng, (aiEnd as any).lat]}
            onSelected={() => setSelectedPOI(aiEnd)}
          >
            <POIMarker label="E" color={ACCENT} />
          </PointAnnotation>
        )}
      </MapView>

      {/* ── Back button ── */}
      <TouchableOpacity
        style={[
          styles.backBtn,
          {
            top: insets.top + 12,
            backgroundColor: cardBg,
            borderColor: borderCol,
          },
        ]}
        onPress={() => {
          if (!isSavedMode) routeStore.clear();
          router.back();
        }}
        activeOpacity={0.8}
      >
        <Text style={[styles.backBtnText, { color: t.text }]}>← Back</Text>
      </TouchableOpacity>

      {/* ── OSM attribution ── */}
      <Text
        style={[
          styles.attribution,
          { bottom: insets.bottom + sheetHeight - 8 },
        ]}
      >
        © OpenStreetMap contributors © OpenFreeMap
      </Text>

      {/* ── Bottom sheet ── */}
      <View
        style={[
          styles.sheet,
          { backgroundColor: sheetBg, paddingBottom: insets.bottom + 12 },
        ]}
      >
        <View style={[styles.handle, { backgroundColor: borderCol }]} />

        <View style={styles.sheetHeader}>
          {isAIRoute && payload?.plan ? (
            <View style={{ flex: 1 }}>
              <Text
                style={[styles.sheetTitle, { color: t.text }]}
                numberOfLines={1}
              >
                {payload.plan.title}
              </Text>
              <Text
                style={[styles.sheetSubtitle, { color: t.muted }]}
                numberOfLines={1}
              >
                {payload.plan.description}
              </Text>
            </View>
          ) : (
            <View style={{ flex: 1 }}>
              <Text style={[styles.sheetTitle, { color: t.text }]}>
                {routes.length} route{routes.length > 1 ? "s" : ""} found
              </Text>
              <Text style={[styles.sheetSubtitle, { color: t.muted }]}>
                Tap a route on the map or swipe below
              </Text>
            </View>
          )}

          {!isAIRoute && routes.length > 1 && (
            <View
              style={[
                styles.routeBadge,
                {
                  backgroundColor:
                    ROUTE_COLORS[activeIdx % ROUTE_COLORS.length] + "22",
                },
              ]}
            >
              <View
                style={[
                  styles.routeBadgeDot,
                  {
                    backgroundColor:
                      ROUTE_COLORS[activeIdx % ROUTE_COLORS.length],
                  },
                ]}
              />
              <Text
                style={[
                  styles.routeBadgeText,
                  { color: ROUTE_COLORS[activeIdx % ROUTE_COLORS.length] },
                ]}
              >
                {activeIdx + 1}/{routes.length}
              </Text>
            </View>
          )}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.cardList}
          decelerationRate="fast"
          snapToInterval={SW * 0.78 + 10}
          snapToAlignment="start"
        >
          {routes.map((route, i) => {
            const active = i === activeIdx;
            const color = ROUTE_COLORS[i % ROUTE_COLORS.length];
            return (
              <TouchableOpacity
                key={i}
                style={[
                  styles.card,
                  { width: SW * 0.78, backgroundColor: cardBg },
                  active
                    ? { borderColor: color, borderWidth: 1.5 }
                    : {
                        borderColor: borderCol,
                        borderWidth: StyleSheet.hairlineWidth,
                      },
                ]}
                onPress={() => setSelectedIdx(i)}
                activeOpacity={0.88}
              >
                <View style={[styles.cardBar, { backgroundColor: color }]} />
                <View style={styles.cardContent}>
                  <View style={styles.cardRow}>
                    <Text style={[styles.cardTitle, { color: t.text }]}>
                      {isAIRoute
                        ? (payload.plan?.title ?? "Route")
                        : `Route ${i + 1}`}
                    </Text>
                    {active && (
                      <View
                        style={[
                          styles.activePill,
                          { backgroundColor: color + "20" },
                        ]}
                      >
                        <Text style={[styles.activePillText, { color }]}>
                          Selected
                        </Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.statsRow}>
                    <StatBlock
                      icon="↗"
                      value={`${isRoundTrip || isAIRoute ? "~" : ""}${fmtDistance(route.summary.distance)}`}
                      label="Distance"
                      color={t.text}
                      muted={t.muted}
                    />
                    <View
                      style={[
                        styles.statDivider,
                        { backgroundColor: borderCol },
                      ]}
                    />
                    <StatBlock
                      icon="◷"
                      value={fmtDuration(route.summary.duration)}
                      label="Duration"
                      color={t.text}
                      muted={t.muted}
                    />
                    {isAIRoute && (
                      <>
                        <View
                          style={[
                            styles.statDivider,
                            { backgroundColor: borderCol },
                          ]}
                        />
                        <StatBlock
                          icon="📍"
                          value={String(
                            (payload.plan?.waypoints?.length ?? 0) + 2,
                          )}
                          label="Stops"
                          color={t.text}
                          muted={t.muted}
                        />
                      </>
                    )}
                  </View>

                  {route.segments?.[0]?.steps?.filter(
                    (s: any) => s.name && s.name !== "-",
                  ).length > 0 && (
                    <View
                      style={[styles.stepsRow, { borderTopColor: borderCol }]}
                    >
                      {route.segments[0].steps
                        .filter((s: any) => s.name && s.name !== "-")
                        .slice(0, 2)
                        .map((step: any, si: number) => (
                          <Text
                            key={si}
                            style={[styles.stepText, { color: t.muted }]}
                            numberOfLines={1}
                          >
                            · {step.instruction}
                          </Text>
                        ))}
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={styles.ctaRow}>
          {isSavedMode ? (
            <TouchableOpacity
              style={[
                styles.ctaBtn,
                {
                  backgroundColor:
                    ROUTE_COLORS[activeIdx % ROUTE_COLORS.length],
                  opacity: exporting ? 0.6 : 1,
                },
              ]}
              activeOpacity={0.85}
              onPress={handleExport}
              disabled={exporting}
            >
              {exporting ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.ctaBtnText}>Export as GPX</Text>
              )}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[
                styles.ctaBtn,
                {
                  backgroundColor:
                    ROUTE_COLORS[activeIdx % ROUTE_COLORS.length],
                  opacity: saving ? 0.6 : 1,
                },
              ]}
              activeOpacity={0.85}
              onPress={handleSave}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.ctaBtnText}>Save Route</Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── Rich POI card ── */}
      {selectedPOI && (
        <POICard
          poi={selectedPOI}
          photoIdx={photoIdx}
          onPhotoIdx={setPhotoIdx}
          onClose={() => setSelectedPOI(null)}
          bottom={sheetHeight + 8}
          cardBg={cardBg}
          borderCol={borderCol}
          textColor={t.text}
          mutedColor={t.muted}
          isDark={isDark}
        />
      )}
    </View>
  );
}

// ─── POICard ──────────────────────────────────────────────────────────────────

function POICard({
  poi,
  photoIdx,
  onPhotoIdx,
  onClose,
  bottom,
  cardBg,
  borderCol,
  textColor,
  mutedColor,
  isDark,
}: {
  poi: EnrichedPOI;
  photoIdx: number;
  onPhotoIdx: (i: number) => void;
  onClose: () => void;
  bottom: number;
  cardBg: string;
  borderCol: string;
  textColor: string;
  mutedColor: string;
  isDark: boolean;
}) {
  const photos = poi.photos ?? [];
  const hasPhoto = photos.length > 0;

  const openStatusColor =
    poi.is_open_now === true
      ? "#22c55e"
      : poi.is_open_now === false
        ? "#ef4444"
        : mutedColor;
  const openStatusLabel =
    poi.is_open_now === true
      ? "Open now"
      : poi.is_open_now === false
        ? "Closed"
        : null;

  const displayDesc =
    poi.editorial_summary ?? poi.wikipedia_summary ?? poi.description;
  const sourceTag =
    poi.enriched_by === "wikipedia"
      ? "via Wikipedia"
      : poi.enriched_by === "google_places"
        ? "via Google"
        : null;

  return (
    <View
      style={[
        poiStyles.card,
        { backgroundColor: cardBg, borderColor: borderCol, bottom },
      ]}
    >
      {/* Photo strip */}
      {hasPhoto && (
        <View style={poiStyles.photoWrap}>
          <Image
            source={{ uri: photos[photoIdx] }}
            style={poiStyles.photo}
            resizeMode="cover"
          />
          {/* Photo counter dots */}
          {photos.length > 1 && (
            <View style={poiStyles.dotRow}>
              {photos.map((_, i) => (
                <TouchableOpacity
                  key={i}
                  onPress={() => onPhotoIdx(i)}
                  hitSlop={8}
                >
                  <View
                    style={[
                      poiStyles.dot,
                      {
                        backgroundColor:
                          i === photoIdx ? "#fff" : "rgba(255,255,255,0.45)",
                      },
                    ]}
                  />
                </TouchableOpacity>
              ))}
            </View>
          )}
          {/* Photo nav arrows */}
          {photos.length > 1 && (
            <>
              {photoIdx > 0 && (
                <TouchableOpacity
                  style={[poiStyles.photoArrow, poiStyles.photoArrowLeft]}
                  onPress={() => onPhotoIdx(photoIdx - 1)}
                  hitSlop={8}
                >
                  <Text style={poiStyles.photoArrowText}>‹</Text>
                </TouchableOpacity>
              )}
              {photoIdx < photos.length - 1 && (
                <TouchableOpacity
                  style={[poiStyles.photoArrow, poiStyles.photoArrowRight]}
                  onPress={() => onPhotoIdx(photoIdx + 1)}
                  hitSlop={8}
                >
                  <Text style={poiStyles.photoArrowText}>›</Text>
                </TouchableOpacity>
              )}
            </>
          )}
          {/* Source tag */}
          {sourceTag && (
            <View style={poiStyles.sourceTag}>
              <Text style={poiStyles.sourceTagText}>{sourceTag}</Text>
            </View>
          )}
        </View>
      )}

      <View style={poiStyles.body}>
        {/* Header row */}
        <View style={poiStyles.headerRow}>
          <View style={[poiStyles.poiDot, { backgroundColor: "#f97316" }]} />
          <Text
            style={[poiStyles.name, { color: textColor }]}
            numberOfLines={2}
          >
            {poi.name}
          </Text>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={14}
            style={poiStyles.closeBtn}
          >
            <Text style={{ fontSize: 20, color: mutedColor, lineHeight: 22 }}>
              ×
            </Text>
          </TouchableOpacity>
        </View>

        {/* Meta row: rating · open status · duration */}
        <View style={poiStyles.metaRow}>
          {poi.rating != null && (
            <View style={poiStyles.metaChip}>
              <Text style={poiStyles.stars}>{renderStars(poi.rating)}</Text>
              <Text style={[poiStyles.metaText, { color: mutedColor }]}>
                {poi.rating.toFixed(1)}
                {poi.review_count
                  ? ` (${poi.review_count.toLocaleString()})`
                  : ""}
              </Text>
            </View>
          )}
          {openStatusLabel && (
            <View style={poiStyles.metaChip}>
              <View
                style={[
                  poiStyles.openDot,
                  { backgroundColor: openStatusColor },
                ]}
              />
              <Text style={[poiStyles.metaText, { color: openStatusColor }]}>
                {openStatusLabel}
              </Text>
            </View>
          )}
          {poi.duration_minutes != null && (
            <View style={poiStyles.metaChip}>
              <Text style={[poiStyles.metaText, { color: mutedColor }]}>
                ⏱ ~{poi.duration_minutes} min
              </Text>
            </View>
          )}
        </View>

        {/* Description */}
        <Text style={[poiStyles.desc, { color: mutedColor }]} numberOfLines={3}>
          {displayDesc}
        </Text>

        {/* Insider tip */}
        {poi.tip && (
          <View
            style={[
              poiStyles.tipBox,
              {
                backgroundColor: isDark ? "#2a2505" : "#fffbeb",
                borderColor: isDark ? "#4a3f10" : "#fde68a",
              },
            ]}
          >
            <Text style={[poiStyles.tipLabel, { color: "#d97706" }]}>
              💡 Insider tip
            </Text>
            <Text
              style={[
                poiStyles.tipText,
                { color: isDark ? "#fde68a" : "#92400e" },
              ]}
              numberOfLines={2}
            >
              {poi.tip}
            </Text>
          </View>
        )}

        {/* Opening hours (first 3 days) */}
        {poi.opening_hours && poi.opening_hours.length > 0 && (
          <View style={[poiStyles.hoursBox, { borderTopColor: borderCol }]}>
            <Text style={[poiStyles.hoursLabel, { color: mutedColor }]}>
              Hours
            </Text>
            {poi.opening_hours.slice(0, 3).map((line, i) => (
              <Text
                key={i}
                style={[poiStyles.hoursLine, { color: mutedColor }]}
                numberOfLines={1}
              >
                {line}
              </Text>
            ))}
            {poi.opening_hours.length > 3 && (
              <Text style={[poiStyles.hoursLine, { color: mutedColor }]}>
                +{poi.opening_hours.length - 3} more days…
              </Text>
            )}
          </View>
        )}

        {/* Website link */}
        {poi.website && (
          <TouchableOpacity
            onPress={() => Linking.openURL(poi.website!)}
            style={poiStyles.websiteRow}
          >
            <Text
              style={[poiStyles.websiteText, { color: ACCENT }]}
              numberOfLines={1}
            >
              🔗 {poi.website.replace(/^https?:\/\/(www\.)?/, "")}
            </Text>
          </TouchableOpacity>
        )}
        {poi.wikipedia_url && !poi.website && (
          <TouchableOpacity
            onPress={() => Linking.openURL(poi.wikipedia_url!)}
            style={poiStyles.websiteRow}
          >
            <Text style={[poiStyles.websiteText, { color: ACCENT }]}>
              📖 Read on Wikipedia
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ─── MapPin ───────────────────────────────────────────────────────────────────

function MapPin({ label, color }: { label: string; color: string }) {
  const size = 36;
  const tailSize = Math.round(size * 0.38);
  const borderWidth = Math.max(2, Math.round(size * 0.065));
  const fontSize =
    label.length > 1 ? Math.round(size * 0.24) : Math.round(size * 0.38);
  return (
    <View
      style={{ width: size + 8, height: size + tailSize, alignItems: "center" }}
    >
      <View
        style={{
          position: "absolute",
          bottom: 0,
          width: tailSize,
          height: tailSize,
          backgroundColor: color,
          transform: [{ rotate: "45deg" }],
          borderBottomRightRadius: 3,
          elevation: 5,
        }}
      />
      <View
        style={{
          position: "absolute",
          top: size * 0.07,
          width: size + 8,
          height: size + 8,
          borderRadius: (size + 8) / 2,
          backgroundColor: color,
          opacity: 0.2,
        }}
      />
      <View
        style={{
          position: "absolute",
          top: 0,
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
          borderWidth,
          borderColor: "#fff",
          justifyContent: "center",
          alignItems: "center",
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 5 },
          shadowOpacity: 0.4,
          shadowRadius: 8,
          elevation: 10,
        }}
      >
        <Text
          style={{
            fontSize,
            fontWeight: "900",
            color: "#fff",
            letterSpacing: -0.5,
          }}
        >
          {label}
        </Text>
      </View>
    </View>
  );
}

// ─── POIMarker ────────────────────────────────────────────────────────────────

function POIMarker({ label, color }: { label: string; color: string }) {
  const size = 28;
  const fontSize =
    label.length > 1 ? Math.round(size * 0.34) : Math.round(size * 0.42);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        borderWidth: Math.max(1.5, size * 0.06),
        borderColor: "#fff",
        justifyContent: "center",
        alignItems: "center",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.35,
        shadowRadius: 5,
        elevation: 8,
      }}
    >
      <Text style={{ fontSize, fontWeight: "800", color: "#fff" }}>
        {label}
      </Text>
    </View>
  );
}

// ─── StatBlock ────────────────────────────────────────────────────────────────

function StatBlock({
  icon,
  value,
  label,
  color,
  muted,
}: {
  icon: string;
  value: string;
  label: string;
  color: string;
  muted: string;
}) {
  return (
    <View style={styles.statBlock}>
      <Text style={[styles.statValue, { color }]}>
        <Text style={{ color: muted, fontSize: 11 }}>{icon} </Text>
        {value}
      </Text>
      <Text style={[styles.statLabel, { color: muted }]}>{label}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },

  backBtn: {
    position: "absolute",
    left: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 99,
    borderWidth: StyleSheet.hairlineWidth,
    zIndex: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 4,
  },
  backBtnText: { fontSize: 14, fontWeight: "500" },

  attribution: {
    position: "absolute",
    right: 8,
    fontSize: 9,
    color: "#777",
    zIndex: 5,
  },

  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 16,
  },
  handle: {
    width: 32,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 12,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 18,
    marginBottom: 12,
    gap: 10,
  },
  sheetTitle: { fontSize: 15, fontWeight: "700", letterSpacing: -0.2 },
  sheetSubtitle: { fontSize: 12, marginTop: 2 },
  routeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 99,
  },
  routeBadgeDot: { width: 6, height: 6, borderRadius: 3 },
  routeBadgeText: { fontSize: 12, fontWeight: "700" },

  cardList: { paddingHorizontal: 18, gap: 10 },
  card: { borderRadius: 16, overflow: "hidden", flexDirection: "row" },
  cardBar: { width: 4 },
  cardContent: { flex: 1, padding: 14, gap: 10 },
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardTitle: { fontSize: 15, fontWeight: "700", letterSpacing: -0.2 },
  activePill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99 },
  activePillText: { fontSize: 11, fontWeight: "600" },

  statsRow: { flexDirection: "row", alignItems: "center" },
  statBlock: { flex: 1, alignItems: "center", gap: 2 },
  statValue: { fontSize: 15, fontWeight: "700", letterSpacing: -0.3 },
  statLabel: { fontSize: 10, letterSpacing: 0.3, textTransform: "uppercase" },
  statDivider: { width: StyleSheet.hairlineWidth, height: 32, opacity: 0.5 },

  stepsRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8, gap: 3 },
  stepText: { fontSize: 12, lineHeight: 17 },

  ctaRow: { paddingHorizontal: 18, paddingTop: 10 },
  ctaBtn: { borderRadius: 14, paddingVertical: 15, alignItems: "center" },
  ctaBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
});

const poiStyles = StyleSheet.create({
  card: {
    position: "absolute",
    left: 16,
    right: 16,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 18,
    elevation: 12,
    zIndex: 20,
  },

  // Photo
  photoWrap: { width: "100%", height: 160, position: "relative" },
  photo: { width: "100%", height: 160 },
  dotRow: {
    position: "absolute",
    bottom: 8,
    alignSelf: "center",
    flexDirection: "row",
    gap: 5,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  photoArrow: {
    position: "absolute",
    top: "50%",
    marginTop: -18,
    width: 32,
    height: 36,
    borderRadius: 8,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    alignItems: "center",
  },
  photoArrowLeft: { left: 8 },
  photoArrowRight: { right: 8 },
  photoArrowText: {
    color: "#fff",
    fontSize: 22,
    lineHeight: 26,
    fontWeight: "600",
  },
  sourceTag: {
    position: "absolute",
    top: 8,
    right: 8,
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  sourceTagText: { color: "#fff", fontSize: 10, fontWeight: "500" },

  // Body
  body: { padding: 14, gap: 8 },
  headerRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  poiDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  name: {
    flex: 1,
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: -0.2,
    lineHeight: 20,
  },
  closeBtn: { paddingLeft: 4 },

  // Meta chips
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  metaChip: { flexDirection: "row", alignItems: "center", gap: 4 },
  stars: { fontSize: 11, color: "#f59e0b", letterSpacing: 1 },
  metaText: { fontSize: 12 },
  openDot: { width: 7, height: 7, borderRadius: 3.5 },

  desc: { fontSize: 13, lineHeight: 20 },

  // Insider tip
  tipBox: { borderRadius: 10, borderWidth: 1, padding: 10, gap: 3 },
  tipLabel: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  tipText: { fontSize: 12, lineHeight: 18 },

  // Hours
  hoursBox: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8, gap: 2 },
  hoursLabel: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  hoursLine: { fontSize: 12, lineHeight: 18 },

  // Website
  websiteRow: { paddingTop: 2 },
  websiteText: { fontSize: 13, fontWeight: "500" },
});
