/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { radius, space } from '@/constants/tokens';
import { Avatar } from '@/components/sp/Avatar';
import { PressableScale } from '@/components/sp/PressableScale';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { formatMoney } from '@/components/sp/logic/money';
import { excerptStacks, movement, toneOf, YOU_RING } from '@/components/sp/logic/gameNight';
import { yourNameStyle, youA11y } from '@/lib/game/managerRow';
import { MEDAL, MedalDisc, useMedalDiscSize } from '@/components/game/MedalDisc';

// Stockpile — <ManagerRow>, Game Night (§9C; Giorgio, 2026-10-12, on Standings: "the game
// night one is the best just because of that, like, style and formatting"; and on 1.2.0's
// table: "not even good like divide like dividing the columns and rows"). League ›
// Standings in full: each row is its own `surface` tile (radius 12, 6pt apart — the list
// gives the gap via MANAGER_ROW_GAP), divided by SPACE, never by rules. Your row: the
// `youTint` over the tile with a 1.5pt `you` ring; your name bold, no "(you)" (S-10).
// Movement as a drawn chevron + number, in gain/loss. Season gain at 15/20, by sign.

export const MANAGER_ROW_GAP = 6;


interface ManagerRowBase {
  rank: number;
  /** Places moved since last week (+ up, − down, 0/null unchanged). */
  delta?: number | null;
  name: string;
  avatarUri?: string | null;
  isYou?: boolean;
  onPress?: () => void;
  /** Home's Standings excerpt (the board's StandingsExcerpt): no movement column ("movement
   * arrows on League only", S-10), a 24pt avatar and a shorter tile. Same row otherwise. */
  excerpt?: boolean;
  /** League (W4): the movement column. Off for final standings (GS-4: no week-over-week
   * arrow against the playoff order). A null `delta` leaves the cell empty (last week's
   * order is unknown); 0 is the en dash (a real comparison that held). */
  showMove?: boolean;
  /** League (W4): a finished season's medal disc in the rank cell, places 1–3 (§9A, GS-4). */
  medal?: boolean;
  /** League (W4): the line under the name ("Champion" / "Runner-up", GS-4), or "Bot". */
  tag?: string | null;
  /** League (W4): the LIST decides (leagueView managerListStacks), so every row has one
   * shape. The excerpt decides for itself (excerptStacks). */
  stacked?: boolean;
  /** League (W4), stacked rows: the name, record and tag's Dynamic Type cap, so none outgrows
   * the season gain (leagueView stackedRowTextCap). */
  textCap?: number;
  /** League (W4): the record column's width, the list's widest, so the "W–L" head lines up. */
  recordWidth?: number;
  /** League (W4): the gain column's width, the head's if wider than 86 (leagueView gainColumnWidth). */
  gainWidth?: number;
  /** Rank 1 reads in `text` (it leads); false when nothing is scored yet, so every rank is text2. */
  rankLeads?: boolean;
}

/** A Standings row (the default) carries the record and the season gain; the draft lobby's
 * ORDER row (`kind: 'order'`, W4 Draft gate: the same row, not a hand copy) is the seat, the
 * avatar and the name, and nothing to rank by yet: no movement, record or gain. */
export type ManagerRowProps = ManagerRowBase & (
  | { kind?: 'standings'; /** "4–2". */ record: string; seasonGain: number }
  | { kind: 'order'; record?: never; seasonGain?: never }
);

