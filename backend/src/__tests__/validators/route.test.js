import { describe, it, expect } from "vitest";
import {
  atoBSchema,
  loopSchema,
  aiRouteSchema,
  saveRouteSchema,
  updateRouteSchema,
} from "../../validators/routeValidators.js";

const vilnius = [25.279, 54.687];
const kaunas = [23.903, 54.898];

describe("atoBSchema", () => {
  const valid = { start: vilnius, end: kaunas };

  it("accepts minimal valid data", () => {
    expect(atoBSchema.safeParse(valid).success).toBe(true);
  });

  it("applies defaults", () => {
    const { data } = atoBSchema.safeParse(valid);
    expect(data.profile).toBe("foot-walking");
    expect(data.elevationPreference).toBe("moderate");
    expect(data.poiCount).toBe(0);
    expect(data.poiTypes).toEqual([]);
    expect(data.waypoints).toEqual([]);
  });

  it("accepts all optional fields", () => {
    expect(
      atoBSchema.safeParse({
        ...valid,
        profile: "foot-hiking",
        elevationPreference: "hilly",
        poiTypes: ["nature", "tourism"],
        poiCount: 5,
        waypoints: [[25.285, 54.69]],
      }).success,
    ).toBe(true);
  });

  it("rejects an invalid profile", () => {
    expect(atoBSchema.safeParse({ ...valid, profile: "jetpack" }).success).toBe(
      false,
    );
  });

  it("rejects an invalid elevationPreference", () => {
    expect(
      atoBSchema.safeParse({ ...valid, elevationPreference: "steep" }).success,
    ).toBe(false);
  });

  it("rejects missing start", () => {
    expect(atoBSchema.safeParse({ end: kaunas }).success).toBe(false);
  });

  it("rejects missing end", () => {
    expect(atoBSchema.safeParse({ start: vilnius }).success).toBe(false);
  });

  it("rejects poiCount above 20", () => {
    expect(
      atoBSchema.safeParse({ ...valid, poiCount: 21 }).success,
    ).toBe(false);
  });
});

describe("loopSchema", () => {
  const valid = { start: vilnius, distance: 5000 };

  it("accepts valid data", () => {
    expect(loopSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects distance below 500", () => {
    expect(loopSchema.safeParse({ ...valid, distance: 499 }).success).toBe(
      false,
    );
  });

  it("accepts distance at exactly 500", () => {
    expect(loopSchema.safeParse({ ...valid, distance: 500 }).success).toBe(
      true,
    );
  });

  it("rejects distance above 6000000", () => {
    expect(
      loopSchema.safeParse({ ...valid, distance: 6_000_001 }).success,
    ).toBe(false);
  });

  it("accepts distance at exactly 6000000", () => {
    expect(
      loopSchema.safeParse({ ...valid, distance: 6_000_000 }).success,
    ).toBe(true);
  });

  it("accepts optional controlPoints", () => {
    expect(
      loopSchema.safeParse({
        ...valid,
        controlPoints: [[25.28, 54.69], [25.27, 54.70]],
      }).success,
    ).toBe(true);
  });
});

describe("aiRouteSchema", () => {
  it("accepts start + end", () => {
    expect(
      aiRouteSchema.safeParse({ start: vilnius, end: kaunas }).success,
    ).toBe(true);
  });

  it("accepts start + distance", () => {
    expect(
      aiRouteSchema.safeParse({ start: vilnius, distance: 5000 }).success,
    ).toBe(true);
  });

  it("rejects start alone (no end or distance)", () => {
    expect(aiRouteSchema.safeParse({ start: vilnius }).success).toBe(false);
  });

  it("rejects area longer than 200 characters", () => {
    expect(
      aiRouteSchema.safeParse({
        start: vilnius,
        end: kaunas,
        area: "a".repeat(201),
      }).success,
    ).toBe(false);
  });

  it("rejects preferences longer than 500 characters", () => {
    expect(
      aiRouteSchema.safeParse({
        start: vilnius,
        end: kaunas,
        preferences: "a".repeat(501),
      }).success,
    ).toBe(false);
  });

  it("rejects unsupported lang", () => {
    expect(
      aiRouteSchema.safeParse({ start: vilnius, end: kaunas, lang: "de" })
        .success,
    ).toBe(false);
  });

  it("accepts lang 'lt'", () => {
    expect(
      aiRouteSchema.safeParse({ start: vilnius, end: kaunas, lang: "lt" })
        .success,
    ).toBe(true);
  });

  it("applies default profile and lang", () => {
    const { data } = aiRouteSchema.safeParse({ start: vilnius, end: kaunas });
    expect(data.profile).toBe("foot-walking");
    expect(data.lang).toBe("en");
  });
});

describe("saveRouteSchema", () => {
  const validGeom = {
    type: "LineString",
    coordinates: [vilnius, kaunas],
  };
  const valid = {
    title: "My Route",
    transport: "foot-walking",
    distance: 5000,
    duration: 3600,
    geometry: validGeom,
    bbox: [23, 54, 26, 55],
  };

  it("accepts valid route data", () => {
    expect(saveRouteSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects empty title", () => {
    expect(saveRouteSchema.safeParse({ ...valid, title: "" }).success).toBe(
      false,
    );
  });

  it("rejects title longer than 100 characters", () => {
    expect(
      saveRouteSchema.safeParse({ ...valid, title: "a".repeat(101) }).success,
    ).toBe(false);
  });

  it("rejects non-positive distance", () => {
    expect(
      saveRouteSchema.safeParse({ ...valid, distance: 0 }).success,
    ).toBe(false);
  });

  it("rejects non-LineString geometry type", () => {
    expect(
      saveRouteSchema.safeParse({
        ...valid,
        geometry: { type: "Point", coordinates: vilnius },
      }).success,
    ).toBe(false);
  });

  it("rejects description longer than 500 characters", () => {
    expect(
      saveRouteSchema.safeParse({
        ...valid,
        description: "a".repeat(501),
      }).success,
    ).toBe(false);
  });
});

describe("updateRouteSchema", () => {
  it("accepts empty object (all fields optional)", () => {
    expect(updateRouteSchema.safeParse({}).success).toBe(true);
  });

  it("accepts isFavorite boolean", () => {
    expect(
      updateRouteSchema.safeParse({ isFavorite: true }).success,
    ).toBe(true);
  });

  it("accepts a valid title", () => {
    expect(
      updateRouteSchema.safeParse({ title: "New name" }).success,
    ).toBe(true);
  });

  it("rejects title longer than 100 characters", () => {
    expect(
      updateRouteSchema.safeParse({ title: "a".repeat(101) }).success,
    ).toBe(false);
  });

  it("rejects empty title", () => {
    expect(updateRouteSchema.safeParse({ title: "" }).success).toBe(false);
  });
});
