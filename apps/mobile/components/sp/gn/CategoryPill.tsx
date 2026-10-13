/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { StyleSheet, View } from 'react-native';

import { radius, space } from '@/constants/tokens';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { CATEGORIES, categoryPillLook, type Category } from '@/components/sp/logic/gameNight';

// Stockpile — <CategoryPill>, Game Night (§9C v3.1): a stock's category as a pill — its short
// name ("Tech", "Food", … Giorgio, 2026-10-12) on its `cat*` colour in `onCat` ink. Keyed by
// the categories.json slug (logic/gameNight.ts's CATEGORIES).

export function CategoryPill({ category }: { category: Category }) {
  const { colors } = useTheme();
  const look = categoryPillLook(category, colors);
  return (
    <View style={[styles.pill, { backgroundColor: look.fill }]}>
      <Text variant="callout" color={look.ink} style={styles.text}>{CATEGORIES[category].pill}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    minHeight: 26,
    paddingHorizontal: space[4],
    borderRadius: radius.pill,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  text: {
    fontWeight: '700',
  },
});
