import { Alert, Linking } from "react-native";
import {
  formatDist,
  formatTime,
  translatePoiCategory,
  poiDisplayName,
  poiIcon,
  notifyLoopMeta,
  ROUTE_COLORS,
} from "../../lib/route-map-helpers";
import type { LoopMeta } from "../../types/route";

jest.mock("@expo/vector-icons", () => ({
  Ionicons: { glyphMap: {} },
}));

// Simple translation stub: returns the key, interpolating any opts values
const t = (key: string, opts?: Record<string, string>): string => {
  if (opts) {
    return `${key}(${Object.entries(opts)
      .map(([k, v]) => `${k}:${v}`)
      .join(",")})`;
  }
  return key;
};

// ---------------------------------------------------------------------------
// formatDist
// ---------------------------------------------------------------------------

describe("formatDist", () => {
  it("formats values below 1 km as metres", () => {
    expect(formatDist(0.5)).toBe("500 m");
    expect(formatDist(0.123)).toBe("123 m");
    expect(formatDist(0.001)).toBe("1 m");
  });

  it("formats values >= 1 km with one decimal", () => {
    expect(formatDist(1.0)).toBe("1.0 km");
    expect(formatDist(1.5)).toBe("1.5 km");
    expect(formatDist(10.0)).toBe("10.0 km");
    expect(formatDist(42.7)).toBe("42.7 km");
  });

  it("formats exactly 1 km as km", () => {
    expect(formatDist(1)).toBe("1.0 km");
  });
});

// ---------------------------------------------------------------------------
// formatTime
// ---------------------------------------------------------------------------

describe("formatTime", () => {
  it("formats seconds < 1 hour as minutes only", () => {
    expect(formatTime(0)).toBe("0 min");
    expect(formatTime(59)).toBe("0 min");
    expect(formatTime(60)).toBe("1 min");
    expect(formatTime(300)).toBe("5 min");
    expect(formatTime(3599)).toBe("59 min");
  });

  it("formats seconds >= 1 hour as hours and minutes", () => {
    expect(formatTime(3600)).toBe("1h 0m");
    expect(formatTime(5400)).toBe("1h 30m");
    expect(formatTime(7200)).toBe("2h 0m");
    expect(formatTime(7260)).toBe("2h 1m");
  });
});

// ---------------------------------------------------------------------------
// translatePoiCategory
// ---------------------------------------------------------------------------

