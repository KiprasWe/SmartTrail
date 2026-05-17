import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { useAuthStore } from "@/store/use-auth-store";
import { resolveErr } from "@/lib/error-messages";
import { t } from "@/lib/i18n";
import type {
  Coords,
  GenParams,
  PoiFeature,
  RouteVariant,
} from "@/types/route";

type Args = {
  
  variant: RouteVariant | null;
  genParams: GenParams | null;
  isLoop: boolean;
  loopControlPoints: Coords[];
  
  routeSessionKey: string;
  
  onVariantUpdated: (next: RouteVariant) => void;
};

export type UsePoiRerouterResult = {
  waypoints: Coords[];
  waypointPois: PoiFeature[];
  isRegenerating: boolean;
  isWaypoint: (poi: PoiFeature) => boolean;
  toggleWaypoint: (poi: PoiFeature) => Promise<void>;
};

export function usePoiRerouter({
  variant,
  genParams,
  isLoop,
  loopControlPoints,
  routeSessionKey,
  onVariantUpdated,
}: Args): UsePoiRerouterResult {
  const [waypoints, setWaypoints] = useState<Coords[]>([]);
  const [waypointPois, setWaypointPois] = useState<PoiFeature[]>([]);
  const [isRegenerating, setIsRegenerating] = useState(false);

  const aiSeededKeyRef = useRef<string | null>(null);
  useEffect(() => {
    aiSeededKeyRef.current = null;
  }, [routeSessionKey]);

  useEffect(() => {
    if (!variant || !genParams) return;
    if (aiSeededKeyRef.current === routeSessionKey) return;
    aiSeededKeyRef.current = routeSessionKey;
    if (genParams.mode === "ai") {
      const essentialCoords = (variant.pois ?? [])
        .filter((p) => p.properties.is_route_waypoint === true && p.properties.name)
        .map((p) => p.geometry.coordinates as Coords);
      setWaypoints(essentialCoords);
    } else {
      setWaypoints((genParams.waypoints ?? []) as Coords[]);
    }
    setWaypointPois([]);
  }, [genParams, variant, routeSessionKey]);

  const isWaypoint = useCallback(
    (poi: PoiFeature) =>
      waypoints.some(
        (w) =>
          w[0] === poi.geometry.coordinates[0] &&
          w[1] === poi.geometry.coordinates[1],
      ),
    [waypoints],
  );

  const toggleWaypoint = useCallback(
    async (poi: PoiFeature) => {
      if (!genParams || !variant) return;

      const coords = poi.geometry.coordinates as Coords;
      const removing = isWaypoint(poi);
      const prevWaypoints = waypoints;
      const prevWaypointPois = waypointPois;
      const newWaypoints = removing
        ? waypoints.filter((w) => !(w[0] === coords[0] && w[1] === coords[1]))
        : [...waypoints, coords];

      setWaypoints(newWaypoints);
      setWaypointPois((prev) =>
        removing
          ? prev.filter((p) => p.properties.id !== poi.properties.id)
          : [...prev, poi],
      );
      setIsRegenerating(true);

      try {
        const { authFetch } = useAuthStore.getState();

        let path: string;
        let body: Record<string, unknown>;

        if (isLoop) {
          path = removing ? "/routes/remove-poi-loop" : "/routes/add-poi-loop";
          body = {
            routeCoords: variant.geometry.coordinates,
            ...(variant.elevation_profile && {
              elevArr: variant.elevation_profile,
            }),
            poi: coords,
            profile: genParams.profile,
            elevationPreference: genParams.elevationPreference,
            currentStats: {
              distance_km: variant.distance_km,
              duration_s: variant.duration_s,
              ascent_m: variant.ascent_m,
              descent_m: variant.descent_m,
            },
          };
        } else {
          if (!genParams.end) throw new Error("Missing route end");
          path = removing ? "/routes/remove-poi-direct" : "/routes/add-poi-direct";
          body = {
            start: genParams.start,
            end: genParams.end,
            profile: genParams.profile,
            elevationPreference: genParams.elevationPreference,
            waypoints: newWaypoints,
          };
        }

        const { data } = await authFetch(path, { method: "POST", data: body });
        const newRoute = data.data.routes[0] as RouteVariant;
        
        newRoute.pois = variant.pois ?? [];
        onVariantUpdated(newRoute);
      } catch (err: unknown) {
        
        setWaypoints(prevWaypoints);
        setWaypointPois(prevWaypointPois);
        Alert.alert(t("common.error"), resolveErr(err));
      } finally {
        setIsRegenerating(false);
      }
    },
    [
      genParams,
      variant,
      waypoints,
      waypointPois,
      isWaypoint,
      isLoop,
      loopControlPoints,
      onVariantUpdated,
    ],
  );

  return { waypoints, waypointPois, isRegenerating, isWaypoint, toggleWaypoint };
}
