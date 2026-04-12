import { useRef, useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  Image,
  ActivityIndicator,
  StyleSheet,
  StatusBar,
  useColorScheme,
  Keyboard,
  Platform,
} from "react-native";
import { useRouter, type Href } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "@/store/use-auth-store";
import { useSocial, type SocialUser } from "@/hooks/use-social";
import { Colors } from "@/constants/theme";
import { useTranslation } from "@/hooks/use-translation";
import { ScreenHeader } from "@/components/ui/screen-header";

const AVATAR_PLACEHOLDER = (name: string) =>
  `https://ui-avatars.com/api/?background=16A34A&color=fff&size=128&bold=true&name=${encodeURIComponent(name)}`;

const SEARCH_DEBOUNCE_MS = 320;

export default function SearchUsersScreen() {
  const router = useRouter();
  const { authFetch } = useAuthStore();
  const scheme = useColorScheme() ?? "light";
  const isDark = scheme === "dark";
  const ts = Colors[scheme];

  const { searchUsers, sendFollow, unfollow, cancelRequest } = useSocial(authFetch);
  const { t } = useTranslation();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SocialUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const searchGenerationRef = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();

    if (trimmed.length < 2) {
      searchGenerationRef.current += 1;
      setResults([]);
      setSearching(false);
      setSearchError(false);
      return;
    }

    const scheduledAt = ++searchGenerationRef.current;
    const timer = setTimeout(async () => {
      setSearching(true);
      setSearchError(false);
      try {
        const users = await searchUsers(trimmed);
        if (searchGenerationRef.current === scheduledAt) setResults(users);
      } catch {
        if (searchGenerationRef.current === scheduledAt) {
          setResults([]);
          setSearchError(true);
        }
      } finally {
        if (searchGenerationRef.current === scheduledAt) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      searchGenerationRef.current += 1;
    };
  }, [query, searchUsers]);

  const clearSearch = useCallback(() => {
    searchGenerationRef.current += 1;
    setQuery("");
    setResults([]);
    setSearching(false);
    setSearchError(false);
  }, []);

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
      // keep existing state on failure
    } finally {
      setActionLoading(null);
    }
  };

  const btnConfig = (status?: "PENDING" | "ACCEPTED" | null) => {
    if (status === "ACCEPTED")
      return { label: t("social.following-btn"), bg: ts.surface, color: ts.text, border: ts.border };
    if (status === "PENDING")
      return { label: t("social.requested"), bg: ts.surface, color: ts.muted, border: ts.border };
    return { label: t("social.follow"), bg: ts.tint, color: "#fff", border: ts.tint };
  };

  const trimmedQuery = query.trim();
  const showSpinner = trimmedQuery.length >= 2 && searching;
  const showClear = query.length > 0 && !searching;

  // Determine which empty state to show (null = show results or loading)
  const emptyState: "idle" | "error" | "no-results" | null =
    trimmedQuery.length < 2
      ? "idle"
      : !searching && searchError
        ? "error"
        : !searching && !searchError && results.length === 0
          ? "no-results"
          : null;

  return (
    <View style={[styles.root, { backgroundColor: ts.bg }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />

      <ScreenHeader
        onBack={() => router.back()}
        right={<View style={styles.headerRightSpacer} />}
      >
        <View
          style={[
            styles.searchBar,
            { backgroundColor: ts.surface, borderColor: ts.border },
          ]}
        >
          <Ionicons name="search-outline" size={16} color={ts.muted} />
          <TextInput
            style={[styles.searchInput, { color: ts.text }]}
            placeholder={t("social.search-placeholder")}
            placeholderTextColor={ts.muted}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            returnKeyType="search"
            underlineColorAndroid="transparent"
          />
          <View style={styles.trailingSlot}>
            {showSpinner ? (
              <ActivityIndicator size="small" color={ts.muted} />
            ) : showClear ? (
              <TouchableOpacity onPress={clearSearch} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={ts.muted} />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </ScreenHeader>

      {/* Empty / hint states */}
      {emptyState === "idle" && (
        <View style={styles.emptyState}>
          <View
            style={[
              styles.emptyIconWrap,
              { backgroundColor: ts.surface, borderColor: ts.border },
            ]}
          >
            <Ionicons name="people-outline" size={28} color={ts.muted} />
          </View>
          <Text style={[styles.emptyTitle, { color: ts.text }]}>
            {t("social.find-people")}
          </Text>
          <Text style={[styles.emptySubtitle, { color: ts.muted }]}>
            {t("social.search-hint")}
          </Text>
        </View>
      )}

      {emptyState === "error" && (
        <View style={styles.emptyState}>
          <View
            style={[
              styles.emptyIconWrap,
              { backgroundColor: ts.surface, borderColor: ts.border },
            ]}
          >
            <Ionicons name="alert-circle-outline" size={28} color={ts.muted} />
          </View>
          <Text style={[styles.emptyTitle, { color: ts.text }]}>
            {t("social.search-failed")}
          </Text>
        </View>
      )}

      {emptyState === "no-results" && (
        <View style={styles.emptyState}>
          <View
            style={[
              styles.emptyIconWrap,
              { backgroundColor: ts.surface, borderColor: ts.border },
            ]}
          >
            <Ionicons name="search-outline" size={28} color={ts.muted} />
          </View>
          <Text style={[styles.emptyTitle, { color: ts.text }]}>
            {t("social.no-results-for", { query: trimmedQuery })}
          </Text>
        </View>
      )}

      {/* Results */}
      {emptyState === null && (
        <FlatList
          data={results}
          keyExtractor={(u) => u.id}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => (
            <View style={[styles.separator, { backgroundColor: ts.border }]} />
          )}
          renderItem={({ item: user }) => {
            const btn = btnConfig(user.followStatus);
            const isLoading = actionLoading === user.id;
            return (
              <TouchableOpacity
                style={styles.userRow}
                onPress={() => {
                  Keyboard.dismiss();
                  router.push({
                    pathname: "/user-profile",
                    params: { userId: String(user.id) },
                  } as Href);
                }}
                activeOpacity={0.7}
              >
                <Image
                  source={{
                    uri: user.profilePicture || AVATAR_PLACEHOLDER(user.username),
                  }}
                  style={[
                    styles.avatar,
                    { borderColor: ts.border, backgroundColor: ts.surface },
                  ]}
                />
                <View style={styles.userInfo}>
                  <Text
                    style={[styles.username, { color: ts.text }]}
                    numberOfLines={1}
                  >
                    {user.username}
                  </Text>
                  {!user.isPublic && (
                    <View style={styles.privatePill}>
                      <Ionicons name="lock-closed" size={10} color={ts.muted} />
                      <Text style={[styles.privateText, { color: ts.muted }]}>
                        {t("social.private")}
                      </Text>
                    </View>
                  )}
                </View>
                <TouchableOpacity
                  style={[
                    styles.followBtn,
                    { backgroundColor: btn.bg, borderColor: btn.border },
                  ]}
                  onPress={(e) => {
                    e.stopPropagation();
                    handleFollowToggle(user);
                  }}
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
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  headerRightSpacer: { width: 36 },

  searchBar: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 38,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 0,
    margin: 0,
  },
  trailingSlot: {
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
  },

  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    paddingBottom: 60,
    gap: 12,
  },
  emptyIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: "600",
    textAlign: "center",
    letterSpacing: -0.1,
  },
  emptySubtitle: { fontSize: 13, textAlign: "center", lineHeight: 19 },

  listContent: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 48 },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 68 },

  userRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    gap: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
  },
  userInfo: { flex: 1, gap: 3, minWidth: 0 },
  username: { fontSize: 15, fontWeight: "600", letterSpacing: -0.1 },
  privatePill: { flexDirection: "row", alignItems: "center", gap: 4 },
  privateText: { fontSize: 12 },

  followBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    minWidth: 88,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 32,
  },
  followBtnText: { fontSize: 13, fontWeight: "600" },
});
