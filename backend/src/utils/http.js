const TIMEOUT_ROUTING_MS = 30_000;
export const TIMEOUT_PLACES_MS = 15_000;

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

export async function fetchWithRetry(
  url,
  opts = {},
  { timeoutMs = TIMEOUT_ROUTING_MS, retries = 2, baseDelayMs = 200 } = {},
) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithTimeout(url, opts, timeoutMs);
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
