import { prisma } from "../config/db.js";

export async function cleanupExpiredRefreshTokens() {
  const { count } = await prisma.refreshToken.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  if (count > 0) {
    console.log(`[cleanup] Deleted ${count} expired refresh token(s)`);
  }
  return count;
}

export function startCleanupJob(intervalMs = 6 * 60 * 60 * 1000) {
  cleanupExpiredRefreshTokens().catch((err) =>
    console.error("[cleanup] Initial run failed:", err.message),
  );
  return setInterval(() => {
    cleanupExpiredRefreshTokens().catch((err) =>
      console.error("[cleanup] Scheduled run failed:", err.message),
    );
  }, intervalMs);
}
