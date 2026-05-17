import { View, Text, StyleSheet, type ViewStyle } from "react-native";

type Props = {
  
  name: string | null | undefined;
  size?: number;
  
  backgroundColor?: string;
  
  textColor?: string;
  
  borderColor?: string;
  style?: ViewStyle;
};

const DEFAULT_BG = "#16A34A";
const DEFAULT_FG = "#FFFFFF";

function initialsFor(name: string | null | undefined): string {
  if (!name) return "?";
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/).slice(0, 2);
  const letters = parts.map((p) => p[0]?.toUpperCase() ?? "").join("");
  return letters || trimmed[0]?.toUpperCase() || "?";
}

export function Avatar({
  name,
  size = 88,
  backgroundColor = DEFAULT_BG,
  textColor = DEFAULT_FG,
  borderColor,
  style,
}: Props) {
  const initials = initialsFor(name);
  return (
    <View
      style={[
        styles.root,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor,
          borderWidth: borderColor ? 1 : 0,
          borderColor,
        },
        style,
      ]}
    >
      <Text
        style={[
          styles.text,
          { color: textColor, fontSize: Math.round(size * 0.4) },
        ]}
        numberOfLines={1}
        allowFontScaling={false}
      >
        {initials}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  text: { fontWeight: "700", letterSpacing: -0.5 },
});
