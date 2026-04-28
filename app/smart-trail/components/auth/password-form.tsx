import { useState, ReactNode } from "react";
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
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Colors } from "@/constants/theme";
import { useTranslation } from "@/hooks/use-translation";
import { ScreenHeader } from "@/components/ui/screen-header";

export interface PasswordFormField {
  key: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}

interface PasswordFormProps {
  title: string;
  description?: string;
  fields: PasswordFormField[];
  error: string | null;
  saving: boolean;
  onSave: () => void;
  children?: ReactNode;
}

export function PasswordForm({
  title,
  description,
  fields,
  error,
  saving,
  onSave,
  children,
}: PasswordFormProps) {
  const router = useRouter();
  const scheme = useColorScheme() ?? "light";
  const ts = Colors[scheme];
  const { t } = useTranslation();

  const saveChip = (
    <TouchableOpacity
      onPress={onSave}
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
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={[styles.root, { backgroundColor: ts.bg }]}
    >
      <ScreenHeader
        title={title}
        onBack={() => router.back()}
        backDisabled={saving}
        right={saveChip}
      />

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {description ? (
          <Text style={[styles.description, { color: ts.muted }]}>
            {description}
          </Text>
        ) : null}

        {fields.map((f) => (
          <View key={f.key} style={styles.field}>
            <Text style={[styles.label, { color: ts.muted }]}>
              {f.label.toUpperCase()}
            </Text>
            <View
              style={[
                styles.inputWrap,
                { backgroundColor: ts.bg, borderColor: ts.border },
              ]}
            >
              <Ionicons name="lock-closed" size={15} color={ts.muted} />
              <TextInput
                value={f.value}
                onChangeText={f.onChange}
                placeholder={f.placeholder}
                placeholderTextColor={ts.muted}
                secureTextEntry
                autoCapitalize="none"
                style={[styles.input, { color: ts.text }]}
              />
            </View>
          </View>
        ))}

        {error ? (
          <Text style={[styles.errorText, { color: ts.danger }]}>{error}</Text>
        ) : null}

        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function validatePassword(
  password: string,
  confirm: string,
  t: (k: string) => string,
  keyPrefix: string,
): string | null {
  if (password.length < 8) return t(`${keyPrefix}.error-min-length`);
  if (!/\d/.test(password)) return t(`${keyPrefix}.error-needs-number`);
  if (password !== confirm) return t(`${keyPrefix}.error-no-match`);
  return null;
}

export function useSavingState() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return { saving, setSaving, error, setError };
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
