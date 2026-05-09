import { useCallback, useState } from "react";
import { Alert } from "react-native";
import { exportGpx, ExportCancelledError } from "@/lib/gpx-export";
import { t } from "@/lib/i18n";
import type { PoiFeature, RouteVariant } from "@/types/route";

const todayStamp = () => new Date().toISOString().slice(0, 10);
const defaultFilename = () => `route_${todayStamp()}`;

type Args = {
  variant: RouteVariant | null;
  routePois: PoiFeature[];
};

export type UseRouteExportResult = {
  dialogOpen: boolean;
  filename: string;
  isExporting: boolean;
  setFilename: (v: string) => void;
  openDialog: () => void;
  closeDialog: () => void;
  confirm: () => Promise<void>;
};

/**
 * Drives the GPX export dialog: filename state + the actual share-sheet call.
 * Routes the user's POIs into GPX waypoints (for nav apps that honour them).
 */
export function useRouteExport({
  variant,
  routePois,
}: Args): UseRouteExportResult {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [filename, setFilename] = useState("");
  const [isExporting, setIsExporting] = useState(false);

  const openDialog = useCallback(() => {
    setFilename(defaultFilename());
    setDialogOpen(true);
  }, []);

  const closeDialog = useCallback(() => setDialogOpen(false), []);

  const confirm = useCallback(async () => {
    if (!variant) return;
    setDialogOpen(false);
    setIsExporting(true);
    try {
      const safeFilename = filename.trim() || defaultFilename();
      const gpxWaypoints = routePois.map((p) => ({
        name: p.properties.name!,
        lat: p.geometry.coordinates[1],
        lng: p.geometry.coordinates[0],
        description:
          p.properties.ai_description ??
          p.properties.editorial_summary ??
          p.properties.category ??
          undefined,
      }));

      await exportGpx(
        {
          title: safeFilename,
          coordinates: variant.geometry.coordinates as [number, number][],
          startLat: variant.geometry.coordinates[0][1],
          startLng: variant.geometry.coordinates[0][0],
          waypoints: gpxWaypoints.length > 0 ? gpxWaypoints : undefined,
        },
        safeFilename,
      );
      Alert.alert(
        t("route-map.export-gpx"),
        t("route-map.export-gpx-success"),
      );
    } catch (err) {
      if (err instanceof ExportCancelledError) return;
      console.error("[GPX export]", err);
      Alert.alert(
        t("route-map.export-gpx"),
        t("route-map.export-gpx-error"),
      );
    } finally {
      setIsExporting(false);
    }
  }, [variant, filename, routePois]);

  return {
    dialogOpen,
    filename,
    isExporting,
    setFilename,
    openDialog,
    closeDialog,
    confirm,
  };
}
