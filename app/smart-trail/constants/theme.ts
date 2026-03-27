import { Platform } from "react-native";

export const Colors = {
  light: {
    bg: "#FFFFFF",
    surface: "#F4F4F5",
    text: "#09090B",
    muted: "#71717A",
    tint: "#16A34A",
    border: "#E4E4E7",
    danger: "#DC2626",
    // tab bar compat
    background: "#FFFFFF",
    icon: "#71717A",
    tabIconDefault: "#71717A",
    tabIconSelected: "#16A34A",
  },
  dark: {
    bg: "#09090B",
    surface: "#18181B",
    text: "#FAFAFA",
    muted: "#A1A1AA",
    tint: "#4ADE80",
    border: "#27272A",
    danger: "#F87171",
    // tab bar compat
    background: "#09090B",
    icon: "#A1A1AA",
    tabIconDefault: "#A1A1AA",
    tabIconSelected: "#4ADE80",
  },
};

export const Fonts = Platform.select({
  ios: {
    sans: "system-ui",
    serif: "ui-serif",
    mono: "ui-monospace",
  },
  default: {
    sans: "normal",
    serif: "serif",
    mono: "monospace",
  },
});
