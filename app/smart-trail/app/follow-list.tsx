// app/follow-list.tsx
import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  StatusBar,
  ActivityIndicator,
  Alert,
  useColorScheme,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { paramToString } from "@/lib/route-param";
import { useAuthStore } from "@/store/use-auth-store";
import { useSocial, type SocialUser } from "@/hooks/use-social";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { Colors } from "@/constants/theme";
import { useTranslation } from "@/hooks/use-translation";
import { ScreenHeader } from "@/components/ui/screen-header";

const AVATAR_PLACEHOLDER = (name: string) =>
  `https://ui-avatars.com/api/?background=16A34A&color=fff&size=128&bold=true&name=${encodeURIComponent(name)}`;

export default function FollowListScreen() {
  const raw = useLocalSearchParams<{
    type?: string | string[];
    userId?: string | string[];
  }>();
  const type =
    paramToString(raw.type) === "following" ? "following" : "followers";
  const userId = paramToString(raw.userId);
  const router = useRouter();
  const scheme = useColorScheme() ?? "light";
  const isDark = scheme === "dark";
  const ts = Colors[scheme];
  const { authFetch } = useAuthStore();
  const { getFollowers, getFollowing, unfollow, removeFollower } =
    useSocial(authFetch);
  const { t } = useTranslation();

  const [users, setUsers] = useState<SocialUser[]>([]);
  const [loading, setLoading] = useState(() => !!userId);
  const [error, setError] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadUsers = useCallback(() => {
    if (!userId) {
      setLoading(false);
      setError(true);
      return;
    }
    setLoading(true);
    setError(false);
    const fetchFn = type === "followers" ? getFollowers : getFollowing;
    fetchFn(userId)
      .then(setUsers)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [userId, type, getFollowers, getFollowing]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const handleAction = (user: SocialUser) => {
    const label = type === "followers" ? t("social.remove") : t("social.unfollow");
    const message =
      type === "followers"
        ? t("social.remove-follower-confirm", { username: user.username })
        : t("social.unfollow-confirm", { username: user.username });

    Alert.alert(label, message, [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: label,
        style: "destructive",
        onPress: async () => {
          setActionLoading(user.id);
          try {
            if (type === "followers") {
              await removeFollower(user.id);
            } else {
              await unfollow(user.id);
            }
            setUsers((prev) => prev.filter((u) => u.id !== user.id));
          } catch {
            // no-op
          } finally {
            setActionLoading(null);
          }
        },
      },
    ]);
  };

  const title = type === "followers" ? t("social.followers") : t("social.following");
  const emptyText =
    type === "followers" ? t("social.no-followers") : t("social.no-following");

  const countBadge = !loading && users.length > 0 ? (
    <View style={[styles.countBadge, { backgroundColor: ts.surface, borderColor: ts.border }]}>
      <Text style={[styles.countText, { color: ts.muted }]}>{users.length}</Text>
    </View>
  ) : undefined;

  return (
    <View style={[styles.root, { backgroundColor: ts.bg }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />

      <ScreenHeader title={title} onBack={() => router.back()} right={countBadge} />

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={ts.tint} />
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Text style={[styles.emptyText, { color: ts.muted }]}>{t("social.fail-load")}</Text>
          <TouchableOpacity onPress={loadUsers} style={{ marginTop: 8 }}>
            <Text style={{ color: ts.tint, fontWeight: "600" }}>{t("common.retry")}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.listContent}>
          {users.length === 0 ? (
            <View style={styles.emptyState}>
              <IconSymbol name="person.2.fill" size={32} color={ts.border} />
              <Text style={[styles.emptyText, { color: ts.muted }]}>
                {emptyText}
              </Text>
            </View>
          ) : (
            users.map((user) => (
              <View
                key={user.id}
                style={[styles.userRow, { borderBottomColor: ts.border }]}
              >
                <Image
                  source={{
                    uri: user.profilePicture || AVATAR_PLACEHOLDER(user.username),
                  }}
                  style={[styles.avatar, { borderColor: ts.border, backgroundColor: ts.surface }]}
                />
                <Text style={[styles.username, { color: ts.text, flex: 1 }]}>
                  @{user.username}
                </Text>
                <TouchableOpacity
                  style={[styles.actionBtn, { borderColor: ts.border }]}
                  onPress={() => handleAction(user)}
                  disabled={actionLoading === user.id}
                  activeOpacity={0.7}
                >
                  {actionLoading === user.id ? (
                    <ActivityIndicator size="small" color={ts.muted} />
                  ) : (
                    <Text style={[styles.actionBtnText, { color: ts.muted }]}>
                      {type === "followers" ? t("social.remove") : t("social.unfollow")}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            ))
          )}
          <View style={{ height: 24 }} />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  countBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 99,
    borderWidth: StyleSheet.hairlineWidth,
  },
  countText: { fontSize: 12, fontWeight: "600" },

  listContent: { paddingHorizontal: 20, paddingBottom: 48 },
  centered: { paddingVertical: 40, alignItems: "center" },
  emptyState: { alignItems: "center", gap: 10, paddingVertical: 36, paddingHorizontal: 20 },
  emptyText: { textAlign: "center", fontSize: 14 },

  userRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },
  username: { fontSize: 14, fontWeight: "600" },
  actionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 76,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 30,
  },
  actionBtnText: { fontSize: 13, fontWeight: "500" },
});
