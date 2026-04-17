import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  TextInput,
  useColorScheme,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useNetwork } from "@/hooks/use-network";
import {
  useLocationSearch,
  ResolvedLocation,
} from "@/hooks/use-location-search";
import { LocationSearchSheet } from "@/components/generate/location-search-sheet";
import { useAuthStore } from "@/store/use-auth-store";
import { Colors } from "@/constants/theme";
import EventSource from "react-native-sse";
import { useTranslation } from "@/hooks/use-translation";
import i18n from "@/lib/i18n";
import { TabScreenHeader } from "@/components/ui/tab-screen-header";

// ── AI streaming progress ─────────────────────────────────────────────────────
// Events emitted by POST /routes/generate-ai/stream:
//   stage → { stage: "ai_pois" | "enriching" | "routing", ... }
//   done  → final route payload
//   error → { code, message }
type AiStage = "ai_pois" | "enriching" | "routing";
type AiStreamEvents = "stage" | "done" | "error";

function getAiStageLabel(stage: AiStage): string {
  const map: Record<AiStage, string> = {
    ai_pois: i18n.t("generate.ai-stage-planning"),
    enriching: i18n.t("generate.ai-stage-enriching"),
    routing: i18n.t("generate.ai-stage-routing"),
  };
  return map[stage];
}

// ─── Types ────────────────────────────────────────────────────────────────────

type TabKey = "a_to_b" | "round_trip" | "ai";
type TransportKey =
  | "foot-walking"
  | "foot-hiking"
  | "running"
  | "cycling-regular"
  | "cycling-mountain"
  | "cycling-electric"
  | "cycling-road";
type ElevationKey = "auto" | "flat" | "moderate" | "hilly";
type DistanceKey = "5" | "10" | "20" | "30" | "custom";

interface MustStop {
  id: string;
  location: ResolvedLocation | null;
}

// Which field is the search sheet targeting
type SearchTarget =
  | "start"
  | "end"
  | "round_start"
  | "ai_start"
  | "ai_end"
  | { type: "stop"; id: string };

// ─── Constants ────────────────────────────────────────────────────────────────

const MODE_TABS: { key: TabKey; tKey: string }[] = [
  { key: "a_to_b", tKey: "generate.mode-atob" },
  { key: "round_trip", tKey: "generate.mode-round-trip" },
  { key: "ai", tKey: "generate.mode-ai" },
];

const TRANSPORT_OPTIONS: {
  key: TransportKey;
  tKey: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  {
    key: "foot-walking",
    tKey: "generate.transport-walking",
    icon: "walk-outline",
  },
  {
    key: "foot-hiking",
    tKey: "generate.transport-hiking",
    icon: "trail-sign-outline",
  },
  {
    key: "running",
    tKey: "generate.transport-running",
    icon: "fitness-outline",
  },
  {
    key: "cycling-regular",
    tKey: "generate.transport-cycling",
    icon: "bicycle-outline",
  },
  {
    key: "cycling-road",
    tKey: "generate.transport-road",
    icon: "speedometer-outline",
  },
  {
    key: "cycling-mountain",
    tKey: "generate.transport-mtb",
    icon: "navigate-outline",
  },
  {
    key: "cycling-electric",
    tKey: "generate.transport-ebike",
    icon: "flash-outline",
  },
];

const ELEVATION_OPTIONS: {
  key: ElevationKey;
  tKey: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { key: "auto", tKey: "generate.elevation-auto", icon: "options-outline" },
  { key: "flat", tKey: "generate.elevation-flat", icon: "remove-outline" },
  {
    key: "moderate",
    tKey: "generate.elevation-moderate",
    icon: "pulse-outline",
  },
  { key: "hilly", tKey: "generate.elevation-hilly", icon: "triangle-outline" },
];

const POI_OPTIONS: {
  key: string;
  tKey: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { key: "nature", tKey: "generate.poi-nature", icon: "leaf-outline" },
  { key: "tourism", tKey: "generate.poi-viewpoints", icon: "eye-outline" },
  { key: "historic", tKey: "generate.poi-historic", icon: "flag-outline" },
  { key: "food", tKey: "generate.poi-food", icon: "cafe-outline" },
  {
    key: "arts_culture",
    tKey: "generate.poi-arts",
    icon: "color-palette-outline",
  },
  { key: "leisure", tKey: "generate.poi-leisure", icon: "basketball-outline" },
];

const DISTANCE_OPTIONS: { key: DistanceKey; label: string; tKey?: string }[] = [
  { key: "5", label: "5 km" },
  { key: "10", label: "10 km" },
  { key: "15", label: "15 km" },
  { key: "20", label: "20 km" },
  { key: "custom", label: "Custom", tKey: "generate.custom-distance" },
];

// ─── Small helpers ────────────────────────────────────────────────────────────

function SectionLabel({ label, color }: { label: string; color: string }) {
  return (
    <Text style={[styles.sectionLabel, { color }]}>{label.toUpperCase()}</Text>
  );
}

