// utils/http.js — low-level fetch helpers used across lib modules

const TIMEOUT_ROUTING_MS = 30_000; // ORS routing
export const TIMEOUT_PLACES_MS = 15_000; // Google Places text search / photo

export async function fetchWithTimeout(
  url,
  opts = {},
  timeoutMs = TIMEOUT_ROUTING_MS,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } catch (err) {
    if (err.name === "AbortError") throw new Error("fetch timed out");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * fetchWithTimeout with simple exponential back-off retry on 5xx / network errors.
 */
export async function fetchWithRetry(
  url,
  opts = {},
  { timeoutMs = TIMEOUT_ROUTING_MS, retries = 2, baseDelayMs = 200 } = {},
) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithTimeout(url, opts, timeoutMs);
      // Retry only on server-side transient errors, not 4xx.
      if (res.status >= 500 && attempt < retries) {
        lastErr = new Error(`HTTP ${res.status}`);
        await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** attempt));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** attempt));
      }
    }
  }
  throw lastErr;
}
