import { useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  StyleSheet,
  Platform,
  StatusBar,
  useColorScheme,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/context/auth-context";
import { useSocial, type SocialUser } from "@/hooks/use-social";
import { Colors } from "@/constants/theme";

const AVATAR_PLACEHOLDER = (name: string) =>
  `https://ui-avatars.com/api/?background=16A34A&color=fff&size=128&bold=true&name=${encodeURIComponent(name)}`;

export default function SearchUsersScreen() {
  const router = useRouter();
  const { authFetch } = useAuth();
  const scheme = useColorScheme() ?? "light";
  const isDark = scheme === "dark";
  const ts = Colors[scheme];

  const { searchUsers, sendFollow, unfollow, cancelRequest } =
    useSocial(authFetch);

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
          prev.map((u) =>
            u.id === user.id ? { ...u, followStatus: next } : u,
          ),
        );
      } else if (user.followStatus === "ACCEPTED") {
        await unfollow(user.id);
        setResults((prev) =>
          prev.map((u) =>
            u.id === user.id ? { ...u, followStatus: null } : u,
          ),
        );
      } else {
        await cancelRequest(user.id);
        setResults((prev) =>
          prev.map((u) =>
            u.id === user.id ? { ...u, followStatus: null } : u,
          ),
        );
      }
    } catch {
      // no-op — keep existing state on failure
    } finally {
      setActionLoading(null);
    }
  };

  const btnConfig = (status?: "PENDING" | "ACCEPTED" | null) => {
    if (status === "ACCEPTED")
      return {
        label: "Following",
        bg: ts.surface,
        color: ts.text,
        border: ts.border,
      };
    if (status === "PENDING")
      return {
        label: "Requested",
        bg: ts.surface,
        color: ts.muted,
        border: ts.border,
      };
    return { label: "Follow", bg: ts.tint, color: "#fff", border: ts.tint };
  };

  return (
    <View style={[styles.root, { backgroundColor: ts.bg }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />

      {/* Header */}
      <View
        style={[
          styles.header,
          {
            borderBottomColor: ts.border,
            paddingTop: Platform.OS === "ios" ? 56 : 40,
          },
        ]}
      >
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={8}
          style={styles.backBtn}
        >
          <Ionicons name="arrow-back" size={22} color={ts.text} />
        </TouchableOpacity>

        <View
          style={[
            styles.searchRow,
            { backgroundColor: ts.surface, borderColor: ts.border },
          ]}
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
            returnKeyType="search"
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
      </View>

      {/* Results */}
      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {query.trim().length < 2 && (
          <View style={styles.hint}>
            <Ionicons name="people-outline" size={40} color={ts.border} />
            <Text style={[styles.hintText, { color: ts.muted }]}>
              Search for people to follow
            </Text>
          </View>
        )}

        {query.trim().length >= 2 && !searching && results.length === 0 && (
          <View style={styles.hint}>
            <Ionicons name="search-outline" size={40} color={ts.border} />
            <Text style={[styles.hintText, { color: ts.muted }]}>
              No users found for "{query}"
            </Text>
          </View>
        )}

        {results.map((user) => {
          const btn = btnConfig(user.followStatus);
          const isLoading = actionLoading === user.id;
          return (
            <View
              key={user.id}
              style={[styles.userRow, { borderBottomColor: ts.border }]}
            >
              <TouchableOpacity
                style={styles.userMain}
                onPress={() =>
                  router.push({
                    pathname: "/user-profile",
                    params: { userId: user.id },
                  })
                }
                activeOpacity={0.7}
              >
                <Image
                  source={{
                    uri:
                      user.profilePicture || AVATAR_PLACEHOLDER(user.username),
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
              </TouchableOpacity>
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
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { padding: 4 },
  searchRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchInput: { flex: 1, fontSize: 15 },

  list: { flex: 1 },
  listContent: { paddingHorizontal: 20 },

  hint: {
    alignItems: "center",
    paddingTop: 80,
    gap: 12,
  },
  hintText: { fontSize: 14, textAlign: "center" },

  userRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  userMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    backgroundColor: "#D4D4D8",
  },
  userInfo: { flex: 1, gap: 2 },
  username: { fontSize: 15, fontWeight: "600" },
  privateBadge: { fontSize: 12 },

  followBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    minWidth: 86,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 32,
  },
  followBtnText: { fontSize: 13, fontWeight: "600" },
});