// Location row — used for start / end / stop rows
function LocationRow({
  dotColor,
  dotStyle = "filled", // "filled" | "outlined"
  label,
  isFilled,
  onPress,
  onClear,
  showHandle,
  alwaysShowClear,
  textColor,
  mutedColor,
  accent,
}: {
  dotColor: string;
  dotStyle?: "filled" | "outlined";
  label: string;
  isFilled: boolean;
  onPress: () => void;
  onClear?: () => void;
  showHandle?: boolean;
  alwaysShowClear?: boolean;
  textColor: string;
  mutedColor: string;
  accent: string;
}) {
  const showClear = (alwaysShowClear || isFilled) && !!onClear;
  return (
    <TouchableOpacity
      style={styles.locationRow}
      onPress={onPress}
      activeOpacity={0.6}
    >
      {showHandle && (
        <Ionicons
          name="reorder-three-outline"
          size={18}
          color={mutedColor}
          style={styles.stopHandle}
        />
      )}
      <View
        style={[
          styles.locDot,
          dotStyle === "outlined"
            ? {
                borderWidth: 2,
                borderColor: dotColor,
                backgroundColor: "transparent",
              }
            : { backgroundColor: dotColor },
        ]}
      />
      <Text
        style={[styles.locText, { color: isFilled ? textColor : mutedColor }]}
        numberOfLines={1}
      >
        {label}
      </Text>
      {showClear ? (
        <TouchableOpacity
          onPress={onClear}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="close-circle" size={18} color={mutedColor} />
        </TouchableOpacity>
      ) : (
        <Ionicons name="search-outline" size={16} color={mutedColor} />
      )}
    </TouchableOpacity>
  );
}

