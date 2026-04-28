import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { router } from "expo-router";
import EventSource from "react-native-sse";
import { useAuthStore } from "@/store/use-auth-store";
import { useTranslation } from "@/hooks/use-translation";
import i18n from "@/lib/i18n";
import type { ResolvedLocation } from "@/hooks/use-location-search";

type AiStage = "ai_pois" | "enriching" | "routing";
type AiStreamEvents = "stage" | "done" | "error";

function getAiStageLabel(stage: AiStage): string {
  const map: Record<AiStage, string> = {
    ai_pois: i18n.t("generate.ai-stage-planning"),
    enriching: i18n.t("generate.ai-stage-enriching"),
    routing: i18n.t("generate.ai-stage-routing"),
  };
  return map[stage];
}

type AiGenParams = {
  mode: "ai";
  start: [number, number];
  end?: [number, number];
  distance?: number;
  waypoints?: [number, number][];
  profile: string;
  elevationPreference: string;
  preferences: string;
  lang: "en" | "lt";
};
type LoopGenParams = {
  mode: "loop";
  start: [number, number];
  distance: number;
  profile: string;
  elevationPreference: string;
  poiTypes: string[];
  poiCount: number;
  waypoints: [number, number][];
};
type AToBGenParams = {
  mode: "a_to_b";
  start: [number, number];
  end: [number, number];
  profile: string;
  elevationPreference: string;
  poiTypes: string[];
  poiCount: number;
  waypoints: [number, number][];
};
type GenParams = AiGenParams | LoopGenParams | AToBGenParams;

const ELEV_MAP: Record<string, string> = {
  auto: "auto",
  flat: "flat",
  moderate: "optimal",
  hilly: "hilly",
};

type Stop = { id: string; location: ResolvedLocation | null };

export type GenerateInput = {
  tab: "a_to_b" | "round_trip" | "ai";
  aiMode: "a_to_b" | "round_trip";
  startLocation: ResolvedLocation | null;
  endLocation: ResolvedLocation | null;
  roundStartLocation: ResolvedLocation | null;
  aiStartLocation: ResolvedLocation | null;
  aiEndLocation: ResolvedLocation | null;
  aiPrompt: string;
  mustStops: Stop[];
  transport: string;
  elevation: string;
  selectedPoi: Set<string>;
  poiCount: number;
  distance: string;
  customDistanceText: string;
};

