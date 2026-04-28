import { prisma } from "../config/db.js";
import bcrypt from "bcryptjs";
import { asyncHandler } from "../utils/asyncHandler.js";
import { Errors, Success, sendError, sendSuccess } from "../utils/responses.js";

const USER_SELECT = {
  id: true,
  username: true,
  email: true,
  bio: true,
  hasOnboarded: true,
  createdAt: true,
  password: true,
};

const serializeUser = (user) => {
  const { password, ...rest } = user;
  return { ...rest, hasPassword: !!password };
};

export const completeOnboarding = asyncHandler(async (req, res) => {
  await prisma.user.update({
    where: { id: req.user.id },
    data: { hasOnboarded: true },
  });
  return sendSuccess(res, Success.USER_UPDATED, { hasOnboarded: true });
});

export const getUserProfile = asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: USER_SELECT,
  });

  return sendSuccess(res, Success.USER_FETCHED, { user: serializeUser(user) });
});

export const editUserProfile = asyncHandler(async (req, res) => {
  const { username, bio } = req.body;

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
    },
    select: { ...USER_SELECT, updatedAt: true },
  });

  return sendSuccess(res, Success.USER_UPDATED, { user: serializeUser(user) });
});

export const setPassword = asyncHandler(async (req, res) => {
  const { password } = req.body;

  if (req.user.password) {
    return sendError(res, Errors.PASSWORD_ALREADY_SET);
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  await prisma.user.update({
    where: { id: req.user.id },
    data: { password: hashedPassword },
  });

  return sendSuccess(res, Success.PASSWORD_SET);
});

export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!req.user.password) {
    return sendError(res, Errors.NO_PASSWORD_SET);
  }

  const valid = await bcrypt.compare(currentPassword, req.user.password);
  if (!valid) {
    return sendError(res, Errors.INVALID_CURRENT_PASSWORD);
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);

  await prisma.user.update({
    where: { id: req.user.id },
    data: { password: hashedPassword },
  });

  return sendSuccess(res, Success.PASSWORD_CHANGED);
});
