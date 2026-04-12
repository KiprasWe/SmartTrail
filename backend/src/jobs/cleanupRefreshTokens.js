// Periodic cleanup of expired refresh tokens.
// Run this on a schedule (e.g. daily cron) or call startCleanupJob() on boot
// to schedule in-process cleanup.

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

/**
 * Schedule periodic cleanup every `intervalMs` (default: 6 hours).
 * Returns the interval handle so it can be cleared on shutdown.
 */
export function startCleanupJob(intervalMs = 6 * 60 * 60 * 1000) {
  // Run immediately on start, then on interval.
  cleanupExpiredRefreshTokens().catch((err) =>
    console.error("[cleanup] Initial run failed:", err.message),
  );
  return setInterval(() => {
    cleanupExpiredRefreshTokens().catch((err) =>
      console.error("[cleanup] Scheduled run failed:", err.message),
    );
  }, intervalMs);
}