export function useRouteGeneration() {
  const { t } = useTranslation();
  const getValidToken = useAuthStore((s) => s.getValidToken);
  const [generating, setGenerating] = useState(false);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);

  // Holds a cleanup function for any active EventSource so we can close it
  // if the user navigates away before the stream completes.
  const esCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    return () => {
      esCleanupRef.current?.();
    };
  }, []);

  const generate = useCallback(
    async (input: GenerateInput) => {
      setGenerating(true);
      setProgressLabel(null);
      try {
        const pickedDistanceM =
          (input.distance === "custom"
            ? parseFloat(input.customDistanceText)
            : Number(input.distance)) * 1000;

        const waypointCoords = input.mustStops
          .filter((s) => s.location !== null)
          .map(
            (s) =>
              [s.location!.coords.lng, s.location!.coords.lat] as [
                number,
                number,
              ],
          );

        let genParams: GenParams;

        if (input.tab === "ai") {
          const aiStart = [
            input.aiStartLocation!.coords.lng,
            input.aiStartLocation!.coords.lat,
          ] as [number, number];
          const aiEnd =
            input.aiMode === "a_to_b" && input.aiEndLocation
              ? ([
                  input.aiEndLocation.coords.lng,
                  input.aiEndLocation.coords.lat,
                ] as [number, number])
              : undefined;

          genParams = {
            mode: "ai",
            start: aiStart,
            ...(aiEnd ? { end: aiEnd } : { distance: pickedDistanceM }),
            ...(waypointCoords.length > 0 ? { waypoints: waypointCoords } : {}),
            profile: input.transport,
            elevationPreference: ELEV_MAP[input.elevation] ?? "optimal",
            preferences: input.aiPrompt.trim(),
            lang: (i18n.locale === "lt" ? "lt" : "en") as "en" | "lt",
          };

          setProgressLabel(getAiStageLabel("ai_pois"));
          const freshToken = await getValidToken();
          await runAiStream(
            genParams,
            freshToken,
            esCleanupRef,
            setProgressLabel,
          );
          return;
        }

        const start =
          input.tab === "a_to_b"
            ? ([
                input.startLocation!.coords.lng,
                input.startLocation!.coords.lat,
              ] as [number, number])
            : ([
                input.roundStartLocation!.coords.lng,
                input.roundStartLocation!.coords.lat,
              ] as [number, number]);

        const end =
          input.tab === "a_to_b"
            ? ([
                input.endLocation!.coords.lng,
                input.endLocation!.coords.lat,
              ] as [number, number])
            : start;

        const isLoop = input.tab === "round_trip";

        genParams = isLoop
          ? {
              mode: "loop",
              start,
              distance: pickedDistanceM,
              profile: input.transport,
              elevationPreference: ELEV_MAP[input.elevation] ?? "optimal",
              poiTypes: [...input.selectedPoi],
              poiCount: input.selectedPoi.size > 0 ? input.poiCount : 0,
              waypoints: waypointCoords,
            }
          : {
              mode: "a_to_b",
              start,
              end,
              profile: input.transport,
              elevationPreference: ELEV_MAP[input.elevation] ?? "optimal",
              poiTypes: [...input.selectedPoi],
              poiCount: input.selectedPoi.size > 0 ? input.poiCount : 0,
              waypoints: waypointCoords,
            };

        const endpoint = isLoop ? "/routes/generate-loop" : "/routes/generate";
        const { authFetch } = useAuthStore.getState();
        const { data: routeResp } = await authFetch(endpoint, {
          method: "POST",
          data: genParams,
        });

        console.log(
          "[generate] routeResp:",
          JSON.stringify(routeResp).slice(0, 300),
        );

        router.push({
          pathname: "/route-map",
          params: {
            payload: JSON.stringify(routeResp.data),
            genParams: JSON.stringify(genParams),
          },
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : t("generate.error");
        Alert.alert(t("generate.error"), msg);
      } finally {
        setGenerating(false);
        setProgressLabel(null);
      }
    },
    [getValidToken, t],
  );

  return { generate, generating, progressLabel };
}

function runAiStream(
  genParams: AiGenParams,
  token: string | null,
  esCleanupRef: React.MutableRefObject<(() => void) | null>,
  setProgressLabel: (v: string | null) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const es = new EventSource<AiStreamEvents>(
      `${process.env.EXPO_PUBLIC_API_URL}/routes/generate-ai/stream`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(genParams),
        // Disable auto-reconnect — Gemini calls are expensive, we don't
        // want the client silently re-firing the whole pipeline on a
        // transient network blip.
        pollingInterval: 0,
      },
    );

    const cleanup = () => {
      es.removeAllEventListeners();
      es.close();
      esCleanupRef.current = null;
    };
    esCleanupRef.current = cleanup;

    es.addEventListener("stage", (event: any) => {
      try {
        const payload = JSON.parse(event.data);
        const label = getAiStageLabel(payload.stage as AiStage);
        if (label) setProgressLabel(label);
      } catch {
        /* ignore malformed stage event */
      }
    });

    es.addEventListener("done", (event: any) => {
      try {
        const data = JSON.parse(event.data);
        cleanup();
        router.push({
          pathname: "/route-map",
          params: {
            payload: JSON.stringify(data),
            genParams: JSON.stringify(genParams),
          },
        });
        resolve();
      } catch {
        cleanup();
        reject(new Error("Failed to parse AI route response"));
      }
    });

    es.addEventListener("error", (event: any) => {
      cleanup();
      // `error` covers both server-emitted typed errors (event.data is
      // JSON) and connection-level failures (event.data is undefined).
      let msg = "Route generation failed";
      if (event?.data) {
        try {
          const payload = JSON.parse(event.data);
          msg = payload.message ?? payload.code ?? msg;
        } catch {
          /* ignore */
        }
      } else if (event?.message) {
        msg = event.message;
      }
      reject(new Error(msg));
    });
  });
}
