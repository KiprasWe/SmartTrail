import { View, Text, TouchableOpacity, TextInput } from "react-native";
import {
  SectionLabel,
  LocationRow,
  TransportPicker,
  ElevationPicker,
  DistancePicker,
  type TransportKey,
  type ElevationKey,
  type DistanceKey,
} from "@/components/generate/route-form-components";
import { formStyles as styles } from "@/components/generate/form-styles";
import { StopsList, type MustStop } from "@/components/generate/stops-list";
import { Colors } from "@/constants/theme";
import { t } from "@/lib/i18n";
import type { ResolvedLocation } from "@/hooks/use-location-search";

type Props = {
  aiMode: "a_to_b" | "round_trip";
  onAiModeChange: (m: "a_to_b" | "round_trip") => void;
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
  prompt: string;
  onPromptChange: (v: string) => void;
  distance: DistanceKey;
  onDistanceChange: (v: DistanceKey) => void;
  customDistanceText: string;
  onCustomDistanceChange: (v: string) => void;
  transport: TransportKey;
  onTransportChange: (v: TransportKey) => void;
  elevation: ElevationKey;
  onElevationChange: (v: ElevationKey) => void;
  colors: (typeof Colors)["light" | "dark"];
};

export function AiTab({
  aiMode,
  onAiModeChange,
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
  prompt,
  onPromptChange,
  distance,
  onDistanceChange,
  customDistanceText,
  onCustomDistanceChange,
  transport,
  onTransportChange,
  elevation,
  onElevationChange,
  colors: c,
}: Props) {
  return (
    <View style={styles.formSection}>
      <View style={[styles.subModeBar, { backgroundColor: c.surface, borderColor: c.border }]}>
        {(
          [
            { key: "a_to_b", label: t("generate.mode-atob") },
            { key: "round_trip", label: t("generate.mode-round-trip") },
          ] as const
        ).map((m) => {
          const active = aiMode === m.key;
          return (
            <TouchableOpacity
              key={m.key}
              style={[styles.subModeTab, active && { backgroundColor: c.tint }]}
              onPress={() => onAiModeChange(m.key)}
              activeOpacity={0.72}
            >
              <Text style={[styles.subModeTabText, { color: active ? "#fff" : c.muted }]}>
                {m.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

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

          {aiMode === "a_to_b" && (
            <>
              <View style={[styles.locationDivider, { backgroundColor: c.border }]} />
              <LocationRow
                dotColor="#E24B4A"
                label={endLocation?.label ?? t("generate.placeholder-destination")}
                isFilled={!!endLocation}
                onPress={onOpenEnd}
                onClear={onClearEnd}
                textColor={c.text}
                mutedColor={c.muted}
              />
            </>
          )}
        </View>
      </View>

      {aiMode === "round_trip" && (
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
      )}

      <View style={styles.formGroup}>
        <SectionLabel label={t("generate.section-ai-prompt")} color={c.muted} />
        <View
          style={[
            styles.card,
            { backgroundColor: c.surface, borderColor: c.border, padding: 14 },
          ]}
        >
          <TextInput
            style={[styles.aiPromptInput, { color: c.text }]}
            placeholder={t("generate.placeholder-ai-prompt")}
            placeholderTextColor={c.muted}
            value={prompt}
            onChangeText={onPromptChange}
            multiline
            numberOfLines={4}
            maxLength={500}
            textAlignVertical="top"
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
