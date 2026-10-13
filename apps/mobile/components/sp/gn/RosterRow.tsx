/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { StyleSheet, View } from 'react-native';

import { radius, space } from '@/constants/tokens';
import { RIM_WIDTH } from '@/constants/tokens/elevation';
import { PressableScale } from '@/components/sp/PressableScale';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { formatMoney, formatPercent } from '@/components/sp/logic/money';
import { litSide, toneOf } from '@/components/sp/logic/gameNight';

// Stockpile — <RosterRow> and <GroupHead>, Game Night (§9C; Giorgio's Matchup ruling: "it
// lists your stocks as if they are like a football roster … and it stacks them up").
//
// A row is two mirrored halves — yours left, theirs right — each: ticker + company, and the
// week gain in `score.md` + week %. The centre is an EMPTY gap (Giorgio took the Design
// Lead's "Empty" for unslotted leagues). The half that wins the row sits on the `lit`
// slab, which runs off its OUTER screen edge (pass the screen `gutter` so it bleeds past it)
// with only its inner corners rounded. No row lines: rows divide by space (rule 2).
// No sparkline (Giorgio, 2026-10-12: "I don't want that like line thing there visible").
//
// Tapping a stock opens its player card: pass `onPress` per half. A half without `onPress`
// isn't pressable at all (nothing tappable does nothing).

export interface RosterHalf {
  ticker: string;
  company: string;
  weekGain: number;
  /** Week change in percent (2.5 = +2.50%). */
  weekPct: number;
  onPress?: () => void;
}

export interface RosterRowProps {
  left: RosterHalf | null;
  right: RosterHalf | null;
  /** The screen gutter the lit slab bleeds past (20 on a phone screen). */
  gutter?: number;
}

/** The empty centre column. */
const CENTRE_GAP = 10;

export function RosterRow({ left, right, gutter = space[6] }: RosterRowProps) {
  const lit = litSide(left?.weekGain ?? null, right?.weekGain ?? null);
  return (
    <View style={styles.row}>
      <Half half={left} mirror={false} lit={lit === 'left'} gutter={gutter} />
      <View style={{ width: CENTRE_GAP }} />
      <Half half={right} mirror lit={lit === 'right'} gutter={gutter} />
    </View>
  );
}

function Half({ half, mirror, lit, gutter }: { half: RosterHalf | null; mirror: boolean; lit: boolean; gutter: number }) {
  const { colors } = useTheme();
  const slab = [
    styles.half,
    // Off the OUTER edge: the slab extends past the gutter, its padding keeps the text put.
    mirror ? { marginRight: -gutter, paddingRight: gutter, paddingLeft: space[4] } : { marginLeft: -gutter, paddingLeft: gutter, paddingRight: space[4] },
    mirror ? styles.innerCornersRight : styles.innerCornersLeft,
    lit ? { backgroundColor: colors.lit } : null,
  ];
  if (!half) return <View style={slab} />;

  const tone = toneOf(half.weekGain);
  const toneColor = colors[tone];
  const name = (
    <View style={[styles.name, mirror ? styles.alignEnd : null]}>
      <Text variant="ticker" numberOfLines={1}>{half.ticker}</Text>
      <Text variant="caption" tone="secondary" numberOfLines={1}>{half.company}</Text>
    </View>
  );
  const num = (
    <View style={mirror ? null : styles.alignEnd}>
      <Text variant="score.md" color={toneColor}>{formatMoney(half.weekGain, { sign: 'always' })}</Text>
      <Text variant="caption" color={toneColor} style={styles.pct}>{formatPercent(half.weekPct, { sign: 'always' })}</Text>
    </View>
  );
  const a11y = `${half.ticker}, ${half.company}, ${formatMoney(half.weekGain, { sign: 'always' })} this week, ${formatPercent(half.weekPct, { sign: 'always' })}${lit ? ', wins the row' : ''}`;
  const content = mirror ? [num, name] : [name, num];

  if (!half.onPress) {
    return (
      <View testID={lit ? 'roster-lit' : undefined} style={[slab, styles.content]} accessible accessibilityLabel={a11y}>
        {content[0]}
        {content[1]}
      </View>
    );
  }
  return (
    <PressableScale testID={lit ? 'roster-lit' : undefined} style={[slab, styles.content]} onPress={half.onPress} accessibilityRole="button" accessibilityLabel={a11y}>
      {content[0]}
      {content[1]}
    </PressableScale>
  );
}

export interface GroupHeadProps {
  /** The slot group, e.g. "Tech ×3" or "$100–$200" (the league's own slot labels). */
  label: string;
}

/** Slotted leagues: the slot group as a `tag` in an `inset` pill with a `rim`, centred across
 * both columns — the group IS the position label (Giorgio's row-order ruling). */
export function GroupHead({ label }: GroupHeadProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.groupWrap} accessibilityRole="header">
      <View style={[styles.groupPill, { backgroundColor: colors.inset, borderColor: colors.rim }]}>
        <Text variant="tag">{label}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  half: {
    flex: 1,
    minWidth: 0,
    minHeight: 64,
    paddingVertical: space[4],
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
  },
  innerCornersLeft: {
    borderTopRightRadius: radius.row,
    borderBottomRightRadius: radius.row,
  },
  innerCornersRight: {
    borderTopLeftRadius: radius.row,
    borderBottomLeftRadius: radius.row,
  },
  name: {
    flex: 1,
    minWidth: 0,
    gap: space[1],
  },
  alignEnd: {
    alignItems: 'flex-end',
  },
  pct: {
    fontWeight: '700',
  },
  groupWrap: {
    alignItems: 'center',
    paddingTop: space[4],
    paddingBottom: space[1],
  },
  groupPill: {
    borderRadius: radius.pill,
    borderWidth: RIM_WIDTH,
    paddingHorizontal: space[4],
    paddingVertical: 5,
  },
});
