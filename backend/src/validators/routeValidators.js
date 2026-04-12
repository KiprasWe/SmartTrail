import { z } from "zod";

// [lng, lat] array (GeoJSON order)
const lngLat = z.tuple([z.number(), z.number()]);

const profile = z.enum([
  "foot-walking",
  "foot-hiking",
  "running",
  "cycling-regular",
  "cycling-road",
  "cycling-mountain",
  "cycling-electric",
]);

const elevationPreference = z
  .enum(["flat", "optimal", "hilly", "auto"])
  .optional()
  .default("auto");

export const atoBSchema = z.object({
  start: lngLat,
  end: lngLat,
  profile: profile.default("foot-walking"),
  elevationPreference,
  poiTypes: z.array(z.string()).optional().default([]),
  waypoints: z.array(lngLat).optional().default([]),
  variantLabel: z.string().optional(),
});

export const loopSchema = z.object({
  start: lngLat,
  distance: z.number().min(500).max(100_000), // metres
  profile: profile.default("foot-walking"),
  elevationPreference,
  poiTypes: z.array(z.string()).optional().default([]),
  waypoints: z.array(lngLat).optional().default([]),
});

export const aiRouteSchema = z
  .object({
    start: lngLat,
    end: lngLat.optional(),
    distance: z.number().min(500).max(100_000).optional(), // metres, loop only
    profile: profile.default("foot-walking"),
    elevationPreference,
    area: z.string().max(200).optional(),
    preferences: z.string().max(500).optional(),
    lang: z.enum(["en", "lt"]).default("en"),
  })
  .refine((d) => d.end || typeof d.distance === "number", {
    message: "Either end or distance is required",
    path: ["distance"],
  });

export const saveRouteSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  mode: z.enum(["A_TO_B", "LOOP", "AI"]),
  transport: z.string(),
  distance: z.number().int().positive(),
  duration: z.number().int().positive(),
  ascent: z.number().int().optional(),
  descent: z.number().int().optional(),
  geometry: z.object({
    type: z.literal("LineString"),
    coordinates: z.array(z.tuple([z.number(), z.number()])),
  }),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  instructions: z.array(z.any()).optional(),
  elevationProfile: z.any().optional(),
  startLat: z.number(),
  startLng: z.number(),
  startLabel: z.string().optional(),
  endLat: z.number().optional(),
  endLng: z.number().optional(),
  endLabel: z.string().optional(),
  aiPlan: z.any().optional(),
  pois: z.any().optional(),
  variantLabel: z.string().optional(),
  generationId: z.string().optional(),
  isFavorite: z.boolean().default(false),
  isPublic: z.boolean().default(false),
});

// Discover query — used by GET /routes/discover. Everything comes in on the
// query string so we coerce numeric fields. `radiusKm` is capped at 100 to
// keep the bounding-box prefilter narrow enough for the index to help.
export const discoverQuerySchema = z.object({
  lat: z.coerce.number().gte(-90).lte(90),
  lng: z.coerce.number().gte(-180).lte(180),
  radiusKm: z.coerce.number().positive().max(100).default(15),
  transport: z.string().optional(),
  minDistanceKm: z.coerce.number().nonnegative().optional(),
  maxDistanceKm: z.coerce.number().positive().optional(),
  sort: z.enum(["nearest", "popular"]).default("nearest"),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(50).default(20),
});

export const updateRouteSchema = z.object({
  title: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  isFavorite: z.boolean().optional(),
  isPublic: z.boolean().optional(),
});
