// store/saved-routes-store.ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { RoutePayload } from "./route-store";

const KEY = "smarttrail_saved_routes";

export type SavedRoute = {
  id: string;
  title: string;
  mode: RoutePayload["mode"];
  savedAt: number;
  distance: number; // metres
  duration: number; // seconds
  selectedIdx: number;
  payload: RoutePayload;
};

async function getAll(): Promise<SavedRoute[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function getById(id: string): Promise<SavedRoute | null> {
  const all = await getAll();
  return all.find((r) => r.id === id) ?? null;
}

async function save(
  entry: Omit<SavedRoute, "id" | "savedAt">,
): Promise<SavedRoute> {
  const all = await getAll();
  const saved: SavedRoute = {
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    savedAt: Date.now(),
  };
  await AsyncStorage.setItem(KEY, JSON.stringify([saved, ...all]));
  return saved;
}

async function remove(id: string): Promise<void> {
  const all = await getAll();
  await AsyncStorage.setItem(
    KEY,
    JSON.stringify(all.filter((r) => r.id !== id)),
  );
}

export const savedRoutesStore = { getAll, getById, save, remove };
