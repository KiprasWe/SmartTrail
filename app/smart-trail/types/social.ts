export type SocialUser = {
  id: string;
  username: string;
  profilePicture?: string | null;
  isPublic: boolean;
  followStatus?: "PENDING" | "ACCEPTED" | null;
  followedAt?: string;
};

export type FollowRequest = {
  id: string;
  username: string;
  profilePicture?: string | null;
  requestId: string;
  requestedAt: string;
};

export type SocialProfile = {
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