describe("translatePoiCategory", () => {
  it("returns null for null input", () => {
    expect(translatePoiCategory(null, t)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(translatePoiCategory(undefined, t)).toBeNull();
  });

  it("translates a known category via t()", () => {
    expect(translatePoiCategory("park", t)).toBe("poi.categories.park");
    expect(translatePoiCategory("viewpoint", t)).toBe(
      "poi.categories.viewpoint",
    );
    expect(translatePoiCategory("museum", t)).toBe("poi.categories.museum");
    expect(translatePoiCategory("cafe", t)).toBe("poi.categories.cafe");
  });

  it("normalises underscores to spaces before lookup", () => {
    expect(translatePoiCategory("national_park", t)).toBe(
      "poi.categories.national_park",
    );
  });

  it("is case-insensitive", () => {
    expect(translatePoiCategory("PARK", t)).toBe("poi.categories.park");
    expect(translatePoiCategory("Viewpoint", t)).toBe(
      "poi.categories.viewpoint",
    );
  });

  it("title-cases unknown categories", () => {
    expect(translatePoiCategory("unknown_place", t)).toBe("Unknown Place");
    expect(translatePoiCategory("some category", t)).toBe("Some Category");
  });
});

// ---------------------------------------------------------------------------
// poiDisplayName
// ---------------------------------------------------------------------------

describe("poiDisplayName", () => {
  it("falls back to category when name is null", () => {
    expect(poiDisplayName(null, "park", t)).toBe("poi.categories.park");
  });

  it("falls back to category when name is undefined", () => {
    expect(poiDisplayName(undefined, "museum", t)).toBe(
      "poi.categories.museum",
    );
  });

  it("returns the real name when it is not a known category label", () => {
    expect(poiDisplayName("Eiffel Tower", "tourism", t)).toBe("Eiffel Tower");
    expect(poiDisplayName("Gediminas Castle", "castle", t)).toBe(
      "Gediminas Castle",
    );
  });

  it("translates the name when it is a raw category key", () => {
    // "park" is in CATEGORY_KEY_MAP, so it should be translated
    expect(poiDisplayName("park", "park", t)).toBe("poi.categories.park");
  });
});

// ---------------------------------------------------------------------------
// poiIcon
// ---------------------------------------------------------------------------

describe("poiIcon", () => {
  it("returns location-outline for null", () => {
    expect(poiIcon(null)).toBe("location-outline");
  });

  it("returns location-outline for an unknown category", () => {
    expect(poiIcon("unknown-xyz")).toBe("location-outline");
  });

  it("returns the correct icon for known categories", () => {
    expect(poiIcon("cafe")).toBe("cafe-outline");
    expect(poiIcon("restaurant")).toBe("restaurant-outline");
    expect(poiIcon("park")).toBe("leaf-outline");
    expect(poiIcon("nature")).toBe("leaf-outline");
    expect(poiIcon("viewpoint")).toBe("eye-outline");
    expect(poiIcon("historic")).toBe("flag-outline");
    expect(poiIcon("waterfall")).toBe("water-outline");
    expect(poiIcon("peak")).toBe("triangle-outline");
    expect(poiIcon("museum")).toBe("color-palette-outline");
    expect(poiIcon("cinema")).toBe("film-outline");
  });

  it("matches by substring (case insensitive)", () => {
    expect(poiIcon("CAFE")).toBe("cafe-outline");
    expect(poiIcon("National Park")).toBe("leaf-outline");
    expect(poiIcon("Sports Centre")).toBe("basketball-outline");
  });
});

// ---------------------------------------------------------------------------
// ROUTE_COLORS
// ---------------------------------------------------------------------------

describe("ROUTE_COLORS", () => {
  it("exports exactly 3 colours", () => {
    expect(ROUTE_COLORS).toHaveLength(3);
  });

  it("starts with the green primary colour", () => {
    expect(ROUTE_COLORS[0]).toBe("#16A34A");
  });

  it("contains valid hex colour strings", () => {
    for (const colour of ROUTE_COLORS) {
      expect(colour).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});

// ---------------------------------------------------------------------------
// notifyLoopMeta
// ---------------------------------------------------------------------------

describe("notifyLoopMeta", () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns false and shows no alert for null meta", () => {
    expect(notifyLoopMeta(null, t)).toBe(false);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("returns false and shows no alert for undefined meta", () => {
    expect(notifyLoopMeta(undefined, t)).toBe(false);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("returns false when neither snapped_to_min nor auto_extended", () => {
    const meta: LoopMeta = {
      requested_km: 5,
      actual_km: 5,
      min_distance_km: null,
      snapped_to_min: false,
      auto_extended: false,
      overlap_ratio: null,
    };
    expect(notifyLoopMeta(meta, t)).toBe(false);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("shows snapped alert and returns true when snapped_to_min", () => {
    const meta: LoopMeta = {
      requested_km: 1,
      actual_km: 2.5,
      min_distance_km: 2.5,
      snapped_to_min: true,
      auto_extended: false,
      overlap_ratio: null,
    };
    expect(notifyLoopMeta(meta, t)).toBe(true);
    expect(alertSpy).toHaveBeenCalledWith(
      "",
      "route-map.loop-snapped-to-min(km:2.5)",
    );
  });

  it("shows auto-extended alert and returns true when auto_extended", () => {
    const meta: LoopMeta = {
      requested_km: 5,
      actual_km: 5.8,
      min_distance_km: null,
      snapped_to_min: false,
      auto_extended: true,
      overlap_ratio: null,
    };
    expect(notifyLoopMeta(meta, t)).toBe(true);
    expect(alertSpy).toHaveBeenCalledWith(
      "",
      "route-map.loop-auto-extended(km:5.8)",
    );
  });

  it("prefers snapped_to_min over auto_extended when both are true", () => {
    const meta: LoopMeta = {
      requested_km: 1,
      actual_km: 2.5,
      min_distance_km: 2.5,
      snapped_to_min: true,
      auto_extended: true,
      overlap_ratio: null,
    };
    notifyLoopMeta(meta, t);
    expect(alertSpy).toHaveBeenCalledWith(
      "",
      "route-map.loop-snapped-to-min(km:2.5)",
    );
    expect(alertSpy).toHaveBeenCalledTimes(1);
  });
});
