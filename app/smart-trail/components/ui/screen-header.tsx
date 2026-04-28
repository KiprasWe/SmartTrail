import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  useColorScheme,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/theme";
import type { ReactNode } from "react";

export type ScreenHeaderProps = {
  title?: string;
  children?: ReactNode;
  onBack?: () => void;
  backDisabled?: boolean;
  right?: ReactNode;
};

export function ScreenHeader({
  title,
  children,
  onBack,
  backDisabled,
  right,
}: ScreenHeaderProps) {
  const scheme = useColorScheme() ?? "light";
  const ts = Colors[scheme];
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.header,
        {
          borderBottomColor: ts.border,
          backgroundColor: ts.bg,
          paddingTop: insets.top + 12,
        },
      ]}
    >
      <TouchableOpacity
        onPress={onBack}
        disabled={!onBack || backDisabled}
        style={[
          styles.backBtn,
          { backgroundColor: ts.surface, borderColor: ts.border },
        ]}
        hitSlop={8}
      >
        <Ionicons name="chevron-back" size={16} color={ts.text} />
      </TouchableOpacity>

      <View style={styles.center}>
        {children != null ? (
          children
        ) : title != null ? (
          <Text style={[styles.title, { color: ts.text }]} numberOfLines={1}>
            {title}
          </Text>
        ) : null}
      </View>

      {right != null ? (
        <View style={styles.rightSlot}>{right}</View>
      ) : (
        <View style={styles.backBtnMirror} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  center: {
    flex: 1,
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  rightSlot: {
    alignItems: "flex-end",
  },
  backBtnMirror: {
    width: 36,
  },
});
