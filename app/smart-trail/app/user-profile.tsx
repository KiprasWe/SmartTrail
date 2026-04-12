import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  StatusBar,
  ActivityIndicator,
  useColorScheme,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "@/store/use-auth-store";
import { useSocial, type UserProfile } from "@/hooks/use-social";
import { Colors } from "@/constants/theme";
import { useTranslation } from "@/hooks/use-translation";
import { ScreenHeader } from "@/components/ui/screen-header";
import { paramToString } from "@/lib/route-param";

const AVATAR_PLACEHOLDER = (name: string) =>
  `https://ui-avatars.com/api/?background=16A34A&color=fff&size=256&bold=true&name=${encodeURIComponent(name)}`;

export default function UserProfileScreen() {
  const rawParams = useLocalSearchParams<{ userId?: string | string[] }>();
  const userId = paramToString(rawParams.userId);
  const router = useRouter();
  const { authFetch } = useAuthStore();
  const scheme = useColorScheme() ?? "light";
  const isDark = scheme === "dark";
  const ts = Colors[scheme];

  const { getUserProfile, sendFollow, unfollow, cancelRequest } =
    useSocial(authFetch);
  const { t } = useTranslation();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(() => !!userId);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchProfile = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      setProfile(null);
      setError(t("social.user-not-found"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await getUserProfile(userId);
      setProfile(data);
      setError(null);
    } catch {
      setProfile(null);
      setError(t("social.fail-load-profile"));
    } finally {
      setLoading(false);
    }
  }, [userId, getUserProfile, t]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const handleFollowToggle = async () => {
    if (!profile) return;
    setActionLoading(true);
    try {
      if (!profile.followStatus) {
        const code = await sendFollow(profile.id);
        const next = code === "NOW_FOLLOWING" ? "ACCEPTED" : "PENDING";
        setProfile(
          (p) =>
            p && {
              ...p,
              followStatus: next,
              canViewContent: next === "ACCEPTED" || p.isPublic,
            },
        );
      } else if (profile.followStatus === "ACCEPTED") {
        await unfollow(profile.id);
        setProfile(
          (p) =>
            p && {
              ...p,
              followStatus: null,
              followersCount: p.followersCount - 1,
              canViewContent: p.isPublic,
            },
        );
      } else {
        await cancelRequest(profile.id);
        setProfile((p) => p && { ...p, followStatus: null });
      }
    } catch {
      // keep existing state on failure
    } finally {
      setActionLoading(false);
    }
  };

  const btnConfig = (status: "PENDING" | "ACCEPTED" | null) => {
    if (status === "ACCEPTED")
      return {
        label: t("social.following-btn"),
        bg: ts.surface,
        color: ts.text,
        border: ts.border,
      };
    if (status === "PENDING")
      return {
        label: t("social.requested"),
        bg: ts.surface,
        color: ts.muted,
        border: ts.border,
      };
    return {
      label: t("social.follow"),
      bg: ts.tint,
      color: "#fff",
      border: ts.tint,
    };
  };

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: ts.bg }]}>
        <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />
        <ActivityIndicator color={ts.tint} />
      </View>
    );
  }

  if (error || !profile) {
    return (
      <View style={[styles.centered, { backgroundColor: ts.bg }]}>
        <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />
        <Text style={[styles.errorText, { color: ts.muted }]}>
          {error ?? t("social.user-not-found")}
        </Text>
        <TouchableOpacity onPress={fetchProfile} style={{ marginTop: 8 }}>
          <Text style={[styles.retryText, { color: ts.tint }]}>
            {t("common.retry")}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  const avatarUri =
    profile.profilePicture || AVATAR_PLACEHOLDER(profile.username);
  const btn = btnConfig(profile.followStatus);
  const canTapStats = profile.canViewContent;

  return (
    <View style={[styles.root, { backgroundColor: ts.bg }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />

      <ScreenHeader
        title={profile.username}
        onBack={() => router.back()}
        right={
          !profile.isPublic ? (
            <Ionicons name="lock-closed" size={14} color={ts.muted} />
          ) : undefined
        }
      />

      <ScrollView
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
            {profile.username}
          </Text>
          {profile.bio ? (
            <Text style={[styles.bio, { color: ts.muted }]}>{profile.bio}</Text>
          ) : null}
        </View>

        {/* Stats row */}
        <View
          style={[
            styles.statsRow,
            { borderTopColor: ts.border, borderBottomColor: ts.border },
          ]}
        >
          <TouchableOpacity
            style={styles.statItem}
            onPress={() =>
              canTapStats &&
              router.push({
                pathname: "/follow-list",
                params: { type: "followers", userId: profile.id },
              })
            }
            activeOpacity={canTapStats ? 0.7 : 1}
          >
            <Text style={[styles.statCount, { color: ts.text }]}>
              {profile.followersCount}
            </Text>
            <Text style={[styles.statLabel, { color: ts.muted }]}>
              {t("social.followers")}
            </Text>
          </TouchableOpacity>

          <View style={[styles.statDivider, { backgroundColor: ts.border }]} />

          <TouchableOpacity
            style={styles.statItem}
            onPress={() =>
              canTapStats &&
              router.push({
                pathname: "/follow-list",
                params: { type: "following", userId: profile.id },
              })
            }
            activeOpacity={canTapStats ? 0.7 : 1}
          >
            <Text style={[styles.statCount, { color: ts.text }]}>
              {profile.followingCount}
            </Text>
            <Text style={[styles.statLabel, { color: ts.muted }]}>
              {t("social.following")}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Follow button */}
        {!profile.isOwnProfile && (
          <View style={styles.followRow}>
            <TouchableOpacity
              style={[
                styles.followBtn,
                { backgroundColor: btn.bg, borderColor: btn.border },
              ]}
              onPress={handleFollowToggle}
              disabled={actionLoading}
              activeOpacity={0.75}
            >
              {actionLoading ? (
                <ActivityIndicator size="small" color={ts.muted} />
              ) : (
                <Text style={[styles.followBtnText, { color: btn.color }]}>
                  {btn.label}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Private lock */}
        {!profile.canViewContent && (
          <View style={styles.privateLock}>
            <View
              style={[
                styles.lockCircle,
                { backgroundColor: ts.surface, borderColor: ts.border },
              ]}
            >
              <Ionicons name="lock-closed" size={28} color={ts.muted} />
            </View>
            <Text style={[styles.privateTitle, { color: ts.text }]}>
              {t("social.account-private")}
            </Text>
            <Text style={[styles.privateSubtitle, { color: ts.muted }]}>
              {t("social.private-follow-hint", { username: profile.username })}
            </Text>
          </View>
        )}

        {/* Content placeholder (public / following) */}
        {profile.canViewContent && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: ts.muted }]}>
              {t("social.routes-label").toUpperCase()}
            </Text>
            <View
              style={[
                styles.emptyCard,
                { backgroundColor: ts.surface, borderColor: ts.border },
              ]}
            >
              <Text style={[styles.emptyText, { color: ts.muted }]}>
                {t("social.no-routes")}
              </Text>
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  errorText: { fontSize: 14 },
  retryText: { fontSize: 14, fontWeight: "600" },

  scroll: { paddingBottom: 48 },

  profileSection: {
    alignItems: "center",
    paddingVertical: 28,
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
  bio: { fontSize: 14, textAlign: "center", lineHeight: 20, marginTop: 4 },

  statsRow: {
    flexDirection: "row",
    marginHorizontal: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 20,
  },
  statItem: { flex: 1, alignItems: "center", paddingVertical: 14, gap: 2 },
  statCount: { fontSize: 18, fontWeight: "700", letterSpacing: -0.3 },
  statLabel: { fontSize: 11, fontWeight: "500", letterSpacing: 0.2 },
  statDivider: { width: StyleSheet.hairlineWidth, marginVertical: 10 },

  followRow: {
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  followBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 42,
  },
  followBtnText: { fontSize: 14, fontWeight: "600" },

  privateLock: {
    alignItems: "center",
    paddingTop: 32,
    paddingHorizontal: 32,
    gap: 12,
  },
  lockCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  privateTitle: { fontSize: 16, fontWeight: "700" },
  privateSubtitle: { fontSize: 14, textAlign: "center", lineHeight: 20 },

  section: { paddingHorizontal: 20 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 1,
    marginBottom: 10,
  },
  emptyCard: {
    paddingHorizontal: 16,
    paddingVertical: 18,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
  },
  emptyText: { fontSize: 13 },
});
