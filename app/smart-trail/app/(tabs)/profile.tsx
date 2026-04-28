import { useCallback, useState } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  StyleSheet,
  ActivityIndicator,
  Alert,
  useColorScheme,
} from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useProfileStore } from "@/store/use-profile-store";
import { useSavedRoutesStore } from "@/store/use-saved-routes-store";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/theme";
import { useTranslation } from "@/hooks/use-translation";
import type { SavedRouteListItem } from "@/types/route";
import { RoutePreview } from "@/components/saved-routes/route-preview";
import {
  TabScreenHeader,
  mainTabHeaderIconHitStyle,
} from "@/components/ui/tab-screen-header";

const AVATAR_PLACEHOLDER = (name: string) =>
  `https://ui-avatars.com/api/?background=16A34A&color=fff&size=256&bold=true&name=${encodeURIComponent(name)}`;

const formatDistance = (metres: number) =>
  metres < 1000
    ? `${Math.round(metres)} m`
    : `${(metres / 1000).toFixed(1)} km`;

const formatDuration = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m} min`;
};

const TRANSPORT_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  "foot-walking": "walk-outline",
  "foot-hiking": "trail-sign-outline",
  running: "walk-outline",
  "cycling-regular": "bicycle-outline",
  "cycling-road": "bicycle-outline",
  "cycling-mountain": "bicycle-outline",
  "cycling-electric": "bicycle-outline",
};

export default function ProfileScreen() {
  const { profile, loading, error, fetchProfile } = useProfileStore();
  const scheme = useColorScheme() ?? "light";
  const isDark = scheme === "dark";
  const ts = Colors[scheme];
  const { t } = useTranslation();
  const router = useRouter();

  const savedRoutes = useSavedRoutesStore((s) => s.routes);
  const savedRoutesLoading = useSavedRoutesStore((s) => s.loading);
  const bootstrapSavedRoutes = useSavedRoutesStore((s) => s.bootstrap);
  const refreshSavedRoutes = useSavedRoutesStore((s) => s.refresh);
  const removeRoute = useSavedRoutesStore((s) => s.remove);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = useCallback(
    (id: string, title: string) => {
      Alert.alert(
        t("profile.delete-route-title"),
        t("profile.delete-route-body", { title }),
        [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("common.delete"),
            style: "destructive",
            onPress: async () => {
              setDeletingId(id);
              try {
                await removeRoute(id);
              } catch {
                Alert.alert(t("common.error"), t("profile.delete-route-error"));
              } finally {
                setDeletingId(null);
              }
            },
          },
        ],
      );
    },
    [removeRoute, t],
  );

  useFocusEffect(
    useCallback(() => {
      fetchProfile();
      if (savedRoutes.length === 0) {
        bootstrapSavedRoutes();
      } else {
        refreshSavedRoutes().catch(() => {});
      }
    }, [
      fetchProfile,
      bootstrapSavedRoutes,
      refreshSavedRoutes,
      savedRoutes.length,
    ]),
  );

  if (loading && !profile) {
    return (
      <View style={[styles.root, { backgroundColor: ts.bg }]}>
        <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />
        <TabScreenHeader title={t("profile.profile-title")} />
        <View style={styles.centeredFill}>
          <ActivityIndicator color={ts.tint} />
        </View>
      </View>
    );
  }

  if (error && !profile) {
    return (
      <View style={[styles.root, { backgroundColor: ts.bg }]}>
        <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />
        <TabScreenHeader title={t("profile.profile-title")} />
        <View style={[styles.centeredFill, { gap: 12 }]}>
          <Text style={[styles.errorText, { color: ts.muted }]}>{error}</Text>
          <TouchableOpacity onPress={fetchProfile}>
            <Text style={[styles.retryText, { color: ts.tint }]}>
              {t("profile.try-again")}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const avatarUri = AVATAR_PLACEHOLDER(profile?.username ?? "User");

  return (
    <View style={[styles.root, { backgroundColor: ts.bg }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />

      <TabScreenHeader
        title={t("profile.profile-title")}
        right={
          <View style={styles.headerBtns}>
            <TouchableOpacity
              onPress={() => router.push("/edit-profile")}
              style={[
                mainTabHeaderIconHitStyle.base,
                { backgroundColor: ts.surface, borderColor: ts.border },
              ]}
            >
              <Ionicons name="pencil-outline" size={16} color={ts.muted} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.push("/settings")}
              style={[
                mainTabHeaderIconHitStyle.base,
                { backgroundColor: ts.surface, borderColor: ts.border },
              ]}
            >
              <Ionicons name="settings-outline" size={16} color={ts.muted} />
            </TouchableOpacity>
          </View>
        }
      />

      <ScrollView
        style={styles.scrollFlex}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        {/* Avatar + info */}
        <View style={styles.profileSection}>
          <Image
            source={{ uri: avatarUri }}
            style={[
              styles.avatar,
              { borderColor: ts.border, backgroundColor: ts.surface },
            ]}
          />
          <Text style={[styles.username, { color: ts.text }]}>
            {profile?.username ?? "—"}
          </Text>
          <Text style={[styles.email, { color: ts.muted }]}>
            {profile?.email}
          </Text>
          {profile?.bio ? (
            <Text style={[styles.bio, { color: ts.muted }]}>{profile.bio}</Text>
          ) : null}
        </View>

        {/* Saved routes */}
        <View style={styles.savedSection}>
          <Text style={[styles.sectionTitle, { color: ts.text }]}>
            {t("profile.saved-routes")}
          </Text>

          {savedRoutesLoading && savedRoutes.length === 0 ? (
            <View style={styles.savedEmpty}>
              <ActivityIndicator color={ts.tint} />
            </View>
          ) : savedRoutes.length === 0 ? (
            <View
              style={[
                styles.savedEmpty,
                { borderColor: ts.border, backgroundColor: ts.surface },
              ]}
            >
              <Ionicons name="bookmark-outline" size={28} color={ts.muted} />
              <Text style={[styles.savedEmptyText, { color: ts.muted }]}>
                {t("profile.no-saved-routes")}
              </Text>
              <Text style={[styles.savedEmptyHint, { color: ts.muted }]}>
                {t("profile.no-saved-routes-hint")}
              </Text>
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              {savedRoutes.map((r: SavedRouteListItem) => {
                const icon = TRANSPORT_ICON[r.transport] ?? "map-outline";
                const isDeleting = deletingId === r.id;
                return (
                  <View
                    key={r.id}
                    style={[
                      styles.savedCard,
                      { backgroundColor: ts.surface, borderColor: ts.border },
                    ]}
                  >
                    <TouchableOpacity
                      activeOpacity={0.8}
                      onPress={() =>
                        router.push({
                          pathname: "/route-map",
                          params: { savedId: r.id },
                        })
                      }
                      style={styles.savedCardBody}
                    >
                      <RoutePreview
                        coords={r.thumbnail}
                        bbox={r.bbox}
                        width={64}
                        height={52}
                        color={ts.tint}
                        backgroundColor={ts.bg}
                      />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text
                          style={[styles.savedCardTitle, { color: ts.text }]}
                          numberOfLines={1}
                        >
                          {r.title}
                        </Text>
                        <View style={styles.savedCardMetaRow}>
                          <Ionicons name={icon} size={12} color={ts.muted} />
                          <Text
                            style={[styles.savedCardMeta, { color: ts.muted }]}
                            numberOfLines={1}
                          >
                            {formatDistance(r.distance)} ·{" "}
                            {formatDuration(r.duration)}
                            {r.ascent != null ? ` · ↑${r.ascent} m` : ""}
                          </Text>
                        </View>
                      </View>
                      {r.isFavorite && (
                        <Ionicons name="star" size={16} color={ts.tint} />
                      )}
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={() => handleDelete(r.id, r.title)}
                      disabled={isDeleting}
                      hitSlop={8}
                      style={styles.deleteBtn}
                    >
                      {isDeleting ? (
                        <ActivityIndicator size="small" color={ts.muted} />
                      ) : (
                        <Ionicons
                          name="trash-outline"
                          size={18}
                          color={ts.muted}
                        />
                      )}
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scrollFlex: { flex: 1 },
  scroll: { paddingBottom: 48 },
  centeredFill: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  errorText: { fontSize: 14 },
  retryText: { fontSize: 14, fontWeight: "600" },

  headerBtns: { flexDirection: "row", gap: 8 },

  profileSection: {
    alignItems: "center",
    paddingVertical: 24,
    paddingHorizontal: 24,
    gap: 4,
  },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 1,
    marginBottom: 12,
  },
  username: { fontSize: 20, fontWeight: "700", letterSpacing: -0.2 },
  email: { fontSize: 14 },
  bio: { fontSize: 14, textAlign: "center", lineHeight: 20, marginTop: 4 },

  // Saved routes section
  savedSection: {
    paddingHorizontal: 20,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  savedEmpty: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 32,
    paddingHorizontal: 24,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  savedEmptyText: { fontSize: 14, fontWeight: "600", marginTop: 4 },
  savedEmptyHint: { fontSize: 12, textAlign: "center" },
  savedCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  savedCardBody: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  deleteBtn: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  savedCardTitle: { fontSize: 14, fontWeight: "700", letterSpacing: -0.1 },
  savedCardMeta: { fontSize: 12, flexShrink: 1 },
  savedCardMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 3,
  },
});
