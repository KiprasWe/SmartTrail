import { Ionicons } from "@expo/vector-icons";
import { useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Dimensions,
  useColorScheme,
  StatusBar,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Location from "expo-location";
import { useAuthStore } from "@/store/use-auth-store";
import { Colors } from "@/constants/theme";
import { t } from "@/lib/i18n";

const { width: SCREEN_W } = Dimensions.get("window");

type Slide = {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  titleKey: string;
  bodyKey: string;
  isPermission?: boolean;
};

const SLIDES: Slide[] = [
  {
    key: "generate",
    icon: "map-outline",
    titleKey: "onboarding.slide1-title",
    bodyKey: "onboarding.slide1-body",
  },
  {
    key: "explore",
    icon: "compass-outline",
    titleKey: "onboarding.slide2-title",
    bodyKey: "onboarding.slide2-body",
  },
  {
    key: "location",
    icon: "location-outline",
    titleKey: "onboarding.slide3-title",
    bodyKey: "onboarding.slide3-body",
    isPermission: true,
  },
];

export default function OnboardingScreen() {
  const scheme = useColorScheme() ?? "light";
  const isDark = scheme === "dark";
  const tc = Colors[scheme];
  const insets = useSafeAreaInsets();
  const { completeOnboarding } = useAuthStore();

  const listRef = useRef<FlatList>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [locationGranted, setLocationGranted] = useState(false);
  const [locationAsked, setLocationAsked] = useState(false);

  const isLast = currentIndex === SLIDES.length - 1;

  const goNext = () => {
    if (currentIndex < SLIDES.length - 1) {
      listRef.current?.scrollToIndex({
        index: currentIndex + 1,
        animated: true,
      });
    }
  };

  const requestLocation = async () => {
    setLocationAsked(true);
    const { status } = await Location.requestForegroundPermissionsAsync();
    setLocationGranted(status === "granted");
  };

  const handleFinish = async () => {
    if (SLIDES[currentIndex].isPermission && !locationAsked) {
      await requestLocation();
      return;
    }
    await completeOnboarding();
  };

  const renderSlide = ({ item }: { item: Slide }) => (
    <View style={[styles.slide, { width: SCREEN_W }]}>
      <View
        style={[
          styles.iconWrap,
          { backgroundColor: tc.tint + "18", borderColor: tc.tint + "30" },
        ]}
      >
        <Ionicons name={item.icon} size={40} color={tc.tint} />
      </View>
      <Text style={[styles.slideTitle, { color: tc.text }]}>
        {t(item.titleKey)}
      </Text>
      <Text style={[styles.slideBody, { color: tc.muted }]}>
        {t(item.bodyKey)}
      </Text>

      {item.isPermission && locationAsked && (
        <View
          style={[
            styles.permissionBadge,
            {
              backgroundColor: locationGranted ? tc.tint + "18" : tc.surface,
              borderColor: locationGranted ? tc.tint + "40" : tc.border,
            },
          ]}
        >
          <Ionicons
            name={locationGranted ? "checkmark-circle" : "close-circle"}
            size={16}
            color={locationGranted ? tc.tint : tc.muted}
          />
          <Text
            style={[
              styles.permissionText,
              { color: locationGranted ? tc.tint : tc.muted },
            ]}
          >
            {locationGranted
              ? t("onboarding.location-granted")
              : t("onboarding.location-denied")}
          </Text>
        </View>
      )}
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: tc.bg }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />

      <View style={[styles.topBar, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity
          onPress={completeOnboarding}
          hitSlop={12}
          style={styles.skipBtn}
        >
          <Text style={[styles.skipText, { color: tc.muted }]}>
            {t("onboarding.skip")}
          </Text>
        </TouchableOpacity>
      </View>

      <FlatList
        ref={listRef}
        data={SLIDES}
        renderItem={renderSlide}
        keyExtractor={(item) => item.key}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEnabled={false}
        style={styles.list}
        onMomentumScrollEnd={(e) => {
          const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
          setCurrentIndex(idx);
        }}
      />

      <View style={[styles.bottom, { paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.dots}>
          {SLIDES.map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                {
                  backgroundColor: i === currentIndex ? tc.tint : tc.border,
                  width: i === currentIndex ? 20 : 6,
                },
              ]}
            />
          ))}
        </View>

        <View style={styles.actions}>
          {isLast ? (
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: tc.tint }]}
              onPress={handleFinish}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryBtnLabel}>
                {SLIDES[currentIndex].isPermission && !locationAsked
                  ? t("onboarding.allow-location")
                  : t("onboarding.get-started")}
              </Text>
              {(locationAsked || !SLIDES[currentIndex].isPermission) && (
                <Ionicons
                  name="arrow-forward"
                  size={16}
                  color="#fff"
                  style={styles.btnIcon}
                />
              )}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: tc.tint }]}
              onPress={goNext}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryBtnLabel}>{t("onboarding.next")}</Text>
              <Ionicons
                name="arrow-forward"
                size={16}
                color="#fff"
                style={styles.btnIcon}
              />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  topBar: {
    alignItems: "flex-end",
    paddingHorizontal: 24,
    paddingBottom: 8,
  },
  skipBtn: { padding: 4 },
  skipText: { fontSize: 14, fontWeight: "500" },

  list: { flex: 1 },

  slide: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    gap: 16,
  },
  iconWrap: {
    width: 96,
    height: 96,
    borderRadius: 28,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  slideTitle: {
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: -0.5,
    textAlign: "center",
  },
  slideBody: {
    fontSize: 15,
    lineHeight: 23,
    textAlign: "center",
  },
  permissionBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 99,
    borderWidth: 1,
    marginTop: 8,
  },
  permissionText: { fontSize: 13, fontWeight: "600" },

  bottom: {
    paddingHorizontal: 24,
    gap: 20,
  },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
  },
  dot: {
    height: 6,
    borderRadius: 3,
  },

  actions: {},
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    paddingVertical: 16,
    gap: 8,
  },
  primaryBtnLabel: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 0.1,
  },
  btnIcon: { marginTop: 1 },
});
