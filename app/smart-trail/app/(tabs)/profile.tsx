import { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  StyleSheet,
  Platform,
  ActivityIndicator,
  Alert,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withSpring,
} from "react-native-reanimated";
import { useAuth } from "@/context/auth-context";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "@/hooks/theme/use-color-scheme";
import { useUserProfile, type EditForm } from "@/hooks/use-user-profile";
import { ProfileHero } from "@/components/profile/profile-hero";
import { AccountCard } from "@/components/profile/account-card";
import { EditProfileSheet } from "@/components/profile/edit-profile-sheet";
import { Colors, Fonts } from "@/constants/theme";

export default function ProfileScreen() {
  const { signout, authFetch } = useAuth();
  const colorScheme = useColorScheme() ?? "light";
  const isDark = colorScheme === "dark";

  const bg = Colors[colorScheme].background;
  const text = Colors[colorScheme].text;
  const muted = Colors[colorScheme].muted;
  const card = Colors[colorScheme].card;
  const border = Colors[colorScheme].border;
  const tint = Colors[colorScheme].tint;

  const { profile, loading, error, fetchProfile, updateProfile, setProfile } =
    useUserProfile(authFetch);

  const user = profile;

  const [editVisible, setEditVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<EditForm>({
    username: "",
    bio: "",
    profilePicture: "",
  });

  // ── Staggered entrance ────────────────────────────────────────
  const headerOpacity = useSharedValue(0);
  const heroY = useSharedValue(32);
  const heroOpacity = useSharedValue(0);
  const cardY = useSharedValue(24);
  const cardOpacity = useSharedValue(0);

  useEffect(() => {
    if (!loading) {
      headerOpacity.value = withTiming(1, { duration: 300 });
      heroY.value = withDelay(
        80,
        withSpring(0, { damping: 18, stiffness: 120 }),
      );
      heroOpacity.value = withDelay(80, withTiming(1, { duration: 300 }));
      cardY.value = withDelay(
        180,
        withSpring(0, { damping: 18, stiffness: 120 }),
      );
      cardOpacity.value = withDelay(180, withTiming(1, { duration: 300 }));
    }
  }, [loading]);

  const headerStyle = useAnimatedStyle(() => ({
    opacity: headerOpacity.value,
  }));
  const heroStyle = useAnimatedStyle(() => ({
    opacity: heroOpacity.value,
    transform: [{ translateY: heroY.value }],
  }));
  const restStyle = useAnimatedStyle(() => ({
    opacity: cardOpacity.value,
    transform: [{ translateY: cardY.value }],
  }));

  // ── Handlers ──────────────────────────────────────────────────
  const openEdit = () => {
    setForm({
      username: user?.username ?? "",
      bio: user?.bio ?? "",
      profilePicture: user?.profilePicture ?? "",
    });
    setEditVisible(true);
  };

  const handleSave = async () => {
    if (!form.username.trim()) {
      Alert.alert("Validation", "Username cannot be empty.");
      return;
    }
    try {
      setSaving(true);
      const patch: Partial<EditForm> = {};
      if (form.username !== user?.username)
        patch.username = form.username.trim();
      if (form.bio !== (user?.bio ?? "")) patch.bio = form.bio;
      if (form.profilePicture !== (user?.profilePicture ?? ""))
        patch.profilePicture = form.profilePicture;

      if (Object.keys(patch).length === 0) {
        setEditVisible(false);
        return;
      }

      const updated = await updateProfile(patch);
      setProfile(updated);
      setEditVisible(false);
    } catch (err: any) {
      Alert.alert("Error", err.message ?? "Failed to save changes.");
    } finally {
      setSaving(false);
    }
  };

  const joinedDate = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      })
    : null;

  // ── Loading ───────────────────────────────────────────────────
  if (loading && !user) {
    return (
      <View style={[styles.centered, { backgroundColor: bg }]}>
        <ActivityIndicator color={tint} size="large" />
      </View>
    );
  }

  if (error && !user) {
    return (
      <View style={[styles.centered, { backgroundColor: bg }]}>
        <Ionicons name="cloud-offline-outline" size={40} color={muted} />
        <Text style={[styles.errorText, { color: muted }]}>{error}</Text>
        <TouchableOpacity
          onPress={fetchProfile}
          style={[styles.retryBtn, { backgroundColor: tint + "18" }]}
        >
          <Text style={[styles.retryLabel, { color: tint }]}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        {/* ── Page header ─────────────────────────────────── */}
        <Animated.View style={[styles.pageHeader, headerStyle]}>
          <Text
            style={[styles.pageTitle, { color: text, fontFamily: Fonts.serif }]}
          >
            Profile
          </Text>
          <TouchableOpacity
            onPress={openEdit}
            style={[
              styles.editBtn,
              { backgroundColor: card, borderColor: border },
            ]}
          >
            <Ionicons name="pencil-outline" size={15} color={muted} />
          </TouchableOpacity>
        </Animated.View>

        {/* ── Hero card ───────────────────────────────────── */}
        <Animated.View style={heroStyle}>
          <ProfileHero user={user} isDark={isDark} onEditBio={openEdit} />
        </Animated.View>

        {/* ── Stats row ───────────────────────────────────── */}
        <Animated.View style={[styles.statsRow, restStyle]}>
          {[
            { label: "Trails", value: "0", icon: "map-outline" },
            { label: "Km", value: "0", icon: "footsteps-outline" },
            { label: "Hours", value: "0h", icon: "time-outline" },
          ].map((s) => (
            <View
              key={s.label}
              style={[
                styles.statCard,
                { backgroundColor: card, borderColor: border },
              ]}
            >
              <Ionicons name={s.icon as any} size={16} color={tint} />
              <Text style={[styles.statValue, { color: text }]}>{s.value}</Text>
              <Text style={[styles.statLabel, { color: muted }]}>
                {s.label}
              </Text>
            </View>
          ))}
        </Animated.View>

        {/* ── Account card ────────────────────────────────── */}
        <Animated.View style={restStyle}>
          <AccountCard
            email={user?.email ?? "—"}
            username={user?.username ?? "—"}
            joinedDate={joinedDate}
            isDark={isDark}
          />

          <TouchableOpacity
            onPress={signout}
            style={[
              styles.signOut,
              {
                borderColor: isDark
                  ? "rgba(185,64,64,0.25)"
                  : "rgba(185,64,64,0.18)",
              },
            ]}
          >
            <Ionicons name="log-out-outline" size={17} color="#B94040" />
            <Text style={styles.signOutLabel}>Sign out</Text>
          </TouchableOpacity>
        </Animated.View>
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingBottom: 52 },

  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 24,
  },
  errorText: { fontSize: 14, textAlign: "center" },
  retryBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 14,
    marginTop: 4,
  },
  retryLabel: { fontWeight: "600", fontSize: 14 },

  pageHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "ios" ? 60 : 44,
    paddingBottom: 8,
  },
  pageTitle: {
    fontSize: 26,
    fontWeight: "700",
    letterSpacing: -0.4,
  },
  editBtn: {
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
  },

  statsRow: {
    flexDirection: "row",
    marginHorizontal: 16,
    marginTop: 10,
    gap: 8,
  },
  statCard: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1,
    gap: 4,
  },
  statValue: {
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  statLabel: {
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },

  signOut: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 10,
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 15,
    backgroundColor: "rgba(185, 64, 64, 0.05)",
  },
  signOutLabel: {
    color: "#B94040",
    fontWeight: "600",
    fontSize: 14,
  },
});
