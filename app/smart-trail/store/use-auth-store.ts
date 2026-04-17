// store/use-auth-store.ts
import { create } from "zustand";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { AxiosRequestConfig, AxiosResponse } from "axios";
import {
  GoogleSignin,
  statusCodes,
} from "@react-native-google-signin/google-signin";
import api from "@/lib/api";

WebBrowser.maybeCompleteAuthSession();

GoogleSignin.configure({
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
});

// Module-level mutable refs — must survive renders, not Zustand state.
// _refreshPromise is stored so all concurrent 401s await the same refresh
// rather than spawning multiple refresh requests.
let _isRefreshing = false;
let _refreshSubscribers: ((token: string) => void)[] = [];
let _refreshRejectSubscribers: ((err: unknown) => void)[] = [];

const REFRESH_TIMEOUT_MS = 15_000;

export type AuthUser = {
  id: string;
  email: string;
  username?: string;
  bio?: string;
  profilePicture?: string;
  createdAt?: string;
  hasOnboarded: boolean;
};

type AuthStore = {
  token: string | null;
  user: AuthUser | null;
  isLoading: boolean;
  // internal
  _persistAuth: (
    accessToken: string,
    refreshToken: string,
    userData: AuthUser,
  ) => Promise<void>;
  _clearAuth: () => Promise<void>;
  // public
  bootstrap: () => Promise<void>;
  completeOnboarding: () => Promise<void>;
  signin: (email: string, password: string) => Promise<void>;
  signup: (
    username: string,
    email: string,
    password: string,
  ) => Promise<void>;
  signout: () => Promise<void>;
  signinWithGoogle: () => Promise<void>;
  authFetch: (
    input: string,
    config?: AxiosRequestConfig,
  ) => Promise<AxiosResponse>;
  getValidToken: () => Promise<string>;
};

