import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("jsonwebtoken", () => ({
  default: { verify: vi.fn() },
}));

vi.mock("../../config/db.js", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
  },
}));

import jwt from "jsonwebtoken";
import { prisma } from "../../config/db.js";
import { authMiddleware } from "../../middleware/authMiddleware.js";

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

describe("authMiddleware", () => {
  let req, res, next;

  beforeEach(() => {
    req = { headers: {}, cookies: {} };
    res = mockRes();
    next = vi.fn();
    vi.resetAllMocks();
  });

  it("returns 401 when no token is present", async () => {
    await authMiddleware(req, res, next);
    expect(res._status).toBe(401);
    expect(res._body.status).toBe("error");
    expect(res._body.code).toBe("NOT_AUTHORIZED");
    expect(next).not.toHaveBeenCalled();
  });

  it("reads the token from the Authorization Bearer header", async () => {
    req.headers.authorization = "Bearer mytoken";
    jwt.verify.mockReturnValue({ id: "user-1" });
    prisma.user.findUnique.mockResolvedValue({ id: "user-1", email: "a@b.com" });

    await authMiddleware(req, res, next);

    expect(jwt.verify).toHaveBeenCalledWith("mytoken", process.env.JWT_SECRET);
    expect(req.user).toEqual({ id: "user-1", email: "a@b.com" });
    expect(next).toHaveBeenCalledOnce();
  });

  it("reads the token from the jwt cookie", async () => {
    req.cookies = { jwt: "cookietoken" };
    jwt.verify.mockReturnValue({ id: "user-2" });
    prisma.user.findUnique.mockResolvedValue({ id: "user-2" });

    await authMiddleware(req, res, next);

    expect(jwt.verify).toHaveBeenCalledWith("cookietoken", process.env.JWT_SECRET);
    expect(next).toHaveBeenCalledOnce();
  });

  it("prefers the Authorization header over the cookie", async () => {
    req.headers.authorization = "Bearer headertoken";
    req.cookies = { jwt: "cookietoken" };
    jwt.verify.mockReturnValue({ id: "user-3" });
    prisma.user.findUnique.mockResolvedValue({ id: "user-3" });

    await authMiddleware(req, res, next);

    expect(jwt.verify).toHaveBeenCalledWith("headertoken", process.env.JWT_SECRET);
  });

  it("returns 401 when the user no longer exists in the database", async () => {
    req.headers.authorization = "Bearer mytoken";
    jwt.verify.mockReturnValue({ id: "ghost-user" });
    prisma.user.findUnique.mockResolvedValue(null);

    await authMiddleware(req, res, next);

    expect(res._status).toBe(401);
    expect(res._body.code).toBe("USER_NOT_FOUND");
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when jwt.verify throws (expired or invalid token)", async () => {
    req.headers.authorization = "Bearer badtoken";
    jwt.verify.mockImplementation(() => {
      throw new Error("invalid signature");
    });

    await authMiddleware(req, res, next);

    expect(res._status).toBe(401);
    expect(res._body.code).toBe("NOT_AUTHORIZED");
    expect(next).not.toHaveBeenCalled();
  });

  it("attaches the full user object to req.user", async () => {
    const user = { id: "u1", email: "x@y.com", username: "xuser", bio: null };
    req.headers.authorization = "Bearer tok";
    jwt.verify.mockReturnValue({ id: "u1" });
    prisma.user.findUnique.mockResolvedValue(user);

    await authMiddleware(req, res, next);

    expect(req.user).toEqual(user);
  });
});
