// components/discover/discover-filters.tsx

import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  useColorScheme,
  Platform,
} from "react-native";
import { Colors } from "@/constants/theme";
import type { DiscoverFilters, DiscoverSort } from "@/types/discover";
import { useTranslation } from "@/hooks/use-translation";

const TRANSPORT_OPTIONS: { value: string; key: string }[] = [
  { value: "foot-walking", key: "transport-walking" },
  { value: "foot-hiking", key: "transport-hiking" },
  { value: "running", key: "transport-running" },
  { value: "cycling-regular", key: "transport-cycling" },
];

const SORT_OPTIONS: { value: DiscoverSort; key: string }[] = [
  { value: "nearest", key: "sort-nearest" },
  { value: "popular", key: "sort-popular" },
];

interface Props {
  filters: DiscoverFilters;
  onChange: (patch: Partial<DiscoverFilters>) => void;
  /** When true chips float over the map — adds shadow for legibility. */
  floating?: boolean;
}

export function DiscoverFiltersBar({ filters, onChange, floating }: Props) {
  const scheme = useColorScheme() ?? "light";
  const t = Colors[scheme];
  const { t: tr } = useTranslation();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[
        styles.container,
        floating && styles.containerFloating,
      ]}
    >
      {SORT_OPTIONS.map((opt) => {
        const active = filters.sort === opt.value;
        return (
          <Chip
            key={opt.value}
            label={tr(`discover.${opt.key}`)}
            active={active}
            theme={t}
            floating={floating}
            onPress={() => onChange({ sort: opt.value })}
          />
        );
      })}

      <View
        style={[styles.separator, { backgroundColor: t.border }]}
        pointerEvents="none"
      />

      {TRANSPORT_OPTIONS.map((opt) => {
        const active = filters.transport === opt.value;
        return (
          <Chip
            key={opt.value}
            label={tr(`generate.${opt.key}`)}
            active={active}
            theme={t}
            floating={floating}
            onPress={() => onChange({ transport: active ? undefined : opt.value })}
          />
        );
      })}
    </ScrollView>
  );
}

interface ChipProps {
  label: string;
  active: boolean;
  theme: (typeof Colors)["light"];
  floating?: boolean;
  onPress: () => void;
}

function Chip({ label, active, theme, floating, onPress }: ChipProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[
        styles.chip,
        {
          backgroundColor: active ? theme.tint : theme.surface,
          borderColor: active ? theme.tint : theme.border,
        },
        floating && styles.chipFloating,
      ]}
    >
      <Text style={[styles.chipText, { color: active ? "#fff" : theme.text }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    gap: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  containerFloating: {
    paddingVertical: 6,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipFloating: {
    // Elevate chips so they're legible over the map
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.15,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
      },
      android: {
        elevation: 4,
      },
    }),
  },
  chipText: {
    fontSize: 13,
    fontWeight: "600",
  },
  separator: {
    width: 1,
    height: 22,
    marginHorizontal: 4,
    borderRadius: 1,
  },
});
