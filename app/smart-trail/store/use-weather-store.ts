// store/use-weather-store.ts
//
// Client-side weather cache. Weather doesn't change second-to-second, so we
// key responses by rounded lat/lon (~0.05° ≈ 5 km) and keep them in-memory for
// 20 minutes. No persistence — if the app is restarted, we just refetch.

import { create } from "zustand";
import { fetchWeather, type LatLon } from "@/lib/weather";
import type { WeatherSnapshot } from "@/types/weather";
import { getErrMessage } from "@/lib/error-messages";
import { useAuthStore } from "./use-auth-store";

const TTL_MS = 20 * 60 * 1000; // 20 min
const COORD_PRECISION = 0.05; // ~5 km cells

/** Round a coordinate pair onto a shared grid so nearby queries share a cache entry. */
function keyFor(lat: number, lon: number): string {
  const rl = Math.round(lat / COORD_PRECISION) * COORD_PRECISION;
  const rn = Math.round(lon / COORD_PRECISION) * COORD_PRECISION;
  return `${rl.toFixed(3)},${rn.toFixed(3)}`;
}

interface CacheEntry {
  snapshot: WeatherSnapshot;
  fetchedAt: number;
}

interface WeatherStore {
  cache: Record<string, CacheEntry>;
  /** Loading flag keyed by a joined request signature (all points at once). */
  loading: Record<string, boolean>;
  /** Last error per request signature. */
  errors: Record<string, string | null>;

  /**
   * Fetch weather for the given points. Cache hits return immediately; only
   * missing points hit the network. Returns all snapshots in input order (or
   * `null` for any that failed).
   */
  getWeather: (
    points: LatLon[],
  ) => Promise<(WeatherSnapshot | null)[]>;
  clear: () => void;
}

export const useWeatherStore = create<WeatherStore>((set, get) => ({
  cache: {},
  loading: {},
  errors: {},

  getWeather: async (points) => {
    if (points.length === 0) return [];
    const sig = points.map((p) => keyFor(p.lat, p.lon)).join("|");
    const state = get();

    // Already fetching this exact request — no-op (caller can retry once done).
    if (state.loading[sig]) {
      // Return whatever is currently cached (may be partial/stale).
      return points.map((p) => {
        const k = keyFor(p.lat, p.lon);
        return state.cache[k]?.snapshot ?? null;
      });
    }

    const now = Date.now();
    const missing: { index: number; point: LatLon; key: string }[] = [];
    const results: (WeatherSnapshot | null)[] = points.map((p, i) => {
      const k = keyFor(p.lat, p.lon);
      const hit = state.cache[k];
      if (hit && now - hit.fetchedAt < TTL_MS) {
        return hit.snapshot;
      }
      missing.push({ index: i, point: p, key: k });
      return null;
    });

    if (missing.length === 0) return results;

    set((s) => ({
      loading: { ...s.loading, [sig]: true },
      errors: { ...s.errors, [sig]: null },
    }));

    try {
      const fetched = await fetchWeather(missing.map((m) => m.point));
      const cacheUpdate: Record<string, CacheEntry> = {};
      fetched.forEach((snap, i) => {
        const m = missing[i];
        if (!m || !snap) return;
        cacheUpdate[m.key] = { snapshot: snap, fetchedAt: now };
        results[m.index] = snap;
      });

      set((s) => ({
        cache: { ...s.cache, ...cacheUpdate },
        loading: { ...s.loading, [sig]: false },
      }));
      return results;
    } catch (e: unknown) {
      set((s) => ({
        loading: { ...s.loading, [sig]: false },
        errors: { ...s.errors, [sig]: getErrMessage(e, "Failed to load weather") },
      }));
      return results;
    }
  },

  clear: () => set({ cache: {}, loading: {}, errors: {} }),
}));

// Clear in-memory weather cache whenever the user signs out.
useAuthStore.subscribe((state, prevState) => {
  if (prevState.user !== null && state.user === null) {
    useWeatherStore.getState().clear();
  }
});
