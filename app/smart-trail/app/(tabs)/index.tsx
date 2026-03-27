import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  Platform,
  useColorScheme,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { useState, useRef, useCallback, useEffect } from "react";
import * as Location from "expo-location";
import { Colors } from "@/constants/theme";
import { routeStore } from "@/store/route-store";
import { useRouter } from "expo-router";

const ORS_KEY = process.env.EXPO_PUBLIC_ORS_API_KEY ?? "";
const ORS_GEOCODE = "https://api.openrouteservice.org/geocode";
const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

const TRANSPORT_OPTIONS = [
  { key: "walking", label: "🚶 Walk" },
  { key: "running", label: "🏃 Run" },
  { key: "hiking", label: "🥾 Hike" },
  { key: "cycling", label: "🚴 Bike" },
  { key: "mtb", label: "🚵 MTB" },
  { key: "ebike", label: "⚡ E-Bike" },
];

const AI_PRESET_CHIPS = [
  "Scenic viewpoints",
  "Historic sites",
  "Local food & cafes",
  "Nature & parks",
  "Architecture",
  "Street art",
  "Local life",
  "Hidden gems",
];

const DISTANCE_OPTIONS = [
  { key: 3000, label: "3 km" },
  { key: 5000, label: "5 km" },
  { key: 10000, label: "10 km" },
  { key: 15000, label: "15 km" },
  { key: 20000, label: "20 km" },
  { key: 30000, label: "30 km" },
];

type LatLng = { lat: number; lng: number };

type GeoFeature = {
  place_id: string;
  label: string;
  coords: LatLng;
};

// ─── ORS helpers ─────────────────────────────────────────────────────────────

async function searchPlaces(
  query: string,
  focus?: LatLng,
): Promise<GeoFeature[]> {
  if (query.trim().length < 2) return [];
  const params = new URLSearchParams({
    api_key: ORS_KEY,
    text: query,
    size: "5",
  });
  if (focus) {
    params.set("focus.point.lon", String(focus.lng));
    params.set("focus.point.lat", String(focus.lat));
  }
  const res = await fetch(`${ORS_GEOCODE}/autocomplete?${params}`);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.features ?? []).map((f: any) => ({
    place_id: f.properties.id,
    label: f.properties.label,
    coords: {
      lng: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
    },
  }));
}

async function reverseGeocode(coords: LatLng): Promise<string> {
  const params = new URLSearchParams({
    api_key: ORS_KEY,
    "point.lon": String(coords.lng),
    "point.lat": String(coords.lat),
    size: "1",
  });
  const res = await fetch(`${ORS_GEOCODE}/reverse?${params}`);
  if (!res.ok) return "Current location";
  const data = await res.json();
  return data.features?.[0]?.properties?.label ?? "Current location";
}

// ─── LocationInput ────────────────────────────────────────────────────────────

type LocationInputProps = {
  placeholder: string;
  dotColor: string;
  /** Controlled label — synced into the input whenever it changes externally */
  value: string;
  coords: LatLng | null;
  onSelect: (label: string, coords: LatLng) => void;
  onClear: () => void;
  borderColor: string;
  textColor: string;
  mutedColor: string;
  dropdownBg: string;
  userCoords: LatLng | null;
  showBorder: boolean;
};

