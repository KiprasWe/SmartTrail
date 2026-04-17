// store/use-saved-routes-store.ts
//
// Offline-first cache of the user's saved routes. List items live in one
// AsyncStorage key; full route details (geometry + POIs) live under per-id
// keys so that opening a saved route works without network.
//
// Flow:
//   1. bootstrap() — hydrate list from AsyncStorage immediately (no await UI)
//   2. refresh()   — hit GET /routes/saved when online, overwrite cache
//   3. save/update/delete — optimistic, roll back on failure

import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuthStore } from "./use-auth-store";
import { getErrMessage } from "@/lib/error-messages";
import type {
  SavedRoute,
  SavedRouteListItem,
  SaveRouteInput,
} from "@/types/route";

const LIST_KEY = "smarttrail_saved_routes_list";
const DETAIL_KEY = (id: string) => `smarttrail_saved_route_${id}`;

type SavedRoutesStore = {
  routes: SavedRouteListItem[];
  loading: boolean;
  error: string | null;

  bootstrap: () => Promise<void>;
  refresh: () => Promise<void>;
  clear: () => void;

  save: (input: SaveRouteInput) => Promise<SavedRoute>;
  getById: (id: string) => Promise<SavedRoute | null>;
  update: (
    id: string,
    patch: {
      title?: string;
      description?: string;
      isFavorite?: boolean;
    },
  ) => Promise<void>;
  remove: (id: string) => Promise<void>;
};

const persistList = (routes: SavedRouteListItem[]) =>
  AsyncStorage.setItem(LIST_KEY, JSON.stringify(routes)).catch(() => {});

const toListItem = (r: SavedRoute): SavedRouteListItem => {
  // Strip heavy fields from a full route to produce the list-cache shape.
  const { geometry, instructions, elevationProfile, aiPlan, pois, generationId, ...rest } =
    r;
  return rest;
};

export const useSavedRoutesStore = create<SavedRoutesStore>((set, get) => ({
  routes: [],
  loading: true,
  error: null,

  clear: () => {
    const { routes } = get();
    set({ routes: [], loading: false, error: null });
    const keys = [LIST_KEY, ...routes.map((r) => DETAIL_KEY(r.id))];
    Promise.all(keys.map((k) => AsyncStorage.removeItem(k))).catch(() => {});
  },

  bootstrap: async () => {
    try {
      const raw = await AsyncStorage.getItem(LIST_KEY);
      if (raw) {
        const cached: SavedRouteListItem[] = JSON.parse(raw);
        set({ routes: cached, loading: false });
      }
    } catch {}
    // Fire-and-forget network refresh — UI already has cached data
    get().refresh().catch(() => {});
  },

  refresh: async () => {
    const { authFetch } = useAuthStore.getState();
    const hadList = get().routes.length > 0;
    // Background refresh: keep showing cached list without toggling loading.
    if (!hadList) set({ loading: true, error: null });
    try {
      const { data } = await authFetch("/routes/saved");
      const routes: SavedRouteListItem[] = data.data.routes ?? [];
      set({ routes });
      persistList(routes);
    } catch (err: unknown) {
      // Stay on cached data — no throw, offline is a valid state
      set({ error: getErrMessage(err) });
    } finally {
      set({ loading: false });
    }
  },

  save: async (input) => {
    const { authFetch } = useAuthStore.getState();
    const { data } = await authFetch("/routes/saved", {
      method: "POST",
      data: input,
    });
    const route: SavedRoute = data.data.route;
    const item = toListItem(route);

    set((s) => ({ routes: [item, ...s.routes] }));
    persistList(get().routes);
    AsyncStorage.setItem(DETAIL_KEY(route.id), JSON.stringify(route)).catch(
      () => {},
    );
    return route;
  },

  getById: async (id) => {
    // Try cache first — this is what makes offline viewing work
    try {
      const raw = await AsyncStorage.getItem(DETAIL_KEY(id));
      if (raw) {
        const cached: SavedRoute = JSON.parse(raw);
        // Kick off a background refresh but return the cached copy immediately
        (async () => {
          try {
            const { authFetch } = useAuthStore.getState();
            const { data } = await authFetch(`/routes/saved/${id}`);
            const fresh: SavedRoute = data.data.route;
            AsyncStorage.setItem(DETAIL_KEY(id), JSON.stringify(fresh)).catch(
              () => {},
            );
          } catch {}
        })();
        return cached;
      }
    } catch {}

    // No cache — must go to network
    try {
      const { authFetch } = useAuthStore.getState();
      const { data } = await authFetch(`/routes/saved/${id}`);
      const route: SavedRoute = data.data.route;
      AsyncStorage.setItem(DETAIL_KEY(id), JSON.stringify(route)).catch(
        () => {},
      );
      return route;
    } catch {
      return null;
    }
  },

  update: async (id, patch) => {
    const prev = get().routes;
    // Optimistic update
    set({
      routes: prev.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    });
    persistList(get().routes);

    try {
      const { authFetch } = useAuthStore.getState();
      const { data } = await authFetch(`/routes/saved/${id}`, {
        method: "PATCH",
        data: patch,
      });
      const fresh: SavedRoute = data.data.route;
      const freshItem = toListItem(fresh);
      set((s) => ({
        routes: s.routes.map((r) => (r.id === id ? freshItem : r)),
      }));
      persistList(get().routes);
      AsyncStorage.setItem(DETAIL_KEY(id), JSON.stringify(fresh)).catch(
        () => {},
      );
    } catch (err) {
      // Roll back
      set({ routes: prev });
      persistList(prev);
      throw err;
    }
  },

  remove: async (id) => {
    const prev = get().routes;
    set({ routes: prev.filter((r) => r.id !== id) });
    persistList(get().routes);

    try {
      const { authFetch } = useAuthStore.getState();
      await authFetch(`/routes/saved/${id}`, { method: "DELETE" });
      AsyncStorage.removeItem(DETAIL_KEY(id)).catch(() => {});
    } catch (err) {
      set({ routes: prev });
      persistList(prev);
      throw err;
    }
  },
}));

// Clear all cached route data whenever the user signs out.
useAuthStore.subscribe((state, prevState) => {
  if (prevState.user !== null && state.user === null) {
    useSavedRoutesStore.getState().clear();
  }
});
