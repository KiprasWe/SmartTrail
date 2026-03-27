import { useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Platform,
  ScrollView,
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AxiosRequestConfig, AxiosResponse } from "axios";
import { Colors } from "@/constants/theme";
import { useSocial, type SocialUser } from "@/hooks/use-social";

const AVATAR_PLACEHOLDER = (name: string) =>
  `https://ui-avatars.com/api/?background=16A34A&color=fff&size=128&bold=true&name=${encodeURIComponent(name)}`;

type AuthFetch = (input: string, config?: AxiosRequestConfig) => Promise<AxiosResponse>;

interface SearchUsersSheetProps {
  visible: boolean;
  onClose: () => void;
  onDone?: () => void;
  isDark: boolean;
  authFetch: AuthFetch;
}

export function SearchUsersSheet({
  visible,
  onClose,
  onDone,
  isDark,
  authFetch,
}: SearchUsersSheetProps) {
  const ts = Colors[isDark ? "dark" : "light"];
  const { searchUsers, sendFollow, unfollow, cancelRequest } = useSocial(authFetch);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SocialUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearch = useCallback(
    (text: string) => {
      setQuery(text);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (text.trim().length < 2) {
        setResults([]);
        return;
      }
      debounceRef.current = setTimeout(async () => {
        setSearching(true);
        try {
          const users = await searchUsers(text);
          setResults(users);
        } catch {
          setResults([]);
        } finally {
          setSearching(false);
        }
      }, 350);
    },
    [searchUsers],
  );

  const handleFollowToggle = async (user: SocialUser) => {
    setActionLoading(user.id);
    try {
      if (!user.followStatus) {
        const code = await sendFollow(user.id);
        const next = code === "NOW_FOLLOWING" ? "ACCEPTED" : "PENDING";
        setResults((prev) =>
          prev.map((u) => (u.id === user.id ? { ...u, followStatus: next } : u)),
        );
      } else if (user.followStatus === "ACCEPTED") {
        await unfollow(user.id);
        setResults((prev) =>
          prev.map((u) => (u.id === user.id ? { ...u, followStatus: null } : u)),
        );
      } else {
        await cancelRequest(user.id);
        setResults((prev) =>
          prev.map((u) => (u.id === user.id ? { ...u, followStatus: null } : u)),
        );
      }
    } catch {
      // no-op — keep existing state
    } finally {
      setActionLoading(null);
    }
  };

  const handleClose = () => {
    setQuery("");
    setResults([]);
    onDone?.();
    onClose();
  };

  const btnConfig = (status?: "PENDING" | "ACCEPTED" | null) => {
    if (status === "ACCEPTED")
      return { label: "Following", bg: ts.surface, color: ts.text, border: ts.border };
    if (status === "PENDING")
      return { label: "Requested", bg: ts.surface, color: ts.muted, border: ts.border };
    return { label: "Follow", bg: ts.tint, color: "#fff", border: ts.tint };
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.flex}
      >
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
            <Text style={[styles.title, { color: ts.text }]}>Find People</Text>
            <TouchableOpacity
              onPress={handleClose}
              style={[styles.closeBtn, { backgroundColor: ts.bg, borderColor: ts.border }]}
            >
              <Ionicons name="close" size={16} color={ts.muted} />
            </TouchableOpacity>
          </View>

          <View
            style={[styles.searchRow, { backgroundColor: ts.bg, borderColor: ts.border }]}
          >
            <Ionicons name="search-outline" size={16} color={ts.muted} />
            <TextInput
              style={[styles.searchInput, { color: ts.text }]}
              placeholder="Search by username…"
              placeholderTextColor={ts.muted}
              value={query}
              onChangeText={handleSearch}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
            />
            {searching && <ActivityIndicator size="small" color={ts.muted} />}
            {!!query && !searching && (
              <TouchableOpacity
                onPress={() => {
                  setQuery("");
                  setResults([]);
                }}
                hitSlop={8}
              >
                <Ionicons name="close-circle" size={16} color={ts.muted} />
              </TouchableOpacity>
            )}
          </View>

          <ScrollView
            style={styles.list}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {query.trim().length >= 2 && !searching && results.length === 0 && (
              <Text style={[styles.emptyText, { color: ts.muted }]}>No users found</Text>
            )}
            {results.map((user) => {
              const btn = btnConfig(user.followStatus);
              const isLoading = actionLoading === user.id;
              return (
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
                  <View style={styles.userInfo}>
                    <Text style={[styles.username, { color: ts.text }]}>
                      {user.username}
                    </Text>
                    {!user.isPublic && (
                      <Text style={[styles.privateBadge, { color: ts.muted }]}>
                        Private
                      </Text>
                    )}
                  </View>
                  <TouchableOpacity
                    style={[
                      styles.followBtn,
                      { backgroundColor: btn.bg, borderColor: btn.border },
                    ]}
                    onPress={() => handleFollowToggle(user)}
                    disabled={isLoading}
                    activeOpacity={0.7}
                  >
                    {isLoading ? (
                      <ActivityIndicator size="small" color={ts.muted} />
                    ) : (
                      <Text style={[styles.followBtnText, { color: btn.color }]}>
                        {btn.label}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              );
            })}
            <View style={{ height: 24 }} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
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
    maxHeight: "85%",
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
  closeBtn: { padding: 8, borderRadius: 10, borderWidth: 1 },

  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  searchInput: { flex: 1, fontSize: 15 },

  list: { flex: 1 },
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
  userInfo: { flex: 1, gap: 2 },
  username: { fontSize: 14, fontWeight: "600" },
  privateBadge: { fontSize: 12 },

  followBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    minWidth: 82,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 32,
  },
  followBtnText: { fontSize: 13, fontWeight: "600" },
});
