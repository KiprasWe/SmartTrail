import jwt from "jsonwebtoken";
import { prisma } from "../config/db.js";
import { sendError, Errors } from "../utils/responses.js";
import { JWT_SECRET } from "../config/env.js";

export const authMiddleware = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    token = req.headers.authorization.split(" ")[1];
  } else if (req.cookies?.jwt) {
    token = req.cookies.jwt;
  }

  if (!token) {
    return sendError(res, Errors.NOT_AUTHORIZED);
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await prisma.user.findUnique({ where: { id: decoded.id } });

    if (!user) {
      return sendError(res, Errors.USER_NOT_FOUND);
    }

    req.user = user;
    next();
  } catch (err) {
    return sendError(res, Errors.NOT_AUTHORIZED);
  }
};
