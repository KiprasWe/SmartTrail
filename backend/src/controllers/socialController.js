import { prisma } from "../config/db.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { Errors, Success, sendError, sendSuccess } from "../utils/responses.js";

const PUBLIC_USER_SELECT = {
  id: true,
  username: true,
  profilePicture: true,
  isPublic: true,
};

export const searchUsers = asyncHandler(async (req, res) => {
  const { username } = req.params;
  const currentUserId = req.user.id;

  const users = await prisma.user.findMany({
    where: {
      username: { contains: username, mode: "insensitive" },
      NOT: { id: currentUserId },
    },
    select: PUBLIC_USER_SELECT,
  });

  const follows = await prisma.follow.findMany({
    where: {
      followerId: currentUserId,
      followingId: { in: users.map((u) => u.id) },
    },
    select: { followingId: true, status: true },
  });

  const followMap = Object.fromEntries(
    follows.map((f) => [f.followingId, f.status]),
  );

  const result = users.map((u) => ({
    ...u,
    followStatus: followMap[u.id] ?? null, // null | "PENDING" | "ACCEPTED"
  }));

  return sendSuccess(res, Success.USERS_FETCHED, { users: result });
});

export const sendFollowRequest = asyncHandler(async (req, res) => {
  const { userId } = req.body;
  const followerId = req.user.id;

  if (userId === followerId) {
    return sendError(res, Errors.CANNOT_FOLLOW_SELF);
  }

  const targetUser = await prisma.user.findUnique({ where: { id: userId } });

  if (!targetUser) {
    return sendError(res, Errors.USER_NOT_FOUND);
  }

  const existingFollow = await prisma.follow.findUnique({
    where: {
      followerId_followingId: { followerId, followingId: userId },
    },
  });

  if (existingFollow) {
    return sendError(
      res,
      existingFollow.status === "ACCEPTED"
        ? Errors.ALREADY_FOLLOWING
        : Errors.FOLLOW_ALREADY_EXISTS,
    );
  }

  const follow = await prisma.follow.create({
    data: {
      followerId,
      followingId: userId,
      status: targetUser.isPublic ? "ACCEPTED" : "PENDING",
    },
  });

  return sendSuccess(
    res,
    targetUser.isPublic ? Success.NOW_FOLLOWING : Success.FOLLOW_REQUEST_SENT,
    { follow },
  );
});

export const acceptFollowRequest = asyncHandler(async (req, res) => {
  const { userId } = req.params; // the person who sent the request
  const followingId = req.user.id; // you (the one accepting)

  const follow = await prisma.follow.findUnique({
    where: {
      followerId_followingId: { followerId: userId, followingId },
    },
  });

  if (!follow) {
    return sendError(res, Errors.FOLLOW_REQUEST_NOT_FOUND);
  }

  if (follow.status === "ACCEPTED") {
    return sendError(res, Errors.ALREADY_FOLLOWING);
  }

  const updated = await prisma.follow.update({
    where: {
      followerId_followingId: { followerId: userId, followingId },
    },
    data: { status: "ACCEPTED" },
  });

  return sendSuccess(res, Success.FOLLOW_ACCEPTED, { follow: updated });
});

export const rejectFollowRequest = asyncHandler(async (req, res) => {
  const { userId } = req.params; // the person who sent the request
  const followingId = req.user.id; // you (the one rejecting)

  const follow = await prisma.follow.findUnique({
    where: {
      followerId_followingId: { followerId: userId, followingId },
    },
  });

  if (!follow || follow.status !== "PENDING") {
    return sendError(res, Errors.FOLLOW_REQUEST_NOT_FOUND);
  }

  await prisma.follow.delete({
    where: {
      followerId_followingId: { followerId: userId, followingId },
    },
  });

  return sendSuccess(res, Success.FOLLOW_REJECTED);
});

export const cancelFollowRequest = asyncHandler(async (req, res) => {
  const { userId } = req.params; // the person you sent the request to
  const followerId = req.user.id; // you (the one cancelling)

  const follow = await prisma.follow.findUnique({
    where: {
      followerId_followingId: { followerId, followingId: userId },
    },
  });

  if (!follow || follow.status !== "PENDING") {
    return sendError(res, Errors.FOLLOW_REQUEST_NOT_FOUND);
  }

  await prisma.follow.delete({
    where: {
      followerId_followingId: { followerId, followingId: userId },
    },
  });

  return sendSuccess(res, Success.FOLLOW_CANCELLED);
});

