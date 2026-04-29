import { useState, useCallback, useRef } from "react";
import { getErrMessage } from "@/lib/error-messages";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PhotonFeature {
  id: string;
  label: string;
  sublabel: string;
  coords: { lat: number; lng: number };
}

export interface ResolvedLocation {
  label: string;
  coords: { lat: number; lng: number };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildLabel(p: Record<string, any>): {
  label: string;
  sublabel: string;
} {
  const parts: string[] = [];
  const sub: string[] = [];

  if (p.name) parts.push(p.name);
  if (p.street) {
    const street = p.housenumber ? `${p.street} ${p.housenumber}` : p.street;
    if (p.name) sub.push(street);
    else parts.push(street);
  }
  if (p.city) sub.push(p.city);
  else if (p.town) sub.push(p.town);
  else if (p.village) sub.push(p.village);
  if (p.county) sub.push(p.county);
  if (p.state) sub.push(p.state);
  if (p.country) sub.push(p.country);

  return {
    label: parts.join(", ") || sub[0] || "Unknown place",
    sublabel: sub.join(", "),
  };
}

type PhotonRawFeature = {
  properties?: Record<string, string | undefined>;
  geometry?: { coordinates?: [number, number] };
};

function parseFeatures(features: unknown[]): PhotonFeature[] {
  return features.map((raw, i) => {
    const f = raw as PhotonRawFeature;
    const p = f.properties ?? {};
    const { label, sublabel } = buildLabel(p);
    return {
      id: `${i}-${f.geometry?.coordinates?.join(",")}`,
      label,
      sublabel,
      coords: {
        lat: f.geometry?.coordinates?.[1] ?? 0,
        lng: f.geometry?.coordinates?.[0] ?? 0,
      },
    };
  });
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useLocationSearch() {
  const [results, setResults] = useState<PhotonFeature[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Search Photon for a text query, optionally biased toward userCoords.
   * Debounced by 300 ms.
   */
  const search = useCallback(
    (
      query: string,
      userCoords?: { lat: number; lng: number } | null,
      lang = "en",
    ) => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);

      if (!query.trim()) {
        setResults([]);
        return;
      }

      debounceTimer.current = setTimeout(async () => {
        setLoading(true);
        setError(null);
        try {
          let url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=6&lang=${lang}`;
          if (userCoords) {
            url += `&lat=${userCoords.lat}&lon=${userCoords.lng}&location_bias_scale=0.5`;
          }
          const res = await fetch(url);
          if (!res.ok) throw new Error("Search failed");
          const data = await res.json();
          setResults(parseFeatures(data.features ?? []));
        } catch (e: unknown) {
          setError(getErrMessage(e));
          setResults([]);
        } finally {
          setLoading(false);
        }
      }, 300);
    },
    [],
  );

  /**
   * Reverse geocode coords → human-readable label via Photon.
   */
  const reverseGeocode = useCallback(
    async (lat: number, lng: number): Promise<ResolvedLocation | null> => {
      try {
        const res = await fetch(
          `https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}`,
        );
        if (!res.ok) throw new Error("Reverse geocode failed");
        const data = await res.json();
        const features = parseFeatures(data.features ?? []);
        if (!features.length) return null;
        const f = features[0];
        return {
          label: [f.label, f.sublabel].filter(Boolean).join(", "),
          coords: { lat, lng },
        };
      } catch {
        return null;
      }
    },
    [],
  );

  const clearResults = useCallback(() => setResults([]), []);

  return { results, loading, error, search, reverseGeocode, clearResults };
}
