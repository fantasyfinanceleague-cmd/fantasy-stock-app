/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { scaledBadge } from '@/components/sp/logic/largeText';

/** The medal for places 1–3 (§9A, season complete only): a filled disc with the place
 * numeral in on-medal. Never medal-coloured text. One component for League › Standings
 * and League › History, so a finished season's medals look the same everywhere (GS-8). */
export const MEDAL: Record<number, { fill: 'medalGold' | 'medalSilver' | 'medalBronze'; label: string }> = {
  1: { fill: 'medalGold', label: '1st place' },
  2: { fill: 'medalSilver', label: '2nd place' },
  3: { fill: 'medalBronze', label: '3rd place' },
};

/** The disc's size at this text size: it grows with its numeral (a fixed 20 pt disc
 * clipped the numeral at XL). */
export function useMedalDiscSize(): number {
  const { fontScale } = useWindowDimensions();
  return scaledBadge(20, fontScale);
}

export function MedalDisc({ place, size }: { place: number; size: number }) {
  const { colors } = useTheme();
  const medal = MEDAL[place];
  if (!medal) return null;
  return (
    <View style={[styles.disc, { width: size, height: size, borderRadius: size / 2, backgroundColor: colors[medal.fill] }]}>
      <Text variant="caption" maxFontSizeMultiplier={1.6} style={[styles.numeral, { color: colors.onMedal }]}>{place}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  disc: { alignItems: 'center', justifyContent: 'center' },
  numeral: { fontSize: 11, fontWeight: '800' },
});
