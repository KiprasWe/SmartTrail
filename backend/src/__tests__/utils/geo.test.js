import { describe, it, expect } from "vitest";
import {
  routeBbox,
  haversineM,
  thinCoords,
  douglasPeucker,
  simplifyForThumbnail,
} from "../../lib/geo.js";

describe("routeBbox", () => {
  it("returns correct bounding box", () => {
    const coords = [
      [1, 2],
      [3, 4],
      [0.5, 5],
      [2, 1],
    ];
    expect(routeBbox(coords)).toEqual([0.5, 1, 3, 5]);
  });

  it("handles a single coordinate", () => {
    expect(routeBbox([[5, 10]])).toEqual([5, 10, 5, 10]);
  });

  it("handles negative coordinates", () => {
    const coords = [
      [-10, -5],
      [10, 5],
    ];
    expect(routeBbox(coords)).toEqual([-10, -5, 10, 5]);
  });
});

describe("haversineM", () => {
  it("returns 0 for identical points", () => {
    expect(haversineM([0, 0], [0, 0])).toBe(0);
  });

  it("calculates ~111km for 1 degree latitude difference at equator", () => {
    const d = haversineM([0, 0], [0, 1]);
    expect(d).toBeCloseTo(111_195, -2);
  });

  it("is symmetric", () => {
    const a = [25.279, 54.687];
    const b = [25.29, 54.695];
    expect(haversineM(a, b)).toBeCloseTo(haversineM(b, a), 5);
  });

  it("gives a positive distance", () => {
    expect(haversineM([24, 54], [25, 55])).toBeGreaterThan(0);
  });
});

describe("thinCoords", () => {
  it("returns original array when length <= maxPts", () => {
    const coords = [
      [1, 2],
      [3, 4],
    ];
    expect(thinCoords(coords, 10)).toBe(coords);
  });

  it("reduces array to exactly maxPts", () => {
    const coords = Array.from({ length: 200 }, (_, i) => [i, i]);
    expect(thinCoords(coords, 50)).toHaveLength(50);
  });

  it("always includes the first point", () => {
    const coords = Array.from({ length: 100 }, (_, i) => [i, i]);
    expect(thinCoords(coords, 10)[0]).toEqual([0, 0]);
  });

  it("always includes the last point", () => {
    const coords = Array.from({ length: 100 }, (_, i) => [i, i]);
    const result = thinCoords(coords, 10);
    expect(result[result.length - 1]).toEqual([99, 99]);
  });
});

describe("douglasPeucker", () => {
  it("returns original for 2 or fewer points", () => {
    const coords = [
      [0, 0],
      [1, 1],
    ];
    expect(douglasPeucker(coords, 1)).toBe(coords);
  });

  it("always keeps first and last points", () => {
    const coords = [
      [0, 0],
      [1, 0.1],
      [2, 0],
      [3, 0.1],
      [4, 0],
    ];
    const result = douglasPeucker(coords, 0.5);
    expect(result[0]).toEqual([0, 0]);
    expect(result[result.length - 1]).toEqual([4, 0]);
  });

  it("collapses collinear points to endpoints only", () => {
    const coords = [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
    ];
    expect(douglasPeucker(coords, 0.01)).toHaveLength(2);
  });

  it("preserves significant deviations", () => {
    const coords = [
      [0, 0],
      [1, 0],
      [2, 10],
      [3, 0],
      [4, 0],
    ];
    const result = douglasPeucker(coords, 0.1);
    expect(result).toContainEqual([2, 10]);
  });
});

describe("simplifyForThumbnail", () => {
  it("returns null for null geometry", () => {
    expect(simplifyForThumbnail(null)).toBeNull();
  });

  it("returns null for missing coordinates", () => {
    expect(simplifyForThumbnail({})).toBeNull();
  });

  it("returns null for empty coordinates", () => {
    expect(simplifyForThumbnail({ coordinates: [] })).toBeNull();
  });

  it("returns coords as-is when under maxPoints", () => {
    const coords = [
      [1, 2],
      [3, 4],
    ];
    expect(simplifyForThumbnail({ coordinates: coords }, 64)).toBe(coords);
  });

  it("reduces coords to at most maxPoints", () => {
    const coords = Array.from({ length: 300 }, (_, i) => [
      i * 0.001,
      Math.sin(i * 0.1) * 0.005,
    ]);
    const result = simplifyForThumbnail({ coordinates: coords }, 64);
    expect(result.length).toBeLessThanOrEqual(64);
  });
});
