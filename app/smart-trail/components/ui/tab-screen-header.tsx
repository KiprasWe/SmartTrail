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

/** Typography + spacing shared by Generate, Discover, and Profile top bars. */
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
  /** Trailing controls (e.g. map/list toggle, profile actions). */
  right?: ReactNode;
  /** Full-width block under the title row (e.g. Generate mode tabs). */
  footer?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

/**
 * Fixed top bar for main tabs: consistent padding, title weight, and bottom hairline.
 */
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
            !stacked && styles.titleFlex,
          ]}
          numberOfLines={1}
        >
          {title}
        </Text>
        {!stacked && right != null ? (
          <View style={styles.rightSlot}>{right}</View>
        ) : null}
      </View>
      {stacked && footer != null ? footer : null}
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

/** Square icon targets in tab headers (Discover map/list, Profile actions). */
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
