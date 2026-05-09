import { useEffect, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Modal,
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  ActivityIndicator,
  useColorScheme,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { Colors } from "@/constants/theme";
import {
  useLocationSearch,
  PhotonFeature,
  ResolvedLocation,
} from "@/hooks/use-location-search";
import i18n, { t } from "@/lib/i18n";

const PHOTON_SUPPORTED = new Set(["de", "en", "fr", "it"]);
function photonLang(): string {
  const code = i18n.locale?.split("-")[0] ?? "en";
  return PHOTON_SUPPORTED.has(code) ? code : "en";
}

interface LocationSearchSheetProps {
  visible: boolean;
  placeholder?: string;
  userCoords?: { lat: number; lng: number } | null;
  onSelect: (location: ResolvedLocation) => void;
  onClose: () => void;
}

export function LocationSearchSheet({
  visible,
  placeholder = "Search location…",
  userCoords,
  onSelect,
  onClose,
}: LocationSearchSheetProps) {
  const scheme = useColorScheme() ?? "light";
  const ts = Colors[scheme];
  const insets = useSafeAreaInsets();

  const { results, loading, search, reverseGeocode, clearResults } =
    useLocationSearch();

  const [query, setQuery] = useState("");
  const [locating, setLocating] = useState(false);
  const [gpsCoords, setGpsCoords] = useState<{
    lat: number;
    lng: number;
  } | null>(null);

  const slideAnim = useRef(new Animated.Value(300)).current;
  const activeRef = useRef(false);

  useEffect(() => {
    if (visible) {
      activeRef.current = true;
      setQuery("");
      clearResults();
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        damping: 22,
        stiffness: 220,
      }).start();

      Location.getLastKnownPositionAsync({})
        .then((pos) => {
          if (pos && activeRef.current) {
            setGpsCoords({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
            });
          }
        })
        .catch(() => {});
    } else {
      activeRef.current = false;
      Keyboard.dismiss();
      Animated.timing(slideAnim, {
        toValue: 400,
        duration: 220,
        useNativeDriver: true,
      }).start();
    }
    // slideAnim is a stable ref-backed Animated.Value; clearResults is a stable
    // hook callback. Only `visible` should re-trigger this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const handleChangeText = useCallback(
    (text: string) => {
      setQuery(text);
      search(text, gpsCoords ?? userCoords, photonLang());
    },
    [search, gpsCoords, userCoords],
  );

  const handleUseMyLocation = useCallback(async () => {
    Keyboard.dismiss();
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;

      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const { latitude: lat, longitude: lng } = loc.coords;

      let resolved = await reverseGeocode(lat, lng);
      if (!resolved) {
        const [native] = await Location.reverseGeocodeAsync({
          latitude: lat,
          longitude: lng,
        });
        if (native) {
          const label = [
            native.name,
            native.street,
            native.city,
            native.country,
          ]
            .filter(Boolean)
            .join(", ");
          // Only accept the native fallback if it actually produced text.
          if (label) resolved = { label, coords: { lat, lng } };
        }
      }

      if (resolved) {
        onSelect(resolved);
        onClose();
      }
    } catch {
    } finally {
      setLocating(false);
    }
  }, [onSelect, onClose, reverseGeocode]);

  const handleSelect = (feature: PhotonFeature) => {
    onSelect({
      label: [feature.label, feature.sublabel].filter(Boolean).join(", "),
      coords: feature.coords,
    });
    onClose();
  };

  const showEmptyState = !loading && query.length > 1 && results.length === 0;

  const myLocationHeader = useCallback(
    () => (
      <TouchableOpacity
        style={[styles.myLocationRow, { borderBottomColor: ts.border }]}
        onPress={handleUseMyLocation}
        activeOpacity={0.6}
        disabled={locating}
      >
        <View
          style={[
            styles.myLocationIcon,
            { backgroundColor: ts.tint + "18", borderColor: ts.tint + "40" },
          ]}
        >
          {locating ? (
            <ActivityIndicator size="small" color={ts.tint} />
          ) : (
            <Ionicons name="locate-outline" size={16} color={ts.tint} />
          )}
        </View>
        <Text style={[styles.myLocationLabel, { color: ts.tint }]}>
          {locating
            ? t("generate.getting-location")
            : t("generate.use-my-location")}
        </Text>
      </TouchableOpacity>
    ),
    [ts.border, ts.tint, locating, handleUseMyLocation],
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.backdrop}
        activeOpacity={1}
        onPress={onClose}
      />

      <KeyboardAvoidingView
        style={styles.kvWrapper}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        pointerEvents="box-none"
      >
        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: ts.bg,
              paddingBottom: insets.bottom + 16,
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          <View style={styles.handleWrap}>
            <View style={[styles.handle, { backgroundColor: ts.border }]} />
          </View>

          <View
            style={[
              styles.searchBar,
              { backgroundColor: ts.surface, borderColor: ts.border },
            ]}
          >
            <Ionicons name="search-outline" size={18} color={ts.muted} />
            <TextInput
              style={[styles.searchInput, { color: ts.text }]}
              placeholder={placeholder}
              placeholderTextColor={ts.muted}
              value={query}
              onChangeText={handleChangeText}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
            />
            {loading ? (
              <ActivityIndicator size="small" color={ts.muted} />
            ) : query.length > 0 ? (
              <TouchableOpacity
                onPress={() => {
                  setQuery("");
                  clearResults();
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close-circle" size={18} color={ts.muted} />
              </TouchableOpacity>
            ) : null}
          </View>

          <FlatList
            data={results}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="always"
            keyboardDismissMode="on-drag"
            ListHeaderComponent={myLocationHeader}
            style={styles.resultsList}
            renderItem={({ item, index }) => (
              <TouchableOpacity
                style={[
                  styles.resultRow,
                  {
                    borderBottomColor: ts.border,
                    borderBottomWidth:
                      index < results.length - 1 ? StyleSheet.hairlineWidth : 0,
                  },
                ]}
                onPress={() => handleSelect(item)}
                activeOpacity={0.6}
              >
                <View
                  style={[
                    styles.resultIcon,
                    { backgroundColor: ts.surface, borderColor: ts.border },
                  ]}
                >
                  <Ionicons
                    name="location-outline"
                    size={14}
                    color={ts.muted}
                  />
                </View>
                <View style={styles.resultText}>
                  <Text
                    style={[styles.resultLabel, { color: ts.text }]}
                    numberOfLines={1}
                  >
                    {item.label}
                  </Text>
                  {item.sublabel ? (
                    <Text
                      style={[styles.resultSublabel, { color: ts.muted }]}
                      numberOfLines={1}
                    >
                      {item.sublabel}
                    </Text>
                  ) : null}
                </View>
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              showEmptyState ? (
                <View style={styles.emptyState}>
                  <Ionicons
                    name="search-outline"
                    size={32}
                    color={ts.muted}
                    style={{ opacity: 0.4 }}
                  />
                  <Text style={[styles.emptyText, { color: ts.muted }]}>
                    {t("generate.no-results")}
                  </Text>
                </View>
              ) : null
            }
          />
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.35)",
  },

  kvWrapper: {
    flex: 1,
    justifyContent: "flex-end",
  },

  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "80%",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 12,
  },

  handleWrap: {
    alignItems: "center",
    paddingTop: 10,
    paddingBottom: 6,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },

  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 4,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === "ios" ? 11 : 8,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    padding: 0,
  },

  myLocationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  myLocationIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  myLocationLabel: {
    fontSize: 14,
    fontWeight: "600",
  },

  resultsList: {
    maxHeight: 340,
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  resultIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  resultText: {
    flex: 1,
    gap: 2,
  },
  resultLabel: {
    fontSize: 14,
    fontWeight: "500",
  },
  resultSublabel: {
    fontSize: 12,
  },

  emptyState: {
    alignItems: "center",
    paddingVertical: 32,
    gap: 10,
  },
  emptyText: {
    fontSize: 14,
  },
});
