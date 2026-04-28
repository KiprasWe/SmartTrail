import { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  useColorScheme,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNetwork } from "@/hooks/use-network";
import type { ResolvedLocation } from "@/hooks/use-location-search";
import { LocationSearchSheet } from "@/components/generate/location-search-sheet";
import { Colors } from "@/constants/theme";
import { useTranslation } from "@/hooks/use-translation";
import { TabScreenHeader } from "@/components/ui/tab-screen-header";
import {
  OfflineScreen,
  type TransportKey,
  type ElevationKey,
  type DistanceKey,
} from "@/components/generate/route-form-components";
import { AtoBTab } from "@/components/generate/tabs/a-to-b-tab";
import { RoundTripTab } from "@/components/generate/tabs/round-trip-tab";
import { AiTab } from "@/components/generate/tabs/ai-tab";
import type { MustStop } from "@/components/generate/stops-list";
import { useRouteGeneration } from "@/hooks/use-route-generation";

type TabKey = "a_to_b" | "round_trip" | "ai";

// Which field is the search sheet targeting
type SearchTarget =
  | "start"
  | "end"
  | "round_start"
  | "ai_start"
  | "ai_end"
  | { type: "stop"; id: string };

const MODE_TABS: { key: TabKey; tKey: string }[] = [
  { key: "a_to_b", tKey: "generate.mode-atob" },
  { key: "round_trip", tKey: "generate.mode-round-trip" },
  { key: "ai", tKey: "generate.mode-ai" },
];

function sameCoords(a: ResolvedLocation | null, b: ResolvedLocation | null) {
  if (!a || !b) return false;
  return a.coords.lat === b.coords.lat && a.coords.lng === b.coords.lng;
}

