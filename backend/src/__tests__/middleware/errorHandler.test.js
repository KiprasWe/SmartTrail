import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { errorHandler } from "../../middleware/errorHandler.js";

function mockRes() {
  return {
    _status: null,
    _body: null,
    status(code) {
      this._status = code;
      return this;
    },
    json(body) {
      this._body = body;
      return this;
    },
  };
}

describe("errorHandler", () => {
  const req = { method: "GET", path: "/test" };
  let consoleSpy;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.NODE_ENV;
  });

  it("always returns HTTP 500 with INTERNAL_SERVER_ERROR code", () => {
    const res = mockRes();
    errorHandler(new Error("something broke"), req, res, () => {});
    expect(res._status).toBe(500);
    expect(res._body.code).toBe("INTERNAL_SERVER_ERROR");
    expect(res._body.status).toBe("error");
  });

  it("logs as structured JSON in production", () => {
    process.env.NODE_ENV = "production";
    const res = mockRes();
    errorHandler(new Error("prod error"), req, res, () => {});
    expect(consoleSpy).toHaveBeenCalledOnce();
    const logArg = consoleSpy.mock.calls[0][0];
    const parsed = JSON.parse(logArg);
    expect(parsed.level).toBe("error");
    expect(parsed.method).toBe("GET");
    expect(parsed.path).toBe("/test");
    expect(parsed.message).toBe("prod error");
  });

  it("logs as plain text in development", () => {
    process.env.NODE_ENV = "development";
    const err = new Error("dev error");
    errorHandler(err, req, mockRes(), () => {});
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("GET /test"),
      err,
    );
  });

  it("does not call next()", () => {
    const next = vi.fn();
    errorHandler(new Error("x"), req, mockRes(), next);
    expect(next).not.toHaveBeenCalled();
  });
});
