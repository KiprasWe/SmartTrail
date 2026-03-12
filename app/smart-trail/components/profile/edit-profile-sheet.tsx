import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  KeyboardAvoidingView,
  ActivityIndicator,
  StyleSheet,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Palette, Fonts } from "@/constants/theme";
import type { EditForm } from "@/hooks/use-user-profile";

interface EditProfileSheetProps {
  visible: boolean;
  saving: boolean;
  form: EditForm;
  onChangeForm: (form: EditForm) => void;
  onSave: () => void;
  onClose: () => void;
  isDark: boolean;
}

export function EditProfileSheet({
  visible,
  saving,
  form,
  onChangeForm,
  onSave,
  onClose,
  isDark,
}: EditProfileSheetProps) {
  const card = isDark ? "#262018" : "#FAFAF7";
  const text = isDark ? Palette.parchment : "#1A1510";
  const muted = isDark ? "#9A8E7A" : Palette.stoneDark;
  const border = isDark ? "#3A3020" : "#DDD5C8";
  const inputBg = isDark ? "#2A2018" : Palette.parchment;
  const accent = isDark ? Palette.forestLight : Palette.forest;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={() => !saving && onClose()}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.flex}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => !saving && onClose()}
          style={styles.backdrop}
        />

        <View style={[styles.sheet, { backgroundColor: card }]}>
          {/* Handle */}
          <View style={[styles.handle, { backgroundColor: border }]} />

          {/* Header */}
          <View style={styles.header}>
            <Text
              style={[styles.title, { color: text, fontFamily: Fonts.serif }]}
            >
              Edit Profile
            </Text>
            <TouchableOpacity
              onPress={() => !saving && onClose()}
              style={[
                styles.closeBtn,
                { backgroundColor: inputBg, borderColor: border },
              ]}
            >
              <Ionicons name="close" size={16} color={muted} />
            </TouchableOpacity>
          </View>

          <Field
            label="Username"
            icon="at-outline"
            value={form.username}
            onChangeText={(v) => onChangeForm({ ...form, username: v })}
            placeholder="Your username"
            autoCapitalize="none"
            text={text}
            muted={muted}
            border={border}
            inputBg={inputBg}
            accent={accent}
          />

          <Field
            label="Bio"
            icon="create-outline"
            value={form.bio}
            onChangeText={(v) => onChangeForm({ ...form, bio: v })}
            placeholder="Tell us about yourself…"
            multiline
            text={text}
            muted={muted}
            border={border}
            inputBg={inputBg}
            accent={accent}
          />

          <Field
            label="Profile Picture URL"
            icon="image-outline"
            value={form.profilePicture}
            onChangeText={(v) => onChangeForm({ ...form, profilePicture: v })}
            placeholder="https://…"
            autoCapitalize="none"
            text={text}
            muted={muted}
            border={border}
            inputBg={inputBg}
            accent={accent}
          />

          <TouchableOpacity
            onPress={onSave}
            disabled={saving}
            activeOpacity={0.85}
            style={[
              styles.saveBtn,
              { backgroundColor: saving ? accent + "80" : accent },
            ]}
          >
            {saving ? (
              <ActivityIndicator color="#F2EAD3" size="small" />
            ) : (
              <>
                <Ionicons name="checkmark" size={17} color="#F2EAD3" />
                <Text style={styles.saveBtnLabel}>Save Changes</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Field({
  label,
  icon,
  value,
  onChangeText,
  placeholder,
  multiline = false,
  autoCapitalize = "sentences",
  text,
  muted,
  border,
  inputBg,
  accent,
}: {
  label: string;
  icon: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  multiline?: boolean;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  text: string;
  muted: string;
  border: string;
  inputBg: string;
  accent: string;
}) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.field}>
      <View style={styles.fieldLabelRow}>
        <Ionicons name={icon as any} size={11} color={muted} />
        <Text style={[styles.fieldLabel, { color: muted }]}>{label}</Text>
      </View>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={muted + "99"}
        autoCapitalize={autoCapitalize}
        multiline={multiline}
        numberOfLines={multiline ? 3 : 1}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[
          styles.fieldInput,
          {
            backgroundColor: inputBg,
            borderColor: focused ? accent : border,
            color: text,
            height: multiline ? 74 : 46,
            textAlignVertical: multiline ? "top" : "center",
            paddingTop: multiline ? 12 : 0,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, justifyContent: "flex-end" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: Platform.OS === "ios" ? 44 : 28,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
    elevation: 24,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 20,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  closeBtn: {
    padding: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  field: {
    marginBottom: 14,
  },
  fieldLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: 6,
  },
  fieldLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  fieldInput: {
    borderWidth: 1.5,
    borderRadius: 13,
    paddingHorizontal: 14,
    fontSize: 14,
  },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 16,
    paddingVertical: 16,
    marginTop: 8,
  },
  saveBtnLabel: {
    color: "#F2EAD3",
    fontWeight: "700",
    fontSize: 15,
    letterSpacing: 0.1,
  },
});
