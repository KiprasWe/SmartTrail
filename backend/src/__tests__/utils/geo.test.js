import { describe, it, expect } from "vitest";
import {
  computeAscentDescent,
  routeBbox,
  haversineM,
  thinCoords,
  computeDestination,
  bboxFromCenter,
  bboxFromCorridor,
  douglasPeucker,
  simplifyForThumbnail,
  toLocalXY,
  sortByBearingFromOrigin,
  sortWaypointsByRouteOrder,
  METRES_PER_DEG_LAT,
} from "../../lib/geo.js";

describe("METRES_PER_DEG_LAT", () => {
  it("is approximately 111320", () => {
    expect(METRES_PER_DEG_LAT).toBe(111_320);
  });
});

describe("computeAscentDescent", () => {
  it("returns zeros for a flat route", () => {
    expect(computeAscentDescent([100, 100, 100])).toEqual({
      ascent_m: 0,
      descent_m: 0,
    });
  });

  it("calculates ascent and descent correctly", () => {
    // +10, -5, +10, -15 → ascent=20, descent=20
    expect(computeAscentDescent([100, 110, 105, 115, 100])).toEqual({
      ascent_m: 20,
      descent_m: 20,
    });
  });

  it("handles only ascending", () => {
    expect(computeAscentDescent([0, 10, 20])).toEqual({
      ascent_m: 20,
      descent_m: 0,
    });
  });

  it("handles only descending", () => {
    expect(computeAscentDescent([20, 10, 0])).toEqual({
      ascent_m: 0,
      descent_m: 20,
    });
  });

  it("returns zeros for single element array", () => {
    expect(computeAscentDescent([50])).toEqual({ ascent_m: 0, descent_m: 0 });
  });

  it("returns zeros for empty array", () => {
    expect(computeAscentDescent([])).toEqual({ ascent_m: 0, descent_m: 0 });
  });

  it("rounds to nearest metre", () => {
    const result = computeAscentDescent([0, 1.4, 2.9]);
    expect(result.ascent_m).toBe(3); // 1.4 + 1.5 = 2.9 → rounds to 3
  });
});

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

describe("computeDestination", () => {
  it("traveling north by ~111km increases latitude by ~1 degree", () => {
    const [lng, lat] = computeDestination([25, 54], 0, 111_320);
    expect(lat).toBeCloseTo(55, 1);
    expect(lng).toBeCloseTo(25, 3);
  });

  it("traveling east increases longitude", () => {
    const [lng, lat] = computeDestination([25, 0], 90, 100_000);
    expect(lng).toBeGreaterThan(25);
    expect(lat).toBeCloseTo(0, 2);
  });

  it("zero distance returns approximately the same point", () => {
    const [lng, lat] = computeDestination([25, 54], 45, 0);
    expect(lng).toBeCloseTo(25, 5);
    expect(lat).toBeCloseTo(54, 5);
  });
});

describe("bboxFromCenter", () => {
  it("returns a bbox symmetric around center", () => {
    const bbox = bboxFromCenter([25, 55], 1000);
    expect(bbox.low.latitude).toBeLessThan(55);
    expect(bbox.high.latitude).toBeGreaterThan(55);
    expect(bbox.low.longitude).toBeLessThan(25);
    expect(bbox.high.longitude).toBeGreaterThan(25);
  });

  it("larger radius produces wider bbox", () => {
    const small = bboxFromCenter([25, 55], 500);
    const large = bboxFromCenter([25, 55], 5000);
    const smallSpan = large.high.latitude - large.low.latitude;
    const largeSpan = small.high.latitude - small.low.latitude;
    expect(smallSpan).toBeGreaterThan(largeSpan);
  });
});

describe("bboxFromCorridor", () => {
  it("returns a bbox that encloses both endpoints with a buffer", () => {
    const bbox = bboxFromCorridor([25, 54], [26, 55], 500);
    expect(bbox.low.latitude).toBeLessThan(54);
    expect(bbox.high.latitude).toBeGreaterThan(55);
    expect(bbox.low.longitude).toBeLessThan(25);
    expect(bbox.high.longitude).toBeGreaterThan(26);
  });
});

describe("toLocalXY", () => {
  it("returns [0, 0] for the origin point", () => {
    const [x, y] = toLocalXY([10, 20], [10, 20]);
    expect(x).toBeCloseTo(0, 5);
    expect(y).toBeCloseTo(0, 5);
  });

  it("y increases going north", () => {
    const [, y] = toLocalXY([0, 1], [0, 0]);
    expect(y).toBeGreaterThan(0);
  });

  it("x increases going east", () => {
    const [x] = toLocalXY([1, 0], [0, 0]);
    expect(x).toBeGreaterThan(0);
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
    // A sharp spike in the middle should be preserved
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
    // Sine wave: non-collinear so DP keeps many points, then stride-sampled
    const coords = Array.from({ length: 300 }, (_, i) => [
      i * 0.001,
      Math.sin(i * 0.1) * 0.005,
    ]);
    const result = simplifyForThumbnail({ coordinates: coords }, 64);
    expect(result.length).toBeLessThanOrEqual(64);
  });
});

describe("sortByBearingFromOrigin", () => {
  it("sorts points clockwise: north → east → south → west", () => {
    const origin = [0, 0];
    const north = [0, 1]; // bearing ~0°
    const east = [1, 0]; // bearing ~90°
    const south = [0, -1]; // bearing ~180°
    const west = [-1, 0]; // bearing ~270°

    const sorted = sortByBearingFromOrigin(
      [south, west, north, east],
      origin,
    );
    expect(sorted[0]).toEqual(north);
    expect(sorted[1]).toEqual(east);
    expect(sorted[2]).toEqual(south);
    expect(sorted[3]).toEqual(west);
  });

  it("does not mutate the original array", () => {
    const points = [
      [1, 0],
      [0, 1],
    ];
    const orig = [...points];
    sortByBearingFromOrigin(points, [0, 0]);
    expect(points).toEqual(orig);
  });
});

describe("sortWaypointsByRouteOrder", () => {
  it("orders waypoints by proximity along the route", () => {
    const routeCoords = [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
    ];
    const waypoints = [
      [3, 0.01],
      [1, 0.01],
    ];
    const sorted = sortWaypointsByRouteOrder(waypoints, routeCoords);
    expect(sorted[0]).toEqual([1, 0.01]);
    expect(sorted[1]).toEqual([3, 0.01]);
  });

  it("handles a single waypoint", () => {
    const routeCoords = [
      [0, 0],
      [1, 0],
    ];
    const result = sortWaypointsByRouteOrder([[0.5, 0]], routeCoords);
    expect(result).toHaveLength(1);
  });
});