export function ManagerRow(props: ManagerRowProps) {
  const { rank, delta, name, avatarUri, isYou = false, onPress, excerpt = false, showMove = !excerpt, medal = false, tag = null, stacked: stackedProp, textCap, recordWidth, gainWidth, rankLeads = true } = props;
  const { colors } = useTheme();
  const { fontScale } = useWindowDimensions();
  // Before any early return: a hook (the medal disc's size; League's final standings).
  const disc = useMedalDiscSize();
  if (props.kind === 'order') {
    // The seat in text2 (seat 1 leads nothing), the 32pt avatar, the name; your row as ever.
    const tile = [styles.tile, { backgroundColor: colors.surface }];
    return (
      <View style={tile} accessible accessibilityLabel={`${rank}, ${name}${youA11y(isYou)}`}>
        {isYou ? <View testID="manager-row-you" pointerEvents="none" style={[styles.youOverlay, { backgroundColor: colors.youTint, borderColor: colors.you }]} /> : null}
        <Text variant="score.md" color={colors.text2} style={styles.rank}>{rank}</Text>
        <Avatar name={name} uri={avatarUri} size={32} tone={isYou ? 'you' : 'neutral'} />
        <Text variant="body" numberOfLines={2} style={[styles.name, yourNameStyle(isYou)]}>{name}</Text>
      </View>
    );
  }
  const { record, seasonGain } = props;
  const stacked = excerpt && excerptStacks(fontScale);
  const leagueStacked = !excerpt && !!stackedProp;
  const known = delta !== null && delta !== undefined;
  const move = movement(delta);
  const medalInfo = medal ? MEDAL[rank] : undefined;
  const gainText = formatMoney(seasonGain, { sign: 'always' });
  const a11y = `${medalInfo ? `${medalInfo.label}, ` : ''}${rank}, ${name}${youA11y(isYou)}${tag ? `, ${tag}` : ''}, ${showMove && known ? `${move.a11y}, ` : ''}${record}, ${gainText} season gain`;

  const body = (
    <>
      {medalInfo ? (
        <View style={[styles.medalCell, { width: Math.max(22, disc) }]}>
          <MedalDisc place={rank} size={disc} />
        </View>
      ) : (
        // In a list with medals the numeral's cell is the disc's width too, so the columns line up.
        <Text variant="score.md" color={rank === 1 && rankLeads ? colors.text : colors.text2} style={[styles.rank, medal ? { width: Math.max(22, disc), textAlign: 'center' } : null]}>{rank}</Text>
      )}
      {showMove ? (known ? <Move dir={move.dir} text={move.text} cap={textCap} /> : <View style={styles.move} />) : null}
      <Avatar name={name} uri={avatarUri} size={excerpt ? 24 : 32} tone={isYou ? 'you' : 'neutral'} />
      {leagueStacked ? (
        // League at large text (the open P2): the name takes its own line(s), the record and
        // gain sit under it; no line of the row is larger than its gain (textCap).
        <View style={styles.stack}>
          <Text variant="body" numberOfLines={2} maxFontSizeMultiplier={textCap} style={yourNameStyle(isYou)}>{name}</Text>
          {tag ? <Text variant="caption" tone="secondary" maxFontSizeMultiplier={textCap}>{tag}</Text> : null}
          <View style={styles.stackNumbers}>
            <Text variant="callout" tone="secondary" maxFontSizeMultiplier={textCap} style={styles.record}>{record}</Text>
            <Text variant="score.sm" color={colors[toneOf(seasonGain)]} style={styles.gainStacked}>{gainText}</Text>
          </View>
        </View>
      ) : !excerpt ? (
        <>
          {/* One line of numbers; the name may take a second line rather than an ellipsis. */}
          <View style={styles.name}>
            <Text variant="body" numberOfLines={2} style={yourNameStyle(isYou)}>{name}</Text>
            {tag ? <Text variant="caption" tone="secondary">{tag}</Text> : null}
          </View>
          <Text variant="callout" tone="secondary" style={[styles.record, recordWidth ? { minWidth: recordWidth } : null]}>{record}</Text>
          <Text variant="score.sm" color={colors[toneOf(seasonGain)]} style={[styles.gain, gainWidth ? { minWidth: gainWidth } : null]}>{gainText}</Text>
        </>
      ) : stacked ? (
        // Home's excerpt at large text (W4 gate): the name takes its own line(s) and the
        // record and gain sit under it, so the name never shrinks to a letter.
        <View style={styles.stack}>
          <Text variant="body" numberOfLines={2} style={yourNameStyle(isYou)}>{name}</Text>
          <View style={styles.stackNumbers}>
            <Text variant="callout" tone="secondary" style={styles.record}>{record}</Text>
            <Text variant="score.sm" color={colors[toneOf(seasonGain)]} style={styles.gain}>{gainText}</Text>
          </View>
        </View>
      ) : (
        <>
          <Text variant="body" numberOfLines={1} style={[styles.name, yourNameStyle(isYou)]}>{name}</Text>
          <Text variant="callout" tone="secondary" style={styles.record}>{record}</Text>
          <Text variant="score.sm" color={colors[toneOf(seasonGain)]} style={styles.gain}>{gainText}</Text>
        </>
      )}
    </>
  );

  // Your row: the tint composited over the tile's surface (the PAIRS rows are scored that way).
  const tile = [styles.tile, excerpt ? styles.tileExcerpt : null, { backgroundColor: colors.surface }];
  const you = isYou ? [styles.youOverlay, { backgroundColor: colors.youTint, borderColor: colors.you }] : null;
  const inner = (
    <>
      {you ? <View testID="manager-row-you" pointerEvents="none" style={you} /> : null}
      {body}
    </>
  );

  if (onPress) {
    return (
      <PressableScale style={tile} onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y}>
        {inner}
      </PressableScale>
    );
  }
  return (
    <View style={tile} accessible accessibilityLabel={a11y}>
      {inner}
    </View>
  );
}

