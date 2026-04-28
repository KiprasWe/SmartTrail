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
  poiCount: z.number().int().min(0).max(20).optional().default(0),
  waypoints: z.array(lngLat).optional().default([]),
});

export const loopSchema = z.object({
  start: lngLat,
  distance: z.number().min(500).max(100_000), // metres
  profile: profile.default("foot-walking"),
  elevationPreference,
  poiTypes: z.array(z.string()).optional().default([]),
  poiCount: z.number().int().min(0).max(20).optional().default(0),
  waypoints: z.array(lngLat).optional().default([]),
  controlPoints: z.array(lngLat).optional().default([]),
});

export const loopPoiSuggestSchema = z.object({
  routeCoords: z.array(lngLat).min(2),
  poiTypes: z.array(z.string()).optional().default(["nature", "tourism", "historic"]),
  max: z.number().int().min(1).max(30).optional().default(15),
});

export const addPoiSchema = z.object({
  poi: lngLat,
  legs: z
    .array(
      z.object({
        from: lngLat,
        to: lngLat,
      }).passthrough(),
    )
    .min(1),
  profile: profile.default("foot-walking"),
});

export const aiRouteSchema = z
  .object({
    start: lngLat,
    end: lngLat.optional(),
    distance: z.number().min(500).max(100_000).optional(),
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
});

export const updateRouteSchema = z.object({
  title: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  isFavorite: z.boolean().optional(),
});
