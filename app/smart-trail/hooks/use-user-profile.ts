import { useState, useEffect, useCallback } from "react";
import { AxiosRequestConfig, AxiosResponse } from "axios";

export interface UserProfile {
  id: string;
  username: string;
  email: string;
  bio?: string | null;
  profilePicture?: string | null;
  createdAt: string;
}

export interface EditForm {
  username: string;
  bio: string;
  profilePicture: string;
}

type AuthFetch = (
  input: string,
  config?: AxiosRequestConfig,
) => Promise<AxiosResponse>;

export function useUserProfile(authFetch: AuthFetch | null | undefined) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    if (!authFetch) return;
    try {
      setLoading(true);
      setError(null);
      const { data } = await authFetch("/user/me");
      setProfile(data.data.user);
    } catch (err: any) {
      setError(err.response?.data?.code ?? err.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const updateProfile = async (
    form: Partial<EditForm>,
  ): Promise<UserProfile> => {
    if (!authFetch) throw new Error("Not authenticated");
    const { data } = await authFetch("/user/me", {
      method: "PATCH",
      data: form,
    });
    return data.data.user;
  };

  return { profile, loading, error, fetchProfile, updateProfile, setProfile };
}
