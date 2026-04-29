import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/theme";
import { ROUTE_COLORS, formatDist, formatTime } from "@/lib/route-map-helpers";
import type { RouteVariant } from "@/types/route";
import { ElevationProfile } from "./elevation-profile";

type Props = {
  routes: RouteVariant[];
  selectedIndex: number;
  onSelectVariant: (i: number) => void;
  poisCount: number;
  bottomInset: number;
  colors: (typeof Colors)["light" | "dark"];
};

export function RouteStatsPanel({
  routes,
  selectedIndex,
  onSelectVariant,
  poisCount,
  bottomInset,
  colors: c,
}: Props) {
  const { width } = useWindowDimensions();
  const variant = routes[selectedIndex];
  if (!variant) return null;

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
            {formatDist(variant.distance_km)}
          </Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: c.border }]} />
        <View style={styles.stat}>
          <Ionicons name="time-outline" size={14} color={c.muted} />
          <Text style={[styles.statValue, { color: c.text }]}>
            {formatTime(variant.duration_s)}
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
        {variant.descent_m > 0 && (
          <>
            <View style={[styles.statDivider, { backgroundColor: c.border }]} />
            <View style={styles.stat}>
              <Ionicons
                name="trending-down-outline"
                size={14}
                color={c.muted}
              />
              <Text style={[styles.statValue, { color: c.text }]}>
                {variant.descent_m} m
              </Text>
            </View>
          </>
        )}
      </View>

      {elevations.length > 0 && (
        <ElevationProfile
          elevations={elevations}
          colors={c}
          width={width - 32} // 16px horizontal padding × 2
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
});
