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
  Image,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import type { EditForm } from "@/hooks/use-user-profile";
import { Colors } from "@/constants/theme";
import { useTranslation } from "@/hooks/use-translation";

const AVATAR_PLACEHOLDER = (name: string) =>
  `https://ui-avatars.com/api/?background=16A34A&color=fff&size=256&bold=true&name=${encodeURIComponent(name)}`;

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
  const ts = Colors[isDark ? "dark" : "light"];
  const { t } = useTranslation();

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled) {
      onChangeForm({ ...form, profilePicture: result.assets[0].uri });
    }
  };

  const avatarUri =
    form.profilePicture || AVATAR_PLACEHOLDER(form.username || "User");

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

        <View style={[styles.sheet, { backgroundColor: ts.surface }]}>
          <View style={[styles.handle, { backgroundColor: ts.border }]} />

          {/* Header */}
          <View style={styles.header}>
            <Text style={[styles.title, { color: ts.text }]}>
              {t("profile.edit-profile")}
            </Text>
            <TouchableOpacity
              onPress={() => !saving && onClose()}
              style={[
                styles.closeBtn,
                { backgroundColor: ts.bg, borderColor: ts.border },
              ]}
            >
              <Ionicons name="close" size={16} color={ts.muted} />
            </TouchableOpacity>
          </View>

          {/* Avatar picker */}
          <View style={styles.avatarRow}>
            <Image
              source={{ uri: avatarUri }}
              style={[styles.avatar, { borderColor: ts.border }]}
            />
            <TouchableOpacity
              onPress={pickImage}
              style={[
                styles.changePhotoBtn,
                { borderColor: ts.border, backgroundColor: ts.bg },
              ]}
            >
              <Text style={[styles.changePhotoText, { color: ts.tint }]}>
                {t("profile.change-photo")}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Username */}
          <View style={styles.field}>
            <Text style={[styles.label, { color: ts.muted }]}>
              {t("profile.username")}
            </Text>
            <TextInput
              value={form.username}
              onChangeText={(v) => onChangeForm({ ...form, username: v })}
              placeholder={t("profile.username-placeholder")}
              placeholderTextColor={ts.muted}
              autoCapitalize="none"
              style={[
                styles.input,
                {
                  backgroundColor: ts.bg,
                  borderColor: ts.border,
                  color: ts.text,
                },
              ]}
            />
          </View>

          {/* Bio */}
          <View style={styles.field}>
            <Text style={[styles.label, { color: ts.muted }]}>
              {t("profile.bio")}
            </Text>
            <TextInput
              value={form.bio}
              onChangeText={(v) => onChangeForm({ ...form, bio: v })}
              placeholder={t("profile.bio-placeholder")}
              placeholderTextColor={ts.muted}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              style={[
                styles.input,
                styles.textarea,
                {
                  backgroundColor: ts.bg,
                  borderColor: ts.border,
                  color: ts.text,
                },
              ]}
            />
          </View>

          {/* Save */}
          <TouchableOpacity
            onPress={onSave}
            disabled={saving}
            activeOpacity={0.85}
            style={[
              styles.saveBtn,
              { backgroundColor: saving ? ts.tint + "80" : ts.tint },
            ]}
          >
            {saving ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.saveBtnLabel}>
                {t("profile.save-changes")}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, justifyContent: "flex-end" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: Platform.OS === "ios" ? 44 : 28,
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
    marginBottom: 24,
  },
  title: { fontSize: 18, fontWeight: "700" },
  closeBtn: {
    padding: 8,
    borderRadius: 10,
    borderWidth: 1,
  },

  avatarRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginBottom: 24,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1,
    backgroundColor: "#D4D4D8",
  },
  changePhotoBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  changePhotoText: { fontSize: 14, fontWeight: "600" },

  field: { marginBottom: 16 },
  label: {
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    height: 46,
  },
  textarea: {
    height: 80,
    paddingTop: 12,
  },

  saveBtn: {
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  saveBtnLabel: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
