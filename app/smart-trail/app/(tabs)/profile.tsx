import { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  StyleSheet,
  ActivityIndicator,
  useColorScheme,
} from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useAuthStore } from "@/store/use-auth-store";
import { useProfileStore } from "@/store/use-profile-store";
import { useSavedRoutesStore } from "@/store/use-saved-routes-store";
import { Ionicons } from "@expo/vector-icons";
import { useSocial } from "@/hooks/use-social";
import { Colors } from "@/constants/theme";
import { useTranslation } from "@/hooks/use-translation";
import type { SavedRouteListItem } from "@/types/route";
import { RoutePreview } from "@/components/saved-routes/route-preview";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  TabScreenHeader,
  mainTabHeaderIconHitStyle,
} from "@/components/ui/tab-screen-header";

const socialStatsStorageKey = (userId: string) =>
  `smarttrail_social_stats_${userId}`;

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
  const { authFetch } = useAuthStore();
  const authUserId = useAuthStore((s) => s.user?.id);
  const { profile, loading, error, fetchProfile } = useProfileStore();
  const scheme = useColorScheme() ?? "light";
  const isDark = scheme === "dark";
  const ts = Colors[scheme];
  const { t } = useTranslation();
  const router = useRouter();

  const { getFollowers, getFollowing, getFollowRequests } =
    useSocial(authFetch);

  const savedRoutes = useSavedRoutesStore((s) => s.routes);
  const savedRoutesLoading = useSavedRoutesStore((s) => s.loading);
  const bootstrapSavedRoutes = useSavedRoutesStore((s) => s.bootstrap);
  const refreshSavedRoutes = useSavedRoutesStore((s) => s.refresh);

  const [socialStats, setSocialStats] = useState({
    followers: 0,
    following: 0,
    requests: 0,
  });

  // Show last-known follower counts immediately (network refresh runs on focus).
  useEffect(() => {
    if (!authUserId) return;
    let cancelled = false;
    AsyncStorage.getItem(socialStatsStorageKey(authUserId)).then((raw) => {
      if (cancelled || !raw) return;
      try {
        const parsed = JSON.parse(raw) as {
          followers?: unknown;
          following?: unknown;
          requests?: unknown;
        };
        if (
          typeof parsed.followers === "number" &&
          typeof parsed.following === "number" &&
          typeof parsed.requests === "number"
        ) {
          setSocialStats({
            followers: parsed.followers,
            following: parsed.following,
            requests: parsed.requests,
          });
        }
      } catch {
        /* ignore */
      }
    });
    return () => {
      cancelled = true;
    };
  }, [authUserId]);

  const fetchStats = useCallback(() => {
    const uid = authUserId ?? profile?.id;
    if (!uid) return;
    let cancelled = false;
    Promise.all([
      getFollowers(uid),
      getFollowing(uid),
      getFollowRequests(),
    ])
      .then(([followers, following, requests]) => {
        if (cancelled) return;
        const next = {
          followers: followers.length,
          following: following.length,
          requests: requests.length,
        };
        setSocialStats(next);
        AsyncStorage.setItem(
          socialStatsStorageKey(uid),
          JSON.stringify(next),
        ).catch(() => {});
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [
    authUserId,
    profile?.id,
    getFollowers,
    getFollowing,
    getFollowRequests,
  ]);

  useFocusEffect(
    useCallback(() => {
      fetchProfile();
      fetchStats();
      // First visit hydrates from AsyncStorage + background refresh;
      // subsequent focuses just re-fetch from the server.
      if (savedRoutes.length === 0) {
        bootstrapSavedRoutes();
      } else {
        refreshSavedRoutes().catch(() => {});
      }
    }, [
      fetchProfile,
      fetchStats,
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
            <Text style={[styles.retryText, { color: ts.tint }]}>{t("profile.try-again")}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const avatarUri =
    profile?.profilePicture || AVATAR_PLACEHOLDER(profile?.username ?? "User");

  return (
    <View style={[styles.root, { backgroundColor: ts.bg }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />

      <TabScreenHeader
        title={t("profile.profile-title")}
        right={
          <View style={styles.headerBtns}>
            <TouchableOpacity
              onPress={() => router.push("/search-users")}
              style={[
                mainTabHeaderIconHitStyle.base,
                { backgroundColor: ts.surface, borderColor: ts.border },
              ]}
            >
              <Ionicons name="search-outline" size={16} color={ts.muted} />
            </TouchableOpacity>
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
            style={[styles.avatar, { borderColor: ts.border, backgroundColor: ts.surface }]}
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

        {/* Social stats */}
        <View
          style={[
            styles.statsRow,
            { borderTopColor: ts.border, borderBottomColor: ts.border },
          ]}
        >
          <TouchableOpacity
            style={styles.statItem}
            onPress={() => {
              if (!profile?.id) return;
              router.push({
                pathname: "/follow-list",
                params: { type: "followers", userId: profile.id },
              });
            }}
            activeOpacity={0.7}
          >
            <Text style={[styles.statCount, { color: ts.text }]}>
              {socialStats.followers}
            </Text>
            <Text style={[styles.statLabel, { color: ts.muted }]}>
              {t("social.followers")}
            </Text>
          </TouchableOpacity>

          <View style={[styles.statDivider, { backgroundColor: ts.border }]} />

          <TouchableOpacity
            style={styles.statItem}
            onPress={() => {
              if (!profile?.id) return;
              router.push({
                pathname: "/follow-list",
                params: { type: "following", userId: profile.id },
              });
            }}
            activeOpacity={0.7}
          >
            <Text style={[styles.statCount, { color: ts.text }]}>
              {socialStats.following}
            </Text>
            <Text style={[styles.statLabel, { color: ts.muted }]}>
              {t("social.following")}
            </Text>
          </TouchableOpacity>

          {socialStats.requests > 0 && (
            <>
              <View
                style={[styles.statDivider, { backgroundColor: ts.border }]}
              />
              <TouchableOpacity
                style={styles.statItem}
                onPress={() => router.push("/follow-requests")}
                activeOpacity={0.7}
              >
                <View style={styles.requestsRow}>
                  <Text style={[styles.statCount, { color: ts.tint }]}>
                    {socialStats.requests}
                  </Text>
                  <View
                    style={[styles.requestsDot, { backgroundColor: ts.tint }]}
                  />
                </View>
                <Text style={[styles.statLabel, { color: ts.muted }]}>
                  {t("social.requests")}
                </Text>
              </TouchableOpacity>
            </>
          )}
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
                return (
                  <TouchableOpacity
                    key={r.id}
                    activeOpacity={0.8}
                    onPress={() =>
                      router.push({
                        pathname: "/route-map",
                        params: { savedId: r.id },
                      })
                    }
                    style={[
                      styles.savedCard,
                      { backgroundColor: ts.surface, borderColor: ts.border },
                    ]}
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
                    <Ionicons
                      name="chevron-forward"
                      size={18}
                      color={ts.muted}
                    />
                  </TouchableOpacity>
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

  statsRow: {
    flexDirection: "row",
    marginHorizontal: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 24,
  },
  statItem: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 14,
    gap: 2,
  },
  statCount: { fontSize: 18, fontWeight: "700", letterSpacing: -0.3 },
  statLabel: { fontSize: 11, fontWeight: "500", letterSpacing: 0.2 },
  statDivider: { width: StyleSheet.hairlineWidth, marginVertical: 10 },
  requestsRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  requestsDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 2,
  },

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
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
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
