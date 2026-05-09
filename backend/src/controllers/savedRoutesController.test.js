import { describe, it, expect, vi, beforeEach } from "vitest";

import { Errors, Success } from "../utils/responses.js";

const flushPromises = async () => new Promise((r) => setTimeout(r, 0));

// Hoisted Prisma mock for vi.mock
const prismaMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  route: {
    findUnique: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("../config/db.js", () => ({ prisma: prismaMock }));

const makeRes = () => ({
  status: vi.fn().mockReturnThis(),
  json: vi.fn().mockReturnThis(),
});

describe("savedRoutesController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Išsaugoti maršrutą: saveRoute returns ROUTE_SAVED with route payload", async () => {
    const { saveRoute } = await import("./savedRoutesController.js");

    prismaMock.$queryRaw.mockResolvedValueOnce([
      {
        id: "r1",
        userId: "u1",
        title: "My route",
        transport: "foot-walking",
        distance: 1234,
        duration: 567,
      },
    ]);

    const req = {
      user: { id: "u1" },
      body: {
        title: "My route",
        description: "desc",
        transport: "foot-walking",
        distance: 1234,
        duration: 567,
        ascent: 10,
        descent: 10,
        geometry: { type: "LineString", coordinates: [[25, 54.7]] },
        bbox: [25, 54.7, 25.1, 54.8],
        elevationProfile: null,
        pois: null,
      },
    };
    const res = makeRes();

    saveRoute(req, res, vi.fn());
    await flushPromises();

    expect(prismaMock.$queryRaw).toHaveBeenCalledOnce();
    expect(res.status).toHaveBeenCalledWith(Success.ROUTE_SAVED.status);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "success",
        code: Success.ROUTE_SAVED.code,
        data: expect.objectContaining({
          route: expect.objectContaining({ id: "r1", userId: "u1" }),
        }),
      }),
    );
  });

  it("Redaguoti maršruto informaciją: updateSavedRoute returns ROUTE_UPDATED when owner edits", async () => {
    const { updateSavedRoute } = await import("./savedRoutesController.js");

    prismaMock.route.findUnique.mockResolvedValueOnce({ id: "r1", userId: "u1" });
    prismaMock.route.update.mockResolvedValueOnce({
      id: "r1",
      userId: "u1",
      title: "New title",
    });

    const req = {
      user: { id: "u1" },
      params: { id: "r1" },
      body: { title: "New title" },
    };
    const res = makeRes();

    updateSavedRoute(req, res, vi.fn());
    await flushPromises();

    expect(res.status).toHaveBeenCalledWith(Success.ROUTE_UPDATED.status);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "success",
        code: Success.ROUTE_UPDATED.code,
        data: expect.objectContaining({
          route: expect.objectContaining({ id: "r1", title: "New title" }),
        }),
      }),
    );
  });

  it("Redaguoti maršruto informaciją: updateSavedRoute returns ROUTE_ACCESS_DENIED for non-owner", async () => {
    const { updateSavedRoute } = await import("./savedRoutesController.js");

    prismaMock.route.findUnique.mockResolvedValueOnce({ id: "r1", userId: "u1" });

    const req = {
      user: { id: "u2" },
      params: { id: "r1" },
      body: { title: "Hacked" },
    };
    const res = makeRes();

    updateSavedRoute(req, res, vi.fn());
    await flushPromises();

    expect(res.status).toHaveBeenCalledWith(Errors.ROUTE_ACCESS_DENIED.status);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error", code: Errors.ROUTE_ACCESS_DENIED.code }),
    );
  });

  it("Ištrinti maršrutą: deleteSavedRoute returns ROUTE_DELETED for owner", async () => {
    const { deleteSavedRoute } = await import("./savedRoutesController.js");

    prismaMock.route.findUnique.mockResolvedValueOnce({ id: "r1", userId: "u1" });
    prismaMock.route.delete.mockResolvedValueOnce({ id: "r1" });

    const req = { user: { id: "u1" }, params: { id: "r1" } };
    const res = makeRes();

    deleteSavedRoute(req, res, vi.fn());
    await flushPromises();

    expect(prismaMock.route.delete).toHaveBeenCalledWith({ where: { id: "r1" } });
    expect(res.status).toHaveBeenCalledWith(Success.ROUTE_DELETED.status);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "success",
        code: Success.ROUTE_DELETED.code,
        data: { id: "r1" },
      }),
    );
  });
});

