import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuthStore } from "./use-auth-store";
import { resolveErr } from "@/lib/error-messages";
import type { UserProfile, EditForm } from "@/types/profile";

export type { UserProfile, EditForm };

const CACHE_KEY = "smarttrail_profile";

type ProfileStore = {
  profile: UserProfile | null;
  loading: boolean;
  error: string | null;
  clear: () => void;
  setProfile: (value: UserProfile | null) => void;
  bootstrap: () => Promise<void>;
  fetchProfile: () => Promise<void>;
  updateProfile: (form: Partial<EditForm>) => Promise<UserProfile>;
  changePassword: (
    currentPassword: string,
    newPassword: string,
  ) => Promise<void>;
  setPassword: (password: string) => Promise<void>;
};

export const useProfileStore = create<ProfileStore>((set, get) => ({
  profile: null,
  loading: true,
  error: null,

  clear: () => {
    set({ profile: null, loading: false, error: null });
    AsyncStorage.removeItem(CACHE_KEY).catch(() => {});
  },

  setProfile: (value) => {
    set({ profile: value });
    if (value)
      AsyncStorage.setItem(CACHE_KEY, JSON.stringify(value)).catch(() => {});
    else AsyncStorage.removeItem(CACHE_KEY).catch(() => {});
  },

  bootstrap: async () => {
    try {
      const raw = await AsyncStorage.getItem(CACHE_KEY);
      if (raw) {
        const cached: UserProfile = JSON.parse(raw);
        const { user } = useAuthStore.getState();

        if (user && cached.id === user.id) {
          set({ profile: cached, loading: false });
        }
      }
    } catch {}

    get().fetchProfile();
  },

  fetchProfile: async () => {
    const { authFetch } = useAuthStore.getState();
    const hadProfile = get().profile !== null;

    if (!hadProfile) set({ loading: true, error: null });
    try {
      const { data } = await authFetch("/user/me");
      const profile: UserProfile = data.data.user;
      set({ profile, error: null });
      AsyncStorage.setItem(CACHE_KEY, JSON.stringify(profile)).catch(() => {});
    } catch (err: unknown) {
      set({ error: resolveErr(err) });
    } finally {
      set({ loading: false });
    }
  },

  updateProfile: async (form) => {
    const { authFetch } = useAuthStore.getState();
    const { username, bio } = form;
    const { data } = await authFetch("/user/me", {
      method: "PATCH",
      data: {
        ...(username && { username }),
        ...(bio !== undefined && { bio }),
      },
    });
    const updated: UserProfile = data.data.user;
    get().setProfile(updated);
    return updated;
  },

  changePassword: async (currentPassword, newPassword) => {
    const { authFetch } = useAuthStore.getState();
    await authFetch("/user/me/change-password", {
      method: "POST",
      data: { currentPassword, newPassword },
    });
  },

  setPassword: async (password) => {
    const { authFetch } = useAuthStore.getState();
    await authFetch("/user/me/set-password", {
      method: "POST",
      data: { password },
    });
    set((s) => ({
      profile: s.profile ? { ...s.profile, hasPassword: true } : null,
    }));
  },
}));

useAuthStore.subscribe((state, prevState) => {
  if (prevState.user !== null && state.user === null) {
    useProfileStore.getState().clear();
  }
});
