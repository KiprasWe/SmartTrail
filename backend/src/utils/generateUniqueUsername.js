import { prisma } from "../config/db.js";

export const generateUniqueUsername = async (displayName) => {
  const base =
    (displayName ?? "user")
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 20) || "user";

  const candidates = [
    base,
    ...Array.from({ length: 9 }, (_, i) => `${base}${i + 1}`),
  ];

  const taken = await prisma.user.findMany({
    where: { username: { in: candidates } },
    select: { username: true },
  });
  const takenSet = new Set(taken.map((u) => u.username));

  const free = candidates.find((c) => !takenSet.has(c));
  return free ?? `${base}${Date.now()}`;
};
