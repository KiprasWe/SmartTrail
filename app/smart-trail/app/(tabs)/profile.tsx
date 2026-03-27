import { useState, useCallback } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  StyleSheet,
  Platform,
  ActivityIndicator,
  Alert,
  useColorScheme,
} from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "@/context/auth-context";
import { Ionicons } from "@expo/vector-icons";
import { useUserProfile, type EditForm } from "@/hooks/use-user-profile";
import { useSocial } from "@/hooks/use-social";
import { EditProfileSheet } from "@/components/profile/edit-profile-sheet";
import { FollowListSheet } from "@/components/social/follow-list-sheet";
import { FollowRequestsSheet } from "@/components/social/follow-requests-sheet";
import { Colors } from "@/constants/theme";
import { useTranslation } from "@/hooks/use-translation";

const AVATAR_PLACEHOLDER = (name: string) =>
  `https://ui-avatars.com/api/?background=16A34A&color=fff&size=256&bold=true&name=${encodeURIComponent(name)}`;

export default function ProfileScreen() {
  const { signout, authFetch } = useAuth();
  const scheme = useColorScheme() ?? "light";
  const isDark = scheme === "dark";
  const ts = Colors[scheme];
  const { t } = useTranslation();
  const router = useRouter();

  const { profile, loading, error, fetchProfile, updateProfile, setProfile } =
    useUserProfile(authFetch);
  const { getFollowers, getFollowing, getFollowRequests } = useSocial(authFetch);

  const [editVisible, setEditVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<EditForm>({
    username: "",
    bio: "",
    profilePicture: "",
  });

  const [followersVisible, setFollowersVisible] = useState(false);
  const [followingVisible, setFollowingVisible] = useState(false);
  const [requestsVisible, setRequestsVisible] = useState(false);

  const [socialStats, setSocialStats] = useState({
    followers: 0,
    following: 0,
    requests: 0,
  });

  const fetchStats = useCallback(() => {
    if (!profile?.id) return;
    Promise.all([
      getFollowers(profile.id),
      getFollowing(profile.id),
      getFollowRequests(),
    ])
      .then(([followers, following, requests]) => {
        setSocialStats({
          followers: followers.length,
          following: following.length,
          requests: requests.length,
        });
      })
      .catch(() => {});
  }, [profile?.id, getFollowers, getFollowing, getFollowRequests]);

  useFocusEffect(fetchStats);

  const openEdit = () => {
    setForm({
      username: profile?.username ?? "",
      bio: profile?.bio ?? "",
      profilePicture: profile?.profilePicture ?? "",
    });
    setEditVisible(true);
  };

  const handleSave = async () => {
    if (!form.username.trim()) {
      Alert.alert("Error", "Username cannot be empty.");
      return;
    }
    setSaving(true);
    try {
      const patch: Partial<EditForm> = {};
      if (form.username !== profile?.username)
        patch.username = form.username.trim();
      if (form.bio !== (profile?.bio ?? "")) patch.bio = form.bio;
      if (form.profilePicture !== (profile?.profilePicture ?? ""))
        patch.profilePicture = form.profilePicture;

      if (Object.keys(patch).length > 0) {
        const updated = await updateProfile(patch);
        setProfile(updated);
      }
      setEditVisible(false);
    } catch (err: any) {
      Alert.alert("Error", err.message ?? "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  if (loading && !profile) {
    return (
      <View style={[styles.centered, { backgroundColor: ts.bg }]}>
        <ActivityIndicator color={ts.tint} />
      </View>
    );
  }

  if (error && !profile) {
    return (
      <View style={[styles.centered, { backgroundColor: ts.bg }]}>
        <Text style={[styles.errorText, { color: ts.muted }]}>{error}</Text>
        <TouchableOpacity onPress={fetchProfile}>
          <Text style={[styles.retryText, { color: ts.tint }]}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const avatarUri =
    profile?.profilePicture || AVATAR_PLACEHOLDER(profile?.username ?? "User");

  return (
    <View style={[styles.root, { backgroundColor: ts.bg }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={[styles.pageTitle, { color: ts.text }]}>
            {t("profile.profile-title")}
          </Text>
          <View style={styles.headerBtns}>
            <TouchableOpacity
              onPress={() => router.push("/search-users")}
              style={[
                styles.iconBtn,
                { backgroundColor: ts.surface, borderColor: ts.border },
              ]}
            >
              <Ionicons name="search-outline" size={16} color={ts.muted} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={openEdit}
              style={[
                styles.iconBtn,
                { backgroundColor: ts.surface, borderColor: ts.border },
              ]}
            >
              <Ionicons name="pencil-outline" size={16} color={ts.muted} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Avatar + info */}
        <View style={styles.profileSection}>
          <Image
            source={{ uri: avatarUri }}
            style={[styles.avatar, { borderColor: ts.border }]}
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
            onPress={() => setFollowersVisible(true)}
            activeOpacity={0.7}
          >
            <Text style={[styles.statCount, { color: ts.text }]}>
              {socialStats.followers}
            </Text>
            <Text style={[styles.statLabel, { color: ts.muted }]}>
              Followers
            </Text>
          </TouchableOpacity>

          <View style={[styles.statDivider, { backgroundColor: ts.border }]} />

          <TouchableOpacity
            style={styles.statItem}
            onPress={() => setFollowingVisible(true)}
            activeOpacity={0.7}
          >
            <Text style={[styles.statCount, { color: ts.text }]}>
              {socialStats.following}
            </Text>
            <Text style={[styles.statLabel, { color: ts.muted }]}>
              Following
            </Text>
          </TouchableOpacity>

          {socialStats.requests > 0 && (
            <>
              <View
                style={[styles.statDivider, { backgroundColor: ts.border }]}
              />
              <TouchableOpacity
                style={styles.statItem}
                onPress={() => setRequestsVisible(true)}
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
                  Requests
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* Sign out */}
        <TouchableOpacity
          onPress={signout}
          style={[styles.signOut, { borderColor: ts.border }]}
        >
          <Text style={[styles.signOutText, { color: ts.danger }]}>
            {t("profile.sign-out")}
          </Text>
        </TouchableOpacity>
      </ScrollView>

      <EditProfileSheet
        visible={editVisible}
        saving={saving}
        form={form}
        onChangeForm={setForm}
        onSave={handleSave}
        onClose={() => setEditVisible(false)}
        isDark={isDark}
      />

      <FollowListSheet
        visible={followersVisible}
        type="followers"
        userId={profile?.id ?? ""}
        onClose={() => setFollowersVisible(false)}
        onDone={fetchStats}
        isDark={isDark}
        authFetch={authFetch}
      />

      <FollowListSheet
        visible={followingVisible}
        type="following"
        userId={profile?.id ?? ""}
        onClose={() => setFollowingVisible(false)}
        onDone={fetchStats}
        isDark={isDark}
        authFetch={authFetch}
      />

      <FollowRequestsSheet
        visible={requestsVisible}
        onClose={() => setRequestsVisible(false)}
        onDone={fetchStats}
        isDark={isDark}
        authFetch={authFetch}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingBottom: 48 },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  errorText: { fontSize: 14 },
  retryText: { fontSize: 14, fontWeight: "600" },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "ios" ? 60 : 44,
    paddingBottom: 12,
  },
  pageTitle: { fontSize: 24, fontWeight: "700", letterSpacing: -0.3 },
  headerBtns: { flexDirection: "row", gap: 8 },
  iconBtn: {
    padding: 9,
    borderRadius: 10,
    borderWidth: 1,
  },

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
    backgroundColor: "#D4D4D8",
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

  signOut: {
    marginHorizontal: 20,
    marginTop: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
  },
  signOutText: { fontSize: 14, fontWeight: "600" },
});
