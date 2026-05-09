import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { Colors } from "@/constants/theme";
import { t } from "@/lib/i18n";
import { modalStyles } from "./modal-styles";

type Props = {
  visible: boolean;
  onClose: () => void;
  title: string;
  onTitleChange: (v: string) => void;
  description: string;
  onDescriptionChange: (v: string) => void;
  saving: boolean;
  onSave: () => void;
  colors: (typeof Colors)["light" | "dark"];
};

export function SaveRouteModal({
  visible,
  onClose,
  title,
  onTitleChange,
  description,
  onDescriptionChange,
  saving,
  onSave,
  colors: c,
}: Props) {
  const handleBackdrop = () => {
    if (!saving) onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleBackdrop}
    >
      <KeyboardAvoidingView
        style={modalStyles.backdrop}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={handleBackdrop}
        />
        <View style={[modalStyles.card, { backgroundColor: c.bg, borderColor: c.border }]}>
          <Text style={[modalStyles.title, { color: c.text }]}>
            {t("route-map.save-modal-title")}
          </Text>
          <Text style={[modalStyles.subtitle, { color: c.muted }]}>
            {t("route-map.save-modal-subtitle")}
          </Text>

          <Text style={[modalStyles.label, { color: c.muted }]}>
            {t("route-map.save-modal-title-label")}
          </Text>
          <TextInput
            value={title}
            onChangeText={onTitleChange}
            placeholder={t("route-map.save-modal-title-placeholder")}
            placeholderTextColor={c.muted}
            maxLength={100}
            style={[
              modalStyles.input,
              { color: c.text, backgroundColor: c.surface, borderColor: c.border },
            ]}
          />

          <Text style={[modalStyles.label, { color: c.muted }]}>
            {t("route-map.save-modal-description-label")}
          </Text>
          <TextInput
            value={description}
            onChangeText={onDescriptionChange}
            placeholder={t("route-map.save-modal-description-placeholder")}
            placeholderTextColor={c.muted}
            maxLength={500}
            multiline
            style={[
              modalStyles.input,
              modalStyles.inputMultiline,
              { color: c.text, backgroundColor: c.surface, borderColor: c.border },
            ]}
          />

          <View style={modalStyles.actions}>
            <TouchableOpacity
              style={[modalStyles.btn, { borderColor: c.border }]}
              onPress={onClose}
              disabled={saving}
            >
              <Text style={{ color: c.text, fontWeight: "600" }}>
                {t("common.cancel")}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[modalStyles.btn, { backgroundColor: c.tint, borderColor: c.tint }]}
              onPress={onSave}
              disabled={saving || !title.trim()}
            >
              {saving ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={{ color: "#fff", fontWeight: "700" }}>
                  {t("common.save")}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
