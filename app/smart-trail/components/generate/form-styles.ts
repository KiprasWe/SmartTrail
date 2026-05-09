import { StyleSheet } from "react-native";

export const formStyles = StyleSheet.create({
  formSection: { gap: 20 },
  formGroup: { gap: 8 },

  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },

  locationDivider: { height: StyleSheet.hairlineWidth, marginLeft: 38 },
  locText: { flex: 1, fontSize: 15 },

  addStopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  addStopIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  addStopLabel: { fontSize: 14, fontWeight: "600" },

  subModeBar: {
    flexDirection: "row",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 3,
    gap: 3,
  },
  subModeTab: {
    flex: 1,
    paddingVertical: 9,
    alignItems: "center",
    borderRadius: 9,
  },
  subModeTabText: { fontSize: 13, fontWeight: "600" },

  aiPromptInput: {
    fontSize: 15,
    minHeight: 96,
    paddingVertical: 0,
  },
});
