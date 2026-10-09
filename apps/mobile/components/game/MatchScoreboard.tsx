/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
/**
 * MatchScoreboard (3c): the one score row for Matchup (hero), All matchups
 * (compact) and the playoff cards. Built on sp's Card (scoreboard variant),
 * ScoreDigits and TugBar. No screen hand-rolls its own score row (the Design
 * Lead's D9 ruling). The rules live in lib/game/matchScoreboardModel.ts,
 * shared with Home's ThisWeekCard, so the two cannot drift.
 */
import { StyleSheet, View } from 'react-native';
import { radius, space } from '@/constants/tokens';
import { yourNameStyle } from '@/lib/game/managerRow';
import { Card } from '@/components/sp/Card';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { ScoreDigits } from '@/components/sp/game/ScoreDigits';
import { TugBar } from '@/components/sp/game/TugBar';
import type { MatchScoreboardModel } from '@/lib/game/matchScoreboardModel';

export interface MatchScoreboardProps {
  model: MatchScoreboardModel;
  /** The two gains behind the model: TugBar works its own ratio from them. */
  mineGain: number;
  oppGain: number;
  /** hero: key screen 2 (live and final). compact: All matchups. */
  size: 'hero' | 'compact';
  youName: string;
  oppName: string | null;
  /** Shown under the scores when there is no lead line (e.g. "Live · Thu 1:37 PM ET"). */
  statusLine: string;
  /** True when the first side is the caller: your name bold in the you colour (no "(you)":
   * S-10, Giorgio), and in All matchups your game's card takes the you-tint.
   * Another manager's game (All matchups) has no "you" side, so its scores and names are neutral. */
  aIsYou?: boolean;
}

export function MatchScoreboard({ model, mineGain, oppGain, size, youName, oppName, statusLine, aIsYou = true }: MatchScoreboardProps) {
  const { colors } = useTheme();
  // Both scores take ONE size (the ThisWeekCard rule), so neither reads larger. The hero
  // is score.lg, ThisWeekCard's size: at score.xl (56 pt) two typical scores need ~187 pt
  // each against ~141 pt per half on a 390 pt phone, so the fit-to-width safety net shrank
  // each side by a different amount and the two read at different sizes (capture pass,
  // 2026-10-08; flagged for the Design Lead's gate).
  const scoreVariant = size === 'hero' ? 'score.lg' : 'score.md';
  // Team colours mark people: only the caller's own side takes the you colour.
  const mineColor = aIsYou ? (model.mineTone === 'zero' ? colors.zero : colors.youText) : colors.text;
  const oppColor = aIsYou ? (model.oppTone === 'zero' ? colors.zero : colors.oppText) : colors.text;

  return (
    <Card variant="scoreboard" accessible accessibilityLabel={model.a11yLabel} style={[styles.card, size === 'compact' ? styles.compact : null, size === 'compact' && aIsYou ? { backgroundColor: colors.youTint } : null]}>
      <View style={styles.namesRow}>
        {aIsYou ? (
          <Text variant="callout" style={[{ color: colors.youText }, yourNameStyle(true)]}>{youName}</Text>
        ) : (
          <Text variant="callout">{youName}</Text>
        )}
        {oppName ? <Text variant="callout" tone="secondary" style={styles.oppName}>{oppName}</Text> : null}
      </View>

      <View style={styles.scoresRow}>
        <View style={styles.scoreCell}>
          <ScoreDigits text={model.mineText} variant={scoreVariant} color={mineColor} />
        </View>
        {model.oppText !== null ? (
          <View style={[styles.scoreCell, styles.scoreCellRight]}>
            <ScoreDigits text={model.oppText} variant={scoreVariant} color={oppColor} />
          </View>
        ) : null}
      </View>

      {/* The board's All-matchups cards each carry a tug bar, so every game with two sides has one. */}
      {model.oppText !== null ? (
        <TugBar you={mineGain} opponent={oppGain} opponentName={oppName ?? ''} />
      ) : null}

      <View style={styles.footerRow}>
        <Text variant="caption" tone="secondary" style={styles.footerLeft}>
          {model.leadLine ?? statusLine}
        </Text>
        {model.tiebreakLine ? (
          <Text variant="caption" tone="secondary" style={styles.footerRight}>
            {model.tiebreakLine}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  // The sp Card has no padding or radius of its own (callers set both, as Home's
  // ThisWeekCard does): without these the text sat flush on the card edge (final sweep S-1).
  card: { borderRadius: radius.lg, padding: space[5], gap: space[1] },
  compact: { paddingVertical: space[3], paddingHorizontal: space[4] },
  // Wraps (as ThisWeekCard's does): at large text the opponent's name went off the card.
  namesRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: space[2] },
  oppName: { flexShrink: 1, textAlign: 'right', marginLeft: 'auto' },
  scoresRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 4, gap: space[5] },
  // ThisWeekCard's rule (#167): `minWidth: 0` lets `flex: 1` really split the row, so
  // ScoreDigits' adjustsFontSizeToFit has a width to shrink against and the two scores
  // never run into each other ("+$213.60+$90.45" in the capture).
  scoreCell: { flex: 1, minWidth: 0 },
  scoreCellRight: { alignItems: 'flex-end' },
  footerRow: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', marginTop: 8 },
  footerLeft: { flexShrink: 1 },
  footerRight: { flexShrink: 1 },
});
