export type Coords = [number, number]; // [lng, lat]

export type RouteMode = "A_TO_B" | "LOOP" | "AI";

export interface RouteInstruction {
  instruction: string;
  type: number;
  distance_km: number;
  duration_s: number;
}

export type ElevationProfile = number[];

export interface PoiProperties {
  id: number | string;
  name: string | null;
  category: string | null;
  distance_from_route: number;
  ai_description?: string | null;
  rating?: number | null;
  user_rating_count?: number | null;
  formatted_address?: string | null;
  website_uri?: string | null;
  google_maps_uri?: string | null;
  editorial_summary?: string | null;
  photo_name?: string | null;
  place_id?: string | null;
  essential?: boolean | null;
}

export interface PoiFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: PoiProperties;
}

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

export interface GenParams {
  mode: "a_to_b" | "loop" | "ai";
  start: Coords;
  end?: Coords;
  distance?: number;
  profile: string;
  elevationPreference: string;
  poiTypes?: string[];
  waypoints?: Coords[];
  preferences?: string;
  lang?: "en" | "lt";
}

export interface RouteVariant {
  label: string;
  description: string;
  profile: string;
  distance_km: number;
  duration_s: number;
  ascent_m: number;
  descent_m: number;
  geometry: { type: "LineString"; coordinates: Coords[] };
  bbox: [number, number, number, number];
  pois: PoiFeature[];
  overlap_ratio?: number;
  elevation_profile?: ElevationProfile;
  maneuvers?: RouteInstruction[];
}

export interface LoopMeta {
  requested_km: number;
  actual_km: number;
  min_distance_km: number | null;
  snapped_to_min: boolean;
  auto_extended: boolean;
  overlap_ratio: number | null;
}

export interface RoutePayload {
  profile: string;
  elevation_preference: string;
  routes: RouteVariant[];
  controlPoints?: Coords[];
  loop_meta?: LoopMeta;
}
