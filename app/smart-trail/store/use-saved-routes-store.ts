

import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuthStore } from "./use-auth-store";
import { resolveErr } from "@/lib/error-messages";
import {
  downloadOfflinePack,
  deleteOfflinePack,
  deleteAllOfflinePacks,
} from "@/lib/offline-map";
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
  
  const { geometry, elevationProfile, aiPlan, pois, generationId, ...rest } = r;
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
    deleteAllOfflinePacks(routes.map((r) => r.id)).catch(() => {});
  },

  bootstrap: async () => {
    try {
      const raw = await AsyncStorage.getItem(LIST_KEY);
      if (raw) {
        const cached: SavedRouteListItem[] = JSON.parse(raw);
        set({ routes: cached, loading: false });
      }
    } catch {}
    
    get().refresh().catch(() => {});
  },

  refresh: async () => {
    const { authFetch } = useAuthStore.getState();
    const hadList = get().routes.length > 0;
    
    if (!hadList) set({ loading: true, error: null });
    try {
      const { data } = await authFetch("/routes/saved");
      const routes: SavedRouteListItem[] = data.data.routes ?? [];
      set({ routes });
      persistList(routes);
    } catch (err: unknown) {
      
      set({ error: resolveErr(err) });
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
    downloadOfflinePack(route.id, route.bbox).catch(() => {});
    return route;
  },

  getById: async (id) => {
    
    try {
      const raw = await AsyncStorage.getItem(DETAIL_KEY(id));
      if (raw) {
        const cached: SavedRoute = JSON.parse(raw);
        
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
      deleteOfflinePack(id).catch(() => {});
    } catch (err) {
      set({ routes: prev });
      persistList(prev);
      throw err;
    }
  },
}));

useAuthStore.subscribe((state, prevState) => {
  if (prevState.user !== null && state.user === null) {
    useSavedRoutesStore.getState().clear();
  }
});
