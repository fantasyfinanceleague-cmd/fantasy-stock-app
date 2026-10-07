/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { PixelRatio, StyleSheet, View } from 'react-native';

import { space } from '@/constants/tokens';
import { Card } from '@/components/sp/Card';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { YOUR_TEAM_SO_FAR, roundSlotLabel, teamSoFarCaption } from '@/lib/home/homeCopy';

// The "Your team so far · 1 of 6" grid (Phase 3b-2, board B5), extracted from
// Home's DraftingCard unchanged so the draft room shows the SAME strip (3c-2,
// UX rule 4). A slot per round, filled with the symbol once drafted, "Rd N"
// while still empty. The room passes its own title and caption (the board's
// "Your roster · 1 of 6 · $2,000 per slot").

export interface TeamSoFarGridProps {
  /** The header; Home's "Your team so far" by default (the room: "Your roster"). */
  title?: string;
  /** The header's caption; "1 of 6" by default (the room: "1 of 6 · $2,000 per slot"). */
  caption?: string;
  /** Your drafted symbols, in pick order. */
  symbols: readonly string[];
  numRounds: number;
}

export function TeamSoFarGrid({ title, caption, symbols, numRounds }: TeamSoFarGridProps) {
  const { colors } = useTheme();
  // XXXL (XL check, 2026-10-05): see styles.slotWide. Default font scale (1)
  // keeps the 3-across grid, so the default layout does not move.
  const twoAcross = PixelRatio.getFontScale() >= 1.5;
  const slots = Array.from({ length: numRounds }, (_, i) => symbols[i] ?? null);
  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Text variant="headline">{title ?? YOUR_TEAM_SO_FAR}</Text>
        <Text variant="caption" tone="secondary">{caption ?? teamSoFarCaption(symbols.length, numRounds)}</Text>
      </View>
      <View style={styles.slotGrid}>
        {slots.map((symbol, i) =>
          symbol ? (
            <View key={i} style={[styles.slot, twoAcross && styles.slotWide, { backgroundColor: colors.youText, borderColor: colors.youText }]}>
              <Text variant="callout" numberOfLines={1} style={{ color: colors.surface, fontWeight: '700' }}>
                {symbol}
              </Text>
            </View>
          ) : (
            <View key={i} style={[styles.slot, twoAcross && styles.slotWide, { borderColor: colors.border }]}>
              <Text variant="callout" tone="secondary" numberOfLines={1}>
                {roundSlotLabel(i + 1)}
              </Text>
            </View>
          ),
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: space[6],
    gap: space[3],
    borderRadius: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  slotGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
  },
  // XXXL (XL check, 2026-10-05): at large Dynamic Type a 3-across tile is too
  // narrow for a ticker like NVDA, so the grid drops to 2 across.
  slotWide: {
    width: '48%',
  },
  // G-5 (pass-2 gate): a fixed-ratio tile in a wrapping row over-allocated the
  // grid's height (empty space under the slots) and set labels low. The board's
  // slot is a 40 pt row with its label centred; minHeight keeps large text growing.
  slot: {
    width: '31%',
    minHeight: 44,
    paddingVertical: space[2],
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space[1],
  },
});
