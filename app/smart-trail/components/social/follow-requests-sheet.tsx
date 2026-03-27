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
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AxiosRequestConfig, AxiosResponse } from "axios";
import { Colors } from "@/constants/theme";
import { useSocial, type FollowRequest } from "@/hooks/use-social";

const AVATAR_PLACEHOLDER = (name: string) =>
  `https://ui-avatars.com/api/?background=16A34A&color=fff&size=128&bold=true&name=${encodeURIComponent(name)}`;

type AuthFetch = (input: string, config?: AxiosRequestConfig) => Promise<AxiosResponse>;

interface FollowRequestsSheetProps {
  visible: boolean;
  onClose: () => void;
  onDone?: () => void;
  isDark: boolean;
  authFetch: AuthFetch;
}

export function FollowRequestsSheet({
  visible,
  onClose,
  onDone,
  isDark,
  authFetch,
}: FollowRequestsSheetProps) {
  const ts = Colors[isDark ? "dark" : "light"];
  const { getFollowRequests, acceptRequest, rejectRequest } = useSocial(authFetch);

  const [requests, setRequests] = useState<FollowRequest[]>([]);
  const [loading, setLoading] = useState(false);
  // tracks which userId is being acted on, with suffix "_reject" for reject
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    getFollowRequests()
      .then(setRequests)
      .catch(() => setRequests([]))
      .finally(() => setLoading(false));
  }, [visible]);

  const handleAccept = async (req: FollowRequest) => {
    setActionLoading(req.id);
    try {
      await acceptRequest(req.id);
      setRequests((prev) => prev.filter((r) => r.id !== req.id));
    } catch {
      // no-op
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (req: FollowRequest) => {
    setActionLoading(req.id + "_reject");
    try {
      await rejectRequest(req.id);
      setRequests((prev) => prev.filter((r) => r.id !== req.id));
    } catch {
      // no-op
    } finally {
      setActionLoading(null);
    }
  };

  const handleClose = () => {
    onDone?.();
    onClose();
  };

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
              Follow Requests
              {!loading && (
                <Text style={[styles.count, { color: ts.muted }]}>
                  {"  "}
                  {requests.length}
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
              {requests.length === 0 ? (
                <Text style={[styles.emptyText, { color: ts.muted }]}>
                  No pending requests
                </Text>
              ) : (
                requests.map((req) => {
                  const acting = actionLoading === req.id || actionLoading === req.id + "_reject";
                  return (
                    <View
                      key={req.id}
                      style={[styles.userRow, { borderBottomColor: ts.border }]}
                    >
                      <Image
                        source={{
                          uri: req.profilePicture || AVATAR_PLACEHOLDER(req.username),
                        }}
                        style={[styles.avatar, { borderColor: ts.border }]}
                      />
                      <Text style={[styles.username, { color: ts.text, flex: 1 }]}>
                        {req.username}
                      </Text>
                      {acting ? (
                        <ActivityIndicator size="small" color={ts.muted} />
                      ) : (
                        <View style={styles.actions}>
                          <TouchableOpacity
                            style={[styles.acceptBtn, { backgroundColor: ts.tint }]}
                            onPress={() => handleAccept(req)}
                            activeOpacity={0.7}
                          >
                            <Text style={styles.acceptText}>Accept</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.rejectBtn, { borderColor: ts.border }]}
                            onPress={() => handleReject(req)}
                            activeOpacity={0.7}
                          >
                            <Text style={[styles.rejectText, { color: ts.muted }]}>
                              Reject
                            </Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  );
                })
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

  actions: { flexDirection: "row", gap: 8 },
  acceptBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  acceptText: { fontSize: 13, fontWeight: "600", color: "#fff" },
  rejectBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  rejectText: { fontSize: 13, fontWeight: "500" },
});
