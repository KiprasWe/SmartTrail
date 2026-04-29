import { useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Animated,
  ActivityIndicator,
  Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/theme";
import { useTranslation } from "@/hooks/use-translation";
import { poiIcon, placePhotoUrl, openExternal, translatePoiCategory, poiDisplayName } from "@/lib/route-map-helpers";
import type { PoiFeature, GenParams } from "@/types/route";

type Props = {
  selectedPoi: PoiFeature | null;
  genParams: GenParams | null;
  isWaypoint: (poi: PoiFeature) => boolean;
  onToggleWaypoint: (poi: PoiFeature) => void;
  isRegenerating: boolean;
  onClose: () => void;
  bottomInset: number;
  colors: (typeof Colors)["light" | "dark"];
};

export function PoiDetailPanel({
  selectedPoi,
  genParams,
  isWaypoint,
  onToggleWaypoint,
  isRegenerating,
  onClose,
  bottomInset,
  colors: c,
}: Props) {
  const { t } = useTranslation();
  const anim = useRef(new Animated.Value(200)).current;

  useEffect(() => {
    Animated.spring(anim, {
      toValue: selectedPoi ? 0 : 200,
      useNativeDriver: true,
      damping: 20,
      stiffness: 200,
    }).start();
  }, [selectedPoi, anim]);

  return (
    <Animated.View
      style={[
        styles.panel,
        {
          backgroundColor: c.bg,
          borderColor: c.border,
          paddingBottom: bottomInset + 12,
          transform: [{ translateY: anim }],
        },
      ]}
      pointerEvents={selectedPoi ? "auto" : "none"}
    >
      {selectedPoi && (
        <PoiBody
          poi={selectedPoi}
          genParams={genParams}
          isWaypoint={isWaypoint}
          onToggleWaypoint={onToggleWaypoint}
          isRegenerating={isRegenerating}
          onClose={onClose}
          colors={c}
          t={t}
        />
      )}
    </Animated.View>
  );
}

type BodyProps = {
  poi: PoiFeature;
  genParams: GenParams | null;
  isWaypoint: (poi: PoiFeature) => boolean;
  onToggleWaypoint: (poi: PoiFeature) => void;
  isRegenerating: boolean;
  onClose: () => void;
  colors: (typeof Colors)["light" | "dark"];
  t: (key: string, opts?: Record<string, string>) => string;
};

function PoiBody({
  poi,
  genParams,
  isWaypoint,
  onToggleWaypoint,
  isRegenerating,
  onClose,
  colors: c,
  t,
}: BodyProps) {
  const props = poi.properties;
  const isAi = !!props.place_id || genParams?.mode === "ai";
  const description = props.editorial_summary ?? props.ai_description ?? null;
  const photoUri = props.photo_name ? placePhotoUrl(props.photo_name) : null;
  const isWp = isWaypoint(poi);

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: 4 }}
    >
      {photoUri && (
        <View style={styles.photoWrap}>
          <Image source={{ uri: photoUri }} style={styles.photo} resizeMode="cover" />
          <TouchableOpacity onPress={onClose} hitSlop={10} style={styles.photoClose}>
            <Ionicons name="close" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.header}>
        {!photoUri && (
          <View
            style={[
              styles.iconWrap,
              { backgroundColor: "#F59E0B18", borderColor: "#F59E0B40" },
            ]}
          >
            <Ionicons name={poiIcon(props.category)} size={20} color="#F59E0B" />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={[styles.name, { color: c.text }]} numberOfLines={2}>
            {poiDisplayName(props.name, props.category, t)}
          </Text>
          {props.category && (
            <Text style={[styles.category, { color: c.muted }]} numberOfLines={1}>
              {translatePoiCategory(props.category, t)}
            </Text>
          )}
        </View>
        {!photoUri && (
          <TouchableOpacity onPress={onClose} hitSlop={10} style={styles.close}>
            <Ionicons name="close" size={20} color={c.muted} />
          </TouchableOpacity>
        )}
      </View>

      {typeof props.rating === "number" && (
        <View style={styles.ratingRow}>
          <Ionicons name="star" size={14} color="#F59E0B" />
          <Text style={[styles.ratingValue, { color: c.text }]}>
            {props.rating.toFixed(1)}
          </Text>
          {typeof props.user_rating_count === "number" && (
            <Text style={[styles.ratingCount, { color: c.muted }]}>
              ({props.user_rating_count.toLocaleString()})
            </Text>
          )}
        </View>
      )}

      {description && (
        <Text style={[styles.description, { color: c.text }]} numberOfLines={4}>
          {description}
        </Text>
      )}

      {props.formatted_address && (
        <View style={styles.infoRow}>
          <Ionicons name="location-outline" size={14} color={c.muted} />
          <Text style={[styles.infoText, { color: c.muted }]} numberOfLines={2}>
            {props.formatted_address}
          </Text>
        </View>
      )}

      {(props.google_maps_uri || props.website_uri) && (
        <View style={styles.linkRow}>
          {props.google_maps_uri && (
            <TouchableOpacity
              style={[styles.linkBtn, { backgroundColor: c.surface, borderColor: c.border }]}
              onPress={() => openExternal(props.google_maps_uri)}
              activeOpacity={0.75}
            >
              <Ionicons name="map-outline" size={15} color={c.tint} />
              <Text style={[styles.linkText, { color: c.tint }]}>
                {t("route-map.open-in-maps")}
              </Text>
            </TouchableOpacity>
          )}
          {props.website_uri && (
            <TouchableOpacity
              style={[styles.linkBtn, { backgroundColor: c.surface, borderColor: c.border }]}
              onPress={() => openExternal(props.website_uri)}
              activeOpacity={0.75}
            >
              <Ionicons name="globe-outline" size={15} color={c.tint} />
              <Text style={[styles.linkText, { color: c.tint }]}>
                {t("route-map.website")}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {genParams && isAi && props.essential ? (
        <View
          style={[
            styles.waypointBtn,
            { backgroundColor: c.tint + "15", borderColor: c.tint, opacity: 0.7 },
          ]}
        >
          <Ionicons name="checkmark-circle-outline" size={16} color={c.tint} />
          <Text style={[styles.waypointBtnText, { color: c.tint }]}>
            {t("route-map.on-route")}
          </Text>
        </View>
      ) : genParams ? (
        <TouchableOpacity
          style={[
            styles.waypointBtn,
            {
              backgroundColor: isWp ? c.danger + "15" : c.tint + "15",
              borderColor: isWp ? c.danger : c.tint,
            },
          ]}
          onPress={() => onToggleWaypoint(poi)}
          disabled={isRegenerating}
          activeOpacity={0.75}
        >
          {isRegenerating ? (
            <ActivityIndicator size="small" color={isWp ? c.danger : c.tint} />
          ) : (
            <>
              <Ionicons
                name={isWp ? "remove-circle-outline" : "add-circle-outline"}
                size={16}
                color={isWp ? c.danger : c.tint}
              />
              <Text
                style={[styles.waypointBtnText, { color: isWp ? c.danger : c.tint }]}
              >
                {isWp
                  ? t("route-map.remove-from-route")
                  : t("route-map.add-to-route")}
              </Text>
            </>
          )}
        </TouchableOpacity>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 16,
    paddingHorizontal: 16,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -2 },
    elevation: 8,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  name: { fontSize: 16, fontWeight: "700" },
  category: { fontSize: 13, marginTop: 2 },
  close: { padding: 4 },
  photoWrap: {
    position: "relative",
    marginHorizontal: -16,
    marginTop: -16,
    marginBottom: 12,
  },
  photo: { width: "100%", aspectRatio: 4 / 3, backgroundColor: "#00000010" },
  photoClose: {
    position: "absolute",
    top: 12,
    right: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 10 },
  ratingValue: { fontSize: 14, fontWeight: "700" },
  ratingCount: { fontSize: 12 },
  description: { fontSize: 13, lineHeight: 19, marginTop: 10 },
  infoRow: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 10 },
  infoText: { fontSize: 12, flex: 1, lineHeight: 17 },
  linkRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  linkBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  linkText: { fontSize: 13, fontWeight: "600" },
  waypointBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  waypointBtnText: { fontSize: 14, fontWeight: "600" },
});
