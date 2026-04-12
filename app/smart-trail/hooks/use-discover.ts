// hooks/use-discover.ts
//
// Drives the Discover tab. Owns: current query center (lat/lng/radius),
// filter state, fetched routes, pagination cursor, and save-toggle action.
//
// The screen calls `fetch()` on mount (with the user's location or a
// fallback), then calls `setCenter()` as the map pans — this hook debounces
// the refetch so we don't spam the backend on every tiny pan.

import { useCallback, useEffect, useRef, useState } from "react";
import type { AxiosRequestConfig, AxiosResponse } from "axios";
import type {
  DiscoverFilters,
  DiscoverQueryCenter,
  DiscoverRoute,
  PublicRoute,
} from "@/types/discover";
import { getErrMessage } from "@/lib/error-messages";

type AuthFetch = (
  input: string,
  config?: AxiosRequestConfig,
) => Promise<AxiosResponse>;

const DEFAULT_FILTERS: DiscoverFilters = {
  sort: "nearest",
};

// Debounce window for refetch-on-pan. 500ms is the sweet spot from testing
// on similar map screens — long enough that flicking the map doesn't stack
// up calls, short enough that it feels responsive when the user stops.
const PAN_DEBOUNCE_MS = 500;

// How far the center must move (as a fraction of the current radius) before
// we refetch. Prevents tiny pans from triggering network calls even after
// the debounce window.
const REFETCH_DISTANCE_RATIO = 0.2;

function haversineKm(a: DiscoverQueryCenter, b: DiscoverQueryCenter): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

export function useDiscover(authFetch: AuthFetch | null | undefined) {
  const [center, setCenterState] = useState<DiscoverQueryCenter | null>(null);
  const [filters, setFilters] = useState<DiscoverFilters>(DEFAULT_FILTERS);

  const [routes, setRoutes] = useState<DiscoverRoute[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  // Track the last center we actually queried against — used to decide
  // whether a pan moved far enough to justify a refetch.
  const lastQueriedCenterRef = useRef<DiscoverQueryCenter | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guard against stale responses: each fetch gets a monotonically increasing
  // request id and only the latest one is allowed to set state.
  const requestIdRef = useRef(0);

  const buildQuery = useCallback(
    (c: DiscoverQueryCenter, f: DiscoverFilters, cursor?: string) => {
      const params = new URLSearchParams({
        lat: String(c.lat),
        lng: String(c.lng),
        radiusKm: String(c.radiusKm),
        sort: f.sort,
      });
      if (f.transport) params.set("transport", f.transport);
      if (typeof f.minDistanceKm === "number")
        params.set("minDistanceKm", String(f.minDistanceKm));
      if (typeof f.maxDistanceKm === "number")
        params.set("maxDistanceKm", String(f.maxDistanceKm));
      if (cursor) params.set("cursor", cursor);
      return `/routes/discover?${params.toString()}`;
    },
    [],
  );

  const fetch = useCallback(
    async (c: DiscoverQueryCenter, f: DiscoverFilters) => {
      if (!authFetch) return;
      const requestId = ++requestIdRef.current;
      setLoading(true);
      setError(null);
      try {
        const { data } = await authFetch(buildQuery(c, f));
        if (requestId !== requestIdRef.current) return; // superseded
        const fetched: DiscoverRoute[] = data.data.routes ?? [];
        setRoutes(fetched);
        setNextCursor(data.data.nextCursor ?? null);
        lastQueriedCenterRef.current = c;
      } catch (err: unknown) {
        if (requestId !== requestIdRef.current) return;
        setError(getErrMessage(err));
        setRoutes([]);
        setNextCursor(null);
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    },
    [authFetch, buildQuery],
  );

  const loadMore = useCallback(async () => {
    if (!authFetch || !center || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const { data } = await authFetch(
        buildQuery(center, filters, nextCursor),
      );
      const more: DiscoverRoute[] = data.data.routes ?? [];
      // Dedupe by id — defensive in case the cursor boundary overlaps
      setRoutes((prev) => {
        const seen = new Set(prev.map((r) => r.id));
        return [...prev, ...more.filter((r) => !seen.has(r.id))];
      });
      setNextCursor(data.data.nextCursor ?? null);
    } catch (err: unknown) {
      setError(getErrMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }, [authFetch, buildQuery, center, filters, nextCursor, loadingMore]);

  // Public setter — debounces and only refetches if the center moved "far
  // enough". Callers can pass `immediate` to skip the debounce (e.g. filter
  // changes, initial load).
  const setCenter = useCallback(
    (c: DiscoverQueryCenter, immediate = false) => {
      setCenterState(c);
      if (debounceRef.current) clearTimeout(debounceRef.current);

      const last = lastQueriedCenterRef.current;
      const movedFarEnough =
        !last ||
        haversineKm(last, c) >= c.radiusKm * REFETCH_DISTANCE_RATIO ||
        Math.abs(last.radiusKm - c.radiusKm) / c.radiusKm > 0.2;

      if (!movedFarEnough && !immediate) return;

      if (immediate) {
        fetch(c, filters);
      } else {
        debounceRef.current = setTimeout(() => {
          fetch(c, filters);
        }, PAN_DEBOUNCE_MS);
      }
    },
    [fetch, filters],
  );

  // Changing filters always triggers an immediate refetch at the current
  // center.
  const updateFilters = useCallback(
    (patch: Partial<DiscoverFilters>) => {
      setFilters((prev) => {
        const next = { ...prev, ...patch };
        if (center) fetch(center, next);
        return next;
      });
    },
    [center, fetch],
  );

  const getPublicRoute = useCallback(
    async (id: string): Promise<PublicRoute | null> => {
      if (!authFetch) return null;
      try {
        const { data } = await authFetch(`/routes/public/${id}`);
        return data.data.route;
      } catch {
        return null;
      }
    },
    [authFetch],
  );

  // Optimistic save/unsave — flip the flag locally, roll back on failure.
  const toggleSave = useCallback(
    async (id: string) => {
      if (!authFetch) return;
      const prev = routes;
      const current = prev.find((r) => r.id === id);
      if (!current) return;
      const nextSaved = !current.savedByMe;

      setRoutes((rs) =>
        rs.map((r) =>
          r.id === id
            ? {
                ...r,
                savedByMe: nextSaved,
                saveCount: Math.max(0, r.saveCount + (nextSaved ? 1 : -1)),
              }
            : r,
        ),
      );

      try {
        await authFetch(`/routes/public/${id}/save`, {
          method: nextSaved ? "POST" : "DELETE",
        });
      } catch (err) {
        setRoutes(prev); // rollback
        throw err;
      }
    },
    [authFetch, routes],
  );

  // Cleanup any pending debounce on unmount so we don't fire a stale fetch
  // after the screen is gone.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return {
    center,
    filters,
    routes,
    loading,
    loadingMore,
    error,
    hasMore: !!nextCursor,
    setCenter,
    setFilters: updateFilters,
    refresh: () => center && fetch(center, filters),
    loadMore,
    getPublicRoute,
    toggleSave,
  };
}