export const useAuthStore = create<AuthStore>((set, get) => ({
  token: null,
  user: null,
  isLoading: true,

  _persistAuth: async (accessToken, refreshToken, userData) => {
    await Promise.all([
      SecureStore.setItemAsync("accessToken", accessToken),
      SecureStore.setItemAsync("refreshToken", refreshToken),
      SecureStore.setItemAsync("user", JSON.stringify(userData)),
    ]);
    set({ token: accessToken, user: userData });
  },

  _clearAuth: async () => {
    await Promise.all([
      SecureStore.deleteItemAsync("accessToken"),
      SecureStore.deleteItemAsync("refreshToken"),
      SecureStore.deleteItemAsync("user"),
    ]);
    // Profile store subscribes to auth user → null changes and clears itself
    // (see use-profile-store.ts bottom). No cross-import needed here.
    set({ token: null, user: null });
  },

  bootstrap: async () => {
    const [t, u] = await Promise.all([
      SecureStore.getItemAsync("accessToken"),
      SecureStore.getItemAsync("user"),
    ]);
    set({
      token: t ?? null,
      user: u ? JSON.parse(u) : null,
      isLoading: false,
    });
  },

  completeOnboarding: async () => {
    await get().authFetch("/user/me/complete-onboarding", { method: "post" });
    const { user } = get();
    if (user) {
      const updated: AuthUser = { ...user, hasOnboarded: true };
      await SecureStore.setItemAsync("user", JSON.stringify(updated));
      set({ user: updated });
    }
  },

  signin: async (email, password) => {
    const { data } = await api.post("/auth/signin", { email, password });
    await get()._persistAuth(
      data.data.accessToken,
      data.data.refreshToken,
      data.data.user,
    );
  },

  signup: async (username, email, password) => {
    const { data } = await api.post("/auth/signup", {
      username,
      email,
      password,
    });
    await get()._persistAuth(
      data.data.accessToken,
      data.data.refreshToken,
      data.data.user,
    );
  },

  signout: async () => {
    const refreshToken = await SecureStore.getItemAsync("refreshToken");
    await api.post("/auth/signout", { refreshToken }).catch(() => {});
    await get()._clearAuth();
  },

  signinWithGoogle: async () => {
    try {
      await GoogleSignin.hasPlayServices();
      await GoogleSignin.signOut();
      await GoogleSignin.signIn();
      const { idToken } = await GoogleSignin.getTokens();
      if (!idToken) throw new Error("No idToken returned from Google");
      const { data } = await api.post("/auth/google", { idToken });
      await get()._persistAuth(
        data.data.accessToken,
        data.data.refreshToken,
        data.data.user,
      );
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error.code === statusCodes.SIGN_IN_CANCELLED ||
          error.code === statusCodes.IN_PROGRESS)
      )
        return;
      throw error;
    }
  },

  authFetch: async (input, config = {}) => {
    const currentToken = await SecureStore.getItemAsync("accessToken");

    const makeRequest = (tkn: string) =>
      api.request({
        url: input,
        ...config,
        headers: {
          ...(config.headers ?? {}),
          Authorization: `Bearer ${tkn}`,
        },
      });

    try {
      return await makeRequest(currentToken ?? "");
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status !== 401) throw err;

      // Another refresh is already in flight — queue this request and wait.
      if (_isRefreshing) {
        return new Promise((resolve, reject) => {
          _refreshSubscribers.push(async (newToken: string) => {
            try { resolve(await makeRequest(newToken)); }
            catch (retryErr) { reject(retryErr); }
          });
          _refreshRejectSubscribers.push(reject);
        });
      }

      _isRefreshing = true;
      const storedRefresh = await SecureStore.getItemAsync("refreshToken");

      if (!storedRefresh) {
        _isRefreshing = false;
        await get()._clearAuth();
        throw err;
      }

      const flushReject = (e: unknown) => {
        _refreshRejectSubscribers.forEach((cb) => cb(e));
        _refreshSubscribers = [];
        _refreshRejectSubscribers = [];
        _isRefreshing = false;
      };

      try {
        // Race the refresh call against a hard timeout so queued requests
        // don't hang forever if the refresh endpoint is unreachable.
        const refreshResult = await Promise.race([
          api.post("/auth/refresh", { refreshToken: storedRefresh }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Refresh timed out")), REFRESH_TIMEOUT_MS),
          ),
        ]);

        const newToken = (refreshResult as { data: { data: { accessToken: string; refreshToken: string } } }).data.data.accessToken;
        const newRefresh = (refreshResult as { data: { data: { accessToken: string; refreshToken: string } } }).data.data.refreshToken;
        await Promise.all([
          SecureStore.setItemAsync("accessToken", newToken),
          SecureStore.setItemAsync("refreshToken", newRefresh),
        ]);
        set({ token: newToken });
        _refreshSubscribers.forEach((cb) => cb(newToken));
        _refreshSubscribers = [];
        _refreshRejectSubscribers = [];
        _isRefreshing = false;
        return makeRequest(newToken);
      } catch (refreshErr) {
        flushReject(refreshErr);
        await get()._clearAuth();
        throw err;
      }
    }
  },

  getValidToken: async () => {
    const stored = await SecureStore.getItemAsync("accessToken");
    if (!stored) return "";
    try {
      const b64 = stored.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      const { exp } = JSON.parse(atob(b64));
      // Proactively refresh if the token expires within 60 seconds.
      if (exp * 1000 > Date.now() + 60_000) return stored;
    } catch {
      return stored;
    }
    const storedRefresh = await SecureStore.getItemAsync("refreshToken");
    if (!storedRefresh) {
      await get()._clearAuth();
      return "";
    }
    try {
      const result = await api.post("/auth/refresh", { refreshToken: storedRefresh });
      const newToken: string = result.data.data.accessToken;
      const newRefresh: string = result.data.data.refreshToken;
      await Promise.all([
        SecureStore.setItemAsync("accessToken", newToken),
        SecureStore.setItemAsync("refreshToken", newRefresh),
      ]);
      set({ token: newToken });
      return newToken;
    } catch {
      await get()._clearAuth();
      return "";
    }
  },
}));
