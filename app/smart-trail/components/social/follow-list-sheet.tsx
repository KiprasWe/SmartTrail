import { useState, useEffect } from "react";
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ScrollView,
  ActivityIndicator,
  Image,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AxiosRequestConfig, AxiosResponse } from "axios";
import { Colors } from "@/constants/theme";
import { useSocial, type SocialUser } from "@/hooks/use-social";

const AVATAR_PLACEHOLDER = (name: string) =>
  `https://ui-avatars.com/api/?background=16A34A&color=fff&size=128&bold=true&name=${encodeURIComponent(name)}`;

type AuthFetch = (input: string, config?: AxiosRequestConfig) => Promise<AxiosResponse>;

interface FollowListSheetProps {
  visible: boolean;
  type: "followers" | "following";
  userId: string;
  onClose: () => void;
  onDone?: () => void;
  isDark: boolean;
  authFetch: AuthFetch;
}

export function FollowListSheet({
  visible,
  type,
  userId,
  onClose,
  onDone,
  isDark,
  authFetch,
}: FollowListSheetProps) {
  const ts = Colors[isDark ? "dark" : "light"];
  const { getFollowers, getFollowing, unfollow, removeFollower } = useSocial(authFetch);

  const [users, setUsers] = useState<SocialUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !userId) return;
    setLoading(true);
    const fetch = type === "followers" ? getFollowers : getFollowing;
    fetch(userId)
      .then(setUsers)
      .catch(() => setUsers([]))
      .finally(() => setLoading(false));
  }, [visible, userId, type]);

  const handleAction = (user: SocialUser) => {
    const label = type === "followers" ? "Remove" : "Unfollow";
    const message =
      type === "followers"
        ? `Remove @${user.username} from your followers?`
        : `Unfollow @${user.username}?`;

    Alert.alert(label, message, [
      { text: "Cancel", style: "cancel" },
      {
        text: label,
        style: "destructive",
        onPress: async () => {
          setActionLoading(user.id);
          try {
            type === "followers"
              ? await removeFollower(user.id)
              : await unfollow(user.id);
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

  const handleClose = () => {
    onDone?.();
    onClose();
  };

  const title = type === "followers" ? "Followers" : "Following";
  const emptyText =
    type === "followers" ? "No followers yet" : "Not following anyone";

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <View style={styles.flex}>
        <TouchableOpacity
          activeOpacity={1}
          onPress={handleClose}
          style={styles.backdrop}
        />
        <View
          style={[
            styles.sheet,
            { backgroundColor: isDark ? Colors.dark.surface : Colors.light.surface },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: ts.border }]} />

          <View style={styles.header}>
            <Text style={[styles.title, { color: ts.text }]}>
              {title}
              {!loading && (
                <Text style={[styles.count, { color: ts.muted }]}>
                  {"  "}
                  {users.length}
                </Text>
              )}
            </Text>
            <TouchableOpacity
              onPress={handleClose}
              style={[styles.closeBtn, { backgroundColor: ts.bg, borderColor: ts.border }]}
            >
              <Ionicons name="close" size={16} color={ts.muted} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.centered}>
              <ActivityIndicator color={ts.tint} />
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              {users.length === 0 ? (
                <Text style={[styles.emptyText, { color: ts.muted }]}>{emptyText}</Text>
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
                      style={[styles.avatar, { borderColor: ts.border }]}
                    />
                    <Text style={[styles.username, { color: ts.text, flex: 1 }]}>
                      {user.username}
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
                          {type === "followers" ? "Remove" : "Unfollow"}
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
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, justifyContent: "flex-end" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === "ios" ? 44 : 28,
    maxHeight: "80%",
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 20,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  title: { fontSize: 18, fontWeight: "700" },
  count: { fontSize: 16, fontWeight: "400" },
  closeBtn: { padding: 8, borderRadius: 10, borderWidth: 1 },

  centered: { paddingVertical: 40, alignItems: "center" },
  emptyText: {
    textAlign: "center",
    fontSize: 14,
    paddingVertical: 32,
  },

  userRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    backgroundColor: "#D4D4D8",
  },
  username: { fontSize: 14, fontWeight: "600" },

  actionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    minWidth: 72,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 30,
  },
  actionBtnText: { fontSize: 13, fontWeight: "500" },
});