function TransportPicker({
  value,
  onChange,
  accent,
  surface,
  border,
  mutedColor,
}: {
  value: TransportKey;
  onChange: (k: TransportKey) => void;
  accent: string;
  surface: string;
  border: string;
  mutedColor: string;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.transportScroll}
    >
      {TRANSPORT_OPTIONS.map((opt) => {
        const active = value === opt.key;
        return (
          <TouchableOpacity
            key={opt.key}
            style={[
              styles.transportChip,
              {
                backgroundColor: active ? accent + "18" : surface,
                borderColor: active ? accent : border,
              },
            ]}
            onPress={() => onChange(opt.key)}
            activeOpacity={0.7}
          >
            <Ionicons
              name={opt.icon}
              size={20}
              color={active ? accent : mutedColor}
            />
            <Text
              style={[
                styles.iconChipLabel,
                { color: active ? accent : mutedColor },
              ]}
            >
              {i18n.t(opt.tKey)}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

function ElevationPicker({
  value,
  onChange,
  accent,
  surface,
  border,
  mutedColor,
}: {
  value: ElevationKey;
  onChange: (k: ElevationKey) => void;
  accent: string;
  surface: string;
  border: string;
  mutedColor: string;
}) {
  return (
    <View style={styles.chipRow}>
      {ELEVATION_OPTIONS.map((opt) => {
        const active = value === opt.key;
        return (
          <TouchableOpacity
            key={opt.key}
            style={[
              styles.iconChip,
              {
                backgroundColor: active ? accent + "18" : surface,
                borderColor: active ? accent : border,
              },
            ]}
            onPress={() => onChange(opt.key)}
            activeOpacity={0.7}
          >
            <Ionicons
              name={opt.icon}
              size={20}
              color={active ? accent : mutedColor}
            />
            <Text
              style={[
                styles.iconChipLabel,
                { color: active ? accent : mutedColor },
              ]}
            >
              {i18n.t(opt.tKey)}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function PoiPicker({
  selected,
  onToggle,
  accent,
  surface,
  border,
  textColor,
  mutedColor,
}: {
  selected: Set<string>;
  onToggle: (key: string) => void;
  accent: string;
  surface: string;
  border: string;
  textColor: string;
  mutedColor: string;
}) {
  return (
    <View style={styles.poiGrid}>
      {POI_OPTIONS.map((poi) => {
        const active = selected.has(poi.key);
        return (
          <TouchableOpacity
            key={poi.key}
            style={[
              styles.poiChip,
              {
                backgroundColor: active ? accent + "14" : surface,
                borderColor: active ? accent : border,
              },
            ]}
            onPress={() => onToggle(poi.key)}
            activeOpacity={0.7}
          >
            <Ionicons
              name={poi.icon}
              size={16}
              color={active ? accent : mutedColor}
            />
            <Text
              style={[styles.poiLabel, { color: active ? accent : mutedColor }]}
            >
              {i18n.t(poi.tKey)}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function DistancePicker({
  value,
  onChange,
  customText,
  onCustomTextChange,
  accent,
  surface,
  border,
  mutedColor,
  textColor,
}: {
  value: DistanceKey;
  onChange: (k: DistanceKey) => void;
  customText: string;
  onCustomTextChange: (t: string) => void;
  accent: string;
  surface: string;
  border: string;
  mutedColor: string;
  textColor: string;
}) {
  return (
    <View style={styles.distanceGroup}>
      <View style={styles.chipRow}>
        {DISTANCE_OPTIONS.map((opt) => {
          const active = value === opt.key;
          return (
            <TouchableOpacity
              key={opt.key}
              style={[
                styles.distChip,
                {
                  backgroundColor: active ? accent + "18" : surface,
                  borderColor: active ? accent : border,
                },
              ]}
              onPress={() => onChange(opt.key)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.distChipLabel,
                  { color: active ? accent : mutedColor },
                ]}
              >
                {opt.tKey ? i18n.t(opt.tKey) : opt.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {value === "custom" && (
        <View
          style={[
            styles.customDistRow,
            { backgroundColor: surface, borderColor: border },
          ]}
        >
          <TextInput
            style={[styles.customDistInput, { color: textColor }]}
            placeholder={i18n.t("generate.section-distance")}
            placeholderTextColor={mutedColor}
            keyboardType="decimal-pad"
            value={customText}
            onChangeText={onCustomTextChange}
            maxLength={5}
          />
          <Text style={[styles.customDistUnit, { color: mutedColor }]}>km</Text>
        </View>
      )}
    </View>
  );
}

// ─── Offline screen ───────────────────────────────────────────────────────────

function OfflineScreen() {
  const scheme = useColorScheme() ?? "light";
  const ts = Colors[scheme];
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[styles.root, { backgroundColor: ts.bg, paddingTop: insets.top }]}
    >
      <StatusBar
        barStyle={scheme === "dark" ? "light-content" : "dark-content"}
      />
      <View style={styles.offlineWrap}>
        <View
          style={[
            styles.offlineIcon,
            { backgroundColor: ts.surface, borderColor: ts.border },
          ]}
        >
          <Ionicons name="wifi-outline" size={28} color={ts.muted} />
        </View>
        <Text style={[styles.offlineTitle, { color: ts.text }]}>
          {i18n.t("generate.no-internet")}
        </Text>
        <Text style={[styles.offlineBody, { color: ts.muted }]}>
          {i18n.t("generate.no-internet-body")}
        </Text>
      </View>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function GenerateScreen() {
  const { isOnline } = useNetwork();
  const scheme = useColorScheme() ?? "light";
  const ts = Colors[scheme];
  const insets = useSafeAreaInsets();
  const isDark = scheme === "dark";
  const { t } = useTranslation();

  const surface = ts.surface;
  const border = ts.border;
  const accent = ts.tint;
  const textColor = ts.text;
  const mutedColor = ts.muted;

  // ── Tab ──
  const [tab, setTab] = useState<TabKey>("a_to_b");

  // ── Location state ──
  const [userCoords, setUserCoords] = useState<{
    lat: number;
    lng: number;
  } | null>(null);

  // A→B
  const [startLocation, setStartLocation] = useState<ResolvedLocation | null>(
    null,
  );
  const [endLocation, setEndLocation] = useState<ResolvedLocation | null>(null);

  // Round trip
  const [roundStartLocation, setRoundStartLocation] =
    useState<ResolvedLocation | null>(null);

  // AI mode
  const [aiStartLocation, setAiStartLocation] =
    useState<ResolvedLocation | null>(null);
  const [aiEndLocation, setAiEndLocation] = useState<ResolvedLocation | null>(
    null,
  );
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiMode, setAiMode] = useState<"a_to_b" | "round_trip">("a_to_b");

  // Must stops (shared)
  const [mustStops, setMustStops] = useState<MustStop[]>([]);

  // ── Search sheet ──
  const [searchTarget, setSearchTarget] = useState<SearchTarget | null>(null);
  const sheetVisible = searchTarget !== null;

  const openSearch = useCallback((target: SearchTarget) => {
    setSearchTarget(target);
  }, []);

  const closeSearch = useCallback(() => setSearchTarget(null), []);

  const handleLocationSelected = useCallback(
    (location: ResolvedLocation) => {
      if (!searchTarget) return;

      // Cache coords for search bias
      setUserCoords(location.coords);

      if (searchTarget === "start") setStartLocation(location);
      else if (searchTarget === "end") setEndLocation(location);
      else if (searchTarget === "round_start") setRoundStartLocation(location);
      else if (searchTarget === "ai_start") setAiStartLocation(location);
      else if (searchTarget === "ai_end") setAiEndLocation(location);
      else if (
        typeof searchTarget === "object" &&
        searchTarget.type === "stop"
      ) {
        setMustStops((prev) =>
          prev.map((s) => (s.id === searchTarget.id ? { ...s, location } : s)),
        );
      }
    },
    [searchTarget],
  );

  // ── Stops ──
  const addStop = () => {
    setMustStops((prev) => [
      ...prev,
      { id: Date.now().toString(), location: null },
    ]);
  };
  const removeStop = (id: string) =>
    setMustStops((prev) => prev.filter((s) => s.id !== id));

  // ── Other form state ──
  const [transport, setTransport] = useState<TransportKey>("foot-walking");
  const [elevation, setElevation] = useState<ElevationKey>("auto");
  const [selectedPoi, setSelectedPoi] = useState<Set<string>>(new Set());
  const [distance, setDistance] = useState<DistanceKey>("10");
  const [customDistanceText, setCustomDistanceText] = useState("");

  const togglePoi = (key: string) => {
    setSelectedPoi((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  // ── Can generate? ──
  const customDistanceKm = parseFloat(customDistanceText);
  const customDistanceValid =
    distance !== "custom" ||
    (!isNaN(customDistanceKm) &&
      customDistanceKm >= 0.5 &&
      customDistanceKm <= 100);
  const aiNeedsDistance = aiMode === "round_trip";
  const canGenerate =
    tab === "a_to_b"
      ? !!startLocation && !!endLocation
      : tab === "round_trip"
        ? !!roundStartLocation && customDistanceValid
        : /* ai */
          !!aiStartLocation &&
          aiPrompt.trim().length > 0 &&
          (aiMode === "a_to_b" ? !!aiEndLocation : customDistanceValid);

  const getValidToken = useAuthStore((s) => s.getValidToken);
  const [generating, setGenerating] = useState(false);
  // Phase label shown in the Generate button during AI streaming generation.
  // null for non-AI modes (plain spinner) or before any stage event arrives.
  const [progressLabel, setProgressLabel] = useState<string | null>(null);

  // Holds a cleanup function for any active EventSource so we can close it
  // if the user navigates away before the stream completes.
  const esCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    return () => {
      esCleanupRef.current?.();
    };
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!canGenerate) return;
    setGenerating(true);
    setProgressLabel(null);
    try {
      const elevMap: Record<string, string> = {
        auto: "auto",
        flat: "flat",
        moderate: "optimal",
        hilly: "hilly",
      };

      const pickedDistanceM =
        (distance === "custom"
          ? parseFloat(customDistanceText)
          : Number(distance)) * 1000;

      let genParams: any;
      let endpoint: string;

      if (tab === "ai") {
        const aiStart = [
          aiStartLocation!.coords.lng,
          aiStartLocation!.coords.lat,
        ] as [number, number];
        const aiEnd =
          aiMode === "a_to_b" && aiEndLocation
            ? ([aiEndLocation.coords.lng, aiEndLocation.coords.lat] as [
                number,
                number,
              ])
            : undefined;
        const aiWaypoints = mustStops
          .filter((s) => s.location !== null)
          .map(
            (s) =>
              [s.location!.coords.lng, s.location!.coords.lat] as [
                number,
                number,
              ],
          );
        genParams = {
          mode: "ai" as const,
          start: aiStart,
          ...(aiEnd ? { end: aiEnd } : { distance: pickedDistanceM }),
          ...(aiWaypoints.length > 0 ? { waypoints: aiWaypoints } : {}),
          profile: transport,
          elevationPreference: elevMap[elevation] ?? "optimal",
          preferences: aiPrompt.trim(),
          lang: (i18n.locale === "lt" ? "lt" : "en") as "en" | "lt",
        };

        // ── AI mode streams via SSE so we can show live phase progress ──
        setProgressLabel(getAiStageLabel("ai_pois"));
        const freshToken = await getValidToken();
        await new Promise<void>((resolve, reject) => {
          const es = new EventSource<AiStreamEvents>(
            `${process.env.EXPO_PUBLIC_API_URL}/routes/generate-ai/stream`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(freshToken ? { Authorization: `Bearer ${freshToken}` } : {}),
              },
              body: JSON.stringify(genParams),
              // Disable auto-reconnect — Gemini calls are expensive, we don't
              // want the client silently re-firing the whole pipeline on a
              // transient network blip.
              pollingInterval: 0,
            },
          );

          const cleanup = () => {
            es.removeAllEventListeners();
            es.close();
            esCleanupRef.current = null;
          };

          // Register cleanup so unmounting the screen closes the stream.
          esCleanupRef.current = cleanup;

          es.addEventListener("stage", (event: any) => {
            try {
              const payload = JSON.parse(event.data);
              const label = getAiStageLabel(payload.stage as AiStage);
              if (label) setProgressLabel(label);
            } catch {
              // ignore malformed stage event
            }
          });

          es.addEventListener("done", (event: any) => {
            try {
              const data = JSON.parse(event.data);
              cleanup();
              router.push({
                pathname: "/route-map",
                params: {
                  payload: JSON.stringify(data),
                  genParams: JSON.stringify(genParams),
                },
              });
              resolve();
            } catch (e: any) {
              cleanup();
              reject(new Error("Failed to parse AI route response"));
            }
          });

          es.addEventListener("error", (event: any) => {
            cleanup();
            // `error` covers both server-emitted typed errors (event.data is
            // JSON) and connection-level failures (event.data is undefined).
            let msg = "Route generation failed";
            if (event?.data) {
              try {
                const payload = JSON.parse(event.data);
                msg = payload.message ?? payload.code ?? msg;
              } catch {
                /* ignore */
              }
            } else if (event?.message) {
              msg = event.message;
            }
            reject(new Error(msg));
          });
        });
        return;
      } else {
        const start =
          tab === "a_to_b"
            ? ([startLocation!.coords.lng, startLocation!.coords.lat] as [
                number,
                number,
              ])
            : ([
                roundStartLocation!.coords.lng,
                roundStartLocation!.coords.lat,
              ] as [number, number]);
        const end =
          tab === "a_to_b"
            ? ([endLocation!.coords.lng, endLocation!.coords.lat] as [
                number,
                number,
              ])
            : ([
                roundStartLocation!.coords.lng,
                roundStartLocation!.coords.lat,
              ] as [number, number]);

        const waypoints = mustStops
          .filter((s) => s.location !== null)
          .map(
            (s) =>
              [s.location!.coords.lng, s.location!.coords.lat] as [
                number,
                number,
              ],
          );

        const isLoop = tab === "round_trip";

        genParams = isLoop
          ? {
              mode: "loop" as const,
              start,
              distance: pickedDistanceM,
              profile: transport,
              elevationPreference: elevMap[elevation] ?? "optimal",
              poiTypes: [...selectedPoi],
              waypoints,
            }
          : {
              mode: "a_to_b" as const,
              start,
              end,
              profile: transport,
              elevationPreference: elevMap[elevation] ?? "optimal",
              poiTypes: [...selectedPoi],
              waypoints,
            };

        endpoint = isLoop ? "/routes/generate-loop" : "/routes/generate";
      }

      const { authFetch } = useAuthStore.getState();
      const { data: routeResp } = await authFetch(endpoint, {
        method: "POST",
        data: genParams,
      });

      router.push({
        pathname: "/route-map",
        params: {
          payload: JSON.stringify(routeResp.data),
          genParams: JSON.stringify(genParams),
        },
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : t("generate.error");
      Alert.alert(t("generate.error"), msg);
    } finally {
      setGenerating(false);
      setProgressLabel(null);
    }
  }, [
    canGenerate,
    tab,
    aiMode,
    startLocation,
    endLocation,
    roundStartLocation,
    aiStartLocation,
    aiEndLocation,
    aiPrompt,
    mustStops,
    transport,
    elevation,
    distance,
    customDistanceText,
    selectedPoi,
    getValidToken,
  ]);

  if (isOnline === false) return <OfflineScreen />;
  if (isOnline === null) return null; // still determining on mount

  // ── Shared form sections ──
  const transportSection = (
    <View style={styles.formGroup}>
      <SectionLabel
        label={t("generate.section-transport")}
        color={mutedColor}
      />
      <TransportPicker
        value={transport}
        onChange={setTransport}
        accent={accent}
        surface={surface}
        border={border}
        mutedColor={mutedColor}
      />
    </View>
  );

  const poiSection = (
    <View style={styles.formGroup}>
      <SectionLabel label={t("generate.section-pois")} color={mutedColor} />
      <PoiPicker
        selected={selectedPoi}
        onToggle={togglePoi}
        accent={accent}
        surface={surface}
        border={border}
        textColor={textColor}
        mutedColor={mutedColor}
      />
    </View>
  );

  const elevationSection = (
    <View style={styles.formGroup}>
      <SectionLabel
        label={t("generate.section-elevation")}
        color={mutedColor}
      />
      <ElevationPicker
        value={elevation}
        onChange={setElevation}
        accent={accent}
        surface={surface}
        border={border}
        mutedColor={mutedColor}
      />
    </View>
  );

  // ── Must stops card (reused in both tabs) ──
  const stopsCard = (
    <View
      style={[styles.card, { backgroundColor: surface, borderColor: border }]}
    >
      {mustStops.map((stop, i) => (
        <View key={stop.id}>
          {i > 0 && (
            <View
              style={[styles.locationDivider, { backgroundColor: border }]}
            />
          )}
          <LocationRow
            dotColor={accent}
            dotStyle="outlined"
            label={
              stop.location?.label ?? t("generate.stop-label", { n: i + 1 })
            }
            isFilled={!!stop.location}
            onPress={() => openSearch({ type: "stop", id: stop.id })}
            onClear={() => {
              if (stop.location) {
                setMustStops((prev) =>
                  prev.map((s) =>
                    s.id === stop.id ? { ...s, location: null } : s,
                  ),
                );
              } else {
                removeStop(stop.id);
              }
            }}
            alwaysShowClear
            showHandle
            textColor={textColor}
            mutedColor={mutedColor}
            accent={accent}
          />
        </View>
      ))}

      {mustStops.length > 0 && (
        <View style={[styles.locationDivider, { backgroundColor: border }]} />
      )}

      <TouchableOpacity
        style={styles.addStopRow}
        onPress={addStop}
        activeOpacity={0.6}
      >
        <View
          style={[
            styles.addStopIcon,
            { backgroundColor: accent + "18", borderColor: accent + "40" },
          ]}
        >
          <Ionicons name="add" size={14} color={accent} />
        </View>
        <Text style={[styles.addStopLabel, { color: accent }]}>
          {t("generate.add-stop")}
        </Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: ts.bg }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />

      {/* ── Header + mode tabs (shared tab header chrome) ── */}
      <TabScreenHeader
        title={t("generate.title")}
        footer={
          <View
            style={[
              styles.modeBar,
              { backgroundColor: surface, borderColor: border },
            ]}
          >
            {MODE_TABS.map((m) => {
              const active = tab === m.key;
              return (
                <TouchableOpacity
                  key={m.key}
                  style={[
                    styles.modeTab,
                    active && { backgroundColor: accent },
                  ]}
                  onPress={() => setTab(m.key)}
                  activeOpacity={0.72}
                >
                  <Text
                    style={[
                      styles.modeTabText,
                      { color: active ? "#fff" : mutedColor },
                    ]}
                  >
                    {t(m.tKey)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        }
      />

      {/* ── Form scroll ── */}
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + 100 },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {tab === "ai" ? (
          <View style={styles.formSection}>
            {/* AI sub-mode: A→B or Round Trip */}
            <View
              style={[
                styles.subModeBar,
                { backgroundColor: surface, borderColor: border },
              ]}
            >
              {(
                [
                  { key: "a_to_b", label: t("generate.mode-atob") },
                  { key: "round_trip", label: t("generate.mode-round-trip") },
                ] as const
              ).map((m) => {
                const active = aiMode === m.key;
                return (
                  <TouchableOpacity
                    key={m.key}
                    style={[
                      styles.subModeTab,
                      active && { backgroundColor: accent },
                    ]}
                    onPress={() => {
                      setAiMode(m.key);
                      // Clear end location when switching to round trip
                      if (m.key === "round_trip") setAiEndLocation(null);
                    }}
                    activeOpacity={0.72}
                  >
                    <Text
                      style={[
                        styles.subModeTabText,
                        { color: active ? "#fff" : mutedColor },
                      ]}
                    >
                      {m.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Locations card */}
            <View style={styles.formGroup}>
              <SectionLabel
                label={t("generate.section-locations")}
                color={mutedColor}
              />
              <View
                style={[
                  styles.card,
                  { backgroundColor: surface, borderColor: border },
                ]}
              >
                {/* Start */}
                <LocationRow
                  dotColor="#1D9E75"
                  label={
                    aiStartLocation?.label ?? t("generate.placeholder-start")
                  }
                  isFilled={!!aiStartLocation}
                  onPress={() => openSearch("ai_start")}
                  onClear={() => setAiStartLocation(null)}
                  textColor={textColor}
                  mutedColor={mutedColor}
                  accent={accent}
                />

                {/* Must stops inline */}
                {mustStops.map((stop, i) => (
                  <View key={stop.id}>
                    <View
                      style={[
                        styles.locationDivider,
                        { backgroundColor: border },
                      ]}
                    />
                    <LocationRow
                      dotColor={accent}
                      dotStyle="outlined"
                      label={
                        stop.location?.label ??
                        t("generate.stop-label", { n: i + 1 })
                      }
                      isFilled={!!stop.location}
                      onPress={() => openSearch({ type: "stop", id: stop.id })}
                      onClear={() => {
                        if (stop.location) {
                          setMustStops((prev) =>
                            prev.map((s) =>
                              s.id === stop.id ? { ...s, location: null } : s,
                            ),
                          );
                        } else {
                          removeStop(stop.id);
                        }
                      }}
                      alwaysShowClear
                      showHandle
                      textColor={textColor}
                      mutedColor={mutedColor}
                      accent={accent}
                    />
                  </View>
                ))}

                {/* Add stop */}
                <View
                  style={[styles.locationDivider, { backgroundColor: border }]}
                />
                <TouchableOpacity
                  style={styles.addStopRow}
                  onPress={addStop}
                  activeOpacity={0.6}
                >
                  <View
                    style={[
                      styles.addStopIcon,
                      {
                        backgroundColor: accent + "18",
                        borderColor: accent + "40",
                      },
                    ]}
                  >
                    <Ionicons name="add" size={14} color={accent} />
                  </View>
                  <Text style={[styles.addStopLabel, { color: accent }]}>
                    {t("generate.add-stop")}
                  </Text>
                </TouchableOpacity>

                {/* End — only for A→B */}
                {aiMode === "a_to_b" && (
                  <>
                    <View
                      style={[
                        styles.locationDivider,
                        { backgroundColor: border },
                      ]}
                    />
                    <LocationRow
                      dotColor="#E24B4A"
                      label={
                        aiEndLocation?.label ??
                        t("generate.placeholder-destination")
                      }
                      isFilled={!!aiEndLocation}
                      onPress={() => openSearch("ai_end")}
                      onClear={() => setAiEndLocation(null)}
                      textColor={textColor}
                      mutedColor={mutedColor}
                      accent={accent}
                    />
                  </>
                )}
              </View>
            </View>

            {/* Distance — only for round trip */}
            {aiMode === "round_trip" && (
              <View style={styles.formGroup}>
                <SectionLabel
                  label={t("generate.section-distance")}
                  color={mutedColor}
                />
                <DistancePicker
                  value={distance}
                  onChange={setDistance}
                  customText={customDistanceText}
                  onCustomTextChange={setCustomDistanceText}
                  accent={accent}
                  surface={surface}
                  border={border}
                  mutedColor={mutedColor}
                  textColor={textColor}
                />
              </View>
            )}

            {/* AI prompt */}
            <View style={styles.formGroup}>
              <SectionLabel
                label={t("generate.section-ai-prompt")}
                color={mutedColor}
              />
              <View
                style={[
                  styles.card,
                  {
                    backgroundColor: surface,
                    borderColor: border,
                    padding: 14,
                  },
                ]}
              >
                <TextInput
                  style={[styles.aiPromptInput, { color: textColor }]}
                  placeholder={t("generate.placeholder-ai-prompt")}
                  placeholderTextColor={mutedColor}
                  value={aiPrompt}
                  onChangeText={setAiPrompt}
                  multiline
                  numberOfLines={4}
                  maxLength={500}
                  textAlignVertical="top"
                />
              </View>
            </View>

            {transportSection}
            {elevationSection}
          </View>
        ) : tab === "a_to_b" ? (
          <View style={styles.formSection}>
            {/* Locations: start → stops → end in one card */}
            <View style={styles.formGroup}>
              <SectionLabel
                label={t("generate.section-locations")}
                color={mutedColor}
              />
              <View
                style={[
                  styles.card,
                  { backgroundColor: surface, borderColor: border },
                ]}
              >
                {/* Start */}
                <LocationRow
                  dotColor="#1D9E75"
                  label={
                    startLocation?.label ?? t("generate.placeholder-start")
                  }
                  isFilled={!!startLocation}
                  onPress={() => openSearch("start")}
                  onClear={() => setStartLocation(null)}
                  textColor={textColor}
                  mutedColor={mutedColor}
                  accent={accent}
                />

                {/* Must stops inline */}
                {mustStops.map((stop, i) => (
                  <View key={stop.id}>
                    <View
                      style={[
                        styles.locationDivider,
                        { backgroundColor: border },
                      ]}
                    />
                    <View style={styles.stopRow}>
                      <Ionicons
                        name="reorder-three-outline"
                        size={18}
                        color={mutedColor}
                        style={styles.stopHandle}
                      />
                      <View style={[styles.stopDot, { borderColor: accent }]} />
                      <TouchableOpacity
                        style={{ flex: 1 }}
                        onPress={() =>
                          openSearch({ type: "stop", id: stop.id })
                        }
                        activeOpacity={0.6}
                      >
                        <Text
                          style={[
                            styles.locText,
                            { color: stop.location ? textColor : mutedColor },
                          ]}
                          numberOfLines={1}
                        >
                          {stop.location?.label ??
                            t("generate.stop-label", { n: i + 1 })}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => removeStop(stop.id)}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        activeOpacity={0.6}
                      >
                        <Ionicons
                          name="close-circle"
                          size={18}
                          color={mutedColor}
                        />
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}

                {/* Add stop button */}
                <View
                  style={[styles.locationDivider, { backgroundColor: border }]}
                />
                <TouchableOpacity
                  style={styles.addStopRow}
                  onPress={addStop}
                  activeOpacity={0.6}
                >
                  <View
                    style={[
                      styles.addStopIcon,
                      {
                        backgroundColor: accent + "18",
                        borderColor: accent + "40",
                      },
                    ]}
                  >
                    <Ionicons name="add" size={14} color={accent} />
                  </View>
                  <Text style={[styles.addStopLabel, { color: accent }]}>
                    {t("generate.add-stop")}
                  </Text>
                </TouchableOpacity>

                {/* End */}
                <View
                  style={[styles.locationDivider, { backgroundColor: border }]}
                />
                <LocationRow
                  dotColor="#E24B4A"
                  label={
                    endLocation?.label ?? t("generate.placeholder-destination")
                  }
                  isFilled={!!endLocation}
                  onPress={() => openSearch("end")}
                  onClear={() => setEndLocation(null)}
                  textColor={textColor}
                  mutedColor={mutedColor}
                  accent={accent}
                />
              </View>
            </View>

            {transportSection}
            {poiSection}
            {elevationSection}
          </View>
        ) : (
          <View style={styles.formSection}>
            {/* Start */}
            <View style={styles.formGroup}>
              <SectionLabel
                label={t("generate.section-start")}
                color={mutedColor}
              />
              <View
                style={[
                  styles.card,
                  { backgroundColor: surface, borderColor: border },
                ]}
              >
                <LocationRow
                  dotColor={accent}
                  label={
                    roundStartLocation?.label ??
                    t("generate.placeholder-loop-start")
                  }
                  isFilled={!!roundStartLocation}
                  onPress={() => openSearch("round_start")}
                  onClear={() => setRoundStartLocation(null)}
                  textColor={textColor}
                  mutedColor={mutedColor}
                  accent={accent}
                />
              </View>
            </View>

            {/* Must stops */}
            <View style={styles.formGroup}>
              <SectionLabel
                label={t("generate.section-stops")}
                color={mutedColor}
              />
              {stopsCard}
            </View>

            {/* Distance */}
            <View style={styles.formGroup}>
              <SectionLabel
                label={t("generate.section-distance")}
                color={mutedColor}
              />
              <DistancePicker
                value={distance}
                onChange={setDistance}
                customText={customDistanceText}
                onCustomTextChange={setCustomDistanceText}
                accent={accent}
                surface={surface}
                border={border}
                mutedColor={mutedColor}
                textColor={textColor}
              />
            </View>

            {transportSection}
            {poiSection}
            {elevationSection}
          </View>
        )}
      </ScrollView>

      {/* ── Footer ── */}
      <View
        style={[
          styles.footer,
          {
            backgroundColor: ts.bg,
            borderTopColor: border,
            paddingBottom: insets.bottom + 10,
          },
        ]}
      >
        <TouchableOpacity
          style={[
            styles.generateBtn,
            {
              backgroundColor: accent,
              opacity: canGenerate && !generating ? 1 : 0.36,
            },
          ]}
          activeOpacity={0.84}
          disabled={!canGenerate || generating}
          onPress={handleGenerate}
        >
          <View style={styles.btnInner}>
            {generating ? (
              <>
                <ActivityIndicator color="#fff" size="small" />
                {progressLabel ? (
                  <Text style={[styles.btnText, { marginLeft: 10 }]}>
                    {progressLabel}
                  </Text>
                ) : null}
              </>
            ) : (
              <>
                <Text style={styles.btnText}>{t("generate.generate-btn")}</Text>
                <Ionicons name="arrow-forward" size={18} color="#fff" />
              </>
            )}
          </View>
        </TouchableOpacity>
      </View>

      {/* ── Location search sheet ── */}
      <LocationSearchSheet
        visible={sheetVisible}
        placeholder={
          searchTarget === "end" || searchTarget === "ai_end"
            ? t("generate.search-destination")
            : searchTarget === "round_start" || searchTarget === "ai_start"
              ? t("generate.search-start")
              : typeof searchTarget === "object"
                ? t("generate.search-stop")
                : t("generate.search-start")
        }
        userCoords={userCoords}
        onSelect={handleLocationSelected}
        onClose={closeSearch}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },

  offlineWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    gap: 12,
  },
  offlineIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  offlineTitle: { fontSize: 20, fontWeight: "700", letterSpacing: -0.3 },
  offlineBody: { fontSize: 14, textAlign: "center", lineHeight: 20 },

  modeBar: {
    flexDirection: "row",
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 3,
    gap: 3,
  },
  modeTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 11,
  },
  modeTabText: { fontSize: 14, fontWeight: "600" },

  scroll: { paddingHorizontal: 20, paddingTop: 4 },

  subModeBar: {
    flexDirection: "row",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 3,
    gap: 3,
  },
  subModeTab: {
    flex: 1,
    paddingVertical: 9,
    alignItems: "center",
    borderRadius: 9,
  },
  subModeTabText: { fontSize: 13, fontWeight: "600" },

  formSection: { gap: 20 },
  formGroup: { gap: 8 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.6,
    paddingHorizontal: 2,
  },

  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },

  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  locationDivider: { height: StyleSheet.hairlineWidth, marginLeft: 38 },

  locDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  locText: { flex: 1, fontSize: 15 },

  stopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  stopHandle: { marginRight: -2 },
  stopDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 2,
    backgroundColor: "transparent",
  },

  addStopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  addStopIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  addStopLabel: { fontSize: 14, fontWeight: "600" },

  transportScroll: { gap: 8, paddingHorizontal: 16, marginHorizontal: -16 },
  transportChip: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
    minWidth: 68,
  },

  chipRow: { flexDirection: "row", gap: 8 },
  iconChip: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  iconChipLabel: { fontSize: 11, fontWeight: "600" },

  poiGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  poiChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    width: "48%",
  },
  poiLabel: { fontSize: 13, fontWeight: "500" },

  distanceGroup: { gap: 8 },
  distChip: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  distChipLabel: { fontSize: 13, fontWeight: "600" },
  customDistRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  customDistInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 9,
  },
  customDistUnit: { fontSize: 14, fontWeight: "600" },

  aiPromptInput: {
    fontSize: 15,
    minHeight: 96,
    paddingVertical: 0,
  },

  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  generateBtn: { borderRadius: 14, paddingVertical: 15, alignItems: "center" },
  btnInner: { flexDirection: "row", alignItems: "center", gap: 8 },
  btnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
});
