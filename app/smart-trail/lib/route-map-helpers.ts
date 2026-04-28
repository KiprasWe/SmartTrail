import { Alert, Linking } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { LoopMeta } from "@/types/route";

export const ROUTE_COLORS = ["#16A34A", "#3B82F6", "#F59E0B"];

export function formatDist(km: number) {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

export function formatTime(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m} min`;
}

const CATEGORY_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  cafe: "cafe-outline",
  coffee: "cafe-outline",
  restaurant: "restaurant-outline",
  bar: "wine-outline",
  pub: "wine-outline",
  "fast food": "fast-food-outline",
  natural: "leaf-outline",
  park: "leaf-outline",
  nature: "leaf-outline",
  waterfall: "water-outline",
  spring: "water-outline",
  water: "water-outline",
  beach: "sunny-outline",
  peak: "triangle-outline",
  cliff: "triangle-outline",
  cave: "moon-outline",
  tourism: "eye-outline",
  viewpoint: "eye-outline",
  attraction: "star-outline",
  information: "information-circle-outline",
  historic: "flag-outline",
  monument: "flag-outline",
  memorial: "flag-outline",
  castle: "business-outline",
  ruins: "business-outline",
  museum: "color-palette-outline",
  gallery: "color-palette-outline",
  theatre: "musical-notes-outline",
  cinema: "film-outline",
  leisure: "basketball-outline",
  sports: "basketball-outline",
  "sports centre": "basketball-outline",
  "picnic site": "umbrella-outline",
  playground: "happy-outline",
  toilet: "body-outline",
  bench: "body-outline",
  drinking: "water-outline",
};

export function poiIcon(category: string | null): keyof typeof Ionicons.glyphMap {
  if (!category) return "location-outline";
  const lower = category.toLowerCase();
  for (const [key, icon] of Object.entries(CATEGORY_ICONS)) {
    if (lower.includes(key)) return icon;
  }
  return "location-outline";
}

// Builds a URL pointing at our backend's Google Places photo proxy. The proxy
// resolves the photoName to the actual image and 302-redirects, so the API key
// never touches the client.
export function placePhotoUrl(photoName: string) {
  const base = process.env.EXPO_PUBLIC_API_URL;
  return `${base}/places/photo?name=${encodeURIComponent(photoName)}`;
}

export async function openExternal(url?: string | null) {
  if (!url) return;
  try {
    const can = await Linking.canOpenURL(url);
    if (can) await Linking.openURL(url);
  } catch {
    // ignore
  }
}

// Show a one-shot toast when the backend snapped the loop to its TSP minimum
// or auto-extended past the slider value. Returns true if a toast fired.
export function notifyLoopMeta(
  meta: LoopMeta | undefined | null,
  translate: (key: string, opts?: Record<string, string>) => string,
): boolean {
  if (!meta) return false;
  if (meta.snapped_to_min && meta.min_distance_km != null) {
    Alert.alert(
      "",
      translate("route-map.loop-snapped-to-min", {
        km: meta.min_distance_km.toFixed(1),
      }),
    );
    return true;
  }
  if (meta.auto_extended) {
    Alert.alert(
      "",
      translate("route-map.loop-auto-extended", {
        km: meta.actual_km.toFixed(1),
      }),
    );
    return true;
  }
  return false;
}
