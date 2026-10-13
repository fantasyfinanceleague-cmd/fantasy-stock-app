/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { StyleSheet, View } from 'react-native';

import { radius, space } from '@/constants/tokens';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { CATEGORIES, categoryPillLook, type Category } from '@/components/sp/logic/gameNight';

// Stockpile — <CategoryPill>, Game Night (§9C v3.1): a stock's category as a pill — its short
// name ("Tech", "Food", … Giorgio, 2026-10-12) on its `cat*` colour in `onCat` ink. Keyed by
// the categories.json slug (logic/gameNight.ts's CATEGORIES).

/** `row`: the small pill beside a ticker on a list row (the board's Portfolio rows: 18pt
 * tall, 11pt type); the card's header keeps the full size. */
export function CategoryPill({ category, size = 'card' }: { category: Category; size?: 'card' | 'row' }) {
  const { colors } = useTheme();
  const look = categoryPillLook(category, colors);
  return (
    <View style={[styles.pill, size === 'row' ? styles.pillRow : null, { backgroundColor: look.fill }]}>
      <Text variant={size === 'row' ? 'caption' : 'callout'} maxFontSizeMultiplier={size === 'row' ? ROW_PILL_MAX_SCALE : undefined} color={look.ink} style={styles.text}>{CATEGORIES[category].pill}</Text>
    </View>
  );
}

/** A row pill follows Dynamic Type only so far: it never outgrows the ticker beside it. */
export const ROW_PILL_MAX_SCALE = 1.3;

const styles = StyleSheet.create({
  pill: {
    minHeight: 26,
    paddingHorizontal: space[4],
    borderRadius: radius.pill,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  pillRow: {
    minHeight: 20,
    paddingHorizontal: space[3],
  },
  text: {
    fontWeight: '700',
  },
});
