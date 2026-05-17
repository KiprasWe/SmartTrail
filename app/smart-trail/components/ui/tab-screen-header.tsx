import {
  View,
  Text,
  StyleSheet,
  useColorScheme,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ReactNode } from "react";
import { Colors } from "@/constants/theme";

export const mainTabScreenTitleStyle = {
  fontSize: 24,
  fontWeight: "700" as const,
  letterSpacing: -0.4,
};

export const mainTabHeaderHorizontalPadding = 20;
export const mainTabHeaderTopInsetExtra = 12;
export const mainTabHeaderBottomPadding = 12;

export type TabScreenHeaderProps = {
  title: string;
  
  right?: ReactNode;
  
  footer?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function TabScreenHeader({
  title,
  right,
  footer,
  style,
}: TabScreenHeaderProps) {
  const scheme = useColorScheme() ?? "light";
  const ts = Colors[scheme];
  const insets = useSafeAreaInsets();
  const stacked = footer != null;

  return (
    <View
      style={[
        styles.wrap,
        {
          paddingTop: insets.top + mainTabHeaderTopInsetExtra,
          paddingHorizontal: mainTabHeaderHorizontalPadding,
          paddingBottom: mainTabHeaderBottomPadding,
          borderBottomColor: ts.border,
          backgroundColor: ts.bg,
        },
        style,
      ]}
    >
      <View style={[styles.titleRow, stacked && styles.titleRowStacked]}>
        <Text
          style={[
            mainTabScreenTitleStyle,
            { color: ts.text },
            styles.titleFlex,
          ]}
          numberOfLines={1}
        >
          {title}
        </Text>
        {right != null ? <View style={styles.rightSlot}>{right}</View> : null}
      </View>
      {footer ?? null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  titleRowStacked: {
    marginBottom: 12,
  },
  titleFlex: {
    flex: 1,
    minWidth: 0,
  },
  rightSlot: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
  },
});

export const mainTabHeaderIconHitStyle = StyleSheet.create({
  base: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
});
