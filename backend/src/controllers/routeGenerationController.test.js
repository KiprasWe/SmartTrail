import { describe, it, expect, vi, beforeEach } from "vitest";

import { Errors, Success } from "../utils/responses.js";

const flushPromises = async () => new Promise((r) => setTimeout(r, 0));

// ---- Hoisted mocks used by vi.mock factories ----
const orsMocks = vi.hoisted(() => ({
  fetchORSDirections: vi.fn(),
  orsFeatureToRouteData: vi.fn(),
  buildORSElevationOpts: vi.fn(() => ({})),
  fetchRoutePois: vi.fn(async () => []),
  filterUnreachablePois: vi.fn(async (_profile, _anchors, pois) => pois),
}));

const loopAlgoMocks = vi.hoisted(() => ({
  generateLoop: vi.fn(),
}));

const profilesMocks = vi.hoisted(() => ({
  PROFILE_CONFIGS: {
    "foot-walking": { orsProfile: "foot-walking" },
  },
  calcDuration: vi.fn((_distanceKm, orsSeconds) => orsSeconds),
}));

vi.mock("../lib/ors.js", () => orsMocks);
vi.mock("../lib/loop-algo.js", () => loopAlgoMocks);
vi.mock("../lib/profiles.js", () => profilesMocks);
vi.mock("../lib/ai/shared.js", () => ({
  genai: null,
  GEMINI_MODEL: "mock",
  extractJsonArray: () => [],
}));

const makeRes = () => ({
  status: vi.fn().mockReturnThis(),
  json: vi.fn().mockReturnThis(),
});

async function importControllerWithORSKey(key) {
  if (key == null) delete process.env.ORS_API_KEY;
  else process.env.ORS_API_KEY = key;
  vi.resetModules();
  return import("./routeGenerationController.js");
}

describe("routeGenerationController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Generuoti tiesioginį maršrutą pagal pasirinktus filtrus auto: missing ORS_API_KEY returns EXTERNAL_SERVICE_ERROR", async () => {
    const { directRouting } = await importControllerWithORSKey(null);

    const req = {
      body: {
        start: [25.0, 54.7],
        end: [25.1, 54.71],
        profile: "foot-walking",
        elevationPreference: "moderate",
        poiTypes: [],
        poiCount: 0,
        waypoints: [],
      },
    };
    const res = makeRes();

    directRouting(req, res, vi.fn());
    await flushPromises();

    expect(res.status).toHaveBeenCalledWith(Errors.EXTERNAL_SERVICE_ERROR.status);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error", code: Errors.EXTERNAL_SERVICE_ERROR.code }),
    );
  });

  it("Generuoti maršrutą ratu pagal pasirinktus filtrus auto: loopRouting returns ROUTE_GENERATED on success", async () => {
    const { loopRouting } = await importControllerWithORSKey("test-key");

    loopAlgoMocks.generateLoop.mockResolvedValue({
      routeData: {
        distance_km: 3.2,
        duration_s: 1200,
        ascent_m: 40,
        descent_m: 40,
        coords: [
          [25.0, 54.7],
          [25.01, 54.705],
          [25.0, 54.7],
        ],
        elevArr: [100, 110, 100],
        maneuvers: [],
      },
      controlPoints: [],
      meta: { snapped_to_min: false, min_distance_km: 0 },
    });

    const req = {
      body: {
        start: [25.0, 54.7],
        distance: 3200,
        profile: "foot-walking",
        elevationPreference: "moderate",
        poiTypes: [],
        poiCount: 0,
        waypoints: [],
        controlPoints: [],
      },
    };
    const res = makeRes();

    loopRouting(req, res, vi.fn());
    await flushPromises();

    expect(res.status).toHaveBeenCalledWith(Success.ROUTE_GENERATED.status);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "success",
        code: Success.ROUTE_GENERATED.code,
        data: expect.objectContaining({
          routes: expect.any(Array),
        }),
      }),
    );
  });

  it("add-poi-loop (splice): stitches POI into loop geometry and returns ROUTE_GENERATED", async () => {
    const { splicePoi } = await importControllerWithORSKey("test-key");

    orsMocks.fetchORSDirections
      .mockResolvedValueOnce({ features: [{ geometry: { coordinates: [[25, 54.7, 0]] }, properties: {} }] })
      .mockResolvedValueOnce({ features: [{ geometry: { coordinates: [[25.1, 54.71, 0]] }, properties: {} }] });

    orsMocks.orsFeatureToRouteData
      .mockReturnValueOnce({
        coords: [[25.0, 54.7], [25.05, 54.705]],
        elevArr: [0, 0],
        maneuvers: [],
        distance_km: 1,
        duration_s: 300,
        ascent_m: 5,
        descent_m: 5,
      })
      .mockReturnValueOnce({
        coords: [[25.05, 54.705], [25.1, 54.71]],
        elevArr: [0, 0],
        maneuvers: [],
        distance_km: 1.1,
        duration_s: 350,
        ascent_m: 6,
        descent_m: 6,
      });

    const req = {
      body: {
        routeCoords: [
          [25.0, 54.7],
          [25.02, 54.702],
          [25.04, 54.704],
          [25.06, 54.706],
          [25.1, 54.71],
        ],
        elevArr: null,
        poi: [25.05, 54.705],
        profile: "foot-walking",
        elevationPreference: "moderate",
        currentStats: { distance_km: 2.0, duration_s: 700, ascent_m: 10, descent_m: 10 },
      },
    };
    const res = makeRes();

    splicePoi(req, res, vi.fn());
    await flushPromises();

    expect(orsMocks.fetchORSDirections).toHaveBeenCalledTimes(2);
    expect(res.status).toHaveBeenCalledWith(Success.ROUTE_GENERATED.status);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "success",
        code: Success.ROUTE_GENERATED.code,
        data: expect.objectContaining({
          routes: expect.any(Array),
        }),
      }),
    );
  });
});

