import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Palette, Fonts } from "@/constants/theme";
import type { UserProfile } from "@/hooks/use-user-profile";

const AVATAR_PLACEHOLDER =
  "https://ui-avatars.com/api/?background=2D6A2F&color=F2EAD3&size=256&bold=true&name=";

interface ProfileHeroProps {
  user: UserProfile | null;
  isDark: boolean;
  onEditBio: () => void;
}

export function ProfileHero({ user, isDark, onEditBio }: ProfileHeroProps) {
  const avatarUri = user?.profilePicture
    ? user.profilePicture
    : `${AVATAR_PLACEHOLDER}${encodeURIComponent(user?.username ?? "U")}`;

  const joinedDate = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString("en-US", {
        month: "short",
        year: "numeric",
      })
    : null;

  return (
    <View style={styles.container}>
      {/* Green header */}
      <View style={[styles.header, isDark && styles.headerDark]}>
        {/* Subtle topo rings inside header */}
        {[160, 120, 85].map((size, i) => (
          <View
            key={i}
            style={{
              position: "absolute",
              top: -size * 0.6,
              right: -size * 0.6,
              width: size,
              height: size,
              borderRadius: size / 2,
              borderWidth: 1,
              borderColor: `rgba(242, 234, 211, ${0.06 + i * 0.03})`,
            }}
          />
        ))}

        <Text style={styles.headerLabel}>TRAIL RUNNER</Text>
      </View>

      {/* Avatar — overlaps header */}
      <View style={styles.avatarWrapper}>
        {/* Outer ring */}
        <View
          style={[styles.avatarRingOuter, isDark && styles.avatarRingOuterDark]}
        >
          {/* White gap ring */}
          <View
            style={[
              styles.avatarRingInner,
              isDark && styles.avatarRingInnerDark,
            ]}
          >
            <Image source={{ uri: avatarUri }} style={styles.avatar} />
          </View>
        </View>
      </View>

      {/* Info below avatar */}
      <View style={styles.info}>
        <Text style={[styles.username, isDark && styles.textDark]}>
          {user?.username ?? "—"}
        </Text>

        <View style={styles.emailRow}>
          <Ionicons
            name="mail-outline"
            size={12}
            color={isDark ? Palette.stoneMid : Palette.stoneDark}
          />
          <Text style={[styles.email, isDark && styles.mutedDark]}>
            {user?.email}
          </Text>
        </View>

        {joinedDate && (
          <View style={[styles.badge, isDark && styles.badgeDark]}>
            <Ionicons
              name="leaf-outline"
              size={10}
              color={isDark ? Palette.forestLight : Palette.forest}
            />
            <Text style={[styles.badgeText, isDark && styles.badgeTextDark]}>
              Since {joinedDate}
            </Text>
          </View>
        )}

        {user?.bio ? (
          <Text style={[styles.bio, isDark && styles.mutedDark]}>
            {user.bio}
          </Text>
        ) : (
          <TouchableOpacity
            onPress={onEditBio}
            style={[styles.addBio, isDark && styles.addBioDark]}
          >
            <Text style={[styles.addBioText, isDark && styles.addBioTextDark]}>
              + Add a bio
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: "#FFFFFF",
    shadowColor: "#1A1510",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
  header: {
    height: 88,
    backgroundColor: Palette.forest,
    justifyContent: "flex-end",
    paddingHorizontal: 20,
    paddingBottom: 12,
    overflow: "hidden",
  },
  headerDark: {
    backgroundColor: Palette.forestDark,
  },
  headerLabel: {
    color: "rgba(242, 234, 211, 0.45)",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 3,
  },
  avatarWrapper: {
    alignSelf: "center",
    marginTop: -38,
  },
  avatarRingOuter: {
    padding: 3,
    borderRadius: 46,
    backgroundColor: Palette.forest,
  },
  avatarRingOuterDark: {
    backgroundColor: Palette.forestLight,
  },
  avatarRingInner: {
    padding: 3,
    borderRadius: 44,
    backgroundColor: "#FFFFFF",
  },
  avatarRingInnerDark: {
    backgroundColor: "#262018",
  },
  avatar: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: Palette.stoneWarm,
  },
  info: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 24,
    gap: 6,
  },
  username: {
    fontSize: 22,
    fontWeight: "700",
    color: "#1A1510",
    fontFamily: Fonts.serif,
    letterSpacing: -0.3,
  },
  textDark: {
    color: Palette.parchment,
  },
  emailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  email: {
    fontSize: 13,
    color: Palette.stoneDark,
  },
  mutedDark: {
    color: "#9A8E7A",
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(45, 106, 47, 0.08)",
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    marginTop: 2,
  },
  badgeDark: {
    backgroundColor: "rgba(74, 140, 78, 0.15)",
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "600",
    color: Palette.forest,
  },
  badgeTextDark: {
    color: Palette.forestLight,
  },
  bio: {
    fontSize: 13,
    color: Palette.stoneDark,
    textAlign: "center",
    lineHeight: 19,
    marginTop: 4,
    paddingHorizontal: 8,
  },
  addBio: {
    marginTop: 4,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "rgba(45, 106, 47, 0.35)",
    backgroundColor: "rgba(45, 106, 47, 0.05)",
  },
  addBioDark: {
    borderColor: "rgba(74, 140, 78, 0.35)",
    backgroundColor: "rgba(74, 140, 78, 0.08)",
  },
  addBioText: {
    fontSize: 12,
    fontWeight: "500",
    color: Palette.forest,
  },
  addBioTextDark: {
    color: Palette.forestLight,
  },
});
