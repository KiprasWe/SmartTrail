import jwt from "jsonwebtoken";
import crypto from "crypto";
import { prisma } from "../config/db.js";
import { JWT_SECRET, JWT_EXPIRES_IN } from "../config/env.js";

export const generateAccessToken = (userId) => {
  const payload = { id: userId };
  const token = jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });

  return token;
};

export const generateRefreshToken = async (userId) => {
  const rawToken = crypto.randomBytes(64).toString("hex");

  const hashedToken = crypto
    .createHash("sha256")
    .update(rawToken)
    .digest("hex");

  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); 

  await prisma.refreshToken.create({
    data: {
      token: hashedToken,
      userId,
      expiresAt,
    },
  });

  return rawToken;
};
