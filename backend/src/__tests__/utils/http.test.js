import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchWithTimeout, fetchWithRetry } from "../../utils/http.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchWithTimeout", () => {
  it("returns the response on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200 }));
    const res = await fetchWithTimeout("https://example.com");
    expect(res.status).toBe(200);
  });

  it('throws "fetch timed out" when fetch rejects with AbortError', async () => {
    const abortErr = new Error("aborted");
    abortErr.name = "AbortError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortErr));
    await expect(
      fetchWithTimeout("https://example.com", {}, 50),
    ).rejects.toThrow("fetch timed out");
  });

  it("rethrows non-abort errors unchanged", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network failure")),
    );
    await expect(fetchWithTimeout("https://example.com")).rejects.toThrow(
      "network failure",
    );
  });

  it("passes options to fetch", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal("fetch", mockFetch);
    await fetchWithTimeout("https://example.com", { method: "POST" });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

describe("fetchWithRetry", () => {
  it("returns the response immediately on first success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200 }));
    const res = await fetchWithRetry("https://example.com", {}, { retries: 0 });
    expect(res.status).toBe(200);
  });

  it("retries after a 5xx response and returns success on retry", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({ status: 503 })
      .mockResolvedValueOnce({ status: 200 });
    vi.stubGlobal("fetch", mockFetch);
    const res = await fetchWithRetry("https://example.com", {}, {
      retries: 1,
      baseDelayMs: 1,
    });
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("returns the last 5xx response when retries are exhausted", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue({ status: 502 });
    vi.stubGlobal("fetch", mockFetch);
    const res = await fetchWithRetry("https://example.com", {}, {
      retries: 1,
      baseDelayMs: 1,
    });
    expect(res.status).toBe(502);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("throws the last error when all attempts throw", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("connection refused")),
    );
    await expect(
      fetchWithRetry("https://example.com", {}, { retries: 1, baseDelayMs: 1 }),
    ).rejects.toThrow("connection refused");
  });

  it("returns a 2xx response without retrying", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 201 });
    vi.stubGlobal("fetch", mockFetch);
    await fetchWithRetry("https://example.com", {}, { retries: 3, baseDelayMs: 1 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
