import { z } from "zod";

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above|system)\s+instructions?/i,
  /you\s+are\s+now\b/i,
  /forget\s+(all\s+)?(rules|instructions|context)/i,
  /disregard\s+(previous|prior|above)\s+/i,
  /new\s+system\s+prompt/i,
  /<\|system\|>/i,
  /###\s*system/i,
  /\[INST\]/,
];

function isInjectionAttempt(text) {
  return INJECTION_PATTERNS.some((p) => p.test(text));
}

const lngLat = z
  .tuple([z.number(), z.number()])
  .refine(
    ([lng, lat]) => lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90,
    {
      message: "Invalid coordinates: lng must be -180..180, lat -90..90",
    },
  );

const profile = z.enum([
  "foot-walking",
  "foot-hiking",
  "running",
  "cycling-regular",
]);

const elevationPreference = z
  .enum(["flat", "moderate", "hilly"])
  .optional()
  .default("moderate");

const poiTypeEnum = z.enum([
  "nature",
  "tourism",
  "historic",
  "food",
  "arts_culture",
  "leisure",
]);

export const atoBSchema = z.object({
  start: lngLat,
  end: lngLat,
  profile: profile.default("foot-walking"),
  elevationPreference,
  poiTypes: z.array(poiTypeEnum).max(6).optional().default([]),
  poiCount: z.number().int().min(0).max(20).optional().default(0),
  waypoints: z.array(lngLat).max(10).optional().default([]),
});

export const loopSchema = z.object({
  start: lngLat,
  distance: z.number().min(500).max(6_000_000),
  profile: profile.default("foot-walking"),
  elevationPreference,
  poiTypes: z.array(poiTypeEnum).max(6).optional().default([]),
  poiCount: z.number().int().min(0).max(20).optional().default(0),
  waypoints: z.array(lngLat).max(10).optional().default([]),
  controlPoints: z.array(lngLat).max(20).optional().default([]),
});

export const splicePoiSchema = z.object({
  routeCoords: z.array(lngLat).min(4).max(20_000),
  elevArr: z.array(z.number()).optional(),
  poi: lngLat,
  profile: profile.default("foot-walking"),
  elevationPreference,
  currentStats: z.object({
    distance_km: z.number().positive(),
    duration_s: z.number().nonnegative(),
    ascent_m: z.number().nonnegative(),
    descent_m: z.number().nonnegative(),
  }),
});

const aiPreferences = z
  .string()
  .max(500)
  .optional()
  .refine((v) => !v || !isInjectionAttempt(v), {
    message: "Invalid preferences input",
  });

export const aiDirectSchema = z.object({
  start: lngLat,
  end: lngLat,
  profile: profile.default("foot-walking"),
  elevationPreference,
  area: z.string().max(200).optional(),
  preferences: aiPreferences,
  lang: z.enum(["en", "lt"]).default("en"),
  waypoints: z.array(lngLat).optional().default([]),
});

export const aiLoopSchema = z.object({
  start: lngLat,
  distance: z.number().min(500).max(6_000_000),
  profile: profile.default("foot-walking"),
  elevationPreference,
  area: z.string().max(200).optional(),
  preferences: aiPreferences,
  lang: z.enum(["en", "lt"]).default("en"),
  waypoints: z.array(lngLat).optional().default([]),
});

export const rerouteDirectSchema = z.object({
  start: lngLat,
  end: lngLat,
  profile: profile.default("foot-walking"),
  elevationPreference,
  waypoints: z.array(lngLat).max(10).optional().default([]),
});

export const saveRouteSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
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
