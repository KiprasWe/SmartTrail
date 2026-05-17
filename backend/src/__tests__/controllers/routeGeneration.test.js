import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import express from "express";
import { authHeader } from "../helpers/auth.js";

const { prismaMock, ors, loopAlgo, aiPipeline } = vi.hoisted(() => {
  const routeData = () => ({
    coords: [
      [25.0, 54.0],
      [25.05, 54.05],
      [25.1, 54.1],
    ],
    elevArr: [10, 20, 15],
    ascent_m: 100,
    descent_m: 80,
    distance_km: 5.2,
    duration_s: 3600,
  });
  return {
    prismaMock: { user: { findUnique: vi.fn() } },
    ors: {
      fetchORSDirections: vi.fn().mockResolvedValue({ features: [{}] }),
      orsFeatureToRouteData: vi.fn(() => routeData()),
      buildProfileOpts: vi.fn(() => ({})),
      fetchRoutePois: vi.fn().mockResolvedValue([]),
      filterUnreachablePois: vi.fn(async (_p, _a, internal) => internal),
    },
    loopAlgo: {
      generateLoop: vi.fn().mockResolvedValue({
        routeData: routeData(),
        controlPoints: [],
        meta: { snapped_to_min: false },
      }),
    },
    aiPipeline: {
      runAiPipeline: vi.fn().mockResolvedValue({
        profile: "foot-walking",
        routes: [{ distance_km: 5, pois: [] }],
      }),
    },
    _routeData: routeData,
  };
});

vi.mock("../../config/db.js", () => ({
  prisma: prismaMock,
  connectDB: vi.fn(),
  disconnectDB: vi.fn(),
}));
vi.mock("@prisma/client", () => ({
  Prisma: { join: (arr) => arr.join(",") },
}));
vi.mock("../../lib/ors.js", () => ors);
vi.mock("../../lib/loop-algo.js", () => loopAlgo);
vi.mock("../../lib/ai/pipeline.js", () => aiPipeline);
vi.mock("../../lib/ai/shared.js", () => ({
  genai: null,
  GEMINI_MODEL: "test",
  extractJsonArray: () => [],
}));

const { default: buildRoutesRouter } = await import(
  "../../routes/routesRoutes.js"
);
const { errorHandler } = await import("../../middleware/errorHandler.js");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/routes", buildRoutesRouter());
  app.use(errorHandler);
  return app;
}

