import { useEffect, useState } from "react";
import { Alert } from "react-native";
import { useAuthStore } from "@/store/use-auth-store";
import { useSavedRoutesStore } from "@/store/use-saved-routes-store";
import { useTranslation } from "@/hooks/use-translation";
import type {
  PoiFeature,
  RoutePayload,
  RouteVariant,
} from "@/types/route";

type Params = {
  savedId?: string;
  publicId?: string;
  initialPayload: RoutePayload | null;
};

type Result = {
  payload: RoutePayload | null;
  loading: boolean;
};

// Resolves the route payload when the screen was opened from a saved-route id
// (cache-first so it works offline) or a public-route id (fetch from backend).
// For direct-payload navigation (genParams), both fetches short-circuit and
// the initial payload is returned as-is.
export function useLoadedRoute({ savedId, publicId, initialPayload }: Params): Result {
  const { t } = useTranslation();
  const authFetch = useAuthStore((s) => s.authFetch);
  const getSavedById = useSavedRoutesStore((s) => s.getById);

  const [payload, setPayload] = useState<RoutePayload | null>(initialPayload);
  const [loading, setLoading] = useState(!!savedId || !!publicId);

  useEffect(() => {
    if (!publicId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await authFetch(`/routes/public/${publicId}`);
        if (cancelled) return;
        const pub = data.data.route;
        if (!pub) {
          setLoading(false);
          Alert.alert(
            t("route-map.route-not-found"),
            t("route-map.route-unavailable"),
          );
          return;
        }
        const variantShape: RouteVariant = {
          label: pub.variantLabel ?? "public",
          description: pub.description ?? "",
          profile: pub.transport,
          distance_km: pub.distance / 1000,
          duration_s: pub.duration,
          ascent_m: pub.ascent ?? 0,
          descent_m: pub.descent ?? 0,
          geometry: pub.geometry,
          bbox: pub.bbox,
          pois: Array.isArray(pub.pois) ? (pub.pois as PoiFeature[]) : [],
          elevation_profile: Array.isArray(pub.elevationProfile)
            ? pub.elevationProfile
            : undefined,
        };
        setPayload({
          profile: pub.transport,
          elevation_preference: "optimal",
          routes: [variantShape],
        });
        setLoading(false);
      } catch (err: unknown) {
        if (cancelled) return;
        setLoading(false);
        const e = err as {
          response?: { data?: { code?: string } };
          message?: string;
        };
        Alert.alert(
          t("route-map.load-error"),
          e?.response?.data?.code ?? e?.message ?? "Unknown error",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [publicId, authFetch]);

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
        label: saved.variantLabel ?? "saved",
        description: saved.description ?? "",
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
