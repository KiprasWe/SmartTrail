import { View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LocationRow } from "./route-form-components";
import { formStyles as styles } from "./form-styles";
import { Colors } from "@/constants/theme";
import { useTranslation } from "@/hooks/use-translation";
import type { ResolvedLocation } from "@/hooks/use-location-search";

export type MustStop = {
  id: string;
  location: ResolvedLocation | null;
};

type Props = {
  stops: MustStop[];
  onOpenStop: (id: string) => void;
  onClearStopLocation: (id: string) => void;
  onRemoveStop: (id: string) => void;
  onAddStop: () => void;
  colors: (typeof Colors)["light" | "dark"];
  /** When true, render stops directly (used inline inside AI card) without
   * wrapping in its own card. Otherwise wraps stops + "Add stop" in a card. */
  embedded?: boolean;
};

export function StopsList({
  stops,
  onOpenStop,
  onClearStopLocation,
  onRemoveStop,
  onAddStop,
  colors: c,
  embedded = false,
}: Props) {
  const { t } = useTranslation();

  const rows = (
    <>
      {stops.map((stop, i) => (
        <View key={stop.id}>
          {(i > 0 || embedded) && (
            <View style={[styles.locationDivider, { backgroundColor: c.border }]} />
          )}
          <LocationRow
            dotColor={c.tint}
            dotStyle="outlined"
            label={stop.location?.label ?? t("generate.stop-label", { n: String(i + 1) })}
            isFilled={!!stop.location}
            onPress={() => onOpenStop(stop.id)}
            onClear={() => {
              if (stop.location) onClearStopLocation(stop.id);
              else onRemoveStop(stop.id);
            }}
            alwaysShowClear
            showHandle
            textColor={c.text}
            mutedColor={c.muted}
            accent={c.tint}
          />
        </View>
      ))}

      {(stops.length > 0 || embedded) && (
        <View style={[styles.locationDivider, { backgroundColor: c.border }]} />
      )}

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
    </>
  );

  if (embedded) return <>{rows}</>;

  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
      {rows}
    </View>
  );
}
