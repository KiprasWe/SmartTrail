import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Palette } from "@/constants/theme";

interface AccountCardProps {
  email: string;
  username: string;
  joinedDate: string | null;
  isDark: boolean;
}

export function AccountCard({
  email,
  username,
  joinedDate,
  isDark,
}: AccountCardProps) {
  const card = isDark ? "#262018" : "#FFFFFF";
  const text = isDark ? Palette.parchment : "#1A1510";
  const muted = isDark ? "#9A8E7A" : Palette.stoneDark;
  const border = isDark ? "#3A3020" : "#EDE8DF";
  const subtleBg = isDark ? "#2A2018" : Palette.parchment;

  return (
    <View
      style={[styles.container, { backgroundColor: card, borderColor: border }]}
    >
      <Text style={[styles.sectionLabel, { color: muted }]}>Account</Text>

      <Row
        icon="mail-outline"
        label="Email"
        value={email}
        text={text}
        muted={muted}
        subtleBg={subtleBg}
        border={border}
      />
      <Row
        icon="at-outline"
        label="Username"
        value={`@${username}`}
        text={text}
        muted={muted}
        subtleBg={subtleBg}
        border={border}
        divider
      />
      {joinedDate && (
        <Row
          icon="calendar-outline"
          label="Member since"
          value={joinedDate}
          text={text}
          muted={muted}
          subtleBg={subtleBg}
          border={border}
          divider
        />
      )}
    </View>
  );
}

function Row({
  icon,
  label,
  value,
  text,
  muted,
  subtleBg,
  border,
  divider,
}: {
  icon: string;
  label: string;
  value: string;
  text: string;
  muted: string;
  subtleBg: string;
  border: string;
  divider?: boolean;
}) {
  return (
    <>
      {divider && (
        <View style={[styles.divider, { backgroundColor: border }]} />
      )}
      <View style={styles.row}>
        {/* Left accent + icon */}
        <View style={[styles.iconBox, { backgroundColor: subtleBg }]}>
          <Ionicons name={icon as any} size={15} color={muted} />
        </View>

        <View style={styles.rowContent}>
          <Text style={[styles.rowLabel, { color: muted }]}>{label}</Text>
          <Text style={[styles.rowValue, { color: text }]} numberOfLines={1}>
            {value}
          </Text>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: 20,
    borderWidth: 1,
    overflow: "hidden",
    shadowColor: "#1A1510",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 2,
    textTransform: "uppercase",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 2,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 13,
    gap: 14,
  },
  iconBox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  rowContent: {
    flex: 1,
  },
  rowLabel: {
    fontSize: 10,
    fontWeight: "500",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  rowValue: {
    fontSize: 14,
    fontWeight: "600",
    marginTop: 2,
  },
  divider: {
    height: 1,
    marginHorizontal: 16,
    opacity: 0.5,
  },
});
