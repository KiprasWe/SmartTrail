// Open-Meteo client — https://open-meteo.com
//
// Zero-key, zero-signup, commercial-friendly (CC-BY 4.0) weather API. The
// forecast endpoint accepts comma-separated lat/lon lists so multiple points
// along a route resolve in a single HTTP request.

import type { WeatherSnapshot } from "@/types/weather";

const FORECAST_BASE = "https://api.open-meteo.com/v1/forecast";

/** Number of forecast days (incl. today). Open-Meteo supports up to 16. */
const FORECAST_DAYS = 5;

export interface LatLon {
  lat: number;
  lon: number;
}

/**
 * Fetch weather for one or more coordinates in a single request.
 *
 * The response array mirrors the order of the input points. If Open-Meteo is
 * queried with a single coordinate it returns an object; with multiple it
 * returns an array — we normalize both shapes here.
 */
export async function fetchWeather(
  points: LatLon[],
  signal?: AbortSignal,
): Promise<WeatherSnapshot[]> {
  if (points.length === 0) return [];

  const latitude = points.map((p) => p.lat.toFixed(4)).join(",");
  const longitude = points.map((p) => p.lon.toFixed(4)).join(",");

  const params = new URLSearchParams({
    latitude,
    longitude,
    current: [
      "temperature_2m",
      "apparent_temperature",
      "relative_humidity_2m",
      "is_day",
      "weather_code",
      "wind_speed_10m",
    ].join(","),
    daily: [
      "weather_code",
      "temperature_2m_max",
      "temperature_2m_min",
      "precipitation_sum",
      "precipitation_probability_max",
      "wind_speed_10m_max",
      "sunrise",
      "sunset",
    ].join(","),
    timezone: "auto",
    forecast_days: String(FORECAST_DAYS),
    temperature_unit: "celsius",
    wind_speed_unit: "kmh",
    precipitation_unit: "mm",
  });

  const res = await fetch(`${FORECAST_BASE}?${params.toString()}`, { signal });
  if (!res.ok) {
    throw new Error(`Open-Meteo HTTP ${res.status}`);
  }
  const json = await res.json();

  // Open-Meteo returns a single object for one point, an array for many.
  const rows: any[] = Array.isArray(json) ? json : [json];
  const now = Date.now();

  return rows.map((row, i): WeatherSnapshot => {
    const current = row.current ?? {};
    const daily = row.daily ?? {};
    const dates: string[] = daily.time ?? [];

    return {
      lat: points[i].lat,
      lon: points[i].lon,
      timezone: row.timezone ?? "UTC",
      fetchedAt: now,
      current: {
        time: current.time ?? new Date().toISOString(),
        temperature: Number(current.temperature_2m ?? 0),
        apparentTemperature: Number(current.apparent_temperature ?? 0),
        humidity: Number(current.relative_humidity_2m ?? 0),
        isDay: (current.is_day ?? 1) as 0 | 1,
        weatherCode: Number(current.weather_code ?? 0),
        windSpeed: Number(current.wind_speed_10m ?? 0),
      },
      daily: dates.map((date, d) => ({
        date,
        weatherCode: Number(daily.weather_code?.[d] ?? 0),
        tempMax: Number(daily.temperature_2m_max?.[d] ?? 0),
        tempMin: Number(daily.temperature_2m_min?.[d] ?? 0),
        precipitation: Number(daily.precipitation_sum?.[d] ?? 0),
        precipitationProbability: Number(
          daily.precipitation_probability_max?.[d] ?? 0,
        ),
        windSpeedMax: Number(daily.wind_speed_10m_max?.[d] ?? 0),
        sunrise: daily.sunrise?.[d] ?? "",
        sunset: daily.sunset?.[d] ?? "",
      })),
    };
  });
}

/**
 * Sample representative points along a route for weather lookup. For short
 * routes we just use the start; for longer ones we add the midpoint and end so
 * the user sees whether conditions diverge along the way.
 */
export function sampleRoutePoints(
  coordinates: [number, number][],
  distanceKm: number,
): LatLon[] {
  if (coordinates.length === 0) return [];

  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  const mid = coordinates[Math.floor(coordinates.length / 2)];

  const toLatLon = (c: [number, number]): LatLon => ({ lat: c[1], lon: c[0] });

  // < 5 km: one point is enough.
  if (distanceKm < 5) return [toLatLon(first)];
  // 5–20 km: start + end.
  if (distanceKm < 20) return [toLatLon(first), toLatLon(last)];
  // Longer: start, mid, end.
  return [toLatLon(first), toLatLon(mid), toLatLon(last)];
}