export const unfollowUser = asyncHandler(async (req, res) => {
  const { userId } = req.params; // the person you want to unfollow
  const followerId = req.user.id; // you

  const follow = await prisma.follow.findUnique({
    where: {
      followerId_followingId: { followerId, followingId: userId },
    },
  });

  if (!follow || follow.status !== "ACCEPTED") {
    return sendError(res, Errors.NOT_FOLLOWING);
  }

  await prisma.follow.delete({
    where: {
      followerId_followingId: { followerId, followingId: userId },
    },
  });

  return sendSuccess(res, Success.UNFOLLOWED);
});

export const removeFollower = asyncHandler(async (req, res) => {
  const { userId } = req.params; // the follower you want to remove
  const followingId = req.user.id; // you

  const follow = await prisma.follow.findUnique({
    where: {
      followerId_followingId: { followerId: userId, followingId },
    },
  });

  if (!follow || follow.status !== "ACCEPTED") {
    return sendError(res, Errors.NOT_A_FOLLOWER);
  }

  await prisma.follow.delete({
    where: {
      followerId_followingId: { followerId: userId, followingId },
    },
  });

  return sendSuccess(res, Success.FOLLOWER_REMOVED);
});

export const getFollowers = asyncHandler(async (req, res) => {
  const { userId } = req.params;

  const follows = await prisma.follow.findMany({
    where: { followingId: userId, status: "ACCEPTED" },
    select: {
      follower: { select: PUBLIC_USER_SELECT },
      createdAt: true,
    },
  });

  const followers = follows.map((f) => ({
    ...f.follower,
    followedAt: f.createdAt,
  }));

  return sendSuccess(res, Success.FOLLOWERS_FETCHED, { followers });
});

export const getFollowing = asyncHandler(async (req, res) => {
  const { userId } = req.params;

  const follows = await prisma.follow.findMany({
    where: { followerId: userId, status: "ACCEPTED" },
    select: {
      following: { select: PUBLIC_USER_SELECT },
      createdAt: true,
    },
  });

  const following = follows.map((f) => ({
    ...f.following,
    followedAt: f.createdAt,
  }));

  return sendSuccess(res, Success.FOLLOWING_FETCHED, { following });
});

export const getUserProfile = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const currentUserId = req.user.id;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      profilePicture: true,
      bio: true,
      isPublic: true,
      _count: {
        select: {
          followers: { where: { status: "ACCEPTED" } },
          following: { where: { status: "ACCEPTED" } },
        },
      },
    },
  });

  if (!user) {
    return sendError(res, Errors.USER_NOT_FOUND);
  }

  const isOwnProfile = userId === currentUserId;

  let followStatus = null;
  if (!isOwnProfile) {
    const follow = await prisma.follow.findUnique({
      where: { followerId_followingId: { followerId: currentUserId, followingId: userId } },
      select: { status: true },
    });
    followStatus = follow?.status ?? null;
  }

  const canViewContent = isOwnProfile || user.isPublic || followStatus === "ACCEPTED";

  const { _count, ...rest } = user;

  return sendSuccess(res, Success.PROFILE_FETCHED, {
    profile: {
      ...rest,
      followersCount: _count.followers,
      followingCount: _count.following,
      isOwnProfile,
      followStatus,
      canViewContent,
    },
  });
});

export const getFollowRequests = asyncHandler(async (req, res) => {
  const followingId = req.user.id;

  const requests = await prisma.follow.findMany({
    where: { followingId, status: "PENDING" },
    select: {
      id: true,
      follower: {
        select: { id: true, username: true, profilePicture: true },
      },
      createdAt: true,
    },
  });

  const followRequests = requests.map((r) => ({
    ...r.follower,
    requestId: r.id,
    requestedAt: r.createdAt,
  }));

  return sendSuccess(res, Success.FOLLOW_REQUESTS_FETCHED, { followRequests });
});
