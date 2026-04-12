import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import "../global.css";
import "react-native-reanimated";

import { useColorScheme } from "@/hooks/theme/use-color-scheme";
import { useAuthStore } from "@/store/use-auth-store";
import { useProfileStore } from "@/store/use-profile-store";
import { useSavedRoutesStore } from "@/store/use-saved-routes-store";
import { View, ActivityIndicator } from "react-native";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { useEffect } from "react";
import { ErrorBoundary } from "@/components/error-boundary";

export const unstable_settings = {
  anchor: "(tabs)",
};

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  const { user, isLoading, bootstrap: bootstrapAuth } = useAuthStore();
  const hasOnboarded = user?.hasOnboarded ?? false;
  const { bootstrap: bootstrapProfile } = useProfileStore();

  useEffect(() => {
    bootstrapAuth().then(() => {
      // only fetch profile once we know we're logged in
      const { user } = useAuthStore.getState();
      if (user) {
        bootstrapProfile();
        // Hydrate saved-route list from disk before Profile is opened (same pattern as profile cache).
        useSavedRoutesStore.getState().bootstrap();
      }
    });
  }, []);

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Protected guard={!!user && !hasOnboarded}>
          <Stack.Screen
            name="onboarding"
            options={{ headerShown: false, animation: "fade" }}
          />
        </Stack.Protected>
        <Stack.Protected guard={!!user && hasOnboarded}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="route-map" options={{ headerShown: false }} />
          <Stack.Screen name="search-users" options={{ headerShown: false }} />
          <Stack.Screen name="settings" options={{ headerShown: false }} />
          <Stack.Screen name="edit-profile" options={{ headerShown: false }} />
          <Stack.Screen name="user-profile" options={{ headerShown: false }} />
          <Stack.Screen name="follow-list" options={{ headerShown: false }} />
          <Stack.Screen
            name="follow-requests"
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="change-password"
            options={{ headerShown: false }}
          />
          <Stack.Screen name="set-password" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={!user}>
          <Stack.Screen
            name="auth"
            options={{ headerShown: false, title: "Authentication" }}
          />
        </Stack.Protected>
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <KeyboardProvider>
        <RootLayoutNav />
      </KeyboardProvider>
    </ErrorBoundary>
  );
}
