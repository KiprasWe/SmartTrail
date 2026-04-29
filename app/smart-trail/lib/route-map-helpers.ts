import { Alert, Linking } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { LoopMeta } from "@/types/route";

// Maps normalised category strings (lowercase, underscores→spaces) to i18n keys
const CATEGORY_KEY_MAP: Record<string, string> = {
  park: "park",
  "national park": "national_park",
  "nature reserve": "national_park",
  nature: "nature",
  natural: "nature",
  wood: "nature",
  forest: "nature",
  spring: "nature",
  water: "nature",
  drinking: "nature",
  "tourist attraction": "tourist_attraction",
  tourism: "tourist_attraction",
  attraction: "tourist_attraction",
  viewpoint: "viewpoint",
  historic: "historic_landmark",
  "historical landmark": "historic_landmark",
  monument: "monument",
  memorial: "monument",
  castle: "historic_landmark",
  ruins: "historic_landmark",
  "archaeological site": "historic_landmark",
  museum: "museum",
  gallery: "art_gallery",
  "art gallery": "art_gallery",
  theatre: "theatre",
  cinema: "cinema",
  church: "church",
  restaurant: "restaurant",
  cafe: "cafe",
  coffee: "cafe",
  bakery: "bakery",
  bar: "bar",
  pub: "bar",
  "fast food": "fast_food",
  "meal takeaway": "fast_food",
  zoo: "zoo",
  aquarium: "aquarium",
  "amusement park": "amusement_park",
  "shopping mall": "shopping_mall",
  stadium: "stadium",
  sports: "sports",
  "sports centre": "sports",
  leisure: "leisure",
  playground: "playground",
  "picnic site": "picnic_site",
  waterfall: "waterfall",
  beach: "beach",
  peak: "peak",
  cliff: "peak",
  cave: "cave",
  "cave entrance": "cave",
  information: "information",
};

export function translatePoiCategory(
  category: string | null | undefined,
  t: (key: string) => string,
): string | null {
  if (!category) return null;
  const normalised = category.toLowerCase().replace(/_/g, " ");
  const key = CATEGORY_KEY_MAP[normalised];
  if (!key) {
    return category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return t(`poi.categories.${key}`);
}

// Returns the display name for a POI — translates the name if it's just a
// raw category label (unnamed OSM place), otherwise returns the real name.
export function poiDisplayName(
  name: string | null | undefined,
  category: string | null | undefined,
  t: (key: string) => string,
): string | null {
  if (!name) return translatePoiCategory(category, t);
  const normalised = name.toLowerCase().replace(/_/g, " ");
  if (CATEGORY_KEY_MAP[normalised]) return translatePoiCategory(name, t);
  return name;
}

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

export function poiIcon(
  category: string | null,
): keyof typeof Ionicons.glyphMap {
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
