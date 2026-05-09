import { useCallback, useState } from "react";
import type { ResolvedLocation } from "@/hooks/use-location-search";
import type { MustStop } from "@/components/generate/stops-list";
import type {
  TransportKey,
  ElevationKey,
  DistanceKey,
} from "@/components/generate/route-form-components";

export type TabKey = "a_to_b" | "round_trip" | "ai";
export type AiMode = "a_to_b" | "round_trip";

export type SearchTarget =
  | "start"
  | "end"
  | "round_start"
  | "ai_start"
  | "ai_end"
  | { type: "stop"; id: string };

function sameCoords(
  a: ResolvedLocation | null,
  b: ResolvedLocation | null,
): boolean {
  if (!a || !b) return false;
  return a.coords.lat === b.coords.lat && a.coords.lng === b.coords.lng;
}

/**
 * Parses a custom distance entered by the user. Tolerates locale-specific
 * decimal separators (e.g. "1,5" used in lt-LT for 1.5 km).
 */
function parseCustomDistance(raw: string): number {
  return parseFloat(raw.replace(",", "."));
}

/**
 * Centralises every piece of state on the Generate screen — locations for the
 * three tabs, the must-stop list, shared form fields (transport / elevation /
 * POI selection / distance), and the active search-sheet target.
 *
 * Exposing it as one hook lets the screen stay almost purely presentational
 * and gives `handleGenerate` a tiny dependency footprint.
 */
export function useGenerateForm() {
  const [tab, setTab] = useState<TabKey>("a_to_b");

  // Last-known coords from the user — used to bias Photon search by location.
  const [userCoords, setUserCoords] = useState<{
    lat: number;
    lng: number;
  } | null>(null);

  // A → B
  const [startLocation, setStartLocation] = useState<ResolvedLocation | null>(
    null,
  );
  const [endLocation, setEndLocation] = useState<ResolvedLocation | null>(null);

  // Round trip
  const [roundStartLocation, setRoundStartLocation] =
    useState<ResolvedLocation | null>(null);

  // AI
  const [aiStartLocation, setAiStartLocation] =
    useState<ResolvedLocation | null>(null);
  const [aiEndLocation, setAiEndLocation] = useState<ResolvedLocation | null>(
    null,
  );
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiMode, setAiMode] = useState<AiMode>("a_to_b");

  const [mustStops, setMustStops] = useState<MustStop[]>([]);
  const [searchTarget, setSearchTarget] = useState<SearchTarget | null>(null);

  // Shared form fields
  const [transport, setTransport] = useState<TransportKey>("foot-walking");
  const [elevation, setElevation] = useState<ElevationKey>("moderate");
  const [selectedPoi, setSelectedPoi] = useState<Set<string>>(new Set());
  const [poiCount, setPoiCount] = useState(3);
  const [distance, setDistance] = useState<DistanceKey>("10");
  const [customDistanceText, setCustomDistanceText] = useState("");

  // ── Location selection ────────────────────────────────────────────────────
  const handleLocationSelected = useCallback(
    (location: ResolvedLocation) => {
      if (!searchTarget) return;
      setUserCoords(location.coords);

      if (searchTarget === "start") {
        // Picking the same point as end auto-switches the screen to round-trip.
        if (sameCoords(endLocation, location)) {
          setTab("round_trip");
          setRoundStartLocation(location);
          setStartLocation(null);
          setEndLocation(null);
        } else {
          setStartLocation(location);
        }
      } else if (searchTarget === "end") {
        if (sameCoords(startLocation, location)) {
          setTab("round_trip");
          setRoundStartLocation(location);
          setStartLocation(null);
          setEndLocation(null);
        } else {
          setEndLocation(location);
        }
      } else if (searchTarget === "round_start") {
        setRoundStartLocation(location);
      } else if (searchTarget === "ai_start") {
        setAiStartLocation(location);
        if (aiMode === "a_to_b" && sameCoords(aiEndLocation, location)) {
          setAiMode("round_trip");
          setAiEndLocation(null);
        }
      } else if (searchTarget === "ai_end") {
        if (aiMode === "a_to_b" && sameCoords(aiStartLocation, location)) {
          setAiMode("round_trip");
          setAiEndLocation(null);
        } else {
          setAiEndLocation(location);
        }
      } else if (
        typeof searchTarget === "object" &&
        searchTarget.type === "stop"
      ) {
        setMustStops((prev) =>
          prev.map((s) => (s.id === searchTarget.id ? { ...s, location } : s)),
        );
      }
    },
    [searchTarget, startLocation, endLocation, aiMode, aiStartLocation, aiEndLocation],
  );

  // ── Stops ────────────────────────────────────────────────────────────────
  const addStop = useCallback(() => {
    setMustStops((prev) => [
      ...prev,
      { id: Date.now().toString(), location: null },
    ]);
  }, []);
  const removeStop = useCallback((id: string) => {
    setMustStops((prev) => prev.filter((s) => s.id !== id));
  }, []);
  const clearStopLocation = useCallback((id: string) => {
    setMustStops((prev) =>
      prev.map((s) => (s.id === id ? { ...s, location: null } : s)),
    );
  }, []);

  const togglePoi = useCallback((key: string) => {
    setSelectedPoi((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // ── Validation ───────────────────────────────────────────────────────────
  const customDistanceKm = parseCustomDistance(customDistanceText);
  const customDistanceValid =
    distance !== "custom" ||
    (!isNaN(customDistanceKm) &&
      customDistanceKm >= 0.5 &&
      customDistanceKm <= 6000);

  const canGenerate =
    tab === "a_to_b"
      ? !!startLocation && !!endLocation
      : tab === "round_trip"
        ? !!roundStartLocation && customDistanceValid
        : !!aiStartLocation &&
          aiPrompt.trim().length > 0 &&
          (aiMode === "a_to_b" ? !!aiEndLocation : customDistanceValid);

  return {
    // tab
    tab,
    setTab,
    // search
    searchTarget,
    setSearchTarget,
    sheetVisible: searchTarget !== null,
    userCoords,
    handleLocationSelected,
    // a→b
    startLocation,
    setStartLocation,
    endLocation,
    setEndLocation,
    // round
    roundStartLocation,
    setRoundStartLocation,
    // ai
    aiStartLocation,
    setAiStartLocation,
    aiEndLocation,
    setAiEndLocation,
    aiPrompt,
    setAiPrompt,
    aiMode,
    setAiMode,
    // stops
    mustStops,
    addStop,
    removeStop,
    clearStopLocation,
    // shared form
    transport,
    setTransport,
    elevation,
    setElevation,
    selectedPoi,
    togglePoi,
    poiCount,
    setPoiCount,
    distance,
    setDistance,
    customDistanceText,
    setCustomDistanceText,
    // validation
    canGenerate,
  };
}
