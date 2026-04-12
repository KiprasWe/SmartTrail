// types/weather.ts
//
// Weather data shapes returned by the Open-Meteo API, normalized for our UI.
// Open-Meteo is a free, no-key weather API: https://open-meteo.com

export interface WeatherCurrent {
  /** °C */
  temperature: number;
  /** °C "feels like" (apparent temperature) */
  apparentTemperature: number;
  /** WMO weather code — map via weatherCodeInfo() */
  weatherCode: number;
  /** km/h */
  windSpeed: number;
  /** 0–100 */
  humidity: number;
  /** 0/1 (day/night) */
  isDay: 0 | 1;
  /** ISO timestamp */
  time: string;
}

export interface WeatherDaily {
  /** ISO date (YYYY-MM-DD) */
  date: string;
  /** WMO weather code */
  weatherCode: number;
  /** °C */
  tempMax: number;
  /** °C */
  tempMin: number;
  /** total precipitation mm */
  precipitation: number;
  /** 0–100 probability of precip */
  precipitationProbability: number;
  /** km/h max */
  windSpeedMax: number;
  /** ISO time */
  sunrise: string;
  /** ISO time */
  sunset: string;
}

export interface WeatherSnapshot {
  /** lat, lon the forecast applies to */
  lat: number;
  lon: number;
  /** "today / now" conditions */
  current: WeatherCurrent;
  /** next N days (including today) */
  daily: WeatherDaily[];
  /** IANA timezone the API returned */
  timezone: string;
  /** epoch ms when this snapshot was fetched */
  fetchedAt: number;
}

// ─── WMO weather code → icon + label ─────────────────────────────────────────
//
// See: https://open-meteo.com/en/docs#weathervariables
// We collapse the 99-code table into a handful of visual buckets. Icons use
// Ionicons glyph names so they match the rest of the app.

export interface WeatherCodeInfo {
  /** Ionicons glyph name — keep in sync with the app's icon set */
  icon:
    | "sunny-outline"
    | "partly-sunny-outline"
    | "cloud-outline"
    | "cloudy-outline"
    | "rainy-outline"
    | "thunderstorm-outline"
    | "snow-outline"
    | "water-outline";
  /** Short human label (i18n key under `weather.conditions.*`) */
  key: string;
}

export function weatherCodeInfo(code: number): WeatherCodeInfo {
  if (code === 0) return { icon: "sunny-outline", key: "clear" };
  if (code === 1) return { icon: "sunny-outline", key: "mostlyClear" };
  if (code === 2) return { icon: "partly-sunny-outline", key: "partlyCloudy" };
  if (code === 3) return { icon: "cloudy-outline", key: "overcast" };
  if (code === 45 || code === 48) return { icon: "cloud-outline", key: "fog" };
  if (code >= 51 && code <= 57) return { icon: "rainy-outline", key: "drizzle" };
  if (code >= 61 && code <= 67) return { icon: "rainy-outline", key: "rain" };
  if (code >= 71 && code <= 77) return { icon: "snow-outline", key: "snow" };
  if (code >= 80 && code <= 82) return { icon: "rainy-outline", key: "showers" };
  if (code === 85 || code === 86) return { icon: "snow-outline", key: "snowShowers" };
  if (code >= 95 && code <= 99)
    return { icon: "thunderstorm-outline", key: "thunderstorm" };
  return { icon: "cloud-outline", key: "unknown" };
}
