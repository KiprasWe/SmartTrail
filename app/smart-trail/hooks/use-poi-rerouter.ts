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
  /** The currently selected route variant (used to seed AI waypoints + carry POIs forward). */
  variant: RouteVariant | null;
  genParams: GenParams | null;
  isLoop: boolean;
  loopControlPoints: Coords[];
  /**
   * Stable identity per route session — when this changes the AI waypoint seeding
   * runs once for the new session.
   */
  routeSessionKey: string;
  /**
   * Replace the variant at the given index with the freshly re-routed one. We
   * leave variant ordering and POI list untouched.
   */
  onVariantUpdated: (next: RouteVariant) => void;
};

export type UsePoiRerouterResult = {
  waypoints: Coords[];
  waypointPois: PoiFeature[];
  isRegenerating: boolean;
  isWaypoint: (poi: PoiFeature) => boolean;
  toggleWaypoint: (poi: PoiFeature) => Promise<void>;
};

/**
 * Drives the "Add to / remove from route" flow on the route-map screen:
 *  - Tracks which POIs are currently waypoints
 *  - Calls the backend to recompute the route on each toggle
 *  - Optimistically applies the change and rolls back on failure
 *  - Seeds AI mode with the essential POIs as initial waypoints
 *
 * Uses authFetch so 401s trigger a transparent token refresh.
 */
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

  // Reset the AI seed marker when the underlying route session changes.
  const aiSeededKeyRef = useRef<string | null>(null);
  useEffect(() => {
    aiSeededKeyRef.current = null;
  }, [routeSessionKey]);

  // Seed AI mode with essential POIs as waypoints exactly once per session.
  useEffect(() => {
    if (genParams?.mode !== "ai" || !variant) return;
    if (aiSeededKeyRef.current === routeSessionKey) return;
    aiSeededKeyRef.current = routeSessionKey;
    const essentialCoords = (variant.pois ?? [])
      .filter((p) => p.properties.is_route_waypoint === true && p.properties.name)
      .map((p) => p.geometry.coordinates as Coords);
    setWaypoints(essentialCoords);
    setWaypointPois([]);
  }, [genParams?.mode, variant, routeSessionKey]);

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
          if (genParams.distance == null) throw new Error("Missing loop distance");
          path = "/routes/remove-poi-loop";
          body = {
            start: genParams.start,
            distance: genParams.distance,
            profile: genParams.profile,
            elevationPreference: genParams.elevationPreference,
            waypoints: newWaypoints,
            ...(loopControlPoints.length > 0 && {
              controlPoints: loopControlPoints,
            }),
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
        // Carry POIs from the previous variant — backend doesn't return them on reroute.
        newRoute.pois = variant.pois ?? [];
        onVariantUpdated(newRoute);
      } catch (err: unknown) {
        // Roll back optimistic state
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