export default function GenerateScreen() {
  const { isOnline } = useNetwork();
  const scheme = useColorScheme() ?? "light";
  const c = Colors[scheme];
  const insets = useSafeAreaInsets();
  const isDark = scheme === "dark";
  const { t } = useTranslation();

  const [tab, setTab] = useState<TabKey>("a_to_b");

  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);

  // A→B
  const [startLocation, setStartLocation] = useState<ResolvedLocation | null>(null);
  const [endLocation, setEndLocation] = useState<ResolvedLocation | null>(null);

  // Round trip
  const [roundStartLocation, setRoundStartLocation] =
    useState<ResolvedLocation | null>(null);

  // AI
  const [aiStartLocation, setAiStartLocation] = useState<ResolvedLocation | null>(null);
  const [aiEndLocation, setAiEndLocation] = useState<ResolvedLocation | null>(null);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiMode, setAiMode] = useState<"a_to_b" | "round_trip">("a_to_b");

  // Shared must-stops
  const [mustStops, setMustStops] = useState<MustStop[]>([]);

  // Search sheet
  const [searchTarget, setSearchTarget] = useState<SearchTarget | null>(null);
  const sheetVisible = searchTarget !== null;

  const openSearch = useCallback((target: SearchTarget) => {
    setSearchTarget(target);
  }, []);
  const closeSearch = useCallback(() => setSearchTarget(null), []);

  const handleLocationSelected = useCallback(
    (location: ResolvedLocation) => {
      if (!searchTarget) return;
      setUserCoords(location.coords);

      if (searchTarget === "start") {
        if (sameCoords(endLocation, location)) {
          setTab("round_trip");
          setRoundStartLocation(location);
          setStartLocation(null);
          setEndLocation(null);
        } else {
          setStartLocation(location);
        }
      } else if (searchTarget === "end") {
        if (sameCoords(startLocation, location)) {
          setTab("round_trip");
          setRoundStartLocation(location);
          setStartLocation(null);
          setEndLocation(null);
        } else {
          setEndLocation(location);
        }
      } else if (searchTarget === "round_start") setRoundStartLocation(location);
      else if (searchTarget === "ai_start") {
        setAiStartLocation(location);
        if (aiMode === "a_to_b" && sameCoords(aiEndLocation, location)) {
          setAiMode("round_trip");
          setAiEndLocation(null);
        }
      } else if (searchTarget === "ai_end") {
        if (aiMode === "a_to_b" && sameCoords(aiStartLocation, location)) {
          setAiMode("round_trip");
          setAiEndLocation(null);
        } else {
          setAiEndLocation(location);
        }
      } else if (typeof searchTarget === "object" && searchTarget.type === "stop") {
        setMustStops((prev) =>
          prev.map((s) => (s.id === searchTarget.id ? { ...s, location } : s)),
        );
      }
    },
    [searchTarget, startLocation, endLocation, aiMode, aiStartLocation, aiEndLocation],
  );

  const addStop = useCallback(() => {
    setMustStops((prev) => [...prev, { id: Date.now().toString(), location: null }]);
  }, []);
  const removeStop = useCallback((id: string) => {
    setMustStops((prev) => prev.filter((s) => s.id !== id));
  }, []);
  const clearStopLocation = useCallback((id: string) => {
    setMustStops((prev) =>
      prev.map((s) => (s.id === id ? { ...s, location: null } : s)),
    );
  }, []);
  const openStop = useCallback(
    (id: string) => openSearch({ type: "stop", id }),
    [openSearch],
  );

  // Form state
  const [transport, setTransport] = useState<TransportKey>("foot-walking");
  const [elevation, setElevation] = useState<ElevationKey>("auto");
  const [selectedPoi, setSelectedPoi] = useState<Set<string>>(new Set());
  const [poiCount, setPoiCount] = useState(3);
  const [distance, setDistance] = useState<DistanceKey>("10");
  const [customDistanceText, setCustomDistanceText] = useState("");

  const togglePoi = useCallback((key: string) => {
    setSelectedPoi((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const customDistanceKm = parseFloat(customDistanceText);
  const customDistanceValid =
    distance !== "custom" ||
    (!isNaN(customDistanceKm) && customDistanceKm >= 0.5 && customDistanceKm <= 100);
  const canGenerate =
    tab === "a_to_b"
      ? !!startLocation && !!endLocation
      : tab === "round_trip"
        ? !!roundStartLocation && customDistanceValid
        : !!aiStartLocation &&
          aiPrompt.trim().length > 0 &&
          (aiMode === "a_to_b" ? !!aiEndLocation : customDistanceValid);

  const { generate, generating, progressLabel } = useRouteGeneration();

  const handleGenerate = useCallback(() => {
    if (!canGenerate) return;
    generate({
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
      selectedPoi,
      poiCount,
      distance,
      customDistanceText,
    });
  }, [
    canGenerate,
    generate,
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
    selectedPoi,
    poiCount,
    distance,
    customDistanceText,
  ]);

  if (isOnline === false) return <OfflineScreen />;
  if (isOnline === null) return null;

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />

      <TabScreenHeader
        title={t("generate.title")}
        footer={
          <View style={[styles.modeBar, { backgroundColor: c.surface, borderColor: c.border }]}>
            {MODE_TABS.map((m) => {
              const active = tab === m.key;
              return (
                <TouchableOpacity
                  key={m.key}
                  style={[styles.modeTab, active && { backgroundColor: c.tint }]}
                  onPress={() => setTab(m.key)}
                  activeOpacity={0.72}
                >
                  <Text
                    style={[styles.modeTabText, { color: active ? "#fff" : c.muted }]}
                  >
                    {t(m.tKey)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        }
      />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {tab === "ai" ? (
          <AiTab
            aiMode={aiMode}
            onAiModeChange={(m) => {
              setAiMode(m);
              if (m === "round_trip") setAiEndLocation(null);
            }}
            startLocation={aiStartLocation}
            endLocation={aiEndLocation}
            onOpenStart={() => openSearch("ai_start")}
            onOpenEnd={() => openSearch("ai_end")}
            onClearStart={() => setAiStartLocation(null)}
            onClearEnd={() => setAiEndLocation(null)}
            mustStops={mustStops}
            onOpenStop={openStop}
            onClearStopLocation={clearStopLocation}
            onRemoveStop={removeStop}
            onAddStop={addStop}
            prompt={aiPrompt}
            onPromptChange={setAiPrompt}
            distance={distance}
            onDistanceChange={setDistance}
            customDistanceText={customDistanceText}
            onCustomDistanceChange={setCustomDistanceText}
            transport={transport}
            onTransportChange={setTransport}
            elevation={elevation}
            onElevationChange={setElevation}
            colors={c}
          />
        ) : tab === "a_to_b" ? (
          <AtoBTab
            startLocation={startLocation}
            endLocation={endLocation}
            onOpenStart={() => openSearch("start")}
            onOpenEnd={() => openSearch("end")}
            onClearStart={() => setStartLocation(null)}
            onClearEnd={() => setEndLocation(null)}
            mustStops={mustStops}
            onOpenStop={openStop}
            onRemoveStop={removeStop}
            onAddStop={addStop}
            transport={transport}
            onTransportChange={setTransport}
            elevation={elevation}
            onElevationChange={setElevation}
            selectedPoi={selectedPoi}
            onTogglePoi={togglePoi}
            poiCount={poiCount}
            onPoiCountChange={setPoiCount}
            colors={c}
          />
        ) : (
          <RoundTripTab
            startLocation={roundStartLocation}
            onOpenStart={() => openSearch("round_start")}
            onClearStart={() => setRoundStartLocation(null)}
            mustStops={mustStops}
            onOpenStop={openStop}
            onClearStopLocation={clearStopLocation}
            onRemoveStop={removeStop}
            onAddStop={addStop}
            distance={distance}
            onDistanceChange={setDistance}
            customDistanceText={customDistanceText}
            onCustomDistanceChange={setCustomDistanceText}
            transport={transport}
            onTransportChange={setTransport}
            elevation={elevation}
            onElevationChange={setElevation}
            selectedPoi={selectedPoi}
            onTogglePoi={togglePoi}
            poiCount={poiCount}
            onPoiCountChange={setPoiCount}
            colors={c}
          />
        )}
      </ScrollView>

      <View
        style={[
          styles.footer,
          { backgroundColor: c.bg, borderTopColor: c.border, paddingBottom: 10 },
        ]}
      >
        <TouchableOpacity
          style={[
            styles.generateBtn,
            {
              backgroundColor: c.tint,
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

const styles = StyleSheet.create({
  root: { flex: 1 },

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
