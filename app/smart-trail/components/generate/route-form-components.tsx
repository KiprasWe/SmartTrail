import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  useColorScheme,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "react-native";
import { Colors } from "@/constants/theme";
import i18n from "@/lib/i18n";

export type TransportKey =
  | "foot-walking"
  | "foot-hiking"
  | "running"
  | "cycling-regular"
  | "cycling-mountain"
  | "cycling-road";

export type ElevationKey = "auto" | "flat" | "moderate" | "hilly";

export type DistanceKey = "5" | "10" | "15" | "20" | "custom";

// ─── Option constants ─────────────────────────────────────────────────────────

export const TRANSPORT_OPTIONS: {
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
];

export const ELEVATION_OPTIONS: {
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

export const POI_OPTIONS: {
  key: string;
  tKey: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { key: "nature", tKey: "generate.poi-nature", icon: "leaf-outline" },
  { key: "tourism", tKey: "generate.poi-viewpoints", icon: "eye-outline" },
  { key: "historic", tKey: "generate.poi-historic", icon: "flag-outline" },
  { key: "food", tKey: "generate.poi-food", icon: "cafe-outline" },
  { key: "arts_culture", tKey: "generate.poi-arts", icon: "color-palette-outline" },
  { key: "leisure", tKey: "generate.poi-leisure", icon: "basketball-outline" },
];

export const DISTANCE_OPTIONS: {
  key: DistanceKey;
  label: string;
  tKey?: string;
}[] = [
  { key: "5", label: "5 km" },
  { key: "10", label: "10 km" },
  { key: "15", label: "15 km" },
  { key: "20", label: "20 km" },
  { key: "custom", label: "Custom", tKey: "generate.custom-distance" },
];

// ─── Components ───────────────────────────────────────────────────────────────

export function SectionLabel({
  label,
  color,
}: {
  label: string;
  color: string;
}) {
  return (
    <Text style={[styles.sectionLabel, { color }]}>{label.toUpperCase()}</Text>
  );
}

export function LocationRow({
  dotColor,
  dotStyle = "filled",
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

export function TransportPicker({
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

export function ElevationPicker({
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

export function PoiPicker({
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

export function PoiCountPicker({
  value,
  onChange,
  accent,
  surface,
  border,
  textColor,
  mutedColor,
}: {
  value: number;
  onChange: (v: number) => void;
  accent: string;
  surface: string;
  border: string;
  textColor: string;
  mutedColor: string;
}) {
  return (
    <View style={[styles.poiCountRow, { backgroundColor: surface, borderColor: border }]}>
      <Text style={[styles.poiCountLabel, { color: mutedColor }]}>
        {i18n.t("generate.poi-count-label")}
      </Text>
      <View style={styles.poiCountStepper}>
        <TouchableOpacity
          onPress={() => onChange(Math.max(1, value - 1))}
          style={[styles.poiCountBtn, { borderColor: value <= 1 ? border : accent + "60" }]}
          activeOpacity={0.7}
          disabled={value <= 1}
        >
          <Ionicons name="remove" size={18} color={value <= 1 ? mutedColor : accent} />
        </TouchableOpacity>
        <Text style={[styles.poiCountValue, { color: textColor }]}>{value}</Text>
        <TouchableOpacity
          onPress={() => onChange(Math.min(10, value + 1))}
          style={[styles.poiCountBtn, { borderColor: value >= 10 ? border : accent + "60" }]}
          activeOpacity={0.7}
          disabled={value >= 10}
        >
          <Ionicons name="add" size={18} color={value >= 10 ? mutedColor : accent} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

export function DistancePicker({
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

export function OfflineScreen() {
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

  sectionLabel: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.6,
    paddingHorizontal: 2,
  },

  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  locDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  locText: { flex: 1, fontSize: 15 },
  stopHandle: { marginRight: -2 },

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

  poiCountRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  poiCountLabel: { fontSize: 14, fontWeight: "500" },
  poiCountStepper: { flexDirection: "row", alignItems: "center", gap: 14 },
  poiCountBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  poiCountValue: { fontSize: 17, fontWeight: "700", minWidth: 20, textAlign: "center" },

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
  customDistInput: { flex: 1, fontSize: 15, paddingVertical: 9 },
  customDistUnit: { fontSize: 14, fontWeight: "600" },
});
