// components/discover/discover-list.tsx
//
// Card list for the Discover tab. Each card shows a small silhouette of
// the route (from the thumbnail polyline the backend sends), title,
// distance-from-user, total distance, and the save count.

import React, { useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  useColorScheme,
  Platform,
} from "react-native";
import Svg, { Polyline } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/theme";
import type { DiscoverRoute } from "@/types/discover";
import { useTranslation } from "@/hooks/use-translation";

interface Props {
  routes: DiscoverRoute[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  onSelect: (route: DiscoverRoute) => void;
  onEndReached: () => void;
  onRefresh?: () => void;
  /** Tab bar + home indicator — keeps scroll thumb and last rows above the bar. */
  listBottomInset?: number;
}

export function DiscoverList({
  routes,
  loading,
  loadingMore,
  hasMore,
  onSelect,
  onEndReached,
  onRefresh,
  listBottomInset = 0,
}: Props) {
  const scheme = useColorScheme() ?? "light";
  const t = Colors[scheme];
  const { t: tr } = useTranslation();

  const bottomPad = listBottomInset + 12;

  if (loading && routes.length === 0) {
    return (
      <View style={styles.empty}>
        <ActivityIndicator color={t.tint} />
      </View>
    );
  }

  if (routes.length === 0) {
    return (
      <View style={[styles.empty, { paddingBottom: bottomPad }]}>
        <Ionicons name="compass-outline" size={44} color={t.muted} />
        <Text style={[styles.emptyText, { color: t.muted }]}>
          {tr("discover.empty")}
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      data={routes}
      keyExtractor={(r) => r.id}
      style={styles.list}
      contentContainerStyle={[
        styles.listContent,
        { paddingBottom: bottomPad },
      ]}
      scrollIndicatorInsets={{
        top: 0,
        bottom: listBottomInset,
        left: 0,
        right: 0,
      }}
      {...Platform.select({
        android: { nestedScrollEnabled: true },
        default: {},
      })}
      onEndReachedThreshold={0.35}
      onEndReached={hasMore ? onEndReached : undefined}
      refreshing={loading}
      onRefresh={onRefresh}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      renderItem={({ item }) => (
        <DiscoverCard route={item} onPress={() => onSelect(item)} theme={t} />
      )}
      ListFooterComponent={
        loadingMore ? (
          <ActivityIndicator color={t.tint} style={styles.footerSpinner} />
        ) : null
      }
    />
  );
}

interface CardProps {
  route: DiscoverRoute;
  theme: (typeof Colors)["light"];
  onPress: () => void;
}

function DiscoverCard({ route, theme, onPress }: CardProps) {
  const km = (route.distance / 1000).toFixed(1);
  const awayKm = route.distanceKm.toFixed(1);

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[
        styles.card,
        { backgroundColor: theme.surface, borderColor: theme.border },
      ]}
    >
      <Thumbnail
        coords={route.thumbnail}
        bbox={route.bbox}
        tint={theme.tint}
      />
      <View style={styles.cardBody}>
        <Text
          numberOfLines={1}
          style={[styles.cardTitle, { color: theme.text }]}
        >
          {route.title}
        </Text>
        <Text
          numberOfLines={1}
          style={[styles.cardMeta, { color: theme.muted }]}
        >
          {km} km · {awayKm} km away
          {route.author ? ` · @${route.author.username}` : ""}
        </Text>
        <View style={styles.cardFooter}>
          <Ionicons
            name={route.savedByMe ? "bookmark" : "bookmark-outline"}
            size={14}
            color={theme.muted}
          />
          <Text style={[styles.cardFooterText, { color: theme.muted }]}>
            {route.saveCount}
          </Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.muted} />
    </TouchableOpacity>
  );
}

// Strava-ish silhouette. Maps bbox coordinates into the SVG viewBox so the
// polyline fills the thumbnail tile regardless of the route's scale.
interface ThumbnailProps {
  coords: [number, number][] | null;
  bbox: [number, number, number, number];
  tint: string;
}

function Thumbnail({ coords, bbox, tint }: ThumbnailProps) {
  const points = useMemo(() => {
    if (!coords || coords.length < 2) return "";
    const [minLng, minLat, maxLng, maxLat] = bbox;
    const w = Math.max(maxLng - minLng, 1e-6);
    const h = Math.max(maxLat - minLat, 1e-6);
    const size = 48;
    const pad = 4;
    return coords
      .map(([lng, lat]) => {
        const x = pad + ((lng - minLng) / w) * (size - pad * 2);
        // SVG y grows downward, lat grows upward — flip
        const y = pad + (1 - (lat - minLat) / h) * (size - pad * 2);
        return `${x},${y}`;
      })
      .join(" ");
  }, [coords, bbox]);

  return (
    <View style={styles.thumb}>
      <Svg width={48} height={48} viewBox="0 0 48 48">
        {points ? (
          <Polyline
            points={points}
            fill="none"
            stroke={tint}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  listContent: {
    paddingTop: 12,
    paddingHorizontal: 20,
  },
  separator: {
    height: 12,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  footerSpinner: {
    marginTop: 8,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    textAlign: "center",
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  thumb: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  cardBody: {
    flex: 1,
    gap: 2,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "700",
  },
  cardMeta: {
    fontSize: 12,
  },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  cardFooterText: {
    fontSize: 12,
  },
});
