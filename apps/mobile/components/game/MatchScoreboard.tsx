/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
/**
 * MatchScoreboard (3c): the one score row for Matchup (hero), All matchups
 * (compact) and the playoff cards. Built on sp's Card (scoreboard variant),
 * ScoreDigits and TugBar. No screen hand-rolls its own score row (the Design
 * Lead's D9 ruling). The rules live in lib/game/matchScoreboardModel.ts,
 * shared with Home's ThisWeekCard, so the two cannot drift.
 */
import { StyleSheet, View } from 'react-native';
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
  /** True when the first side is the caller: it gets "(you)", the you colour and the tug.
   * Another manager's game (All matchups) has no "you" side, so its colours are neutral. */
  aIsYou?: boolean;
}

export function MatchScoreboard({ model, mineGain, oppGain, size, youName, oppName, statusLine, aIsYou = true }: MatchScoreboardProps) {
  const { colors } = useTheme();
  // Both scores take ONE size (the ThisWeekCard rule), so neither reads larger.
  const scoreVariant = size === 'hero' ? 'score.xl' : 'score.md';
  // Team colours mark people: only the caller's own side takes the you colour.
  const mineColor = aIsYou ? (model.mineTone === 'zero' ? colors.zero : colors.youText) : colors.text;
  const oppColor = aIsYou ? (model.oppTone === 'zero' ? colors.zero : colors.oppText) : colors.text;

  return (
    <Card variant="scoreboard" accessible accessibilityLabel={model.a11yLabel} style={size === 'compact' ? styles.compact : undefined}>
      <View style={styles.namesRow}>
        {aIsYou ? (
          <Text variant="callout" style={{ color: colors.youText, fontWeight: '700' }}>
            {youName} <Text variant="callout" tone="secondary">(you)</Text>
          </Text>
        ) : (
          <Text variant="callout">{youName}</Text>
        )}
        {oppName ? <Text variant="callout" tone="secondary">{oppName}</Text> : null}
      </View>

      <View style={styles.scoresRow}>
        <View style={styles.scoreCell}>
          <ScoreDigits text={model.mineText} variant={scoreVariant} color={mineColor} />
        </View>
        {model.oppText !== null ? (
          <View style={styles.scoreCell}>
            <ScoreDigits text={model.oppText} variant={scoreVariant} color={oppColor} />
          </View>
        ) : null}
      </View>

      {model.oppText !== null && aIsYou ? (
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
  compact: { paddingVertical: 10 },
  namesRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  scoresRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 4 },
  scoreCell: { flexShrink: 1 },
  footerRow: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', marginTop: 8 },
  footerLeft: { flexShrink: 1 },
  footerRight: { flexShrink: 1 },
});
