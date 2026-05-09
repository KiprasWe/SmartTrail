import AntDesign from "@expo/vector-icons/AntDesign";
import { useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
  useColorScheme,
  StatusBar,
  type TextStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  KeyboardAwareScrollView,
  KeyboardStickyView,
} from "react-native-keyboard-controller";
import { useAuthStore } from "@/store/use-auth-store";
import { Colors } from "@/constants/theme";
import { resolveErr } from "@/lib/error-messages";
import { t } from "@/lib/i18n";

// RFC 5322-light: tolerant enough for typos, strict enough to catch obvious junk.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function AuthScreen() {
  const { signin, signup, signinWithGoogle } = useAuthStore();
  const scheme = useColorScheme() ?? "light";
  const isDark = scheme === "dark";
  const tc = Colors[scheme];

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const isSignUp = mode === "signup";

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [googleLoad, setGoogleLoad] = useState(false);

  // Themed input style — derived once per scheme rather than duplicating across
  // four <TextInput>s.
  const inputStyle = useMemo<TextStyle[]>(
    () => [
      styles.input,
      {
        borderColor: tc.border,
        color: tc.text,
        backgroundColor: tc.surface,
      },
    ],
    [tc],
  );

  const switchMode = (next: "signin" | "signup") => {
    if (next === mode) return;
    setMode(next);
    setUsername("");
    setEmail("");
    setPassword("");
    setConfirmPassword("");
  };

  const handleSubmit = async () => {
    const trimmedEmail = email.trim();
    const trimmedUsername = username.trim();

    // Required-field guard — unchanged behaviour, just centralised.
    if (isSignUp) {
      if (
        !trimmedUsername ||
        !trimmedEmail ||
        !password ||
        !confirmPassword
      )
        return;
    } else if (!trimmedEmail || !password) {
      return;
    }

    if (!EMAIL_REGEX.test(trimmedEmail)) {
      Alert.alert(t("common.error"), t("auth.errors.invalid-email"));
      return;
    }

    setSubmitting(true);
    try {
      if (isSignUp) {
        await signup(trimmedUsername, trimmedEmail, password, confirmPassword);
      } else {
        await signin(trimmedEmail, password);
      }
    } catch (err: unknown) {
      Alert.alert(t("common.error"), resolveErr(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    setGoogleLoad(true);
    try {
      await signinWithGoogle();
    } catch (err: unknown) {
      Alert.alert(t("common.error"), resolveErr(err));
    } finally {
      setGoogleLoad(false);
    }
  };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: tc.bg }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />

      <KeyboardAwareScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={[
            styles.toggle,
            { backgroundColor: tc.surface, borderColor: tc.border },
          ]}
        >
          <TouchableOpacity
            style={[
              styles.toggleBtn,
              !isSignUp && { backgroundColor: tc.tint },
            ]}
            onPress={() => switchMode("signin")}
          >
            <Text
              style={[
                styles.toggleLabel,
                { color: !isSignUp ? "#fff" : tc.muted },
              ]}
            >
              {t("auth.signIn")}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleBtn, isSignUp && { backgroundColor: tc.tint }]}
            onPress={() => switchMode("signup")}
          >
            <Text
              style={[
                styles.toggleLabel,
                { color: isSignUp ? "#fff" : tc.muted },
              ]}
            >
              {t("auth.signUp")}
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={[styles.title, { color: tc.text }]}>
          {isSignUp ? t("auth.title.signUp") : t("auth.title.signIn")}
        </Text>
        <Text style={[styles.subtitle, { color: tc.muted }]}>
          {isSignUp ? t("auth.subtitle.signUp") : t("auth.subtitle.signIn")}
        </Text>

        <TouchableOpacity
          onPress={handleGoogle}
          disabled={googleLoad}
          style={[styles.googleBtn, { borderColor: tc.border }]}
        >
          {googleLoad ? (
            <ActivityIndicator color={tc.text} size="small" />
          ) : (
            <>
              <AntDesign name="google" size={16} color={tc.text} />
              <Text style={[styles.googleLabel, { color: tc.text }]}>
                {t("auth.google")}
              </Text>
            </>
          )}
        </TouchableOpacity>

        <View style={styles.divider}>
          <View style={[styles.dividerLine, { backgroundColor: tc.border }]} />
          <Text style={[styles.dividerText, { color: tc.muted }]}>
            {t("auth.divider")}
          </Text>
          <View style={[styles.dividerLine, { backgroundColor: tc.border }]} />
        </View>

        <View style={styles.fields}>
          {isSignUp && (
            <TextInput
              value={username}
              onChangeText={setUsername}
              placeholder={t("auth.fields.username")}
              placeholderTextColor={tc.muted}
              autoCapitalize="none"
              autoCorrect={false}
              style={inputStyle}
            />
          )}
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder={t("auth.fields.email")}
            placeholderTextColor={tc.muted}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            style={inputStyle}
          />
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder={t("auth.fields.password")}
            placeholderTextColor={tc.muted}
            secureTextEntry
            style={inputStyle}
          />
          {isSignUp && (
            <TextInput
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder={t("auth.fields.confirmPassword")}
              placeholderTextColor={tc.muted}
              secureTextEntry
              style={inputStyle}
            />
          )}
        </View>
      </KeyboardAwareScrollView>

      <KeyboardStickyView offset={{ closed: 0, opened: 16 }}>
        <View style={styles.footer}>
          <TouchableOpacity
            onPress={handleSubmit}
            disabled={submitting}
            style={[
              styles.submitBtn,
              { backgroundColor: submitting ? tc.tint + "80" : tc.tint },
            ]}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.submitLabel}>
                {isSignUp ? t("auth.createAccount") : t("auth.signIn")}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardStickyView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
  },

  toggle: {
    flexDirection: "row",
    borderRadius: 12,
    borderWidth: 1,
    padding: 4,
    marginBottom: 28,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 9,
    alignItems: "center",
  },
  toggleLabel: { fontSize: 14, fontWeight: "600" },

  title: {
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  subtitle: { fontSize: 15, marginBottom: 32 },

  googleBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    marginBottom: 20,
  },
  googleLabel: { fontSize: 14, fontWeight: "600" },

  divider: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 20,
  },
  dividerLine: { flex: 1, height: 1 },
  dividerText: { fontSize: 12 },

  fields: { gap: 12 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
  },

  footer: { paddingHorizontal: 24, paddingBottom: 16 },
  submitBtn: {
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
  },
  submitLabel: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
