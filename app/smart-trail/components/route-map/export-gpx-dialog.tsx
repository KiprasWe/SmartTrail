import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from "react-native";
import { Colors } from "@/constants/theme";
import { useTranslation } from "@/hooks/use-translation";
import { modalStyles } from "./modal-styles";

type Props = {
  visible: boolean;
  onClose: () => void;
  filename: string;
  onFilenameChange: (v: string) => void;
  onConfirm: () => void;
  colors: (typeof Colors)["light" | "dark"];
};

export function ExportGpxDialog({
  visible,
  onClose,
  filename,
  onFilenameChange,
  onConfirm,
  colors: c,
}: Props) {
  const { t } = useTranslation();
  const placeholder = `route_${new Date().toISOString().slice(0, 10)}`;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={modalStyles.backdrop}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onClose}
        />
        <View style={[modalStyles.card, { backgroundColor: c.bg, borderColor: c.border }]}>
          <Text style={[modalStyles.title, { color: c.text }]}>
            {t("route-map.export-gpx")}
          </Text>
          <Text style={[modalStyles.subtitle, { color: c.muted }]}>
            {t("route-map.export-gpx-subtitle")}
          </Text>

          <Text style={[modalStyles.label, { color: c.muted }]}>
            {t("route-map.export-gpx-filename-label")}
          </Text>
          <TextInput
            value={filename}
            onChangeText={onFilenameChange}
            placeholder={placeholder}
            placeholderTextColor={c.muted}
            maxLength={80}
            autoCapitalize="none"
            style={[
              modalStyles.input,
              { color: c.text, backgroundColor: c.surface, borderColor: c.border },
            ]}
          />

          <View style={modalStyles.actions}>
            <TouchableOpacity
              style={[modalStyles.btn, { borderColor: c.border }]}
              onPress={onClose}
            >
              <Text style={{ color: c.text, fontWeight: "600" }}>
                {t("common.cancel")}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[modalStyles.btn, { backgroundColor: c.tint, borderColor: c.tint }]}
              onPress={onConfirm}
            >
              <Text style={{ color: "#fff", fontWeight: "700" }}>
                {t("route-map.export-gpx-confirm")}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
