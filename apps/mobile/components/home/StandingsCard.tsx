/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, ReduceMotion } from 'react-native-reanimated';

import { space } from '@/constants/tokens';
import { Card } from '@/components/sp/Card';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { Money } from '@/components/sp/Money';
import { useMotion } from '@/components/sp/motion';
import { STANDINGS_CARD_TITLE, standingsThroughWeekCaption } from '@/lib/home/homeCopy';

// Stockpile — <StandingsCard> (Phase 3b-2, board "Home"). Top 3 plus the
// caller's own row if outside it. Rank/record/gain come STRAIGHT from
// get_home_league's `standings` (league_standings_ranked server order) —
// this component never re-sorts (spec: "standings from SQL
// league_standings_ranked only, never re-sort on the client").
//
// H4: rows use `stagger.delayFor(i)` on enter (capped at 8, per the token).

export interface StandingRow {
  userId: string;
  rank: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  displayName: string;
  isBot: boolean;
  isYou: boolean;
}

export interface StandingsCardProps {
  rows: StandingRow[];
  /** The last COMPLETED week (not the league's total week count — code
   * review, 2026-09-29 found this receiving `numWeeks`, so the caption
   * always said "Through Week 14" regardless of which week was live). */
  throughWeek: number;
}

function record(r: StandingRow): string {
  return `${r.wins}–${r.losses}${r.ties ? `–${r.ties}` : ''}`;
}

export function StandingsCard({ rows, throughWeek }: StandingsCardProps) {
  const { colors } = useTheme();
  const { reduced, stagger, spring } = useMotion();

  // Top 3, plus the caller's own row if they're outside it.
  const top3 = rows.slice(0, 3);
  const mine = rows.find((r) => r.isYou);
  const showMineSeparately = mine && !top3.some((r) => r.userId === mine.userId);
  const displayed = showMineSeparately ? [...top3, mine] : top3;

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Text variant="headline">{STANDINGS_CARD_TITLE}</Text>
        <Text variant="caption" tone="secondary">
          {standingsThroughWeekCaption(throughWeek)}
        </Text>
      </View>
      <View>
        {displayed.map((r, i) => {
          const entering = reduced
            ? undefined
            : FadeInDown.delay(stagger.delayFor(i))
                .springify()
                .damping(spring.snappy.damping)
                .stiffness(spring.snappy.stiffness)
                .reduceMotion(ReduceMotion.System);
          return (
            <Animated.View
              key={r.userId}
              entering={entering}
              style={[styles.row, { backgroundColor: r.isYou ? colors.youTint : 'transparent' }]}
            >
              <Text variant="callout" tone="secondary" style={styles.rankCol}>
                {r.rank}
              </Text>
              <Text variant="callout" style={styles.nameCol} numberOfLines={1}>
                {r.displayName}
                {r.isYou ? <Text variant="callout" tone="secondary"> (you)</Text> : null}
              </Text>
              <Text variant="callout" tone="secondary" style={styles.recordCol}>
                {record(r)}
              </Text>
              <View style={styles.gainCol}>
                <Money value={r.pointsFor} size="callout" colorBySign />
              </View>
            </Animated.View>
          );
        })}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: space[5],
    gap: space[3],
    borderRadius: 14,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingVertical: space[3],
  },
  rankCol: {
    width: 20,
    fontVariant: ['tabular-nums'],
  },
  nameCol: {
    flex: 1,
    fontWeight: '700',
  },
  recordCol: {
    fontVariant: ['tabular-nums'],
  },
  gainCol: {
    minWidth: 78,
    alignItems: 'flex-end',
  },
});
