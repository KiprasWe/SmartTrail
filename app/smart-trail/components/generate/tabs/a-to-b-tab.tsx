import { View } from "react-native";
import {
  SectionLabel,
  LocationRow,
  TransportPicker,
  ElevationPicker,
  PoiPicker,
  PoiCountPicker,
  type TransportKey,
  type ElevationKey,
} from "@/components/generate/route-form-components";
import { StopsList, type MustStop } from "@/components/generate/stops-list";
import { formStyles as styles } from "@/components/generate/form-styles";
import { Colors } from "@/constants/theme";
import { t } from "@/lib/i18n";
import type { ResolvedLocation } from "@/hooks/use-location-search";

type Props = {
  startLocation: ResolvedLocation | null;
  endLocation: ResolvedLocation | null;
  onOpenStart: () => void;
  onOpenEnd: () => void;
  onClearStart: () => void;
  onClearEnd: () => void;
  mustStops: MustStop[];
  onOpenStop: (id: string) => void;
  onClearStopLocation: (id: string) => void;
  onRemoveStop: (id: string) => void;
  onAddStop: () => void;
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

export function AtoBTab({
  startLocation,
  endLocation,
  onOpenStart,
  onOpenEnd,
  onClearStart,
  onClearEnd,
  mustStops,
  onOpenStop,
  onClearStopLocation,
  onRemoveStop,
  onAddStop,
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
  return (
    <View style={styles.formSection}>
      <View style={styles.formGroup}>
        <SectionLabel label={t("generate.section-locations")} color={c.muted} />
        <View
          style={[
            styles.card,
            { backgroundColor: c.surface, borderColor: c.border },
          ]}
        >
          <LocationRow
            dotColor="#1D9E75"
            label={startLocation?.label ?? t("generate.placeholder-start")}
            isFilled={!!startLocation}
            onPress={onOpenStart}
            onClear={onClearStart}
            textColor={c.text}
            mutedColor={c.muted}
          />

          <StopsList
            stops={mustStops}
            onOpenStop={onOpenStop}
            onClearStopLocation={onClearStopLocation}
            onRemoveStop={onRemoveStop}
            onAddStop={onAddStop}
            colors={c}
            embedded
          />

          <View
            style={[styles.locationDivider, { backgroundColor: c.border }]}
          />
          <LocationRow
            dotColor="#E24B4A"
            label={endLocation?.label ?? t("generate.placeholder-destination")}
            isFilled={!!endLocation}
            onPress={onOpenEnd}
            onClear={onClearEnd}
            textColor={c.text}
            mutedColor={c.muted}
          />
        </View>
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
