import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import express from "express";
import bcrypt from "bcryptjs";
import { authHeader } from "../helpers/auth.js";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("../../config/db.js", () => ({
  prisma: prismaMock,
  connectDB: vi.fn(),
  disconnectDB: vi.fn(),
}));

const { default: userRoutes } = await import("../../routes/userRoutes.js");
const { errorHandler } = await import("../../middleware/errorHandler.js");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/user", userRoutes());
  app.use(errorHandler);
  return app;
}

const app = buildApp();

function mockAuthUser(user) {
  prismaMock.user.findUnique.mockImplementation(({ where }) => {
    if (where.id) return Promise.resolve(user);
    return Promise.resolve(null);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Redaguoti savo informaciją (PATCH /user/me)", () => {
  it("prisijungęs naudotojas, bent 1 keičiamas laukas -> 200, atnaujinti duomenys", async () => {
    mockAuthUser({ id: "user-1", username: "old", email: "u@e.com" });
    prismaMock.user.update.mockResolvedValue({
      id: "user-1",
      username: "naujas",
      email: "u@e.com",
    });

    const res = await request(app)
      .patch("/user/me")
      .set(authHeader())
      .send({ username: "naujas" });

    expect(res.status).toBe(200);
    expect(res.body.code).toBe("USER_UPDATED");
    expect(res.body.data.user.username).toBe("naujas");
  });

  it("be prisijungimo tokeno -> 401", async () => {
    const res = await request(app).patch("/user/me").send({ username: "x" });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("NOT_AUTHORIZED");
  });

  it("neteisingi duomenys (tuščias body) -> 400", async () => {
    mockAuthUser({ id: "user-1", username: "old" });

    const res = await request(app).patch("/user/me").set(authHeader()).send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_REQUEST");
  });
});

describe("Nustatyti slaptažodį (POST /user/me/set-password)", () => {
  it("užklausa su norimu slaptažodžiu -> 200", async () => {
    mockAuthUser({ id: "user-1", username: "u", password: null });
    prismaMock.user.update.mockResolvedValue({ id: "user-1" });

    const res = await request(app)
      .post("/user/me/set-password")
      .set(authHeader())
      .send({ password: "newpass123" });

    expect(res.status).toBe(200);
    expect(res.body.code).toBe("PASSWORD_SET");
  });

  it("be prisijungimo tokeno -> 401", async () => {
    const res = await request(app)
      .post("/user/me/set-password")
      .send({ password: "newpass123" });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("NOT_AUTHORIZED");
  });

  it("neteisingi duomenys (per trumpas slaptažodis) -> 400", async () => {
    mockAuthUser({ id: "user-1", username: "u", password: null });

    const res = await request(app)
      .post("/user/me/set-password")
      .set(authHeader())
      .send({ password: "short" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_REQUEST");
  });
});

describe("Pakeisti slaptažodį (POST /user/me/change-password)", () => {
  it("užklausa su dabartiniu ir nauju slaptažodžiu -> 200", async () => {
    const hashed = await bcrypt.hash("oldpass123", 12);
    mockAuthUser({ id: "user-1", username: "u", password: hashed });
    prismaMock.user.update.mockResolvedValue({ id: "user-1" });

    const res = await request(app)
      .post("/user/me/change-password")
      .set(authHeader())
      .send({ currentPassword: "oldpass123", newPassword: "newpass123" });

    expect(res.status).toBe(200);
    expect(res.body.code).toBe("PASSWORD_CHANGED");
  });

  it("be prisijungimo tokeno -> 401", async () => {
    const res = await request(app)
      .post("/user/me/change-password")
      .send({ currentPassword: "oldpass123", newPassword: "newpass123" });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("NOT_AUTHORIZED");
  });

  it("neteisingi duomenys (neteisingas dabartinis slaptažodis) -> 401", async () => {
    const hashed = await bcrypt.hash("oldpass123", 12);
    mockAuthUser({ id: "user-1", username: "u", password: hashed });

    const res = await request(app)
      .post("/user/me/change-password")
      .set(authHeader())
      .send({ currentPassword: "wrongpass", newPassword: "newpass123" });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("INVALID_CURRENT_PASSWORD");
  });
});
