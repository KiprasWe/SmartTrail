import { useCallback, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  ActivityIndicator,
  Alert,
  useColorScheme,
} from "react-native";
import { modalStyles } from "@/components/route-map/modal-styles";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useProfileStore } from "@/store/use-profile-store";
import { useSavedRoutesStore } from "@/store/use-saved-routes-store";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { Colors } from "@/constants/theme";
import { t } from "@/lib/i18n";
import {
  formatDistanceMeters,
  formatDuration,
} from "@/lib/route-map-helpers";
import type { SavedRouteListItem } from "@/types/route";
import { RoutePreview } from "@/components/saved-routes/route-preview";
import {
  TabScreenHeader,
  mainTabHeaderIconHitStyle,
} from "@/components/ui/tab-screen-header";
import { TRANSPORT_OPTIONS } from "@/components/generate/route-form-components";
import { Avatar } from "@/components/ui/avatar";

// Older saved routes stored display labels instead of profile keys; map them
// back so we can still pick the right icon and translation.
const LEGACY_LABEL_TO_KEY: Record<string, string> = {
  Walking: "foot-walking",
  Hiking: "foot-hiking",
  Running: "running",
  Cycling: "cycling-regular",
};

export default function ProfileScreen() {
  const { profile, loading, error, fetchProfile } = useProfileStore();
  const scheme = useColorScheme() ?? "light";
  const isDark = scheme === "dark";
  const ts = Colors[scheme];
  const router = useRouter();

  const savedRoutes = useSavedRoutesStore((s) => s.routes);
  const savedRoutesLoading = useSavedRoutesStore((s) => s.loading);
  const bootstrapSavedRoutes = useSavedRoutesStore((s) => s.bootstrap);
  const refreshSavedRoutes = useSavedRoutesStore((s) => s.refresh);
  const removeRoute = useSavedRoutesStore((s) => s.remove);
  const updateRoute = useSavedRoutesStore((s) => s.update);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [editingRoute, setEditingRoute] = useState<SavedRouteListItem | null>(
    null,
  );
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  const handleEdit = useCallback((route: SavedRouteListItem) => {
    setEditingRoute(route);
    setEditTitle(route.title);
    setEditDescription(route.description ?? "");
  }, []);

  const handleEditSave = useCallback(async () => {
    if (!editingRoute || !editTitle.trim()) return;
    setEditSaving(true);
    try {
      await updateRoute(editingRoute.id, {
        title: editTitle.trim(),
        description: editDescription.trim() || undefined,
      });
      setEditingRoute(null);
    } catch {
      Alert.alert(t("common.error"), t("profile.edit-route-save-error"));
      } finally {
        setEditSaving(false);
      }
    }, [editingRoute, editTitle, editDescription, updateRoute]);

  const handleDelete = useCallback(
    (id: string, title: string) => {
      Alert.alert(
        t("profile.delete-route-title"),
        t("profile.delete-route-body", { title }),
        [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("common.delete"),
            style: "destructive",
            onPress: async () => {
              setDeletingId(id);
              try {
                await removeRoute(id);
              } catch {
                Alert.alert(t("common.error"), t("profile.delete-route-error"));
              } finally {
                setDeletingId(null);
              }
            },
          },
        ],
      );
    },
    [removeRoute],
  );

  useFocusEffect(
    useCallback(() => {
      fetchProfile();
      if (savedRoutes.length === 0) {
        bootstrapSavedRoutes();
      } else {
        refreshSavedRoutes().catch(() => {});
      }
    }, [
      fetchProfile,
      bootstrapSavedRoutes,
      refreshSavedRoutes,
      savedRoutes.length,
    ]),
  );

  if (loading && !profile) {
    return (
      <View style={[styles.root, { backgroundColor: ts.bg }]}>
        <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />
        <TabScreenHeader title={t("profile.profile-title")} />
        <View style={styles.centeredFill}>
          <ActivityIndicator color={ts.tint} />
        </View>
      </View>
    );
  }

  if (error && !profile) {
    return (
      <View style={[styles.root, { backgroundColor: ts.bg }]}>
        <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />
        <TabScreenHeader title={t("profile.profile-title")} />
        <View style={[styles.centeredFill, { gap: 12 }]}>
          <Text style={[styles.errorText, { color: ts.muted }]}>{error}</Text>
          <TouchableOpacity onPress={fetchProfile}>
            <Text style={[styles.retryText, { color: ts.tint }]}>
              {t("profile.try-again")}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: ts.bg }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />

      <TabScreenHeader
        title={t("profile.profile-title")}
        right={
          <View style={styles.headerBtns}>
            <TouchableOpacity
              onPress={() => router.push("/edit-profile")}
              style={[
                mainTabHeaderIconHitStyle.base,
                { backgroundColor: ts.surface, borderColor: ts.border },
              ]}
            >
              <Ionicons name="pencil-outline" size={16} color={ts.muted} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.push("/settings")}
              style={[
                mainTabHeaderIconHitStyle.base,
                { backgroundColor: ts.surface, borderColor: ts.border },
              ]}
            >
              <Ionicons name="settings-outline" size={16} color={ts.muted} />
            </TouchableOpacity>
          </View>
        }
      />

      <Modal
        visible={!!editingRoute}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!editSaving) setEditingRoute(null);
        }}
      >
        <KeyboardAvoidingView
          style={modalStyles.backdrop}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => {
              if (!editSaving) setEditingRoute(null);
            }}
          />
          <View
            style={[
              modalStyles.card,
              { backgroundColor: ts.bg, borderColor: ts.border },
            ]}
          >
            <Text style={[modalStyles.title, { color: ts.text }]}>
              {t("profile.edit-route-title")}
            </Text>

            <Text style={[modalStyles.label, { color: ts.muted }]}>
              {t("route-map.save-modal-title-label")}
            </Text>
            <TextInput
              value={editTitle}
              onChangeText={setEditTitle}
              placeholder={t("route-map.save-modal-title-placeholder")}
              placeholderTextColor={ts.muted}
              maxLength={100}
              style={[
                modalStyles.input,
                {
                  color: ts.text,
                  backgroundColor: ts.surface,
                  borderColor: ts.border,
                },
              ]}
            />

            <Text style={[modalStyles.label, { color: ts.muted }]}>
              {t("route-map.save-modal-description-label")}
            </Text>
            <TextInput
              value={editDescription}
              onChangeText={setEditDescription}
              placeholder={t("route-map.save-modal-description-placeholder")}
              placeholderTextColor={ts.muted}
              maxLength={500}
              multiline
              style={[
                modalStyles.input,
                modalStyles.inputMultiline,
                {
                  color: ts.text,
                  backgroundColor: ts.surface,
                  borderColor: ts.border,
                },
              ]}
            />

            <View style={modalStyles.actions}>
              <TouchableOpacity
                style={[modalStyles.btn, { borderColor: ts.border }]}
                onPress={() => setEditingRoute(null)}
                disabled={editSaving}
              >
                <Text style={{ color: ts.text, fontWeight: "600" }}>
                  {t("common.cancel")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  modalStyles.btn,
                  { backgroundColor: ts.tint, borderColor: ts.tint },
                ]}
                onPress={handleEditSave}
                disabled={editSaving || !editTitle.trim()}
              >
                {editSaving ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={{ color: "#fff", fontWeight: "700" }}>
                    {t("common.save")}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <ScrollView
        style={styles.scrollFlex}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        <View style={styles.profileSection}>
          <Avatar
            name={profile?.username ?? "User"}
            size={88}
            backgroundColor={ts.tint}
            borderColor={ts.border}
            style={styles.avatar}
          />
          <Text style={[styles.username, { color: ts.text }]}>
            {profile?.username ?? "—"}
          </Text>
          <Text style={[styles.email, { color: ts.muted }]}>
            {profile?.email}
          </Text>
          {profile?.bio ? (
            <Text style={[styles.bio, { color: ts.muted }]}>{profile.bio}</Text>
          ) : null}
        </View>

        <View style={styles.savedSection}>
          <Text style={[styles.sectionTitle, { color: ts.text }]}>
            {t("profile.saved-routes")}
          </Text>

          {savedRoutesLoading && savedRoutes.length === 0 ? (
            <View style={styles.savedEmpty}>
              <ActivityIndicator color={ts.tint} />
            </View>
          ) : savedRoutes.length === 0 ? (
            <View
              style={[
                styles.savedEmpty,
                { borderColor: ts.border, backgroundColor: ts.surface },
              ]}
            >
              <Ionicons name="bookmark-outline" size={28} color={ts.muted} />
              <Text style={[styles.savedEmptyText, { color: ts.muted }]}>
                {t("profile.no-saved-routes")}
              </Text>
              <Text style={[styles.savedEmptyHint, { color: ts.muted }]}>
                {t("profile.no-saved-routes-hint")}
              </Text>
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              {savedRoutes.map((r: SavedRouteListItem) => {
                const transportKey =
                  LEGACY_LABEL_TO_KEY[r.transport] ?? r.transport;
                const transportOption = TRANSPORT_OPTIONS.find(
                  (o) => o.key === transportKey,
                );
                const transportLabel = transportOption
                  ? t(transportOption.tKey)
                  : (r.transport ?? "");
                const isDeleting = deletingId === r.id;
                return (
                  <View
                    key={r.id}
                    style={[
                      styles.savedCard,
                      { backgroundColor: ts.surface, borderColor: ts.border },
                    ]}
                  >
                    <TouchableOpacity
                      activeOpacity={0.8}
                      onPress={() =>
                        router.push({
                          pathname: "/route-map",
                          params: { savedId: r.id },
                        })
                      }
                      style={styles.savedCardBody}
                    >
                      <RoutePreview
                        coords={r.thumbnail}
                        bbox={r.bbox}
                        width={64}
                        height={52}
                        color={ts.tint}
                        backgroundColor={ts.bg}
                      />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text
                          style={[styles.savedCardTitle, { color: ts.text }]}
                          numberOfLines={1}
                        >
                          {r.title}
                        </Text>
                        <View style={styles.savedCardMetaRow}>
                          {transportOption ? (
                            <MaterialCommunityIcons
                              name={transportOption.icon}
                              size={12}
                              color={ts.muted}
                            />
                          ) : (
                            <Ionicons
                              name="map-outline"
                              size={12}
                              color={ts.muted}
                            />
                          )}
                          <Text
                            style={[styles.savedCardMeta, { color: ts.muted }]}
                            numberOfLines={1}
                          >
                            {transportLabel}
                            {" · "}
                            {formatDistanceMeters(r.distance)} ·{" "}
                            {formatDuration(r.duration)}
                            {r.ascent != null ? ` · ↑${r.ascent} m` : ""}
                          </Text>
                        </View>
                      </View>
                      {r.isFavorite && (
                        <Ionicons name="star" size={16} color={ts.tint} />
                      )}
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={() => handleEdit(r)}
                      hitSlop={8}
                      style={styles.cardActionBtn}
                    >
                      <Ionicons
                        name="pencil-outline"
                        size={18}
                        color={ts.muted}
                      />
                    </TouchableOpacity>
                    <View
                      style={[
                        styles.cardDivider,
                        { backgroundColor: ts.border },
                      ]}
                    />
                    <TouchableOpacity
                      onPress={() => handleDelete(r.id, r.title)}
                      disabled={isDeleting}
                      hitSlop={8}
                      style={styles.cardActionBtn}
                    >
                      {isDeleting ? (
                        <ActivityIndicator size="small" color={ts.muted} />
                      ) : (
                        <Ionicons
                          name="trash-outline"
                          size={18}
                          color={ts.muted}
                        />
                      )}
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scrollFlex: { flex: 1 },
  scroll: { paddingBottom: 48 },
  centeredFill: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  errorText: { fontSize: 14 },
  retryText: { fontSize: 14, fontWeight: "600" },

  headerBtns: { flexDirection: "row", gap: 8 },

  profileSection: {
    alignItems: "center",
    paddingVertical: 24,
    paddingHorizontal: 24,
    gap: 4,
  },
  avatar: { marginBottom: 12 },
  username: { fontSize: 20, fontWeight: "700", letterSpacing: -0.2 },
  email: { fontSize: 14 },
  bio: { fontSize: 14, textAlign: "center", lineHeight: 20, marginTop: 4 },

  savedSection: {
    paddingHorizontal: 20,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  savedEmpty: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 32,
    paddingHorizontal: 24,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  savedEmptyText: { fontSize: 14, fontWeight: "600", marginTop: 4 },
  savedEmptyHint: { fontSize: 12, textAlign: "center" },
  savedCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  savedCardBody: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  cardActionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  cardDivider: {
    width: StyleSheet.hairlineWidth,
    height: 20,
  },
  savedCardTitle: { fontSize: 14, fontWeight: "700", letterSpacing: -0.1 },
  savedCardMeta: { fontSize: 12, flexShrink: 1 },
  savedCardMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 3,
  },
});
