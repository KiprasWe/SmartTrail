// app/(tabs)/discover.tsx

import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  TouchableOpacity,
  StyleSheet,
  useColorScheme,
  Alert,
  StatusBar,
} from "react-native";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { Colors } from "@/constants/theme";
import { useAuthStore } from "@/store/use-auth-store";
import { useDiscover } from "@/hooks/use-discover";
import { useTranslation } from "@/hooks/use-translation";
import { DiscoverFiltersBar } from "@/components/discover/discover-filters";
import { DiscoverList } from "@/components/discover/discover-list";
import { DiscoverMap } from "@/components/discover/discover-map";
import { RoutePreviewSheet } from "@/components/discover/route-preview-sheet";
import type { DiscoverRoute } from "@/types/discover";
import {
  TabScreenHeader,
  mainTabHeaderIconHitStyle,
} from "@/components/ui/tab-screen-header";

const FALLBACK_CENTER = { lat: 54.687, lng: 25.279, radiusKm: 15 };
const DEFAULT_RADIUS_KM = 15;

type ViewMode = "map" | "list";

export default function DiscoverScreen() {
  const scheme = useColorScheme() ?? "light";
  const isDark = scheme === "dark";
  const t = Colors[scheme];
  const tabBarHeight = useBottomTabBarHeight();
  const { t: tr } = useTranslation();
  const authFetch = useAuthStore((s) => s.authFetch);

  const {
    center,
    filters,
    routes,
    loading,
    loadingMore,
    hasMore,
    setCenter,
    setFilters,
    loadMore,
    toggleSave,
  } = useDiscover(authFetch);

  const [viewMode, setViewMode] = useState<ViewMode>("map");
  const [selected, setSelected] = useState<DiscoverRoute | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    if (!selected) return;
    const fresh = routes.find((r) => r.id === selected.id);
    if (fresh && fresh !== selected) setSelected(fresh);
  }, [routes, selected]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;

        if (status !== "granted") {
          setCenter(FALLBACK_CENTER, true);
          return;
        }

        const last = await Location.getLastKnownPositionAsync({});
        if (!cancelled && last) {
          setCenter(
            { lat: last.coords.latitude, lng: last.coords.longitude, radiusKm: DEFAULT_RADIUS_KM },
            true,
          );
        }

        try {
          const fresh = await Location.getCurrentPositionAsync({});
          if (!cancelled) {
            setCenter({ lat: fresh.coords.latitude, lng: fresh.coords.longitude, radiusKm: DEFAULT_RADIUS_KM });
          }
        } catch {
          // Swallow — last-known is good enough.
        }

        if (!cancelled && !last) setCenter(FALLBACK_CENTER, true);
      } catch (err) {
        if (!cancelled) {
          setCenter(FALLBACK_CENTER, true);
          if (__DEV__) console.warn("[discover] location error:", err);
        }
      }
    })().catch((err) => {
      if (!cancelled) {
        setCenter(FALLBACK_CENTER, true);
        if (__DEV__) console.warn("[discover] unexpected location error:", err);
      }
    });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleToggleSave = useCallback(async () => {
    if (!selected) return;
    setSavingId(selected.id);
    try {
      await toggleSave(selected.id);
    } catch (err: any) {
      Alert.alert(
        tr("discover.save-error"),
        err?.response?.data?.code ?? err?.message ?? "Unknown error",
      );
    } finally {
      setSavingId(null);
    }
  }, [selected, toggleSave, tr]);

  const handleViewFull = useCallback(() => {
    if (!selected) return;
    setSelected(null);
    router.push({ pathname: "/route-map", params: { publicId: selected.id } });
  }, [selected]);

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />

      <TabScreenHeader
        title={tr("discover.title")}
        right={
          <View style={styles.toggleGroup}>
            <TouchableOpacity
              onPress={() => setViewMode("map")}
              activeOpacity={0.8}
              style={[
                mainTabHeaderIconHitStyle.base,
                {
                  backgroundColor: viewMode === "map" ? t.tint : t.surface,
                  borderColor: viewMode === "map" ? t.tint : t.border,
                },
              ]}
            >
              <Ionicons
                name="map-outline"
                size={16}
                color={viewMode === "map" ? "#fff" : t.muted}
              />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setViewMode("list")}
              activeOpacity={0.8}
              style={[
                mainTabHeaderIconHitStyle.base,
                {
                  backgroundColor: viewMode === "list" ? t.tint : t.surface,
                  borderColor: viewMode === "list" ? t.tint : t.border,
                },
              ]}
            >
              <Ionicons
                name="list-outline"
                size={16}
                color={viewMode === "list" ? "#fff" : t.muted}
              />
            </TouchableOpacity>
          </View>
        }
      />

      {/* Body — map mode has filters floating over it; list mode stacks them */}
      {viewMode === "map" ? (
        <View style={styles.mapContainer}>
          {center && (
            <DiscoverMap
              routes={routes}
              centerCoordinate={[center.lng, center.lat]}
              onSelectRoute={setSelected}
              onRegionChanged={(c) =>
                setCenter({ lat: c.lat, lng: c.lng, radiusKm: center.radiusKm })
              }
            />
          )}
          {/* Filter chips float over the map */}
          <View style={styles.floatingFilters} pointerEvents="box-none">
            <DiscoverFiltersBar filters={filters} onChange={setFilters} floating />
          </View>
        </View>
      ) : (
        <View style={styles.listModeRoot}>
          <View
            style={[
              styles.listToolbar,
              {
                borderBottomColor: t.border,
                backgroundColor: t.bg,
              },
            ]}
          >
            <DiscoverFiltersBar filters={filters} onChange={setFilters} />
          </View>
          <View style={styles.listContainer}>
            <DiscoverList
              routes={routes}
              loading={loading}
              loadingMore={loadingMore}
              hasMore={hasMore}
              onSelect={setSelected}
              onEndReached={loadMore}
              onRefresh={() => center && setCenter(center, true)}
              listBottomInset={tabBarHeight}
            />
          </View>
        </View>
      )}

      <RoutePreviewSheet
        route={selected}
        saving={savingId === selected?.id}
        onClose={() => setSelected(null)}
        onToggleSave={handleToggleSave}
        onViewFull={handleViewFull}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  toggleGroup: {
    flexDirection: "row",
    gap: 8,
  },

  mapContainer: {
    flex: 1,
  },
  floatingFilters: {
    position: "absolute",
    top: 8,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  /** List mode: toolbar + scrollable list share width/alignment with header. */
  listModeRoot: {
    flex: 1,
    minHeight: 0,
  },
  listToolbar: {
    flexShrink: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  listContainer: {
    flex: 1,
    minHeight: 0,
  },
});
