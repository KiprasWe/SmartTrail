import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "react-native";
import { Colors } from "@/constants/theme";
import { HapticTab } from "@/components/haptic-tab";
import { useTranslation } from "@/hooks/use-translation";

export default function TabLayout() {
  const scheme = useColorScheme() ?? "light";
  const ts = Colors[scheme];
  const { t } = useTranslation();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarActiveTintColor: ts.tint,
        tabBarInactiveTintColor: ts.tabIconDefault,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "600",
          letterSpacing: 0.15,
        },
        tabBarStyle: {
          backgroundColor: ts.bg,
          borderTopColor: ts.border,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t("navbar.generate"),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="map-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="discover"
        options={{
          title: t("navbar.discover"),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="compass-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t("navbar.profile"),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
