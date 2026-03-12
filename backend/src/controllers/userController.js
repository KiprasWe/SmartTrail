import { prisma } from "../config/db.js";
import bcrypt from "bcryptjs";
import { asyncHandler } from "../utils/asyncHandler.js";
import { Errors, Success, sendError, sendSuccess } from "../utils/responses.js";

const USER_SELECT = {
  id: true,
  username: true,
  email: true,
  bio: true,
  profilePicture: true,
  createdAt: true,
};

export const getUserProfile = asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: USER_SELECT,
  });

  return sendSuccess(res, Success.USER_FETCHED, { user });
});

export const editUserProfile = asyncHandler(async (req, res) => {
  const { username, bio, profilePicture } = req.body;

  if (username) {
    const existingUser = await prisma.user.findUnique({ where: { username } });
    if (existingUser && existingUser.id !== req.user.id) {
      return sendError(res, Errors.USER_USERNAME_EXISTS);
    }
  }

  const user = await prisma.user.update({
    where: { id: req.user.id },
    data: {
      ...(username !== undefined && { username }),
      ...(bio !== undefined && { bio }),
      ...(profilePicture !== undefined && { profilePicture }),
    },
    select: { ...USER_SELECT, updatedAt: true },
  });

  return sendSuccess(res, Success.USER_UPDATED, { user });
});

export const setPassword = asyncHandler(async (req, res) => {
  const { password } = req.body;
  // password validation handled by setPasswordSchema

  if (req.user.password) {
    return sendError(res, Errors.PASSWORD_ALREADY_SET);
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  await prisma.user.update({
    where: { id: req.user.id },
    data: { password: hashedPassword },
  });

  return sendSuccess(res, Success.PASSWORD_SET);
});