/** The drawn movement chevron + its number; an en dash when unchanged. */
function Move({ dir, text, cap }: { dir: 'up' | 'down' | 'none'; text: string; cap?: number }) {
  const { colors } = useTheme();
  if (dir === 'none') return <Text variant="caption" tone="secondary" maxFontSizeMultiplier={cap} style={styles.move}>{text}</Text>;
  const ink = dir === 'up' ? colors.gain : colors.loss;
  return (
    <View style={[styles.move, styles.moveRow]}>
      <Svg width={10} height={10} viewBox="0 0 10 10">
        <Path d={dir === 'up' ? 'M2 7 L5 3.5 L8 7' : 'M2 3 L5 6.5 L8 3'} stroke={ink} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
      <Text variant="caption" color={ink} maxFontSizeMultiplier={cap} style={styles.moveText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: 56,
    paddingVertical: space[4],
    // The 4pt scale (W4 Home): 12, not the board's 10.
    paddingHorizontal: space[4],
    borderRadius: radius.row,
    overflow: 'hidden',
  },
  // Inside Home's card: 44pt tall (the §9B target), 8pt above and below the name.
  tileExcerpt: {
    minHeight: 44,
    paddingVertical: space[3],
  },
  youOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radius.row,
    borderWidth: YOU_RING,
  },
  stack: {
    flex: 1,
    minWidth: 0,
    gap: space[1],
  },
  stackNumbers: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: space[3],
  },
  rank: {
    width: 22,
  },
  // The medal disc grows with its numeral (MedalDisc): the cell grows with it.
  medalCell: {
    alignItems: 'center',
  },
  move: {
    width: 22,
  },
  moveRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  moveText: {
    fontWeight: '800',
  },
  name: {
    flex: 1,
    minWidth: 0,
  },
  record: {
    textAlign: 'right',
  },
  gain: {
    textAlign: 'right',
    minWidth: 86,
  },
  // No shrink-to-fit on the gains: iOS mis-measured a flex-shrinking adjustsFontSizeToFit
  // text and drew "−$34.10" at a few points (W4 capture, XL). The list stacks before a gain
  // can run out of room (leagueView managerListStacks), so the gain always fits whole.
  gainStacked: {
    flexShrink: 0,
    textAlign: 'right',
  },
});