function LocationInput({
  placeholder,
  dotColor,
  value,
  coords,
  onSelect,
  onClear,
  borderColor,
  textColor,
  mutedColor,
  dropdownBg,
  userCoords,
  showBorder,
}: LocationInputProps) {
  const [query, setQuery] = useState(value);
  const [suggestions, setSuggestions] = useState<GeoFeature[]>([]);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Distinguishes external updates (reverse geocode) from user typing
  const isUserTyping = useRef(false);

  // When parent pushes a new label (e.g. after reverse geocode), reflect it
  useEffect(() => {
    if (!isUserTyping.current) {
      setQuery(value);
    }
    isUserTyping.current = false;
  }, [value]);

  const handleChange = useCallback(
    (text: string) => {
      isUserTyping.current = true;
      setQuery(text);

      if (!text.trim()) {
        setSuggestions([]);
        onClear();
        return;
      }

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        setLoading(true);
        const results = await searchPlaces(text, userCoords ?? undefined);
        setSuggestions(results);
        setLoading(false);
      }, 350);
    },
    [userCoords, onClear],
  );

  const handleSelect = (feature: GeoFeature) => {
    isUserTyping.current = false;
    setQuery(feature.label);
    setSuggestions([]);
    setFocused(false);
    onSelect(feature.label, feature.coords);
  };

  const handleClear = () => {
    isUserTyping.current = false;
    setQuery("");
    setSuggestions([]);
    onClear();
  };

  const showDropdown = focused && (suggestions.length > 0 || loading);

  return (
    <View>
      <View
        style={[
          styles.inputRow,
          showBorder && {
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: borderColor,
          },
        ]}
      >
        <View style={[styles.dot, { backgroundColor: dotColor }]} />
        <TextInput
          style={[styles.locationInput, { color: textColor }]}
          placeholder={placeholder}
          placeholderTextColor={mutedColor}
          value={query}
          onChangeText={handleChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
        />
        {loading && <ActivityIndicator size="small" color={mutedColor} />}
        {!!query && !loading && (
          <TouchableOpacity onPress={handleClear} hitSlop={8}>
            <Text style={{ color: mutedColor, fontSize: 18, lineHeight: 20 }}>
              ×
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {showDropdown && (
        <View
          style={[
            styles.dropdown,
            { backgroundColor: dropdownBg, borderColor },
          ]}
        >
          {loading && suggestions.length === 0 ? (
            <View style={styles.suggestionRow}>
              <ActivityIndicator size="small" color={mutedColor} />
            </View>
          ) : (
            suggestions.map((s, i) => (
              <TouchableOpacity
                key={s.place_id}
                style={[
                  styles.suggestionRow,
                  i < suggestions.length - 1 && {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: borderColor,
                  },
                ]}
                onPress={() => handleSelect(s)}
                activeOpacity={0.7}
              >
                <Text
                  style={[styles.suggestionText, { color: textColor }]}
                  numberOfLines={1}
                >
                  {s.label}
                </Text>
              </TouchableOpacity>
            ))
          )}
        </View>
      )}
    </View>
  );
}

// ─── GenerateScreen ───────────────────────────────────────────────────────────

export default function GenerateScreen() {
  const scheme = useColorScheme() ?? "light";
  const t = Colors[scheme];
  const isDark = scheme === "dark";
  const router = useRouter();

  const [mode, setMode] = useState<"a_to_b" | "round_trip" | "ai_route">("a_to_b");
  const [transport, setTransport] = useState("walking");
  const [distance, setDistance] = useState(5000);
  const [startLabel, setStartLabel] = useState("");
  const [startCoords, setStartCoords] = useState<LatLng | null>(null);
  const [endLabel, setEndLabel] = useState("");
  const [endCoords, setEndCoords] = useState<LatLng | null>(null);
  const [locating, setLocating] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [userCoords, setUserCoords] = useState<LatLng | null>(null);
  // AI mode state
  const [aiMode, setAiMode] = useState<"a_to_b" | "round_trip">("a_to_b");
  const [preferences, setPreferences] = useState("");
  const [area, setArea] = useState("");
  const [aiUseLocation, setAiUseLocation] = useState(false);

  const cardBg = isDark ? "#1c1c1e" : "#f2f2f7";
  const borderCol = isDark ? "#2c2c2e" : "#e0e0e5";
  const accentCol = "#4f8ef7";
  const dropBg = isDark ? "#2c2c2e" : "#ffffff";

  const handleLocateMe = async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        alert("Location permission denied.");
        return;
      }
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const coords: LatLng = {
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
      };
      setUserCoords(coords);
      // ORS reverse geocode → human-readable label in the same format as search results
      const label = await reverseGeocode(coords);
      setStartCoords(coords);
      setStartLabel(label); // triggers useEffect in LocationInput → updates the input
    } catch {
      alert("Could not get your location.");
    } finally {
      setLocating(false);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      let url: string;
      let body: object;

      if (mode === "ai_route") {
        url = `${API_BASE}/routes/generate-ai`;
        body = {
          preferences,
          area: aiUseLocation ? undefined : area,
          transport,
          mode: aiMode,
          start: aiUseLocation && userCoords ? userCoords : undefined,
        };
      } else if (mode === "round_trip") {
        url = `${API_BASE}/routes/generate-round-trip`;
        body = { start: startCoords, transport, length: distance };
      } else {
        url = `${API_BASE}/routes/generate-a-to-b`;
        body = { start: startCoords, end: endCoords, transport };
      }

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Server error ${res.status}`);

      if (mode === "ai_route") {
        routeStore.set(data); // backend already includes start, end, plan
      } else {
        routeStore.set({
          ...data,
          start: startCoords!,
          end: mode === "round_trip" ? startCoords! : endCoords!,
        });
      }
      router.push("/route-map");
    } catch (error: any) {
      alert("Could not generate routes: " + error.message);
    } finally {
      setGenerating(false);
    }
  };

  const canGenerate = !generating && (() => {
    if (mode === "ai_route") return preferences.trim().length > 0 && (aiUseLocation ? !!userCoords : area.trim().length > 0);
    if (mode === "round_trip") return !!startCoords;
    return !!startCoords && !!endCoords;
  })();

  const Section = ({ label }: { label: string }) => (
    <Text style={[styles.sectionLabel, { color: t.muted }]}>{label}</Text>
  );

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />

      <View style={[styles.header, { borderBottomColor: borderCol }]}>
        <Text style={[styles.title, { color: t.text }]}>Generate</Text>
        <Text style={[styles.subtitle, { color: t.muted }]}>
          {mode === "a_to_b" ? "A → B route" : mode === "round_trip" ? "Round trip" : "AI planned route"}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {/* ── Mode ── */}
        <View style={[styles.modeRow, { backgroundColor: cardBg, borderColor: borderCol }]}>
          {([
            { key: "a_to_b", label: "A → B" },
            { key: "round_trip", label: "Loop" },
            { key: "ai_route", label: "✦ AI" },
          ] as const).map((m) => {
            const active = mode === m.key;
            return (
              <TouchableOpacity
                key={m.key}
                style={[styles.modeTab, active && { backgroundColor: m.key === "ai_route" ? "#7c3aed" : accentCol }]}
                onPress={() => setMode(m.key)}
                activeOpacity={0.7}
              >
                <Text style={[styles.modeTabText, { color: active ? "#fff" : t.muted }]}>
                  {m.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ── AI Mode UI ── */}
        {mode === "ai_route" && (
          <>
            {/* Sub-mode: one-way or loop */}
            <Section label="ROUTE TYPE" />
            <View style={[styles.modeRow, { backgroundColor: cardBg, borderColor: borderCol }]}>
              {([
                { key: "a_to_b", label: "One-way" },
                { key: "round_trip", label: "Loop" },
              ] as const).map((m) => {
                const active = aiMode === m.key;
                return (
                  <TouchableOpacity
                    key={m.key}
                    style={[styles.modeTab, active && { backgroundColor: "#7c3aed" }]}
                    onPress={() => setAiMode(m.key)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.modeTabText, { color: active ? "#fff" : t.muted }]}>
                      {m.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Area input — hidden when using current location */}
            {!aiUseLocation && (
              <>
                <Section label="CITY OR AREA" />
                <View style={[styles.card, { backgroundColor: cardBg, borderColor: borderCol, paddingHorizontal: 14, paddingVertical: 12 }]}>
                  <TextInput
                    style={[{ fontSize: 15, color: t.text }]}
                    placeholder="e.g. Kaunas old town, Paris 7th arrondissement..."
                    placeholderTextColor={t.muted}
                    value={area}
                    onChangeText={setArea}
                    autoCorrect={false}
                  />
                </View>
              </>
            )}

            {/* Preferences text input */}
            <Section label="WHAT DO YOU WANT TO EXPERIENCE?" />
            <View style={[styles.card, { backgroundColor: cardBg, borderColor: borderCol, padding: 14 }]}>
              <TextInput
                style={[styles.preferencesInput, { color: t.text }]}
                placeholder="e.g. historical objects of Kaunas old town, coffee shops with a view..."
                placeholderTextColor={t.muted}
                value={preferences}
                onChangeText={setPreferences}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
            </View>

            {/* Preset chips */}
            <View style={[styles.chipRow, { marginTop: 10 }]}>
              {AI_PRESET_CHIPS.map((chip) => {
                const active = preferences.includes(chip);
                return (
                  <TouchableOpacity
                    key={chip}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: active ? "#7c3aed" : cardBg,
                        borderColor: active ? "#7c3aed" : borderCol,
                      },
                    ]}
                    onPress={() =>
                      setPreferences((p) =>
                        p.includes(chip)
                          ? p.replace(chip, "").replace(/,\s*,/, ",").trim().replace(/^,|,$/, "").trim()
                          : p.trim() ? `${p.trim()}, ${chip}` : chip
                      )
                    }
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.chipText, { color: active ? "#fff" : t.text }]}>
                      {chip}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Use my location toggle */}
            <TouchableOpacity
              style={[styles.locateBtn, { borderColor: aiUseLocation ? "#7c3aed" : borderCol, backgroundColor: aiUseLocation ? "#7c3aed15" : cardBg, marginTop: 16 }]}
              onPress={async () => {
                if (!aiUseLocation) {
                  setLocating(true);
                  try {
                    const { status } = await Location.requestForegroundPermissionsAsync();
                    if (status !== "granted") { alert("Location permission denied."); return; }
                    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
                    setUserCoords({ lat: loc.coords.latitude, lng: loc.coords.longitude });
                    setAiUseLocation(true);
                  } catch { alert("Could not get location."); }
                  finally { setLocating(false); }
                } else {
                  setAiUseLocation(false);
                }
              }}
              activeOpacity={0.7}
              disabled={locating}
            >
              {locating ? <ActivityIndicator size="small" color="#7c3aed" /> : (
                <Text style={{ fontSize: 14, color: aiUseLocation ? "#7c3aed" : t.muted }}>◎</Text>
              )}
              <Text style={[styles.locateText, { color: aiUseLocation ? "#7c3aed" : t.muted }]}>
                {aiUseLocation ? "Using your current location as start" : "Use my location as starting point (optional)"}
              </Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── Locations (non-AI modes) ── */}
        {mode !== "ai_route" && (
          <>
            <Section label="LOCATIONS" />
            <View style={[styles.card, { backgroundColor: cardBg, borderColor: borderCol }]}>
              <LocationInput
                placeholder="Starting point"
                dotColor="#34c759"
                value={startLabel}
                coords={startCoords}
                onSelect={(label, coords) => { setStartLabel(label); setStartCoords(coords); }}
                onClear={() => { setStartLabel(""); setStartCoords(null); }}
                borderColor={borderCol}
                textColor={t.text}
                mutedColor={t.muted}
                dropdownBg={dropBg}
                userCoords={userCoords}
                showBorder={mode === "a_to_b"}
              />
              {mode === "a_to_b" && (
                <LocationInput
                  placeholder="Destination"
                  dotColor={accentCol}
                  value={endLabel}
                  coords={endCoords}
                  onSelect={(label, coords) => { setEndLabel(label); setEndCoords(coords); }}
                  onClear={() => { setEndLabel(""); setEndCoords(null); }}
                  borderColor={borderCol}
                  textColor={t.text}
                  mutedColor={t.muted}
                  dropdownBg={dropBg}
                  userCoords={userCoords}
                  showBorder={false}
                />
              )}
            </View>

            <TouchableOpacity
              style={[styles.locateBtn, { borderColor: borderCol, backgroundColor: cardBg }]}
              onPress={handleLocateMe}
              activeOpacity={0.7}
              disabled={locating}
            >
              {locating
                ? <ActivityIndicator size="small" color={accentCol} />
                : <Text style={styles.locateDot}>◎</Text>}
              <Text style={[styles.locateText, { color: accentCol }]}>
                {locating ? "Detecting location…" : "Use my current location as start"}
              </Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── Distance (round trip only) ── */}
        {mode === "round_trip" && (
          <>
            <Section label="DISTANCE" />
            <View style={styles.chipRow}>
              {DISTANCE_OPTIONS.map((opt) => {
                const active = distance === opt.key;
                return (
                  <TouchableOpacity
                    key={opt.key}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: active ? accentCol : cardBg,
                        borderColor: active ? accentCol : borderCol,
                      },
                    ]}
                    onPress={() => setDistance(opt.key)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.chipText, { color: active ? "#fff" : t.text }]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}

        {/* ── Transport ── */}
        <Section label="TRANSPORT" />
        <View style={styles.chipRow}>
          {TRANSPORT_OPTIONS.map((opt) => {
            const active = transport === opt.key;
            return (
              <TouchableOpacity
                key={opt.key}
                style={[
                  styles.chip,
                  {
                    backgroundColor: active ? accentCol : cardBg,
                    borderColor: active ? accentCol : borderCol,
                  },
                ]}
                onPress={() => setTransport(opt.key)}
                activeOpacity={0.7}
              >
                <Text
                  style={[styles.chipText, { color: active ? "#fff" : t.text }]}
                >
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* ── Footer ── */}
      <View
        style={[
          styles.footer,
          { backgroundColor: t.bg, borderTopColor: borderCol },
        ]}
      >
        <TouchableOpacity
          style={[
            styles.generateBtn,
            { backgroundColor: mode === "ai_route" ? "#7c3aed" : accentCol, opacity: canGenerate ? 1 : 0.4 },
          ]}
          onPress={handleGenerate}
          disabled={!canGenerate}
          activeOpacity={0.85}
        >
          {generating ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.generateBtnText}>
              {mode === "ai_route" ? "✦ Plan with AI" : "Generate Route"}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  modeRow: {
    flexDirection: "row",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    marginTop: 24,
  },
  modeTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 11,
  },
  modeTabText: { fontSize: 14, fontWeight: "600" },
  header: {
    paddingTop: Platform.OS === "ios" ? 60 : 44,
    paddingBottom: 16,
    paddingHorizontal: 24,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 28, fontWeight: "700", letterSpacing: -0.5 },
  subtitle: { fontSize: 14, marginTop: 2 },
  scroll: { paddingHorizontal: 24, paddingTop: 24 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.8,
    marginBottom: 10,
    marginTop: 24,
  },
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "visible",
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 12,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  locationInput: { flex: 1, fontSize: 16 },
  dropdown: {
    marginTop: 4,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    zIndex: 999,
  },
  suggestionRow: {
    paddingHorizontal: 16,
    paddingVertical: 13,
    minHeight: 44,
    justifyContent: "center",
  },
  suggestionText: { fontSize: 14 },
  locateBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignSelf: "flex-start",
  },
  locateDot: { fontSize: 14, color: "#4f8ef7" },
  locateText: { fontSize: 14, fontWeight: "500" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  preferencesInput: { fontSize: 15, minHeight: 72, lineHeight: 22 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 99,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: { fontSize: 14, fontWeight: "500" },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 24,
    paddingBottom: Platform.OS === "ios" ? 36 : 24,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  generateBtn: { borderRadius: 14, paddingVertical: 16, alignItems: "center" },
  generateBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    letterSpacing: -0.2,
  },
});
