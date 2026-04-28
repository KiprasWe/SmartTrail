import { View } from "react-native";
import {
  SectionLabel,
  LocationRow,
  TransportPicker,
  ElevationPicker,
  PoiPicker,
  PoiCountPicker,
  DistancePicker,
  type TransportKey,
  type ElevationKey,
  type DistanceKey,
} from "@/components/generate/route-form-components";
import { formStyles as styles } from "@/components/generate/form-styles";
import { StopsList, type MustStop } from "@/components/generate/stops-list";
import { Colors } from "@/constants/theme";
import { useTranslation } from "@/hooks/use-translation";
import type { ResolvedLocation } from "@/hooks/use-location-search";

type Props = {
  startLocation: ResolvedLocation | null;
  onOpenStart: () => void;
  onClearStart: () => void;
  mustStops: MustStop[];
  onOpenStop: (id: string) => void;
  onClearStopLocation: (id: string) => void;
  onRemoveStop: (id: string) => void;
  onAddStop: () => void;
  distance: DistanceKey;
  onDistanceChange: (v: DistanceKey) => void;
  customDistanceText: string;
  onCustomDistanceChange: (v: string) => void;
  transport: TransportKey;
  onTransportChange: (v: TransportKey) => void;
  elevation: ElevationKey;
  onElevationChange: (v: ElevationKey) => void;
  selectedPoi: Set<string>;
  onTogglePoi: (key: string) => void;
  poiCount: number;
  onPoiCountChange: (v: number) => void;
  colors: (typeof Colors)["light" | "dark"];
};

export function RoundTripTab({
  startLocation,
  onOpenStart,
  onClearStart,
  mustStops,
  onOpenStop,
  onClearStopLocation,
  onRemoveStop,
  onAddStop,
  distance,
  onDistanceChange,
  customDistanceText,
  onCustomDistanceChange,
  transport,
  onTransportChange,
  elevation,
  onElevationChange,
  selectedPoi,
  onTogglePoi,
  poiCount,
  onPoiCountChange,
  colors: c,
}: Props) {
  const { t } = useTranslation();

  return (
    <View style={styles.formSection}>
      <View style={styles.formGroup}>
        <SectionLabel label={t("generate.section-start")} color={c.muted} />
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
          <LocationRow
            dotColor={c.tint}
            label={startLocation?.label ?? t("generate.placeholder-loop-start")}
            isFilled={!!startLocation}
            onPress={onOpenStart}
            onClear={onClearStart}
            textColor={c.text}
            mutedColor={c.muted}
            accent={c.tint}
          />
        </View>
      </View>

      <View style={styles.formGroup}>
        <SectionLabel label={t("generate.section-stops")} color={c.muted} />
        <StopsList
          stops={mustStops}
          onOpenStop={onOpenStop}
          onClearStopLocation={onClearStopLocation}
          onRemoveStop={onRemoveStop}
          onAddStop={onAddStop}
          colors={c}
        />
      </View>

      <View style={styles.formGroup}>
        <SectionLabel label={t("generate.section-distance")} color={c.muted} />
        <DistancePicker
          value={distance}
          onChange={onDistanceChange}
          customText={customDistanceText}
          onCustomTextChange={onCustomDistanceChange}
          accent={c.tint}
          surface={c.surface}
          border={c.border}
          mutedColor={c.muted}
          textColor={c.text}
        />
      </View>

      <View style={styles.formGroup}>
        <SectionLabel label={t("generate.section-transport")} color={c.muted} />
        <TransportPicker
          value={transport}
          onChange={onTransportChange}
          accent={c.tint}
          surface={c.surface}
          border={c.border}
          mutedColor={c.muted}
        />
      </View>

      <View style={styles.formGroup}>
        <SectionLabel label={t("generate.section-pois")} color={c.muted} />
        <PoiPicker
          selected={selectedPoi}
          onToggle={onTogglePoi}
          accent={c.tint}
          surface={c.surface}
          border={c.border}
          textColor={c.text}
          mutedColor={c.muted}
        />
        {selectedPoi.size > 0 && (
          <PoiCountPicker
            value={poiCount}
            onChange={onPoiCountChange}
            accent={c.tint}
            surface={c.surface}
            border={c.border}
            textColor={c.text}
            mutedColor={c.muted}
          />
        )}
      </View>

      <View style={styles.formGroup}>
        <SectionLabel label={t("generate.section-elevation")} color={c.muted} />
        <ElevationPicker
          value={elevation}
          onChange={onElevationChange}
          accent={c.tint}
          surface={c.surface}
          border={c.border}
          mutedColor={c.muted}
        />
      </View>
    </View>
  );
}
