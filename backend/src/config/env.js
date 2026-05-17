export const ORS_API_KEY = process.env.ORS_API_KEY;
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
export const JWT_SECRET = process.env.JWT_SECRET;
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN;
export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
export const DATABASE_URL = process.env.DATABASE_URL;

export const PORT = process.env.PORT || 5001;
export const CORS_ORIGIN = process.env.CORS_ORIGIN;

export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
export const ORS_VERBOSE = process.env.ORS_VERBOSE === "1";

export const ORS_POIS_URL =
  process.env.ORS_POIS_URL ?? "https://api.heigit.org/openpoiservice/v0/pois";
export const ORS_DIRECTIONS_URL =
  process.env.ORS_DIRECTIONS_URL ??
  "https://api.heigit.org/openrouteservice/v2/directions";
export const ORS_MATRIX_URL =
  process.env.ORS_MATRIX_URL ??
  "https://api.openrouteservice.org/v2/matrix";
export const ORS_POI_BASE =
  process.env.ORS_POI_BASE ?? "https://api.openrouteservice.org/pois";
export const ORS_GEOCODE_BASE =
  process.env.ORS_GEOCODE_BASE ??
  "https://api.openrouteservice.org/geocode/search";
export const NOMINATIM_BASE =
  process.env.NOMINATIM_BASE ?? "https://nominatim.openstreetmap.org";
export const NOMINATIM_EMAIL =
  process.env.NOMINATIM_EMAIL ?? "student@university.lt";
export const APP_URL = process.env.APP_URL ?? "http://localhost:3000";

export const nodeEnv = () => process.env.NODE_ENV;
export const isProduction = () => process.env.NODE_ENV === "production";
export const isDevelopment = () => process.env.NODE_ENV === "development";
