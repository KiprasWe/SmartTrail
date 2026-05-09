const TIMEOUT_ROUTING_MS = 30_000;

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
  { timeoutMs = TIMEOUT_ROUTING_MS, retries = 3, baseDelayMs = 600 } = {},
) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithTimeout(url, opts, timeoutMs);
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        lastErr = new Error(`HTTP ${res.status}`);
        const jitter = Math.random() * 300;
        await new Promise((r) =>
          setTimeout(r, baseDelayMs * 2 ** attempt + jitter),
        );
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        const jitter = Math.random() * 300;
        await new Promise((r) =>
          setTimeout(r, baseDelayMs * 2 ** attempt + jitter),
        );
      }
    }
  }
  throw lastErr;
}
