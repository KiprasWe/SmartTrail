// components/discover/route-preview-sheet.tsx
//
// Bottom-up preview panel shown when the user selects a discover route from
// either the map or the list. Simple Modal + slide-up view — no bottom-sheet
// library dependency. Shows key stats, author, save toggle, and a "View
// full route" action that deep-links into route-map.tsx with the public id.

import React from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  useColorScheme,
  Pressable,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/theme";
import type { DiscoverRoute } from "@/types/discover";
import { useTranslation } from "@/hooks/use-translation";

interface Props {
  route: DiscoverRoute | null;
  saving: boolean;
  onClose: () => void;
  onToggleSave: () => void;
  onViewFull: () => void;
}

function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m} min`;
  return `${h}h ${m}m`;
}

export function RoutePreviewSheet({
  route,
  saving,
  onClose,
  onToggleSave,
  onViewFull,
}: Props) {
  const scheme = useColorScheme() ?? "light";
  const t = Colors[scheme];
  const { t: tr } = useTranslation();
  const insets = useSafeAreaInsets();

  if (!route) return null;

  const km = (route.distance / 1000).toFixed(1);
  const ascent = route.ascent ?? 0;
  const awayKm = route.distanceKm.toFixed(1);

  return (
    <Modal
      visible={!!route}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View
        style={[
          styles.sheet,
          {
            backgroundColor: t.bg,
            borderColor: t.border,
            paddingBottom: Math.max(insets.bottom, 20),
          },
        ]}
      >
        <View style={[styles.handle, { backgroundColor: t.border }]} />

        <Text style={[styles.title, { color: t.text }]} numberOfLines={2}>
          {route.title}
        </Text>

        {route.description ? (
          <Text
            style={[styles.description, { color: t.muted }]}
            numberOfLines={3}
          >
            {route.description}
          </Text>
        ) : null}

        {/* Stats row */}
        <View style={styles.stats}>
          <Stat theme={t} icon="walk-outline" label={`${km} km`} />
          <Stat
            theme={t}
            icon="time-outline"
            label={formatDuration(route.duration)}
          />
          <Stat
            theme={t}
            icon="trending-up-outline"
            label={`${Math.round(ascent)} m`}
          />
          <Stat
            theme={t}
            icon="location-outline"
            label={`${awayKm} km ${tr("discover.away")}`}
          />
        </View>

        {/* Author + save count */}
        <View
          style={[
            styles.authorRow,
            { borderTopColor: t.border, borderBottomColor: t.border },
          ]}
        >
          <View style={styles.authorLeft}>
            <Ionicons name="person-circle-outline" size={20} color={t.muted} />
            <Text style={[styles.authorText, { color: t.text }]}>
              {route.author ? `@${route.author.username}` : "—"}
            </Text>
          </View>
          <View style={styles.saveCount}>
            <Ionicons name="bookmark" size={14} color={t.muted} />
            <Text style={[styles.saveCountText, { color: t.muted }]}>
              {route.saveCount}
            </Text>
          </View>
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity
            onPress={onToggleSave}
            disabled={saving}
            activeOpacity={0.85}
            style={[
              styles.actionBtn,
              {
                backgroundColor: route.savedByMe ? t.surface : t.tint,
                borderColor: route.savedByMe ? t.border : t.tint,
              },
            ]}
          >
            {saving ? (
              <ActivityIndicator
                color={route.savedByMe ? t.text : "#fff"}
                size="small"
              />
            ) : (
              <>
                <Ionicons
                  name={route.savedByMe ? "bookmark" : "bookmark-outline"}
                  size={16}
                  color={route.savedByMe ? t.text : "#fff"}
                />
                <Text
                  style={[
                    styles.actionText,
                    { color: route.savedByMe ? t.text : "#fff" },
                  ]}
                >
                  {route.savedByMe
                    ? tr("discover.saved")
                    : tr("discover.save")}
                </Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={onViewFull}
            activeOpacity={0.85}
            style={[
              styles.actionBtn,
              styles.actionBtnOutline,
              { borderColor: t.border },
            ]}
          >
            <Ionicons name="map-outline" size={16} color={t.text} />
            <Text style={[styles.actionText, { color: t.text }]}>
              {tr("discover.view-full")}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

interface StatProps {
  theme: (typeof Colors)["light"];
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
}

function Stat({ theme, icon, label }: StatProps) {
  return (
    <View style={styles.stat}>
      <Ionicons name={icon} size={14} color={theme.muted} />
      <Text style={[styles.statText, { color: theme.text }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: 20,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
  },
  description: {
    fontSize: 13,
    lineHeight: 18,
  },
  stats: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  stat: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  statText: {
    fontSize: 13,
    fontWeight: "600",
  },
  authorRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderTopWidth: 1,
    borderBottomWidth: 1,
  },
  authorLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  authorText: {
    fontSize: 13,
    fontWeight: "600",
  },
  saveCount: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  saveCountText: {
    fontSize: 12,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  actionBtnOutline: {
    backgroundColor: "transparent",
  },
  actionText: {
    fontSize: 14,
    fontWeight: "700",
  },
});
