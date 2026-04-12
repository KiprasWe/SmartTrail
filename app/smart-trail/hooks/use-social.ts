import { useCallback } from "react";
import { AxiosRequestConfig, AxiosResponse } from "axios";

type AuthFetch = (input: string, config?: AxiosRequestConfig) => Promise<AxiosResponse>;

export type SocialUser = {
  id: string;
  username: string;
  profilePicture?: string | null;
  isPublic: boolean;
  followStatus?: "PENDING" | "ACCEPTED" | null;
  followedAt?: string;
};

export type UserProfile = {
  id: string;
  username: string;
  profilePicture?: string | null;
  bio?: string | null;
  isPublic: boolean;
  followersCount: number;
  followingCount: number;
  isOwnProfile: boolean;
  followStatus: "PENDING" | "ACCEPTED" | null;
  canViewContent: boolean;
};

export type FollowRequest = {
  id: string;
  username: string;
  profilePicture?: string | null;
  requestId: string;
  requestedAt: string;
};

export function useSocial(authFetch: AuthFetch | null | undefined) {
  const searchUsers = useCallback(
    async (username: string): Promise<SocialUser[]> => {
      if (!authFetch || username.trim().length < 2) return [];
      const { data } = await authFetch(
        `/social/search/${encodeURIComponent(username.trim())}`,
      );
      if (data?.status !== "success" || !data.data) return [];
      return (data.data.users ?? []) as SocialUser[];
    },
    [authFetch],
  );

  const sendFollow = useCallback(
    async (userId: string): Promise<"NOW_FOLLOWING" | "FOLLOW_REQUEST_SENT"> => {
      if (!authFetch) throw new Error("Not authenticated");
      const { data } = await authFetch("/social/follow", {
        method: "POST",
        data: { userId },
      });
      return data.code;
    },
    [authFetch],
  );

  const unfollow = useCallback(
    async (userId: string) => {
      if (!authFetch) throw new Error("Not authenticated");
      await authFetch(`/social/unfollow/${userId}`, { method: "DELETE" });
    },
    [authFetch],
  );

  const cancelRequest = useCallback(
    async (userId: string) => {
      if (!authFetch) throw new Error("Not authenticated");
      await authFetch(`/social/cancel/${userId}`, { method: "DELETE" });
    },
    [authFetch],
  );

  const acceptRequest = useCallback(
    async (userId: string) => {
      if (!authFetch) throw new Error("Not authenticated");
      await authFetch(`/social/accept/${userId}`, { method: "POST" });
    },
    [authFetch],
  );

  const rejectRequest = useCallback(
    async (userId: string) => {
      if (!authFetch) throw new Error("Not authenticated");
      await authFetch(`/social/reject/${userId}`, { method: "POST" });
    },
    [authFetch],
  );

  const removeFollower = useCallback(
    async (userId: string) => {
      if (!authFetch) throw new Error("Not authenticated");
      await authFetch(`/social/remove/${userId}`, { method: "DELETE" });
    },
    [authFetch],
  );

  const getFollowers = useCallback(
    async (userId: string): Promise<SocialUser[]> => {
      if (!authFetch) return [];
      const { data } = await authFetch(`/social/${userId}/followers`);
      return data.data.followers ?? [];
    },
    [authFetch],
  );

  const getFollowing = useCallback(
    async (userId: string): Promise<SocialUser[]> => {
      if (!authFetch) return [];
      const { data } = await authFetch(`/social/${userId}/following`);
      return data.data.following ?? [];
    },
    [authFetch],
  );

  const getUserProfile = useCallback(
    async (userId: string): Promise<UserProfile> => {
      if (!authFetch) throw new Error("Not authenticated");
      const { data } = await authFetch(`/social/profile/${encodeURIComponent(userId)}`);
      if (data?.status !== "success" || !data.data?.profile) {
        throw new Error("Profile unavailable");
      }
      return data.data.profile as UserProfile;
    },
    [authFetch],
  );

  const getFollowRequests = useCallback(async (): Promise<FollowRequest[]> => {
    if (!authFetch) return [];
    const { data } = await authFetch("/social/requests");
    return data.data.followRequests ?? [];
  }, [authFetch]);

  return {
    searchUsers,
    getUserProfile,
    sendFollow,
    unfollow,
    cancelRequest,
    acceptRequest,
    rejectRequest,
    removeFollower,
    getFollowers,
    getFollowing,
    getFollowRequests,
  };
}
