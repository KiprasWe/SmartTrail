import { useState, useEffect } from "react";
import {
  View,
  Text,
  Image,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  StyleSheet,
  ActivityIndicator,
  Alert,
  useColorScheme,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useProfileStore } from "@/store/use-profile-store";
import { Colors } from "@/constants/theme";
import { useTranslation } from "@/hooks/use-translation";
import { ScreenHeader } from "@/components/ui/screen-header";

const BIO_MAX = 160;

export default function EditProfileScreen() {
  const router = useRouter();
  const { profile, updateProfile, setProfile } = useProfileStore();
  const scheme = useColorScheme() ?? "light";
  const isDark = scheme === "dark";
  const ts = Colors[scheme];
  const { t } = useTranslation();

  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile) {
      setUsername(profile.username ?? "");
      setBio(profile.bio ?? "");
    }
  }, [profile?.id]);

  const handleSave = async () => {
    if (!username.trim()) {
      Alert.alert(t("common.required"), t("edit-profile.username-empty"));
      return;
    }
    setSaving(true);
    try {
      const patch: Record<string, string> = {};
      if (username.trim() !== (profile?.username ?? ""))
        patch.username = username.trim();
      if (bio !== (profile?.bio ?? "")) patch.bio = bio;

      if (Object.keys(patch).length > 0) {
        const updated = await updateProfile(patch);
        setProfile(updated);
      }
      router.back();
    } catch (err: any) {
      Alert.alert(
        t("common.error"),
        err.response?.data?.error ?? err.message ?? "Failed to save.",
      );
    } finally {
      setSaving(false);
    }
  };

  const saveChip = (
    <TouchableOpacity
      onPress={handleSave}
      disabled={saving}
      activeOpacity={0.75}
      style={[
        styles.saveChip,
        { backgroundColor: saving ? ts.tint + "60" : ts.tint },
      ]}
    >
      {saving ? (
        <ActivityIndicator color="#fff" size="small" />
      ) : (
        <Text style={styles.saveChipLabel}>{t("common.save")}</Text>
      )}
    </TouchableOpacity>
  );

  return (
    <View style={[styles.root, { backgroundColor: ts.bg }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />

      <ScreenHeader
        title={t("edit-profile.title")}
        onBack={() => router.back()}
        backDisabled={saving}
        right={saveChip}
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.scroll}
      >
        {/* Profile fields */}
        <Text style={[styles.sectionLabel, { color: ts.muted }]}>
          {t("edit-profile.section-profile").toUpperCase()}
        </Text>
        <View
          style={[
            styles.section,
            { backgroundColor: ts.surface, borderColor: ts.border },
          ]}
        >
          {/* Username */}
          <View style={styles.inputRow}>
            <Ionicons name="person" size={15} color={ts.muted} />
            <TextInput
              value={username}
              onChangeText={setUsername}
              placeholder={t("profile.username")}
              placeholderTextColor={ts.muted}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.input, { color: ts.text }]}
            />
          </View>

          <View style={[styles.rowDivider, { backgroundColor: ts.border }]} />

          {/* Bio */}
          <View style={[styles.inputRow, styles.bioRow]}>
            <TextInput
              value={bio}
              onChangeText={(v) => v.length <= BIO_MAX && setBio(v)}
              placeholder={t("profile.bio")}
              placeholderTextColor={ts.muted}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              style={[styles.input, styles.bioInput, { color: ts.text }]}
            />
            <Text
              style={[
                styles.charCount,
                { color: bio.length > BIO_MAX * 0.9 ? ts.danger : ts.muted },
              ]}
            >
              {bio.length}/{BIO_MAX}
            </Text>
          </View>
        </View>

        {/* Email — read-only */}
        {profile?.email ? (
          <>
            <Text style={[styles.sectionLabel, { color: ts.muted }]}>
              {t("edit-profile.section-account").toUpperCase()}
            </Text>
            <View
              style={[
                styles.section,
                { backgroundColor: ts.surface, borderColor: ts.border },
              ]}
            >
              <View style={styles.inputRow}>
                <Ionicons name="mail-outline" size={15} color={ts.muted} />
                <Text
                  style={[
                    styles.input,
                    styles.readonlyText,
                    { color: ts.muted },
                  ]}
                  numberOfLines={1}
                >
                  {profile.email}
                </Text>
                <View
                  style={[
                    styles.lockedBadge,
                    { backgroundColor: ts.bg, borderColor: ts.border },
                  ]}
                >
                  <Ionicons name="lock-closed" size={10} color={ts.muted} />
                </View>
              </View>
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  saveChip: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 99,
    minWidth: 60,
    alignItems: "center",
    justifyContent: "center",
  },
  saveChipLabel: { color: "#fff", fontSize: 13, fontWeight: "700" },

  scroll: { paddingTop: 28, paddingHorizontal: 20, paddingBottom: 48 },

  avatarWrap: {
    alignSelf: "center",
    marginBottom: 32,
  },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 1,
  },

  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    marginBottom: 8,
    marginLeft: 4,
  },
  section: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    marginBottom: 28,
  },

  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  bioRow: {
    alignItems: "flex-start",
    paddingTop: 13,
  },
  input: { flex: 1, fontSize: 15 },
  bioInput: { minHeight: 64, lineHeight: 22 },
  readonlyText: { flex: 1 },

  rowDivider: { height: StyleSheet.hairlineWidth, marginHorizontal: 16 },

  charCount: {
    fontSize: 11,
    fontWeight: "500",
    alignSelf: "flex-end",
    paddingBottom: 4,
  },

  lockedBadge: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
});
