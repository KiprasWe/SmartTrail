import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
  StatusBar,
  ActivityIndicator,
  useColorScheme,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/context/auth-context";
import { useSocial, type UserProfile } from "@/hooks/use-social";
import { FollowListSheet } from "@/components/social/follow-list-sheet";
import { Colors } from "@/constants/theme";

const AVATAR_PLACEHOLDER = (name: string) =>
  `https://ui-avatars.com/api/?background=16A34A&color=fff&size=256&bold=true&name=${encodeURIComponent(name)}`;

export default function UserProfileScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const router = useRouter();
  const { authFetch } = useAuth();
  const scheme = useColorScheme() ?? "light";
  const isDark = scheme === "dark";
  const ts = Colors[scheme];

  const { getUserProfile, sendFollow, unfollow, cancelRequest } = useSocial(authFetch);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const [followersVisible, setFollowersVisible] = useState(false);
  const [followingVisible, setFollowingVisible] = useState(false);

  const fetchProfile = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getUserProfile(userId);
      setProfile(data);
    } catch {
      setError("Failed to load profile.");
    } finally {
      setLoading(false);
    }
  }, [userId, getUserProfile]);

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
        setProfile((p) => p && { ...p, followStatus: next, canViewContent: next === "ACCEPTED" || p.isPublic });
      } else if (profile.followStatus === "ACCEPTED") {
        await unfollow(profile.id);
        setProfile((p) =>
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
      return { label: "Following", bg: ts.surface, color: ts.text, border: ts.border };
    if (status === "PENDING")
      return { label: "Requested", bg: ts.surface, color: ts.muted, border: ts.border };
    return { label: "Follow", bg: ts.tint, color: "#fff", border: ts.tint };
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
        <Text style={[styles.errorText, { color: ts.muted }]}>{error ?? "User not found."}</Text>
        <TouchableOpacity onPress={fetchProfile} style={{ marginTop: 8 }}>
          <Text style={[styles.retryText, { color: ts.tint }]}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const avatarUri = profile.profilePicture || AVATAR_PLACEHOLDER(profile.username);
  const btn = btnConfig(profile.followStatus);
  const canTapStats = profile.canViewContent;

  return (
    <View style={[styles.root, { backgroundColor: ts.bg }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />

      {/* Header */}
      <View
        style={[
          styles.header,
          { borderBottomColor: ts.border, paddingTop: Platform.OS === "ios" ? 56 : 40 },
        ]}
      >
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={ts.text} />
        </TouchableOpacity>
        <Text style={[styles.headerUsername, { color: ts.text }]} numberOfLines={1}>
          {profile.username}
        </Text>
        {!profile.isPublic && (
          <Ionicons name="lock-closed" size={14} color={ts.muted} style={styles.lockIcon} />
        )}
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        {/* Avatar + info */}
        <View style={styles.profileSection}>
          <Image
            source={{ uri: avatarUri }}
            style={[styles.avatar, { borderColor: ts.border }]}
          />
          <Text style={[styles.username, { color: ts.text }]}>{profile.username}</Text>
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
            onPress={() => canTapStats && setFollowersVisible(true)}
            activeOpacity={canTapStats ? 0.7 : 1}
          >
            <Text style={[styles.statCount, { color: ts.text }]}>{profile.followersCount}</Text>
            <Text style={[styles.statLabel, { color: ts.muted }]}>Followers</Text>
          </TouchableOpacity>

          <View style={[styles.statDivider, { backgroundColor: ts.border }]} />

          <TouchableOpacity
            style={styles.statItem}
            onPress={() => canTapStats && setFollowingVisible(true)}
            activeOpacity={canTapStats ? 0.7 : 1}
          >
            <Text style={[styles.statCount, { color: ts.text }]}>{profile.followingCount}</Text>
            <Text style={[styles.statLabel, { color: ts.muted }]}>Following</Text>
          </TouchableOpacity>
        </View>

        {/* Follow button */}
        {!profile.isOwnProfile && (
          <View style={styles.followRow}>
            <TouchableOpacity
              style={[styles.followBtn, { backgroundColor: btn.bg, borderColor: btn.border }]}
              onPress={handleFollowToggle}
              disabled={actionLoading}
              activeOpacity={0.75}
            >
              {actionLoading ? (
                <ActivityIndicator size="small" color={ts.muted} />
              ) : (
                <Text style={[styles.followBtnText, { color: btn.color }]}>{btn.label}</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Private lock */}
        {!profile.canViewContent && (
          <View style={styles.privateLock}>
            <View style={[styles.lockCircle, { backgroundColor: ts.surface, borderColor: ts.border }]}>
              <Ionicons name="lock-closed" size={28} color={ts.muted} />
            </View>
            <Text style={[styles.privateTitle, { color: ts.text }]}>This account is private</Text>
            <Text style={[styles.privateSubtitle, { color: ts.muted }]}>
              Follow {profile.username} to see their routes.
            </Text>
          </View>
        )}

        {/* Content placeholder (public / following) */}
        {profile.canViewContent && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: ts.muted }]}>ROUTES</Text>
            <View style={[styles.emptyCard, { backgroundColor: ts.surface, borderColor: ts.border }]}>
              <Text style={[styles.emptyText, { color: ts.muted }]}>No routes yet.</Text>
            </View>
          </View>
        )}
      </ScrollView>

      <FollowListSheet
        visible={followersVisible}
        type="followers"
        userId={profile.id}
        onClose={() => setFollowersVisible(false)}
        onDone={() => {}}
        isDark={isDark}
        authFetch={authFetch}
      />

      <FollowListSheet
        visible={followingVisible}
        type="following"
        userId={profile.id}
        onClose={() => setFollowingVisible(false)}
        onDone={() => {}}
        isDark={isDark}
        authFetch={authFetch}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  errorText: { fontSize: 14 },
  retryText: { fontSize: 14, fontWeight: "600" },

  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  backBtn: { padding: 4 },
  headerUsername: { fontSize: 16, fontWeight: "700", flex: 1 },
  lockIcon: { marginLeft: 2 },

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
    backgroundColor: "#D4D4D8",
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
  sectionTitle: { fontSize: 11, fontWeight: "600", letterSpacing: 1, marginBottom: 10 },
  emptyCard: {
    paddingHorizontal: 16,
    paddingVertical: 18,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
  },
  emptyText: { fontSize: 13 },
});
