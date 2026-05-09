import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- Mocks (must be defined before importing controller) ----
const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  oAuthAccount: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  refreshToken: {
    findUnique: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  },
}));

vi.mock("../config/db.js", () => ({ prisma: prismaMock }));

vi.mock("bcryptjs", () => ({
  default: {
    hash: vi.fn(async () => "hashed"),
    compare: vi.fn(async () => true),
  },
}));

vi.mock("../utils/generateToken.js", () => ({
  generateAccessToken: vi.fn(() => "access.jwt"),
  generateRefreshToken: vi.fn(async () => "refresh.token"),
}));

vi.mock("../utils/generateUniqueUsername.js", () => ({
  generateUniqueUsername: vi.fn(async () => "unique_name"),
}));

const verifyIdTokenMock = vi.hoisted(() => vi.fn());
vi.mock("google-auth-library", () => ({
  OAuth2Client: vi.fn(() => ({
    verifyIdToken: verifyIdTokenMock,
  })),
}));

import { Errors, Success } from "../utils/responses.js";
import { signup, signin, refresh, googleAuth, signout } from "./authController.js";

const flushPromises = async () => {
  // authController handlers are wrapped in asyncHandler which does not return the promise
  await new Promise((r) => setTimeout(r, 0));
};

const makeRes = () => {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res;
};

describe("authController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Registruotis auto: POST /auth/signup returns USER_CREATED + tokens", async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce(null) // emailTaken
      .mockResolvedValueOnce(null); // usernameTaken

    prismaMock.user.create.mockResolvedValueOnce({
      id: "u1",
      username: "john",
      email: "john@example.com",
      hasOnboarded: false,
    });

    const req = {
      body: { username: "john", email: "john@example.com", password: "Password1" },
    };
    const res = makeRes();

    signup(req, res, vi.fn());
    await flushPromises();

    expect(res.status).toHaveBeenCalledWith(Success.USER_CREATED.status);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "success",
        code: Success.USER_CREATED.code,
        data: expect.objectContaining({
          user: expect.objectContaining({ id: "u1", email: "john@example.com" }),
          accessToken: "access.jwt",
          refreshToken: "refresh.token",
        }),
      }),
    );
  });

  it("Prisijungti auto: POST /auth/refresh returns REFRESH_TOKEN_CREATED when refresh token exists", async () => {
    prismaMock.refreshToken.findUnique.mockResolvedValueOnce({
      id: "rt1",
      userId: "u1",
      expiresAt: new Date(Date.now() + 60_000),
      user: { id: "u1" },
    });
    prismaMock.refreshToken.delete.mockResolvedValueOnce({ id: "rt1" });

    const req = { body: { refreshToken: "refresh.token" } };
    const res = makeRes();

    refresh(req, res, vi.fn());
    await flushPromises();

    expect(prismaMock.refreshToken.delete).toHaveBeenCalledWith({ where: { id: "rt1" } });
    expect(res.status).toHaveBeenCalledWith(Success.REFRESH_TOKEN_CREATED.status);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "success",
        code: Success.REFRESH_TOKEN_CREATED.code,
        data: { accessToken: "access.jwt", refreshToken: "refresh.token" },
      }),
    );
  });

  it("Prisijungti su „Google” auto: POST /auth/google returns ID_TOKEN_INVALID when verify fails", async () => {
    verifyIdTokenMock.mockRejectedValueOnce(new Error("bad token"));

    const req = { body: { idToken: "bad" } };
    const res = makeRes();

    googleAuth(req, res, vi.fn());
    await flushPromises();

    expect(res.status).toHaveBeenCalledWith(Errors.ID_TOKEN_INVALID.status);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "error",
        code: Errors.ID_TOKEN_INVALID.code,
      }),
    );
  });

  it("Atsijungti auto: POST /auth/signout deletes refresh token (if provided) and returns USER_LOGGED_OUT", async () => {
    prismaMock.refreshToken.deleteMany.mockResolvedValueOnce({ count: 1 });

    const req = { body: { refreshToken: "refresh.token" } };
    const res = makeRes();

    signout(req, res, vi.fn());
    await flushPromises();

    expect(prismaMock.refreshToken.deleteMany).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(Success.USER_LOGGED_OUT.status);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "success",
        code: Success.USER_LOGGED_OUT.code,
      }),
    );
  });

  it("Prisijungti auto (password): POST /auth/signin returns INVALID_LOGIN when user not found", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);

    const req = { body: { email: "missing@example.com", password: "x" } };
    const res = makeRes();

    signin(req, res, vi.fn());
    await flushPromises();

    expect(res.status).toHaveBeenCalledWith(Errors.INVALID_LOGIN.status);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "error",
        code: Errors.INVALID_LOGIN.code,
      }),
    );
  });
});

