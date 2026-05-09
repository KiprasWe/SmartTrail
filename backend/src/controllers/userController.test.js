import { describe, it, expect, vi, beforeEach } from "vitest";

import { Errors, Success } from "../utils/responses.js";

const flushPromises = async () => new Promise((r) => setTimeout(r, 0));

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("../config/db.js", () => ({ prisma: prismaMock }));

vi.mock("bcryptjs", () => ({
  default: {
    hash: vi.fn(async () => "hashed"),
    compare: vi.fn(async () => true),
  },
}));

const makeRes = () => ({
  status: vi.fn().mockReturnThis(),
  json: vi.fn().mockReturnThis(),
});

describe("userController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Redaguoti savo informaciją auto: PATCH /user/me updates username/bio and returns USER_UPDATED", async () => {
    const { editUserProfile } = await import("./userController.js");

    prismaMock.user.findUnique.mockResolvedValueOnce(null); // username not taken
    prismaMock.user.update.mockResolvedValueOnce({
      id: "u1",
      username: "newname",
      email: "u1@example.com",
      bio: "hi",
      hasOnboarded: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      password: null,
    });

    const req = { user: { id: "u1" }, body: { username: "newname", bio: "hi" } };
    const res = makeRes();

    editUserProfile(req, res, vi.fn());
    await flushPromises();

    expect(res.status).toHaveBeenCalledWith(Success.USER_UPDATED.status);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "success",
        code: Success.USER_UPDATED.code,
        data: expect.objectContaining({
          user: expect.objectContaining({
            id: "u1",
            username: "newname",
            hasPassword: false,
          }),
        }),
      }),
    );
  });

  it("Redaguoti savo informaciją auto: returns USER_USERNAME_EXISTS when username already taken", async () => {
    const { editUserProfile } = await import("./userController.js");

    prismaMock.user.findUnique.mockResolvedValueOnce({ id: "u2", username: "taken" });

    const req = { user: { id: "u1" }, body: { username: "taken" } };
    const res = makeRes();

    editUserProfile(req, res, vi.fn());
    await flushPromises();

    expect(res.status).toHaveBeenCalledWith(Errors.USER_USERNAME_EXISTS.status);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error", code: Errors.USER_USERNAME_EXISTS.code }),
    );
  });

  it("Nustatyti slaptažodį auto: POST /user/me/set-password returns PASSWORD_SET when no password exists", async () => {
    const { setPassword } = await import("./userController.js");

    const req = { user: { id: "u1", password: null }, body: { password: "Password1" } };
    const res = makeRes();

    setPassword(req, res, vi.fn());
    await flushPromises();

    expect(prismaMock.user.update).toHaveBeenCalledOnce();
    expect(res.status).toHaveBeenCalledWith(Success.PASSWORD_SET.status);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: "success", code: Success.PASSWORD_SET.code }),
    );
  });

  it("Pakeisti slaptažodį auto: POST /user/me/change-password returns PASSWORD_CHANGED when current password matches", async () => {
    const { changePassword } = await import("./userController.js");

    const req = {
      user: { id: "u1", password: "hashed-old" },
      body: { currentPassword: "OldPass1", newPassword: "NewPass1" },
    };
    const res = makeRes();

    changePassword(req, res, vi.fn());
    await flushPromises();

    expect(prismaMock.user.update).toHaveBeenCalledOnce();
    expect(res.status).toHaveBeenCalledWith(Success.PASSWORD_CHANGED.status);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: "success", code: Success.PASSWORD_CHANGED.code }),
    );
  });
});

