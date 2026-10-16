/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, ReduceMotion } from 'react-native-reanimated';
import { router } from 'expo-router';

import { radius, space } from '@/constants/tokens';
import { Card } from '@/components/sp/Card';
import { Icon } from '@/components/sp/Icon';
import { PressableScale } from '@/components/sp/PressableScale';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { ManagerRow } from '@/components/sp/gn';
import { useMotion } from '@/components/sp/motion';
import { teamHref, teamLinkLabel } from '@/lib/game/teamLink';
import { useCaptureAction } from '@/lib/money/captureScript';
import { STANDINGS_CARD_TITLE, standingsThroughWeekCaption } from '@/lib/home/homeCopy';
import { STANDINGS_HREF, throughWeekShown } from '@/lib/home/calmHome';

// Stockpile — <StandingsCard> (Phase 3b-2, board "Home"). Top 3 plus the
// caller's own row if outside it. Rank/record/gain come STRAIGHT from
// get_home_league's `standings` (league_standings_ranked server order) —
// this component never re-sorts (spec: "standings from SQL
// league_standings_ranked only, never re-sort on the client").
//
// H4: rows use `stagger.delayFor(i)` on enter (capped at 8, per the token).
//
// A calm Home (2026-10-12): the whole card opens League on Standings (a chevron after
// "Through Week N"); League reads `segment`, so it lands there even if it was left on
// Schedule.
//
// Game Night (§9C, W4; the board's StandingsExcerpt): the rimmed card; the rows are the
// one manager row (ManagerRow, its Home excerpt: no movement column — movement is League's
// alone, S-10 — and a 24pt avatar), divided by space, never by rules.

/** The header row is ~22pt tall; 11pt above and below reaches 44pt (the rows below start 8pt under it,
 * so the last 3pt overlap theirs, where the row on top wins). */
const HEADER_HIT_SLOP = { top: 11, bottom: 11 } as const;

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
  /** True when this mount was caused by a LEAGUE SWITCH, not Home's first
   * open (H5, Design Lead ruling 2026-09-29, Blocking 1) — rows render at
   * their final position with no stagger to replay. */
  skipEntrance?: boolean;
}

function record(r: StandingRow): string {
  return `${r.wins}–${r.losses}${r.ties ? `–${r.ties}` : ''}`;
}

export function StandingsCard({ rows, throughWeek, skipEntrance = false }: StandingsCardProps) {
  const { colors } = useTheme();
  // DEV capture only (captureScript): the same push an excerpt row's tap runs.
  useCaptureAction('homeheader', () => router.push(STANDINGS_HREF));
  useCaptureAction('hometeam', (id) => {
    const r = rows.find((x) => x.userId === id);
    const href = r ? teamHref({ userId: r.userId, name: r.displayName, isYou: r.isYou }) : null;
    if (href) router.push(href);
  });
  const { reduced, stagger, spring } = useMotion();

  // Top 3, plus the caller's own row if they're outside it.
  const top3 = rows.slice(0, 3);
  const mine = rows.find((r) => r.isYou);
  const showMineSeparately = mine && !top3.some((r) => r.userId === mine.userId);
  const displayed = showMineSeparately ? [...top3, mine] : top3;

  return (
    <Card style={styles.card}>
      {/* The header is the link to League › Standings; each row below opens THAT manager's team
          (yours: your Portfolio), so the card is no longer one button (the leaguemate team view). */}
      <PressableScale
        onPress={() => router.push(STANDINGS_HREF)}
        accessibilityRole="button"
        accessibilityLabel={throughWeekShown(throughWeek) ? `${STANDINGS_CARD_TITLE}, ${standingsThroughWeekCaption(throughWeek)}` : STANDINGS_CARD_TITLE}
        accessibilityHint="Opens Standings"
        // The §9B 44pt target by hit slop, so the header's own box (and the card) doesn't move.
        hitSlop={HEADER_HIT_SLOP}
        style={styles.header}
        testID="standings-card-header"
      >
        {/* The board's excerpt title: 17/800 (headline is 17/600). */}
        <Text variant="headline" style={styles.title}>{STANDINGS_CARD_TITLE}</Text>
        <View style={styles.headerRight}>
          {throughWeekShown(throughWeek) ? (
            <Text variant="caption" tone="secondary" style={styles.headerCaption}>
              {standingsThroughWeekCaption(throughWeek)}
            </Text>
          ) : null}
          <Icon name="chevronRight" size="callout" tone="text2" />
        </View>
      </PressableScale>
      <View style={styles.rows}>
        {displayed.map((r, i) => {
          const entering = reduced || skipEntrance
            ? undefined
            : FadeInDown.delay(stagger.delayFor(i))
                .springify()
                .damping(spring.snappy.damping)
                .stiffness(spring.snappy.stiffness)
                .reduceMotion(ReduceMotion.System);
          const href = teamHref({ userId: r.userId, name: r.displayName, isYou: r.isYou });
          return (
            <Animated.View key={r.userId} entering={entering}>
              {/* S-10 / §9C ManagerRow: your row on `youTint` with the 1.5pt `you` ring, your
                  name bold, no "(you)"; season gains carry their sign (U-50), by sign colour. */}
              <ManagerRow
                excerpt
                rank={r.rank}
                name={r.displayName}
                isYou={r.isYou}
                record={record(r)}
                seasonGain={r.pointsFor}
                onPress={href ? () => router.push(href) : undefined}
                hint={href ? teamLinkLabel({ name: r.displayName, isYou: r.isYou }) : undefined}
              />
            </Animated.View>
          );
        })}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  // The board's excerpt: the rows run nearly to the card's edge (8), the header inset
  // to line up with the rows' rank column (8 + 8 = 16, the card's own 16).
  card: {
    paddingTop: space[5],
    paddingHorizontal: space[3],
    paddingBottom: space[3],
    gap: space[3],
    borderRadius: radius.lg,
  },
  // At large text the caption and chevron drop to their own line rather than push the
  // chevron off the card or break the caption mid-word (capture pass, XL/XXXL).
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    // The title's left edge on the rows' rank glyphs: the card's 8 + ManagerRow's 12.
    paddingHorizontal: space[4],
    justifyContent: 'space-between',
    alignItems: 'center',
    columnGap: space[3],
    rowGap: space[1],
  },
  title: {
    fontWeight: '800',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    flexShrink: 1,
  },
  headerCaption: {
    flexShrink: 1,
  },
  // The rows sit 2pt apart (space, never a rule line, §9C rule 2).
  rows: {
    gap: space[1],
  },
});
