/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { View, StyleSheet } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { space } from '@/constants/tokens';
import { raceCoords, type RaceLayout } from '@/lib/game/raceLayout';

export interface WeekRaceProps {
  layout: RaceLayout;
  width: number;
  height?: number;
  a11yLabel: string;
}

/** Mon–Fri race: each side's score at each day's close, on one shared scale.
 * Points are the real closes (no interpolation); a day with no bar is a gap. */
export function WeekRace({ layout, width, height = 120, a11yLabel }: WeekRaceProps) {
  const { colors } = useTheme();
  const c = raceCoords(layout, width, height);
  const path = (pts: { x: number; y: number }[]) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

  return (
    <View accessible accessibilityLabel={a11yLabel} style={styles.wrap}>
      <Svg width={width} height={height}>
        <Line x1={0} x2={width} y1={c.zeroY} y2={c.zeroY} stroke={colors.borderStrong} strokeWidth={1} />
        {c.mine.length > 1 ? <Path d={path(c.mine)} stroke={colors.you} strokeWidth={2} fill="none" /> : null}
        {c.opp.length > 1 ? <Path d={path(c.opp)} stroke={colors.opp} strokeWidth={2} fill="none" /> : null}
      </Svg>
      <View style={[styles.labels, { width }]}>
        {layout.labels.map((label) => (
          <Text key={label} variant="caption" tone="secondary">{label}</Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space[2] },
  labels: { flexDirection: 'row', justifyContent: 'space-between' },
});
