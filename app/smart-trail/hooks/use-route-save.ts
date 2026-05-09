import { useCallback, useState } from "react";
import { Alert } from "react-native";
import { useSavedRoutesStore } from "@/store/use-saved-routes-store";
import { resolveErr } from "@/lib/error-messages";
import { t } from "@/lib/i18n";
import type { GenParams, PoiFeature, RouteVariant, SaveRouteInput } from "@/types/route";

type Args = {
  variant: RouteVariant | null;
  genParams: GenParams | null;
  routePois: PoiFeature[];
  /** id of the saved route if this screen was opened from one. */
  initialSavedId?: string;
};

export type UseRouteSaveResult = {
  modalOpen: boolean;
  title: string;
  description: string;
  isSaving: boolean;
  savedRouteId: string | null;
  setTitle: (v: string) => void;
  setDescription: (v: string) => void;
  openModal: () => void;
  closeModal: () => void;
  save: () => Promise<void>;
};

/**
 * Manages the "Save route" modal: form state, the default-title heuristic,
 * and the optimistic save call. Once a route is saved (or was opened from
 * a saved id), `savedRouteId` flips so the bookmark icon goes solid.
 */
export function useRouteSave({
  variant,
  genParams,
  routePois,
  initialSavedId,
}: Args): UseRouteSaveResult {
  const saveRoute = useSavedRoutesStore((s) => s.save);
  const [modalOpen, setModalOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [savedRouteId, setSavedRouteId] = useState<string | null>(
    initialSavedId ?? null,
  );

  const openModal = useCallback(() => {
    if (!variant) return;
    const km = variant.distance_km.toFixed(1);
    const prettyProfile = variant.profile
      .replace(/^foot-/, "")
      .replace(/^cycling-/, "")
      .replace(/-/g, " ");
    const defaultTitle =
      genParams?.mode === "loop"
        ? `${prettyProfile} loop · ${km} km`
        : `${prettyProfile} · ${km} km`;
    setTitle(defaultTitle);
    setDescription("");
    setModalOpen(true);
  }, [variant, genParams]);

  const closeModal = useCallback(() => setModalOpen(false), []);

  const save = useCallback(async () => {
    if (!variant || !genParams) return;
    if (!title.trim()) {
      Alert.alert(
        t("route-map.title-required"),
        t("route-map.title-required-body"),
      );
      return;
    }

    const payload: SaveRouteInput = {
      title: title.trim(),
      description: description.trim() || undefined,
      transport: genParams.profile,
      distance: Math.round(variant.distance_km * 1000),
      duration: Math.round(variant.duration_s),
      ascent: Math.round(variant.ascent_m),
      descent: Math.round(variant.descent_m),
      geometry: variant.geometry,
      bbox: variant.bbox,
      elevationProfile: variant.elevation_profile ?? undefined,
      pois: routePois.length > 0 ? routePois : undefined,
    };

    setIsSaving(true);
    try {
      const saved = await saveRoute(payload);
      setSavedRouteId(saved.id);
      setModalOpen(false);
    } catch (err: unknown) {
      Alert.alert(t("route-map.save-error"), resolveErr(err));
    } finally {
      setIsSaving(false);
    }
  }, [variant, genParams, title, description, routePois, saveRoute]);

  return {
    modalOpen,
    title,
    description,
    isSaving,
    savedRouteId,
    setTitle,
    setDescription,
    openModal,
    closeModal,
    save,
  };
}
