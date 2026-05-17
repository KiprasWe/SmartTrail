import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import express from "express";
import bcrypt from "bcryptjs";

const { prismaMock, verifyIdTokenMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn(), create: vi.fn(), findMany: vi.fn() },
    oAuthAccount: { findUnique: vi.fn(), create: vi.fn() },
    refreshToken: {
      create: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  },
  verifyIdTokenMock: vi.fn(),
}));

vi.mock("../../config/db.js", () => ({
  prisma: prismaMock,
  connectDB: vi.fn(),
  disconnectDB: vi.fn(),
}));

vi.mock("google-auth-library", () => ({
  OAuth2Client: vi.fn(() => ({ verifyIdToken: verifyIdTokenMock })),
}));

const { default: authRoutes } = await import("../../routes/authRoutes.js");
const { errorHandler } = await import("../../middleware/errorHandler.js");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/auth", authRoutes);
  app.use(errorHandler);
  return app;
}

const app = buildApp();

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.refreshToken.create.mockResolvedValue({});
  prismaMock.refreshToken.deleteMany.mockResolvedValue({ count: 1 });
});

describe("Registruotis (POST /auth/signup)", () => {
  it("naujo naudotojo duomenys -> 201, naudotojo info ir tokenai", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null); // el. paštas ir vardas laisvi
    prismaMock.user.create.mockResolvedValue({
      id: "u1",
      username: "newuser",
      email: "new@example.com",
      hasOnboarded: false,
    });

    const res = await request(app).post("/auth/signup").send({
      username: "newuser",
      email: "new@example.com",
      password: "password1",
      passwordConfirm: "password1",
    });

    expect(res.status).toBe(201);
    expect(res.body.code).toBe("USER_CREATED");
    expect(res.body.data.user).toMatchObject({
      id: "u1",
      email: "new@example.com",
    });
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.refreshToken).toBeTruthy();
  });

  it("jau egzistuojantis el. paštas -> 400, naujas naudotojas nesukuriamas", async () => {
    prismaMock.user.findUnique.mockImplementation(({ where }) =>
      where.email ? { id: "existing", email: where.email } : null,
    );

    const res = await request(app).post("/auth/signup").send({
      username: "newuser",
      email: "taken@example.com",
      password: "password1",
      passwordConfirm: "password1",
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("USER_EMAIL_EXISTS");
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it("neteisingi duomenys (per trumpas slaptažodis) -> 400", async () => {
    const res = await request(app).post("/auth/signup").send({
      username: "newuser",
      email: "new@example.com",
      password: "short",
      passwordConfirm: "short",
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_REQUEST");
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });
});

describe("Prisijungti (POST /auth/signin)", () => {
  it("egzistuojančio naudotojo duomenys -> 200 ir tokenai", async () => {
    const hashed = await bcrypt.hash("password1", 12);
    prismaMock.user.findUnique.mockResolvedValue({
      id: "u1",
      username: "user",
      email: "user@example.com",
      password: hashed,
      hasOnboarded: true,
    });

    const res = await request(app)
      .post("/auth/signin")
      .send({ email: "user@example.com", password: "password1" });

    expect(res.status).toBe(200);
    expect(res.body.code).toBe("USER_LOGGED_IN");
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.refreshToken).toBeTruthy();
  });

  it("neteisingas slaptažodis -> 401 ir klaidos pranešimas", async () => {
    const hashed = await bcrypt.hash("password1", 12);
    prismaMock.user.findUnique.mockResolvedValue({
      id: "u1",
      email: "user@example.com",
      password: hashed,
    });

    const res = await request(app)
      .post("/auth/signin")
      .send({ email: "user@example.com", password: "wrongpass" });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("INVALID_LOGIN");
  });

  it("neegzistuojantis el. paštas -> 401", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post("/auth/signin")
      .send({ email: "ghost@example.com", password: "password1" });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("INVALID_LOGIN");
  });
});

describe("Prisijungti su Google (POST /auth/google)", () => {
  it("naujas naudotojas -> 201 ir tokenai", async () => {
    verifyIdTokenMock.mockResolvedValue({
      getPayload: () => ({
        sub: "google-123",
        email: "g@example.com",
        name: "Google User",
      }),
    });
    prismaMock.oAuthAccount.findUnique.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.findMany.mockResolvedValue([]); // generateUniqueUsername
    prismaMock.user.create.mockResolvedValue({
      id: "gu1",
      username: "googleuser",
      email: "g@example.com",
      hasOnboarded: false,
    });

    const res = await request(app)
      .post("/auth/google")
      .send({ idToken: "valid-token" });

    expect(res.status).toBe(201);
    expect(res.body.code).toBe("USER_CREATED");
    expect(res.body.data.accessToken).toBeTruthy();
  });

  it("egzistuojantis Google naudotojas -> 200 ir tokenai", async () => {
    verifyIdTokenMock.mockResolvedValue({
      getPayload: () => ({
        sub: "google-123",
        email: "g@example.com",
        name: "Google User",
      }),
    });
    prismaMock.oAuthAccount.findUnique.mockResolvedValue({
      userId: "gu1",
      user: { id: "gu1", username: "googleuser", email: "g@example.com" },
    });

    const res = await request(app)
      .post("/auth/google")
      .send({ idToken: "valid-token" });

    expect(res.status).toBe(200);
    expect(res.body.code).toBe("USER_LOGGED_IN");
    expect(res.body.data.accessToken).toBeTruthy();
  });

  it("negaliojantis idToken -> 401 ir klaidos pranešimas", async () => {
    verifyIdTokenMock.mockRejectedValue(new Error("invalid token"));

    const res = await request(app)
      .post("/auth/google")
      .send({ idToken: "bad-token" });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("ID_TOKEN_INVALID");
  });
});

describe("Atsijungti (POST /auth/signout)", () => {
  it("atsijungimo užklausa su refresh tokenu -> 200, tokenas pašalintas", async () => {
    const res = await request(app)
      .post("/auth/signout")
      .send({ refreshToken: "some-refresh-token" });

    expect(res.status).toBe(200);
    expect(res.body.code).toBe("USER_LOGGED_OUT");
    expect(prismaMock.refreshToken.deleteMany).toHaveBeenCalledOnce();
  });
});