const app = buildApp();
const ROUTE = () => ({
  routeData: {
    coords: [
      [25.0, 54.0],
      [25.05, 54.05],
      [25.1, 54.1],
    ],
    elevArr: [10, 20, 15],
    ascent_m: 100,
    descent_m: 80,
    distance_km: 5.2,
    duration_s: 3600,
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.user.findUnique.mockResolvedValue({ id: "user-1" });
  ors.fetchORSDirections.mockResolvedValue({ features: [{}] });
  ors.orsFeatureToRouteData.mockReturnValue(ROUTE().routeData);
  ors.buildProfileOpts.mockReturnValue({});
  ors.fetchRoutePois.mockResolvedValue([]);
  ors.filterUnreachablePois.mockImplementation(async (_p, _a, i) => i);
  loopAlgo.generateLoop.mockResolvedValue({
    routeData: ROUTE().routeData,
    controlPoints: [],
    meta: { snapped_to_min: false },
  });
  aiPipeline.runAiPipeline.mockResolvedValue({
    profile: "foot-walking",
    routes: [{ distance_km: 5, pois: [] }],
  });
});

describe("Generuoti tiesioginį maršrutą (POST /routes/generate-direct)", () => {
  it("teisingi filtrai -> 200, maršrutas su geometrija, atstumu, trukme", async () => {
    const res = await request(app)
      .post("/routes/generate-direct")
      .set(authHeader())
      .send({
        start: [25.0, 54.0],
        end: [25.1, 54.1],
        profile: "foot-walking",
        elevationPreference: "moderate",
        poiTypes: ["nature"],
        poiCount: 2,
      });

    expect(res.status).toBe(200);
    expect(res.body.code).toBe("ROUTE_GENERATED");
    const route = res.body.data.routes[0];
    expect(route.geometry.type).toBe("LineString");
    expect(route.distance_km).toBe(5.2);
    expect(route.duration_s).toBeGreaterThan(0);
    expect(route).toHaveProperty("ascent_m");
    expect(route).toHaveProperty("pois");
  });

  it("klaidingi duomenys (blogas transporto profilis) -> 400", async () => {
    const res = await request(app)
      .post("/routes/generate-direct")
      .set(authHeader())
      .send({ start: [25.0, 54.0], end: [25.1, 54.1], profile: "car" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_REQUEST");
  });

  it("be prisijungimo tokeno -> 401", async () => {
    const res = await request(app)
      .post("/routes/generate-direct")
      .send({ start: [25.0, 54.0], end: [25.1, 54.1] });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("NOT_AUTHORIZED");
  });
});

describe("Generuoti maršrutą ratu (POST /routes/generate-loop)", () => {
  it("teisingi filtrai -> 200, maršrutas su geometrija", async () => {
    const res = await request(app)
      .post("/routes/generate-loop")
      .set(authHeader())
      .send({
        start: [25.0, 54.0],
        distance: 5000,
        profile: "cycling-regular",
        elevationPreference: "flat",
      });

    expect(res.status).toBe(200);
    expect(res.body.code).toBe("ROUTE_GENERATED");
    expect(res.body.data.routes[0].geometry.type).toBe("LineString");
  });

  it("klaidingi duomenys (blogas transporto profilis) -> 400", async () => {
    const res = await request(app)
      .post("/routes/generate-loop")
      .set(authHeader())
      .send({ start: [25.0, 54.0], distance: 5000, profile: "car" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_REQUEST");
  });

  it("be prisijungimo tokeno -> 401", async () => {
    const res = await request(app)
      .post("/routes/generate-loop")
      .send({ start: [25.0, 54.0], distance: 5000 });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("NOT_AUTHORIZED");
  });
});

describe("Generuoti tiesioginį maršrutą pagal AI užklausą (POST /routes/generate-ai-direct)", () => {
  it("teisinga AI užklausa -> 200, SSE su rezultatu", async () => {
    const res = await request(app)
      .post("/routes/generate-ai-direct")
      .set(authHeader())
      .send({
        start: [25.0, 54.0],
        end: [25.1, 54.1],
        profile: "foot-walking",
        preferences: "nice nature route",
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.text).toContain("event: done");
  });

  it("klaidingi duomenys (blogas transporto profilis) -> 400", async () => {
    const res = await request(app)
      .post("/routes/generate-ai-direct")
      .set(authHeader())
      .send({ start: [25.0, 54.0], end: [25.1, 54.1], profile: "car" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_REQUEST");
  });

  it("be prisijungimo tokeno -> 401", async () => {
    const res = await request(app)
      .post("/routes/generate-ai-direct")
      .send({ start: [25.0, 54.0], end: [25.1, 54.1] });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("NOT_AUTHORIZED");
  });
});

describe("Generuoti maršrutą ratu pagal AI užklausą (POST /routes/generate-ai-loop)", () => {
  it("teisinga AI užklausa su distance -> 200, SSE su rezultatu", async () => {
    const res = await request(app)
      .post("/routes/generate-ai-loop")
      .set(authHeader())
      .send({
        start: [25.0, 54.0],
        distance: 5000,
        profile: "foot-walking",
        preferences: "scenic loop",
      });

    expect(res.status).toBe(200);
    expect(res.text).toContain("event: done");
  });
});

describe("Pridėti lankytiną vietą į maršrutą (POST /routes/add-poi-loop)", () => {
  const routeCoords = Array.from({ length: 12 }, (_, i) => [
    25.0 + i * 0.0005,
    54.0,
  ]);

  it("teisinga užklausa -> 200 ir atnaujintas maršrutas", async () => {
    ors.orsFeatureToRouteData.mockReturnValue({
      coords: [
        [25.0, 54.0],
        [25.001, 54.0],
      ],
      elevArr: [10, 11],
      ascent_m: 1,
      descent_m: 0,
      distance_km: 0.1,
      duration_s: 60,
    });

    const res = await request(app)
      .post("/routes/add-poi-loop")
      .set(authHeader())
      .send({
        routeCoords,
        poi: [25.003, 54.0],
        profile: "foot-walking",
        currentStats: {
          distance_km: 3,
          duration_s: 1800,
          ascent_m: 50,
          descent_m: 40,
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.code).toBe("ROUTE_GENERATED");
    expect(res.body.data.routes[0].geometry.type).toBe("LineString");
  });

  it("naujo maršruto skaičiavimas nepavyko -> 502 (EXTERNAL_SERVICE_ERROR)", async () => {
    // Pastaba: 28 lentelėje nurodyta 400; realizacija grąžina 502 dėl ORS klaidos.
    ors.fetchORSDirections.mockRejectedValue(new Error("ORS down"));

    const res = await request(app)
      .post("/routes/add-poi-loop")
      .set(authHeader())
      .send({
        routeCoords,
        poi: [25.003, 54.0],
        profile: "foot-walking",
        currentStats: {
          distance_km: 3,
          duration_s: 1800,
          ascent_m: 50,
          descent_m: 40,
        },
      });

    expect(res.status).toBe(502);
    expect(res.body.code).toBe("EXTERNAL_SERVICE_ERROR");
  });
});

describe("Pašalinti lankytiną vietą iš maršruto (POST /routes/remove-poi-loop)", () => {
  const routeCoords = Array.from({ length: 12 }, (_, i) => [
    25.0 + i * 0.0005,
    54.0,
  ]);

  it("teisinga užklausa -> 200 ir atnaujintas maršrutas", async () => {
    ors.orsFeatureToRouteData.mockReturnValue({
      coords: [
        [25.0, 54.0],
        [25.001, 54.0],
      ],
      elevArr: [10, 11],
      ascent_m: 1,
      descent_m: 0,
      distance_km: 0.1,
      duration_s: 60,
    });

    const res = await request(app)
      .post("/routes/remove-poi-loop")
      .set(authHeader())
      .send({
        routeCoords,
        poi: [25.003, 54.0],
        profile: "foot-walking",
        currentStats: {
          distance_km: 3,
          duration_s: 1800,
          ascent_m: 50,
          descent_m: 40,
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.code).toBe("ROUTE_GENERATED");
  });

  it("naujo maršruto skaičiavimas nepavyko -> 400 su klaidos pranešimu", async () => {
    const res = await request(app)
      .post("/routes/remove-poi-loop")
      .set(authHeader())
      .send({
        routeCoords,
        poi: [30.0, 60.0], // toli nuo maršruto -> negalima rasti aplinkkelio
        profile: "foot-walking",
        currentStats: {
          distance_km: 3,
          duration_s: 1800,
          ascent_m: 50,
          descent_m: 40,
        },
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("BAD_REQUEST");
  });
});
