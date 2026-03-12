import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { AxiosRequestConfig, AxiosResponse } from "axios";
import {
  GoogleSignin,
  statusCodes,
} from "@react-native-google-signin/google-signin";
import api from "@/lib/api";

WebBrowser.maybeCompleteAuthSession();

const GOOGLE_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

type User = {
  id: string;
  email: string;
  username?: string;
  bio?: string;
  profilePicture?: string;
  createdAt?: string;
};

type AuthContextType = {
  token: string | null;
  user: User | null;
  signin: (email: string, password: string) => Promise<void>;
  signout: () => Promise<void>;
  signinWithGoogle: () => Promise<void>;
  authFetch: (
    input: string,
    config?: AxiosRequestConfig,
  ) => Promise<AxiosResponse>;
  isLoading: boolean;
};

const AuthContext = createContext<AuthContextType>({
  token: null,
  user: null,
  signin: async () => {},
  signout: async () => {},
  signinWithGoogle: async () => {},
  authFetch: async () => ({ data: {} }) as AxiosResponse,
  isLoading: true,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const isRefreshing = useRef(false);
  const refreshSubscribers = useRef<((token: string) => void)[]>([]);

  GoogleSignin.configure({
    webClientId: GOOGLE_CLIENT_ID,
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  });

  useEffect(() => {
    Promise.all([
      SecureStore.getItemAsync("accessToken"),
      SecureStore.getItemAsync("user"),
    ]).then(([t, u]) => {
      if (t) setToken(t);
      if (u) setUser(JSON.parse(u));
      setIsLoading(false);
    });
  }, []);

  const persistAuth = async (
    accessToken: string,
    refreshToken: string,
    userData: User,
  ) => {
    await Promise.all([
      SecureStore.setItemAsync("accessToken", accessToken),
      SecureStore.setItemAsync("refreshToken", refreshToken),
      SecureStore.setItemAsync("user", JSON.stringify(userData)),
    ]);
    setToken(accessToken);
    setUser(userData);
  };

  const clearAuth = async () => {
    await Promise.all([
      SecureStore.deleteItemAsync("accessToken"),
      SecureStore.deleteItemAsync("refreshToken"),
      SecureStore.deleteItemAsync("user"),
    ]);
    setToken(null);
    setUser(null);
  };

  const onRefreshed = (newToken: string) => {
    refreshSubscribers.current.forEach((cb) => cb(newToken));
    refreshSubscribers.current = [];
  };

  const refreshAccessToken = useCallback(async (): Promise<string | null> => {
    const storedRefresh = await SecureStore.getItemAsync("refreshToken");
    if (!storedRefresh) {
      await clearAuth();
      return null;
    }

    try {
      const { data } = await api.post("/auth/refresh", {
        refreshToken: storedRefresh,
      });

      await Promise.all([
        SecureStore.setItemAsync("accessToken", data.data.accessToken),
        SecureStore.setItemAsync("refreshToken", data.data.refreshToken),
      ]);
      setToken(data.data.accessToken);

      return data.data.accessToken;
    } catch {
      await clearAuth();
      return null;
    }
  }, []);

  const authFetch = useCallback(
    async (
      input: string,
      config: AxiosRequestConfig = {},
    ): Promise<AxiosResponse> => {
      const currentToken = await SecureStore.getItemAsync("accessToken");

      console.log("authFetch →", input, "baseURL:", api.defaults.baseURL);
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
      } catch (err: any) {
        if (err?.response?.status !== 401) throw err;

        if (isRefreshing.current) {
          return new Promise((resolve, reject) => {
            refreshSubscribers.current.push(async (newToken: string) => {
              try {
                resolve(await makeRequest(newToken));
              } catch (retryErr) {
                reject(retryErr);
              }
            });
          });
        }

        isRefreshing.current = true;
        const newToken = await refreshAccessToken();
        isRefreshing.current = false;

        if (!newToken) throw err;

        onRefreshed(newToken);
        return makeRequest(newToken);
      }
    },
    [refreshAccessToken],
  );

  const signin = async (email: string, password: string) => {
    const { data } = await api.post("/auth/signin", { email, password });
    await persistAuth(
      data.data.accessToken,
      data.data.refreshToken,
      data.data.user,
    );
  };

  const signinWithGoogle = async () => {
    try {
      await GoogleSignin.hasPlayServices();
      await GoogleSignin.signOut();
      await GoogleSignin.signIn();

      const { idToken } = await GoogleSignin.getTokens();
      if (!idToken) throw new Error("No idToken returned from Google");

      const { data } = await api.post("/auth/google", { idToken });
      await persistAuth(
        data.data.accessToken,
        data.data.refreshToken,
        data.data.user,
      );
    } catch (error: any) {
      if (
        error.code === statusCodes.SIGN_IN_CANCELLED ||
        error.code === statusCodes.IN_PROGRESS
      ) {
        return;
      }
      throw error;
    }
  };

  const signout = async () => {
    const refreshToken = await SecureStore.getItemAsync("refreshToken");
    await api.post("/auth/signout", { refreshToken }).catch(() => {});
    await clearAuth();
  };

  return (
    <AuthContext.Provider
      value={{
        token,
        user,
        signin,
        signout,
        signinWithGoogle,
        authFetch,
        isLoading,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
