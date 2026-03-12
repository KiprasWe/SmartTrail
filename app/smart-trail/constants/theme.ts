import { Platform } from "react-native";

// ── Palette ───────────────────────────────────────────────────────
export const Palette = {
  forestDeep:  "#0C1A0C",
  forestDark:  "#1B2E1B",
  forest:      "#2D6A2F",
  forestMid:   "#3D7A40",
  forestLight: "#4A8C4E",
  sage:        "#7A9E7E",

  earthNight: "#0E0B07",
  earthDark:  "#1A1510",
  earth:      "#2A2018",

  parchment:  "#F2EAD3",
  cream:      "#F0EBE1",
  stoneWarm:  "#C4B99A",
  stoneMid:   "#8A7D6A",
  stoneDark:  "#6B5E50",
} as const;

// ── Interface tokens ──────────────────────────────────────────────
export const Colors = {
  light: {
    text:            "#1A1510",
    background:      Palette.cream,
    surface:         Palette.parchment,
    tint:            Palette.forest,
    icon:            Palette.stoneDark,
    tabIconDefault:  Palette.stoneMid,
    tabIconSelected: Palette.forest,
    card:            "#FFFFFF",
    border:          "#DDD5C8",
    muted:           Palette.stoneDark,
  },
  dark: {
    text:            Palette.parchment,
    background:      Palette.earthDark,
    surface:         Palette.earth,
    tint:            Palette.forestLight,
    icon:            Palette.stoneMid,
    tabIconDefault:  "#6B6560",
    tabIconSelected: Palette.forestLight,
    card:            "#262018",
    border:          "#3A3020",
    muted:           "#9A8E7A",
  },
} as const;

// ── Typography ────────────────────────────────────────────────────
export const Fonts = Platform.select({
  ios: {
    serif: "Georgia",
    mono:  "Courier New",
    sans:  "System",
  },
  default: {
    serif: "serif",
    mono:  "monospace",
    sans:  "normal",
  },
  web: {
    serif: "Georgia, 'Times New Roman', serif",
    mono:  "'Courier New', Courier, monospace",
    sans:  "system-ui, -apple-system, sans-serif",
  },
})!;
