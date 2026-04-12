// app/change-password.tsx
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

export default function ChangePasswordScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? "light";
  const ts = Colors[scheme];
  const { changePassword } = useProfileStore();
  const { t } = useTranslation();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setError(null);
    if (!current) { setError(t("change-password.error-current-empty")); return; }
    if (next.length < 8) { setError(t("change-password.error-min-length")); return; }
    if (!/\d/.test(next)) { setError(t("change-password.error-needs-number")); return; }
    if (next !== confirm) { setError(t("change-password.error-no-match")); return; }

    setSaving(true);
    try {
      await changePassword(current, next);
      router.back();
    } catch (err: any) {
      const code = err.response?.data?.code;
      if (code === "INVALID_CURRENT_PASSWORD") {
        setError(t("change-password.error-incorrect"));
      } else {
        setError(err.response?.data?.error ?? err.message ?? t("change-password.error-generic"));
      }
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
        title={t("change-password.title")}
        onBack={() => router.back()}
        backDisabled={saving}
        right={saveChip}
      />

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Current password */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: ts.muted }]}>{t("change-password.current-label").toUpperCase()}</Text>
          <View style={[styles.inputWrap, { backgroundColor: ts.bg, borderColor: ts.border }]}>
            <IconSymbol name="lock.fill" size={15} color={ts.muted} />
            <TextInput
              value={current}
              onChangeText={setCurrent}
              placeholder={t("change-password.current-placeholder")}
              placeholderTextColor={ts.muted}
              secureTextEntry
              autoCapitalize="none"
              style={[styles.input, { color: ts.text }]}
            />
          </View>
        </View>

        {/* New password */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: ts.muted }]}>{t("change-password.new-label").toUpperCase()}</Text>
          <View style={[styles.inputWrap, { backgroundColor: ts.bg, borderColor: ts.border }]}>
            <IconSymbol name="lock.fill" size={15} color={ts.muted} />
            <TextInput
              value={next}
              onChangeText={setNext}
              placeholder={t("change-password.new-placeholder")}
              placeholderTextColor={ts.muted}
              secureTextEntry
              autoCapitalize="none"
              style={[styles.input, { color: ts.text }]}
            />
          </View>
        </View>

        {/* Confirm password */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: ts.muted }]}>{t("change-password.confirm-label").toUpperCase()}</Text>
          <View style={[styles.inputWrap, { backgroundColor: ts.bg, borderColor: ts.border }]}>
            <IconSymbol name="lock.fill" size={15} color={ts.muted} />
            <TextInput
              value={confirm}
              onChangeText={setConfirm}
              placeholder={t("change-password.confirm-placeholder")}
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
