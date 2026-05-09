import {
  View,
  Text,
  StyleSheet,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/theme";
import { formatDistanceKm, formatDuration } from "@/lib/route-map-helpers";
import type { RouteVariant } from "@/types/route";
import { ElevationProfile } from "./elevation-profile";

type Props = {
  variant: RouteVariant;
  bottomInset: number;
  colors: (typeof Colors)["light" | "dark"];
};

export function RouteStatsPanel({ variant, bottomInset, colors: c }: Props) {
  const { width } = useWindowDimensions();
  const elevations: number[] = variant.elevation_profile ?? [];

  return (
    <View
      style={[
        styles.panel,
        {
          backgroundColor: c.bg,
          borderTopColor: c.border,
          paddingBottom: bottomInset + 8,
        },
      ]}
    >
      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Ionicons name="map-outline" size={14} color={c.muted} />
          <Text style={[styles.statValue, { color: c.text }]}>
            {formatDistanceKm(variant.distance_km)}
          </Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: c.border }]} />
        <View style={styles.stat}>
          <Ionicons name="time-outline" size={14} color={c.muted} />
          <Text style={[styles.statValue, { color: c.text }]}>
            {formatDuration(variant.duration_s)}
          </Text>
        </View>
        {variant.ascent_m > 0 && (
          <>
            <View style={[styles.statDivider, { backgroundColor: c.border }]} />
            <View style={styles.stat}>
              <Ionicons name="trending-up-outline" size={14} color={c.muted} />
              <Text style={[styles.statValue, { color: c.text }]}>
                {variant.ascent_m} m
              </Text>
            </View>
          </>
        )}
      </View>

      {elevations.length > 0 && (
        <ElevationProfile
          elevations={elevations}
          colors={c}
          width={width - 32}
          height={80}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
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
});
