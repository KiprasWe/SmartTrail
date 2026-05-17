import { useEffect, useState } from "react";
import { Alert } from "react-native";
import { useSavedRoutesStore } from "@/store/use-saved-routes-store";
import { t } from "@/lib/i18n";
import type {
  PoiFeature,
  RoutePayload,
  RouteVariant,
} from "@/types/route";

type Params = {
  savedId?: string;
  initialPayload: RoutePayload | null;
};

type Result = {
  payload: RoutePayload | null;
  loading: boolean;
};

export function useLoadedRoute({ savedId, initialPayload }: Params): Result {
  const getSavedById = useSavedRoutesStore((s) => s.getById);

  const [payload, setPayload] = useState<RoutePayload | null>(initialPayload);
  const [loading, setLoading] = useState(!!savedId);

  useEffect(() => {
    if (!savedId) return;
    let cancelled = false;
    (async () => {
      const saved = await getSavedById(savedId);
      if (cancelled) return;
      if (!saved) {
        setLoading(false);
        Alert.alert(
          t("route-map.route-not-found"),
          t("route-map.saved-route-unavailable"),
        );
        return;
      }
      const variantShape: RouteVariant = {
        profile: saved.transport,
        distance_km: saved.distance / 1000,
        duration_s: saved.duration,
        ascent_m: saved.ascent ?? 0,
        descent_m: saved.descent ?? 0,
        geometry: saved.geometry,
        bbox: saved.bbox,
        pois: Array.isArray(saved.pois) ? (saved.pois as PoiFeature[]) : [],
        elevation_profile: Array.isArray(saved.elevationProfile)
          ? saved.elevationProfile
          : undefined,
      };
      setPayload({
        profile: saved.transport,
        elevation_preference: "optimal",
        routes: [variantShape],
      });
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [savedId, getSavedById]);

  return { payload, loading };
}
