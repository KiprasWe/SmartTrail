import { useMemo } from "react";
import { View, StyleSheet } from "react-native";
import Svg, {
  Path,
  Defs,
  LinearGradient,
  Stop,
  Line,
  Text as SvgText,
} from "react-native-svg";
import { Colors } from "@/constants/theme";

type Props = {
  elevations: number[];
  colors: (typeof Colors)["light" | "dark"];
  width?: number;
  height?: number;
};

const PAD = { top: 8, right: 8, bottom: 24, left: 36 };

export function ElevationProfile({
  elevations,
  colors: c,
  width = 340,
  height = 80,
}: Props) {
  const chartW = width - PAD.left - PAD.right;
  const chartH = height - PAD.top - PAD.bottom;

  const { fillPath, linePath, yLabels } = useMemo(() => {
    if (!elevations.length) return { fillPath: "", linePath: "", yLabels: [] };

    const step = Math.max(1, Math.floor(elevations.length / 200));
    const pts = elevations.filter((_, i) => i % step === 0);

    const minE = Math.floor(Math.min(...pts) / 5) * 5;
    const maxE = Math.ceil(Math.max(...pts) / 5) * 5;
    const range = maxE - minE || 1;

    const toX = (i: number) => PAD.left + (i / (pts.length - 1)) * chartW;
    const toY = (e: number) => PAD.top + chartH - ((e - minE) / range) * chartH;

    let linePath = `M${toX(0)},${toY(pts[0])}`;
    for (let i = 1; i < pts.length; i++) {
      linePath += ` L${toX(i)},${toY(pts[i])}`;
    }

    const fillPath =
      linePath +
      ` L${toX(pts.length - 1)},${PAD.top + chartH}` +
      ` L${PAD.left},${PAD.top + chartH} Z`;

    const mid = Math.round((minE + maxE) / 2);
    const yLabels = [
      { label: `${maxE}`, y: toY(maxE) },
      { label: `${mid}`, y: toY(mid) },
      { label: `${minE}`, y: toY(minE) },
    ];

    return { fillPath, linePath, yLabels };
  }, [elevations, chartW, chartH]);

  if (!elevations.length) return null;

  const tint = c.tint;
  const gridColor = c.border;

  return (
    <View style={[styles.container, { borderTopColor: c.border }]}>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="elev-grad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={tint} stopOpacity={0.35} />
            <Stop offset="100%" stopColor={tint} stopOpacity={0} />
          </LinearGradient>
        </Defs>

        {yLabels.map(({ y }, i) => (
          <Line
            key={i}
            x1={PAD.left}
            y1={y}
            x2={PAD.left + chartW}
            y2={y}
            stroke={gridColor}
            strokeWidth={1}
          />
        ))}

        <Path d={fillPath} fill="url(#elev-grad)" />

        <Path
          d={linePath}
          fill="none"
          stroke={tint}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {yLabels.map(({ label, y }, i) => (
          <SvgText
            key={i}
            x={PAD.left - 4}
            y={y + 4}
            textAnchor="end"
            fontSize={9}
            fill={c.muted}
            fontWeight="400"
          >
            {label}
          </SvgText>
        ))}

        <SvgText
          x={PAD.left - 4}
          y={PAD.top + chartH + 14}
          textAnchor="end"
          fontSize={9}
          fill={c.muted}
          fontWeight="400"
        >
          m
        </SvgText>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
  },
});
