// app/set-password.tsx
import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  ActivityIndicator,
  StyleSheet,
  Platform,
  ScrollView,
  useColorScheme,
} from "react-native";
import { useRouter } from "expo-router";
import { useProfileStore } from "@/store/use-profile-store";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { Colors } from "@/constants/theme";
import { useTranslation } from "@/hooks/use-translation";
import { ScreenHeader } from "@/components/ui/screen-header";

export default function SetPasswordScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? "light";
  const ts = Colors[scheme];
  const { setPassword } = useProfileStore();
  const { t } = useTranslation();

  const [password, setPasswordVal] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setError(null);
    if (password.length < 8) {
      setError(t("set-password.error-min-length"));
      return;
    }
    if (!/\d/.test(password)) {
      setError(t("set-password.error-needs-number"));
      return;
    }
    if (password !== confirm) {
      setError(t("set-password.error-no-match"));
      return;
    }

    setSaving(true);
    try {
      await setPassword(password);
      router.back();
    } catch (err: any) {
      setError(
        err.response?.data?.error ?? err.message ?? t("set-password.error-generic"),
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
      style={[styles.saveChip, { backgroundColor: saving ? ts.tint + "60" : ts.tint }]}
    >
      {saving ? (
        <ActivityIndicator color="#fff" size="small" />
      ) : (
        <Text style={styles.saveChipLabel}>{t("common.save")}</Text>
      )}
    </TouchableOpacity>
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={[styles.root, { backgroundColor: ts.bg }]}
    >
      <ScreenHeader
        title={t("set-password.title")}
        onBack={() => router.back()}
        backDisabled={saving}
        right={saveChip}
      />

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.description, { color: ts.muted }]}>
          {t("set-password.description")}
        </Text>

        {/* Password */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: ts.muted }]}>{t("set-password.new-label").toUpperCase()}</Text>
          <View style={[styles.inputWrap, { backgroundColor: ts.bg, borderColor: ts.border }]}>
            <IconSymbol name="lock.fill" size={15} color={ts.muted} />
            <TextInput
              value={password}
              onChangeText={setPasswordVal}
              placeholder={t("set-password.new-placeholder")}
              placeholderTextColor={ts.muted}
              secureTextEntry
              autoCapitalize="none"
              style={[styles.input, { color: ts.text }]}
            />
          </View>
        </View>

        {/* Confirm */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: ts.muted }]}>
            {t("set-password.confirm-label").toUpperCase()}
          </Text>
          <View style={[styles.inputWrap, { backgroundColor: ts.bg, borderColor: ts.border }]}>
            <IconSymbol name="lock.fill" size={15} color={ts.muted} />
            <TextInput
              value={confirm}
              onChangeText={setConfirm}
              placeholder={t("set-password.confirm-placeholder")}
              placeholderTextColor={ts.muted}
              secureTextEntry
              autoCapitalize="none"
              style={[styles.input, { color: ts.text }]}
            />
          </View>
        </View>

        {error ? (
          <Text style={[styles.errorText, { color: ts.danger }]}>{error}</Text>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingTop: 20, paddingHorizontal: 20, paddingBottom: 48 },

  saveChip: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 99,
    minWidth: 72,
    alignItems: "center",
    justifyContent: "center",
  },
  saveChipLabel: { color: "#fff", fontSize: 13, fontWeight: "700" },

  description: { fontSize: 13, lineHeight: 18, marginBottom: 20 },

  field: { marginBottom: 14 },
  label: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.9,
    textTransform: "uppercase",
    marginBottom: 7,
  },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  input: { flex: 1, fontSize: 15 },

  errorText: { fontSize: 13, marginTop: 4 },
});
