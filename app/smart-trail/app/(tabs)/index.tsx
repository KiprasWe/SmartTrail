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
import { useGenerateForm } from "@/hooks/use-generate-form";
import { useRouteGeneration } from "@/hooks/use-route-generation";
import { LocationSearchSheet } from "@/components/generate/location-search-sheet";
import { Colors } from "@/constants/theme";
import { t } from "@/lib/i18n";
import { TabScreenHeader } from "@/components/ui/tab-screen-header";
import { OfflineScreen } from "@/components/generate/route-form-components";
import { AtoBTab } from "@/components/generate/tabs/a-to-b-tab";
import { RoundTripTab } from "@/components/generate/tabs/round-trip-tab";
import { AiTab } from "@/components/generate/tabs/ai-tab";

const MODE_TABS: { key: "a_to_b" | "round_trip" | "ai"; tKey: string }[] = [
  { key: "a_to_b", tKey: "generate.mode-atob" },
  { key: "round_trip", tKey: "generate.mode-round-trip" },
  { key: "ai", tKey: "generate.mode-ai" },
];

export default function GenerateScreen() {
  const { isOnline } = useNetwork();
  const scheme = useColorScheme() ?? "light";
  const c = Colors[scheme];
  const insets = useSafeAreaInsets();
  const isDark = scheme === "dark";

  const form = useGenerateForm();
  const { generate, generating, progressLabel } = useRouteGeneration();

  const openSearch = (target: typeof form.searchTarget) =>
    form.setSearchTarget(target);
  const closeSearch = () => form.setSearchTarget(null);
  const openStop = (id: string) => openSearch({ type: "stop", id });

  const handleGenerate = () => {
    if (!form.canGenerate) return;
    generate({
      tab: form.tab,
      aiMode: form.aiMode,
      startLocation: form.startLocation,
      endLocation: form.endLocation,
      roundStartLocation: form.roundStartLocation,
      aiStartLocation: form.aiStartLocation,
      aiEndLocation: form.aiEndLocation,
      aiPrompt: form.aiPrompt,
      mustStops: form.mustStops,
      transport: form.transport,
      elevation: form.elevation,
      selectedPoi: form.selectedPoi,
      poiCount: form.poiCount,
      distance: form.distance,
      customDistanceText: form.customDistanceText,
    });
  };

  // Network status: explicit offline screen, brief loader during the initial
  // probe (was previously a blank screen — bad UX on slow boots).
  if (isOnline === false) return <OfflineScreen />;
  if (isOnline === null) {
    return (
      <View
        style={[
          styles.root,
          { backgroundColor: c.bg, alignItems: "center", justifyContent: "center" },
        ]}
      >
        <ActivityIndicator color={c.tint} />
      </View>
    );
  }

  const searchPlaceholder = (() => {
    const target = form.searchTarget;
    if (target === "end" || target === "ai_end")
      return t("generate.search-destination");
    if (target === "round_start" || target === "ai_start")
      return t("generate.search-start");
    if (typeof target === "object") return t("generate.search-stop");
    return t("generate.search-start");
  })();

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />

      <TabScreenHeader
        title={t("generate.title")}
        footer={
          <View
            style={[
              styles.modeBar,
              { backgroundColor: c.surface, borderColor: c.border },
            ]}
          >
            {MODE_TABS.map((m) => {
              const active = form.tab === m.key;
              return (
                <TouchableOpacity
                  key={m.key}
                  style={[
                    styles.modeTab,
                    active && { backgroundColor: c.tint },
                  ]}
                  onPress={() => form.setTab(m.key)}
                  activeOpacity={0.72}
                >
                  <Text
                    style={[
                      styles.modeTabText,
                      { color: active ? "#fff" : c.muted },
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

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + 100 },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {form.tab === "ai" ? (
          <AiTab
            aiMode={form.aiMode}
            onAiModeChange={(m) => {
              form.setAiMode(m);
              if (m === "round_trip") form.setAiEndLocation(null);
            }}
            startLocation={form.aiStartLocation}
            endLocation={form.aiEndLocation}
            onOpenStart={() => openSearch("ai_start")}
            onOpenEnd={() => openSearch("ai_end")}
            onClearStart={() => form.setAiStartLocation(null)}
            onClearEnd={() => form.setAiEndLocation(null)}
            mustStops={form.mustStops}
            onOpenStop={openStop}
            onClearStopLocation={form.clearStopLocation}
            onRemoveStop={form.removeStop}
            onAddStop={form.addStop}
            prompt={form.aiPrompt}
            onPromptChange={form.setAiPrompt}
            distance={form.distance}
            onDistanceChange={form.setDistance}
            customDistanceText={form.customDistanceText}
            onCustomDistanceChange={form.setCustomDistanceText}
            transport={form.transport}
            onTransportChange={form.setTransport}
            elevation={form.elevation}
            onElevationChange={form.setElevation}
            colors={c}
          />
        ) : form.tab === "a_to_b" ? (
          <AtoBTab
            startLocation={form.startLocation}
            endLocation={form.endLocation}
            onOpenStart={() => openSearch("start")}
            onOpenEnd={() => openSearch("end")}
            onClearStart={() => form.setStartLocation(null)}
            onClearEnd={() => form.setEndLocation(null)}
            mustStops={form.mustStops}
            onOpenStop={openStop}
            onClearStopLocation={form.clearStopLocation}
            onRemoveStop={form.removeStop}
            onAddStop={form.addStop}
            transport={form.transport}
            onTransportChange={form.setTransport}
            elevation={form.elevation}
            onElevationChange={form.setElevation}
            selectedPoi={form.selectedPoi}
            onTogglePoi={form.togglePoi}
            poiCount={form.poiCount}
            onPoiCountChange={form.setPoiCount}
            colors={c}
          />
        ) : (
          <RoundTripTab
            startLocation={form.roundStartLocation}
            onOpenStart={() => openSearch("round_start")}
            onClearStart={() => form.setRoundStartLocation(null)}
            mustStops={form.mustStops}
            onOpenStop={openStop}
            onClearStopLocation={form.clearStopLocation}
            onRemoveStop={form.removeStop}
            onAddStop={form.addStop}
            distance={form.distance}
            onDistanceChange={form.setDistance}
            customDistanceText={form.customDistanceText}
            onCustomDistanceChange={form.setCustomDistanceText}
            transport={form.transport}
            onTransportChange={form.setTransport}
            elevation={form.elevation}
            onElevationChange={form.setElevation}
            selectedPoi={form.selectedPoi}
            onTogglePoi={form.togglePoi}
            poiCount={form.poiCount}
            onPoiCountChange={form.setPoiCount}
            colors={c}
          />
        )}
      </ScrollView>

      <View
        style={[
          styles.footer,
          {
            backgroundColor: c.bg,
            borderTopColor: c.border,
            paddingBottom: 10,
          },
        ]}
      >
        <TouchableOpacity
          style={[
            styles.generateBtn,
            {
              backgroundColor: c.tint,
              opacity: form.canGenerate && !generating ? 1 : 0.36,
            },
          ]}
          activeOpacity={0.84}
          disabled={!form.canGenerate || generating}
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
        visible={form.sheetVisible}
        placeholder={searchPlaceholder}
        userCoords={form.userCoords}
        onSelect={form.handleLocationSelected}
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
