// types/discover.ts — community route discovery shapes

import type { Coords, RouteMode } from "./route";

export type DiscoverSort = "nearest" | "popular";

export interface DiscoverAuthor {
  id: string;
  username: string;
  profilePicture: string | null;
}

// Shape returned by GET /routes/discover — contains the simplified thumbnail
// polyline for map/list rendering but no full geometry. Fetch the full route
// via GET /routes/public/:id when the user opens a preview.
export interface DiscoverRoute {
  id: string;
  title: string;
  description: string | null;
  mode: RouteMode;
  transport: string;
  distance: number; // metres (total route length)
  duration: number; // seconds
  ascent: number | null;
  descent: number | null;
  bbox: [number, number, number, number];
  startLat: number;
  startLng: number;
  startLabel: string | null;
  endLat: number | null;
  endLng: number | null;
  endLabel: string | null;
  variantLabel: string | null;
  saveCount: number;
  savedByMe: boolean;
  distanceKm: number; // haversine distance from user's query point
  author: DiscoverAuthor | null;
  thumbnail: Coords[] | null;
  createdAt: string;
}

// Full public route, returned by GET /routes/public/:id. Same shape as a
// private SavedRoute but with an `author` block and a `savedByMe` flag.
export interface PublicRoute {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  mode: RouteMode;
  transport: string;
  distance: number;
  duration: number;
  ascent: number | null;
  descent: number | null;
  geometry: { type: "LineString"; coordinates: Coords[] };
  bbox: [number, number, number, number];
  instructions: unknown | null;
  elevationProfile: unknown | null;
  startLat: number;
  startLng: number;
  startLabel: string | null;
  endLat: number | null;
  endLng: number | null;
  endLabel: string | null;
  aiPlan: unknown | null;
  pois: unknown | null;
  variantLabel: string | null;
  isPublic: boolean;
  saveCount: number;
  savedByMe: boolean;
  author: DiscoverAuthor | null;
  createdAt: string;
  updatedAt: string;
}

export interface DiscoverFilters {
  transport?: string; // "foot-walking" | "cycling-regular" | etc.
  minDistanceKm?: number;
  maxDistanceKm?: number;
  sort: DiscoverSort;
}

export interface DiscoverQueryCenter {
  lat: number;
  lng: number;
  radiusKm: number;
}
