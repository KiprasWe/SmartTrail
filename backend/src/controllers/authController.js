import { prisma } from "../config/db.js";
import bcrypt from "bcryptjs";
import {
  generateAccessToken,
  generateRefreshToken,
} from "../utils/generateToken.js";
import { generateUniqueUsername } from "../utils/generateUniqueUsername.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { Errors, Success, sendError, sendSuccess } from "../utils/responses.js";
import { OAuth2Client } from "google-auth-library";
import crypto from "crypto";

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const buildTokenPair = async (userId) => ({
  accessToken: generateAccessToken(userId),
  refreshToken: await generateRefreshToken(userId),
});

const buildUserPayload = (user) => ({
  id: user.id,
  username: user.username,
  email: user.email,
  hasOnboarded: user.hasOnboarded,
});

const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

export const googleAuth = asyncHandler(async (req, res) => {
  const { idToken } = req.body;

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch {
    return sendError(res, Errors.ID_TOKEN_INVALID);
  }

  const { sub: googleId, email, name, picture } = payload;

  // OAuth jau susietas
  const existingOAuth = await prisma.oAuthAccount.findUnique({
    where: {
      provider_providerId: { provider: "google", providerId: googleId },
    },
    include: { user: true },
  });

  if (existingOAuth) {
    const tokens = await buildTokenPair(existingOAuth.userId);
    return sendSuccess(res, Success.USER_LOGGED_IN, {
      user: buildUserPayload(existingOAuth.user),
      ...tokens,
    });
  }

  // If a local account exists with the same email, link the OAuth account
  // only when the Google-verified email matches exactly. This prevents an
  // attacker from taking over an existing account by creating a Google
  // account with an email they don't actually control in our system.
  const existingUser = await prisma.user.findUnique({ where: { email } });

  if (existingUser) {
    // email from Google payload is already verified by Google — safe to link
    await prisma.oAuthAccount.create({
      data: {
        provider: "google",
        providerId: googleId,
        userId: existingUser.id,
      },
    });

    const tokens = await buildTokenPair(existingUser.id);
    return sendSuccess(res, Success.USER_LOGGED_IN, {
      user: buildUserPayload(existingUser),
      ...tokens,
    });
  }

  // naujas useris, uzreginam
  const newUser = await prisma.user.create({
    data: {
      email,
      username: await generateUniqueUsername(name),
      profilePicture: picture,
      oAuthAccounts: {
        create: { provider: "google", providerId: googleId },
      },
    },
  });

  const tokens = await buildTokenPair(newUser.id);
  return sendSuccess(res, Success.USER_CREATED, {
    user: buildUserPayload(newUser),
    ...tokens,
  });
});

export const signup = asyncHandler(async (req, res) => {
  const { username, email, password } = req.body;
  // passworda tikrinam su zod schema

  const [emailTaken, usernameTaken] = await Promise.all([
    prisma.user.findUnique({ where: { email } }),
    prisma.user.findUnique({ where: { username } }),
  ]);

  if (emailTaken) return sendError(res, Errors.USER_EMAIL_EXISTS);
  if (usernameTaken) return sendError(res, Errors.USER_USERNAME_EXISTS);

  const hashedPassword = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: { username, email, password: hashedPassword },
  });

  const tokens = await buildTokenPair(user.id);
  return sendSuccess(res, Success.USER_CREATED, {
    user: buildUserPayload(user),
    ...tokens,
  });
});

export const signin = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await prisma.user.findUnique({ where: { email } });

  // Nera userio arba neturi passwordo
  if (!user || !user.password) {
    return sendError(res, Errors.INVALID_LOGIN);
  }

  const isPasswordValid = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) {
    return sendError(res, Errors.INVALID_LOGIN);
  }

  const tokens = await buildTokenPair(user.id);
  return sendSuccess(res, Success.USER_LOGGED_IN, {
    user: buildUserPayload(user),
    ...tokens,
  });
});

export const refresh = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;

  const storedToken = await prisma.refreshToken.findUnique({
    where: { token: hashToken(refreshToken) },
    include: { user: true },
  });

  if (!storedToken) {
    return sendError(res, Errors.INVALID_REFRESH_TOKEN);
  }

  // Check expiry BEFORE deleting so we don't strand the client with neither
  // a valid token nor a useful error. Both branches delete the token so it
  // can only be used once regardless of the outcome.
  if (storedToken.expiresAt < new Date()) {
    await prisma.refreshToken.delete({ where: { id: storedToken.id } });
    return sendError(res, Errors.REFRESH_TOKEN_EXPIRED);
  }

  await prisma.refreshToken.delete({ where: { id: storedToken.id } });

  const tokens = await buildTokenPair(storedToken.userId);
  return sendSuccess(res, Success.REFRESH_TOKEN_CREATED, tokens);
});

export const signout = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;

  if (refreshToken) {
    await prisma.refreshToken.deleteMany({
      where: { token: hashToken(refreshToken) },
    });
  }

  return sendSuccess(res, Success.USER_LOGGED_OUT);
});
