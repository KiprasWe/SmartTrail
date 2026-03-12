import { prisma } from "../config/db.js";

export const generateUniqueUsername = async (displayName) => {
  const base = displayName
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9]/g, "");

  let username = base;
  let attempts = 0;

  while (attempts < 10) {
    const exists = await prisma.user.findUnique({ where: { username } });
    if (!exists) return username;
    username = `${base}${Math.floor(Math.random() * 9000) + 1000}`;
    attempts++;
  }

  return `${base}${Date.now()}`;
};
