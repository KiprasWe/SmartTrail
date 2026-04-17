// types/route.ts — saved-route types shared between store and screens

export type Coords = [number, number]; // [lng, lat]

export type RouteMode = "A_TO_B" | "LOOP" | "AI";

// ── Route sub-types ──────────────────────────────────────────────────────────

/** One turn-by-turn step returned by ORS. */
export interface RouteInstruction {
  /** Human-readable instruction string, e.g. "Turn left onto Main St". */
  instruction: string;
  /** Maneuver type code (Valhalla / ORS numeric code). */
  type: number;
  distance_km: number;
  duration_s: number;
}

/** Elevation samples in metres ASL, one per ~30 m of route. */
export type ElevationProfile = number[];

/** Properties shared by both ORS and AI-enriched POI features. */
export interface PoiProperties {
  id: number | string;
  name: string | null;
  /** ORS category name or Google Places primary type. */
  category: string | null;
  /** Metres from the route line (0 for AI/Gemini POIs). */
  distance_from_route: number;
  // AI-enriched extras (null/undefined for ORS POIs)
  ai_description?: string | null;
  rating?: number | null;
  user_rating_count?: number | null;
  formatted_address?: string | null;
  website_uri?: string | null;
  google_maps_uri?: string | null;
  editorial_summary?: string | null;
  photo_name?: string | null;
  place_id?: string | null;
}

/** GeoJSON Point feature for a single POI. */
export interface PoiFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] }; // [lng, lat]
  properties: PoiProperties;
}

/** AI planning metadata stored alongside a route. */
export interface AiPlan {
  pois: PoiFeature[];
}

export interface SavedRouteListItem {
  id: string;
  title: string;
  description: string | null;
  mode: RouteMode;
  transport: string;
  distance: number; // metres
  duration: number; // seconds
  ascent: number | null; // metres
  descent: number | null; // metres
  bbox: [number, number, number, number];
  startLat: number;
  startLng: number;
  startLabel: string | null;
  endLat: number | null;
  endLng: number | null;
  endLabel: string | null;
  variantLabel: string | null;
  isFavorite: boolean;
  createdAt: string;
  updatedAt: string;
  // Simplified polyline for list thumbnails (~64 points, same bbox as the full route)
  thumbnail: Coords[] | null;
}

export interface SavedRoute extends SavedRouteListItem {
  geometry: { type: "LineString"; coordinates: Coords[] };
  instructions: RouteInstruction[] | null;
  elevationProfile: ElevationProfile | null;
  aiPlan: AiPlan | null;
  pois: PoiFeature[] | null;
  generationId: string | null;
}

// Payload sent to POST /routes/saved — maps the generator's snake_case response
// into the backend's camelCase schema.
export interface SaveRouteInput {
  title: string;
  description?: string;
  mode: RouteMode;
  transport: string;
  distance: number;
  duration: number;
  ascent?: number;
  descent?: number;
  geometry: { type: "LineString"; coordinates: Coords[] };
  bbox: [number, number, number, number];
  instructions?: RouteInstruction[];
  elevationProfile?: ElevationProfile;
  startLat: number;
  startLng: number;
  startLabel?: string;
  endLat?: number;
  endLng?: number;
  endLabel?: string;
  aiPlan?: AiPlan;
  pois?: PoiFeature[];
  variantLabel?: string;
  generationId?: string;
  isFavorite?: boolean;
}
