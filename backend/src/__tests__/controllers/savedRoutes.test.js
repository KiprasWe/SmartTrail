import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import express from "express";
import { authHeader } from "../helpers/auth.js";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn() },
    route: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}));

vi.mock("../../config/db.js", () => ({
  prisma: prismaMock,
  connectDB: vi.fn(),
  disconnectDB: vi.fn(),
}));
vi.mock("@prisma/client", () => ({
  Prisma: { join: (arr) => arr.join(",") },
}));
vi.mock("../../lib/ors.js", () => ({
  fetchORSDirections: vi.fn(),
  orsFeatureToRouteData: vi.fn(),
  buildProfileOpts: vi.fn(),
  fetchRoutePois: vi.fn(),
  filterUnreachablePois: vi.fn(),
}));
vi.mock("../../lib/loop-algo.js", () => ({ generateLoop: vi.fn() }));
vi.mock("../../lib/ai/pipeline.js", () => ({ runAiPipeline: vi.fn() }));
vi.mock("../../lib/ai/shared.js", () => ({
  genai: null,
  GEMINI_MODEL: "test",
  extractJsonArray: () => [],
}));

const { default: buildRoutesRouter } =
  await import("../../routes/routesRoutes.js");
const { errorHandler } = await import("../../middleware/errorHandler.js");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/routes", buildRoutesRouter());
  app.use(errorHandler);
  return app;
}

const app = buildApp();

const validSaveBody = {
  title: "Mano maršrutas",
  description: "Aprašymas",
  transport: "foot-walking",
  distance: 5200,
  duration: 3600,
  ascent: 100,
  descent: 80,
  geometry: {
    type: "LineString",
    coordinates: [
      [25.0, 54.0],
      [25.1, 54.1],
    ],
  },
  bbox: [25.0, 54.0, 25.1, 54.1],
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.user.findUnique.mockResolvedValue({ id: "user-1" });
});

describe("Išsaugoti maršrutą (POST /routes/saved)", () => {
  it("prisijungęs vartotojas, teisingi duomenys -> 201 ir išsaugotas maršrutas", async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      { id: "route-1", userId: "user-1", title: "Mano maršrutas" },
    ]);

    const res = await request(app)
      .post("/routes/saved")
      .set(authHeader())
      .send(validSaveBody);

    expect(res.status).toBe(201);
    expect(res.body.code).toBe("ROUTE_SAVED");
    expect(res.body.data.route.id).toBe("route-1");
  });

  it("be prisijungimo tokeno -> 401", async () => {
    const res = await request(app).post("/routes/saved").send(validSaveBody);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("NOT_AUTHORIZED");
  });

  it("neteisingi duomenys (trūksta title) -> 400", async () => {
    const { title, ...invalid } = validSaveBody;
    const res = await request(app)
      .post("/routes/saved")
      .set(authHeader())
      .send(invalid);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_REQUEST");
  });
});

describe("Redaguoti maršruto informaciją (PATCH /routes/saved/:id)", () => {
  it("prisijungęs vartotojas, nauji duomenys -> 200 ir atnaujintas maršrutas", async () => {
    prismaMock.route.findUnique.mockResolvedValue({
      id: "route-1",
      userId: "user-1",
    });
    prismaMock.route.update.mockResolvedValue({
      id: "route-1",
      title: "Naujas pavadinimas",
    });

    const res = await request(app)
      .patch("/routes/saved/route-1")
      .set(authHeader())
      .send({ title: "Naujas pavadinimas" });

    expect(res.status).toBe(200);
    expect(res.body.code).toBe("ROUTE_UPDATED");
    expect(res.body.data.route.title).toBe("Naujas pavadinimas");
  });

  it("be prisijungimo tokeno -> 401", async () => {
    const res = await request(app)
      .patch("/routes/saved/route-1")
      .send({ title: "X" });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("NOT_AUTHORIZED");
  });

  it("neteisingi duomenys (tuščias title) -> 400", async () => {
    const res = await request(app)
      .patch("/routes/saved/route-1")
      .set(authHeader())
      .send({ title: "" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_REQUEST");
  });
});

describe("Ištrinti maršrutą (DELETE /routes/saved/:id)", () => {
  it("prisijungęs vartotojas, maršruto ID -> 200 ir ištrinto maršruto ID", async () => {
    prismaMock.route.findUnique.mockResolvedValue({
      id: "route-1",
      userId: "user-1",
    });
    prismaMock.route.delete.mockResolvedValue({ id: "route-1" });

    const res = await request(app)
      .delete("/routes/saved/route-1")
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.code).toBe("ROUTE_DELETED");
    expect(res.body.data.id).toBe("route-1");
  });

  it("be prisijungimo tokeno -> 401", async () => {
    const res = await request(app).delete("/routes/saved/route-1");

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("NOT_AUTHORIZED");
  });

  it("neegzistuojantis maršruto ID -> 404 ir klaidos pranešimas", async () => {
    prismaMock.route.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .delete("/routes/saved/missing-id")
      .set(authHeader());

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("ROUTE_NOT_FOUND");
  });
});
