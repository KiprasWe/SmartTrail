import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/theme";
import { t } from "@/lib/i18n";
import {
  poiIcon,
  translatePoiCategory,
  poiDisplayName,
} from "@/lib/route-map-helpers";
import type { PoiFeature } from "@/types/route";

type Props = {
  pois: PoiFeature[];
  onSelect: (poi: PoiFeature) => void;
  onClose: () => void;
  bottomInset: number;
  colors: (typeof Colors)["light" | "dark"];
};

export function PoiListPanel({
  pois,
  onSelect,
  onClose,
  bottomInset,
  colors: c,
}: Props) {
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
      <View style={styles.header}>
        <Text style={[styles.title, { color: c.text }]}>
          {t("route-map.nearby-places")}
        </Text>
        <TouchableOpacity onPress={onClose} hitSlop={8}>
          <Ionicons name="close" size={20} color={c.muted} />
        </TouchableOpacity>
      </View>
      <ScrollView showsVerticalScrollIndicator={false}>
        {pois.map((poi, i) => (
          <TouchableOpacity
            key={poi.properties.id ?? i}
            style={[
              styles.row,
              i < pois.length - 1 && {
                borderBottomColor: c.border,
                borderBottomWidth: StyleSheet.hairlineWidth,
              },
            ]}
            activeOpacity={0.7}
            onPress={() => onSelect(poi)}
          >
            <View
              style={[
                styles.rowIcon,
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
                style={[styles.rowName, { color: c.text }]}
                numberOfLines={1}
              >
                {poiDisplayName(
                  poi.properties.name,
                  poi.properties.category,
                  t,
                )}
              </Text>
              {poi.properties.category && (
                <Text
                  style={[styles.rowCategory, { color: c.muted }]}
                  numberOfLines={1}
                >
                  {translatePoiCategory(poi.properties.category, t)}
                </Text>
              )}
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
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
    maxHeight: 340,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: { fontSize: 16, fontWeight: "700" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 11,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  rowName: { fontSize: 14, fontWeight: "600" },
  rowCategory: { fontSize: 12, marginTop: 1 },
});
