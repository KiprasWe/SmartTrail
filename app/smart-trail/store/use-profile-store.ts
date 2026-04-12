// store/use-profile-store.ts
import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { useAuthStore } from "./use-auth-store";
import { getErrMessage } from "@/lib/error-messages";

const CACHE_KEY = "smarttrail_profile";

export interface UserProfile {
  id: string;
  username: string;
  email: string;
  bio?: string | null;
  profilePicture?: string | null;
  createdAt: string;
  hasPassword: boolean;
}

export interface EditForm {
  username: string;
  bio: string;
  profilePicture: string; // local URI (file://) or remote URL or empty
}

const isLocalUri = (uri: string) =>
  uri.startsWith("file://") || uri.startsWith("/");

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
        // Only use the cache if it belongs to the currently logged-in user
        if (user && cached.id === user.id) {
          set({ profile: cached, loading: false });
        }
      }
    } catch {}
    // fetch fresh in background (don't await)
    get().fetchProfile();
  },

  fetchProfile: async () => {
    const { authFetch } = useAuthStore.getState();
    const hadProfile = get().profile !== null;
    // Avoid flashing the full-screen loader when we already show cached profile.
    if (!hadProfile) set({ loading: true, error: null });
    try {
      const { data } = await authFetch("/user/me");
      const profile: UserProfile = data.data.user;
      set({ profile, error: null });
      AsyncStorage.setItem(CACHE_KEY, JSON.stringify(profile)).catch(() => {});
    } catch (err: unknown) {
      set({ error: getErrMessage(err) });
    } finally {
      set({ loading: false });
    }
  },

  updateProfile: async (form) => {
    const { authFetch } = useAuthStore.getState();
    const hasNewPicture = form.profilePicture && isLocalUri(form.profilePicture);

    if (hasNewPicture) {
      const formData = new FormData();
      const uri = form.profilePicture!;
      const filename = uri.split("/").pop() ?? "profile.jpg";
      const ext = filename.split(".").pop()?.toLowerCase() ?? "jpg";
      const mimeType =
        ext === "png"
          ? "image/png"
          : ext === "webp"
            ? "image/webp"
            : "image/jpeg";

      formData.append("profilePicture", {
        uri: Platform.OS === "android" ? uri : uri.replace("file://", ""),
        name: filename,
        type: mimeType,
      } as any);

      if (form.username) formData.append("username", form.username);
      if (form.bio !== undefined) formData.append("bio", form.bio);

      const { data } = await authFetch("/user/me", {
        method: "PATCH",
        data: formData,
        headers: { "Content-Type": "multipart/form-data" },
      });
      return data.data.user;
    }

    const { username, bio } = form;
    const { data } = await authFetch("/user/me", {
      method: "PATCH",
      data: {
        ...(username && { username }),
        ...(bio !== undefined && { bio }),
      },
    });
    return data.data.user;
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

// Clear profile data whenever the user signs out. This replaces the dynamic
// require("./use-profile-store") that was in use-auth-store.ts _clearAuth to
// break the circular dependency — now the import is one-way: profile → auth.
useAuthStore.subscribe(
  (state, prevState) => {
    if (prevState.user !== null && state.user === null) {
      useProfileStore.getState().clear();
    }
  },
);
