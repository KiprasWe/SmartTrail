import { View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
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
import { formStyles as styles } from "@/components/generate/form-styles";
import { Colors } from "@/constants/theme";
import { useTranslation } from "@/hooks/use-translation";
import type { ResolvedLocation } from "@/hooks/use-location-search";
import type { MustStop } from "@/components/generate/stops-list";

type Props = {
  startLocation: ResolvedLocation | null;
  endLocation: ResolvedLocation | null;
  onOpenStart: () => void;
  onOpenEnd: () => void;
  onClearStart: () => void;
  onClearEnd: () => void;
  mustStops: MustStop[];
  onOpenStop: (id: string) => void;
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
  const { t } = useTranslation();

  return (
    <View style={styles.formSection}>
      <View style={styles.formGroup}>
        <SectionLabel label={t("generate.section-locations")} color={c.muted} />
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
          <LocationRow
            dotColor="#1D9E75"
            label={startLocation?.label ?? t("generate.placeholder-start")}
            isFilled={!!startLocation}
            onPress={onOpenStart}
            onClear={onClearStart}
            textColor={c.text}
            mutedColor={c.muted}
            accent={c.tint}
          />

          {mustStops.map((stop, i) => (
            <View key={stop.id}>
              <View style={[styles.locationDivider, { backgroundColor: c.border }]} />
              <View style={styles.stopRow}>
                <Ionicons
                  name="reorder-three-outline"
                  size={18}
                  color={c.muted}
                  style={styles.stopHandle}
                />
                <View style={[styles.stopDot, { borderColor: c.tint }]} />
                <TouchableOpacity
                  style={{ flex: 1 }}
                  onPress={() => onOpenStop(stop.id)}
                  activeOpacity={0.6}
                >
                  <Text
                    style={[
                      styles.locText,
                      { color: stop.location ? c.text : c.muted },
                    ]}
                    numberOfLines={1}
                  >
                    {stop.location?.label ?? t("generate.stop-label", { n: String(i + 1) })}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => onRemoveStop(stop.id)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  activeOpacity={0.6}
                >
                  <Ionicons name="close-circle" size={18} color={c.muted} />
                </TouchableOpacity>
              </View>
            </View>
          ))}

          <View style={[styles.locationDivider, { backgroundColor: c.border }]} />
          <TouchableOpacity style={styles.addStopRow} onPress={onAddStop} activeOpacity={0.6}>
            <View
              style={[
                styles.addStopIcon,
                { backgroundColor: c.tint + "18", borderColor: c.tint + "40" },
              ]}
            >
              <Ionicons name="add" size={14} color={c.tint} />
            </View>
            <Text style={[styles.addStopLabel, { color: c.tint }]}>
              {t("generate.add-stop")}
            </Text>
          </TouchableOpacity>

          <View style={[styles.locationDivider, { backgroundColor: c.border }]} />
          <LocationRow
            dotColor="#E24B4A"
            label={endLocation?.label ?? t("generate.placeholder-destination")}
            isFilled={!!endLocation}
            onPress={onOpenEnd}
            onClear={onClearEnd}
            textColor={c.text}
            mutedColor={c.muted}
            accent={c.tint}
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
