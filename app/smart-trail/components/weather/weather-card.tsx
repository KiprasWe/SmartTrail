// components/weather/weather-card.tsx
//
// Inline weather widget shown on the route-map screen. Renders current
// conditions for the first point of the route plus a horizontal strip of
// daily forecasts. Tapping the card expands to show multi-point weather if
// there is more than one snapshot (start / mid / end).

import React, { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  useColorScheme,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/theme";
import i18n from "@/lib/i18n";
import {
  weatherCodeInfo,
  type WeatherSnapshot,
  type WeatherDaily,
} from "@/types/weather";

interface Props {
  snapshots: (WeatherSnapshot | null)[];
  loading?: boolean;
  /** Optional labels for each snapshot point, e.g. ["Start", "Mid", "End"]. */
  pointLabels?: string[];
}

function conditionLabel(code: number): string {
  const key = weatherCodeInfo(code).key;
  return i18n.t(`weather.conditions.${key}`, {
    defaultValue: key,
  });
}

function formatDayLabel(isoDate: string, index: number): string {
  if (index === 0) return i18n.t("weather.today", { defaultValue: "Today" });
  try {
    const d = new Date(isoDate);
    return d.toLocaleDateString(undefined, { weekday: "short" });
  } catch {
    return isoDate;
  }
}

export function WeatherCard({ snapshots, loading, pointLabels }: Props) {
  const scheme = useColorScheme() ?? "light";
  const t = Colors[scheme];
  const [expanded, setExpanded] = useState(false);
  const [activePointIdx, setActivePointIdx] = useState(0);

  const valid = snapshots.filter(Boolean) as WeatherSnapshot[];
  const hasMultiple = valid.length > 1;
  const active = valid[activePointIdx] ?? valid[0] ?? null;

  if (loading && !active) {
    return (
      <View
        style={[
          styles.card,
          { backgroundColor: t.surface, borderColor: t.border },
        ]}
      >
        <ActivityIndicator size="small" color={t.tint} />
      </View>
    );
  }

  if (!active) return null;

  const info = weatherCodeInfo(active.current.weatherCode);

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: t.surface, borderColor: t.border },
      ]}
    >
      {/* Header row — current conditions */}
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => setExpanded((v) => !v)}
        style={styles.headerRow}
      >
        <View style={styles.headerIconWrap}>
          <Ionicons name={info.icon} size={28} color={t.tint} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.currentTemp, { color: t.text }]}>
            {Math.round(active.current.temperature)}°C
          </Text>
          <Text
            style={[styles.currentLabel, { color: t.muted }]}
            numberOfLines={1}
          >
            {conditionLabel(active.current.weatherCode)} ·{" "}
            {i18n.t("weather.feelsLike", { defaultValue: "Feels like" })}{" "}
            {Math.round(active.current.apparentTemperature)}°
          </Text>
        </View>
        <Ionicons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={18}
          color={t.muted}
        />
      </TouchableOpacity>

      {/* Secondary stats (wind + humidity) */}
      <View style={styles.metaRow}>
        <View style={styles.metaItem}>
          <Ionicons name="navigate-outline" size={12} color={t.muted} />
          <Text style={[styles.metaText, { color: t.muted }]}>
            {Math.round(active.current.windSpeed)} km/h
          </Text>
        </View>
        <View style={styles.metaItem}>
          <Ionicons name="water-outline" size={12} color={t.muted} />
          <Text style={[styles.metaText, { color: t.muted }]}>
            {Math.round(active.current.humidity)}%
          </Text>
        </View>
      </View>

      {/* Start/mid/end selector (only when multi-point) */}
      {expanded && hasMultiple && pointLabels && (
        <View style={styles.pointTabs}>
          {valid.map((_, i) => {
            const isActive = i === activePointIdx;
            return (
              <TouchableOpacity
                key={i}
                onPress={() => setActivePointIdx(i)}
                style={[
                  styles.pointTab,
                  {
                    backgroundColor: isActive ? t.tint + "20" : "transparent",
                    borderColor: isActive ? t.tint : t.border,
                  },
                ]}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.pointTabText,
                    { color: isActive ? t.tint : t.muted },
                  ]}
                >
                  {pointLabels[i] ?? `#${i + 1}`}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* Daily forecast strip */}
      {expanded && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.dailyStrip}
        >
          {active.daily.map((d, i) => (
            <DailyCell key={d.date} day={d} index={i} textColor={t.text} muted={t.muted} tint={t.tint} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

interface DailyCellProps {
  day: WeatherDaily;
  index: number;
  textColor: string;
  muted: string;
  tint: string;
}

function DailyCell({ day, index, textColor, muted, tint }: DailyCellProps) {
  const info = weatherCodeInfo(day.weatherCode);
  return (
    <View style={styles.dailyCell}>
      <Text style={[styles.dailyDay, { color: muted }]}>
        {formatDayLabel(day.date, index)}
      </Text>
      <Ionicons name={info.icon} size={22} color={tint} style={{ marginVertical: 4 }} />
      <Text style={[styles.dailyTemp, { color: textColor }]}>
        {Math.round(day.tempMax)}°
      </Text>
      <Text style={[styles.dailyTempMin, { color: muted }]}>
        {Math.round(day.tempMin)}°
      </Text>
      {day.precipitationProbability > 10 && (
        <View style={styles.precipRow}>
          <Ionicons name="water-outline" size={10} color="#3B82F6" />
          <Text style={[styles.precipText, { color: "#3B82F6" }]}>
            {Math.round(day.precipitationProbability)}%
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 12,
    gap: 8,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#16A34A15",
  },
  currentTemp: { fontSize: 20, fontWeight: "700" },
  currentLabel: { fontSize: 12, marginTop: 2 },

  metaRow: {
    flexDirection: "row",
    gap: 14,
    paddingLeft: 52,
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  metaText: { fontSize: 11 },

  pointTabs: {
    flexDirection: "row",
    gap: 6,
    marginTop: 4,
  },
  pointTab: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  pointTabText: { fontSize: 11, fontWeight: "600" },

  dailyStrip: {
    gap: 14,
    paddingVertical: 6,
    paddingHorizontal: 2,
  },
  dailyCell: {
    alignItems: "center",
    minWidth: 44,
  },
  dailyDay: { fontSize: 11, fontWeight: "600", textTransform: "uppercase" },
  dailyTemp: { fontSize: 13, fontWeight: "700" },
  dailyTempMin: { fontSize: 11, marginTop: 1 },
  precipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    marginTop: 2,
  },
  precipText: { fontSize: 10, fontWeight: "600" },
});
