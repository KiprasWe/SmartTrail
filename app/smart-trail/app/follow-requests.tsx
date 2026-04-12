// app/follow-requests.tsx
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
  useColorScheme,
} from "react-native";
import { useRouter } from "expo-router";
import { useAuthStore } from "@/store/use-auth-store";
import { useSocial, type FollowRequest } from "@/hooks/use-social";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { Colors } from "@/constants/theme";
import { useTranslation } from "@/hooks/use-translation";
import { ScreenHeader } from "@/components/ui/screen-header";

const AVATAR_PLACEHOLDER = (name: string) =>
  `https://ui-avatars.com/api/?background=16A34A&color=fff&size=128&bold=true&name=${encodeURIComponent(name)}`;

export default function FollowRequestsScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? "light";
  const isDark = scheme === "dark";
  const ts = Colors[scheme];
  const { authFetch } = useAuthStore();
  const { getFollowRequests, acceptRequest, rejectRequest } =
    useSocial(authFetch);
  const { t } = useTranslation();

  const [requests, setRequests] = useState<FollowRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadRequests = useCallback(() => {
    setLoading(true);
    setError(false);
    getFollowRequests()
      .then(setRequests)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [getFollowRequests]);

  useEffect(() => { loadRequests(); }, [loadRequests]);

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

  const countBadge = !loading && requests.length > 0 ? (
    <View style={[styles.countBadge, { backgroundColor: ts.surface, borderColor: ts.border }]}>
      <Text style={[styles.countText, { color: ts.muted }]}>{requests.length}</Text>
    </View>
  ) : undefined;

  return (
    <View style={[styles.root, { backgroundColor: ts.bg }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />

      <ScreenHeader
        title={t("social.follow-requests-title")}
        onBack={() => router.back()}
        right={countBadge}
      />

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={ts.tint} />
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Text style={[styles.emptyText, { color: ts.muted }]}>{t("social.fail-load")}</Text>
          <TouchableOpacity onPress={loadRequests} style={{ marginTop: 8 }}>
            <Text style={{ color: ts.tint, fontWeight: "600" }}>{t("common.retry")}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.listContent}>
          {requests.length === 0 ? (
            <View style={styles.emptyState}>
              <IconSymbol name="person.badge.plus" size={32} color={ts.border} />
              <Text style={[styles.emptyText, { color: ts.muted }]}>
                {t("social.no-requests")}
              </Text>
            </View>
          ) : (
            requests.map((req) => {
              const acting =
                actionLoading === req.id ||
                actionLoading === req.id + "_reject";
              return (
                <View
                  key={req.id}
                  style={[styles.userRow, { borderBottomColor: ts.border }]}
                >
                  <Image
                    source={{
                      uri: req.profilePicture || AVATAR_PLACEHOLDER(req.username),
                    }}
                    style={[styles.avatar, { borderColor: ts.border, backgroundColor: ts.surface }]}
                  />
                  <Text style={[styles.username, { color: ts.text, flex: 1 }]}>
                    @{req.username}
                  </Text>
                  {acting ? (
                    <ActivityIndicator size="small" color={ts.muted} />
                  ) : (
                    <View style={styles.actions}>
                      <TouchableOpacity
                        style={[styles.acceptBtn, { backgroundColor: ts.tint }]}
                        onPress={() => handleAccept(req)}
                        activeOpacity={0.75}
                      >
                        <IconSymbol name="checkmark" size={13} color="#fff" />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.rejectBtn, { borderColor: ts.border, backgroundColor: ts.bg }]}
                        onPress={() => handleReject(req)}
                        activeOpacity={0.75}
                      >
                        <IconSymbol name="xmark" size={13} color={ts.muted} />
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

  actions: { flexDirection: "row", gap: 8 },
  acceptBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  rejectBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
});
