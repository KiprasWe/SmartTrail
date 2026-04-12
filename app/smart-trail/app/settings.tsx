import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  StyleSheet,
  useColorScheme,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "@/store/use-auth-store";
import { useProfileStore } from "@/store/use-profile-store";
import { Colors } from "@/constants/theme";
import { useTranslation } from "@/hooks/use-translation";
import { ScreenHeader } from "@/components/ui/screen-header";

export default function SettingsScreen() {
  const router = useRouter();
  const { signout } = useAuthStore();
  const { profile } = useProfileStore();
  const scheme = useColorScheme() ?? "light";
  const isDark = scheme === "dark";
  const ts = Colors[scheme];
  const { t } = useTranslation();

  const handleSignOut = () => {
    Alert.alert(t("settings.sign-out"), t("settings.sign-out-confirm"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("settings.sign-out"), style: "destructive", onPress: signout },
    ]);
  };

  return (
    <View style={[styles.root, { backgroundColor: ts.bg }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />

      <ScreenHeader title={t("settings.title")} onBack={() => router.back()} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        {/* Security */}
        <Text style={[styles.sectionLabel, { color: ts.muted }]}>
          {t("settings.security").toUpperCase()}
        </Text>
        <View
          style={[
            styles.section,
            { backgroundColor: ts.surface, borderColor: ts.border },
          ]}
        >
          {profile && !profile.hasPassword ? (
            <TouchableOpacity
              style={styles.row}
              onPress={() => router.push("/set-password")}
              activeOpacity={0.7}
            >
              <View
                style={[styles.rowIcon, { backgroundColor: ts.tint + "20" }]}
              >
                <Ionicons
                  name="lock-closed-outline"
                  size={16}
                  color={ts.tint}
                />
              </View>
              <View style={styles.rowContent}>
                <Text style={[styles.rowTitle, { color: ts.text }]}>
                  {t("settings.set-password")}
                </Text>
                <Text style={[styles.rowSubtitle, { color: ts.muted }]}>
                  {t("settings.set-password-subtitle")}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={14} color={ts.muted} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.row}
              onPress={() => router.push("/change-password")}
              activeOpacity={0.7}
            >
              <View
                style={[styles.rowIcon, { backgroundColor: ts.tint + "20" }]}
              >
                <Ionicons
                  name="lock-closed-outline"
                  size={16}
                  color={ts.tint}
                />
              </View>
              <View style={styles.rowContent}>
                <Text style={[styles.rowTitle, { color: ts.text }]}>
                  {t("settings.change-password")}
                </Text>
                <Text style={[styles.rowSubtitle, { color: ts.muted }]}>
                  {t("settings.change-password-subtitle")}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={14} color={ts.muted} />
            </TouchableOpacity>
          )}
        </View>

        {/* Account */}
        <Text style={[styles.sectionLabel, { color: ts.muted }]}>
          {t("settings.account").toUpperCase()}
        </Text>
        <View
          style={[
            styles.section,
            { backgroundColor: ts.surface, borderColor: ts.border },
          ]}
        >
          <TouchableOpacity
            style={styles.row}
            onPress={handleSignOut}
            activeOpacity={0.7}
          >
            <View
              style={[styles.rowIcon, { backgroundColor: ts.danger + "20" }]}
            >
              <Ionicons name="log-out-outline" size={16} color={ts.danger} />
            </View>
            <View style={styles.rowContent}>
              <Text style={[styles.rowTitle, { color: ts.danger }]}>
                {t("settings.sign-out")}
              </Text>
            </View>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  scroll: { paddingTop: 28, paddingHorizontal: 20, paddingBottom: 48 },

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

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  rowContent: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: "600" },
  rowSubtitle: { fontSize: 12, marginTop: 1 },
});
