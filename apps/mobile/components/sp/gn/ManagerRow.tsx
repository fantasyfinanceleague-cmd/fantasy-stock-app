/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { radius, space } from '@/constants/tokens';
import { Avatar } from '@/components/sp/Avatar';
import { PressableScale } from '@/components/sp/PressableScale';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { formatMoney } from '@/components/sp/logic/money';
import { movement, toneOf, YOU_RING } from '@/components/sp/logic/gameNight';
import { yourNameStyle, youA11y } from '@/lib/game/managerRow';

// Stockpile — <ManagerRow>, Game Night (§9C; Giorgio, 2026-10-12, on Standings: "the game
// night one is the best just because of that, like, style and formatting"; and on 1.2.0's
// table: "not even good like divide like dividing the columns and rows"). League ›
// Standings in full: each row is its own `surface` tile (radius 12, 6pt apart — the list
// gives the gap via MANAGER_ROW_GAP), divided by SPACE, never by rules. Your row: the
// `youTint` over the tile with a 1.5pt `you` ring; your name bold, no "(you)" (S-10).
// Movement as a drawn chevron + number, in gain/loss. Season gain at 15/20, by sign.

export const MANAGER_ROW_GAP = 6;

export interface ManagerRowProps {
  rank: number;
  /** Places moved since last week (+ up, − down, 0/null unchanged). */
  delta?: number | null;
  name: string;
  avatarUri?: string | null;
  isYou?: boolean;
  /** "4–2". */
  record: string;
  seasonGain: number;
  onPress?: () => void;
  /** Home's Standings excerpt (the board's StandingsExcerpt): no movement column ("movement
   * arrows on League only", S-10), a 24pt avatar and a shorter tile. Same row otherwise. */
  excerpt?: boolean;
}

export function ManagerRow({ rank, delta, name, avatarUri, isYou = false, record, seasonGain, onPress, excerpt = false }: ManagerRowProps) {
  const { colors } = useTheme();
  const move = movement(delta);
  const gainText = formatMoney(seasonGain, { sign: 'always' });
  const a11y = `${rank}, ${name}${youA11y(isYou)}, ${excerpt ? '' : `${move.a11y}, `}${record}, ${gainText} season gain`;

  const body = (
    <>
      <Text variant="score.md" color={rank === 1 ? colors.text : colors.text2} style={styles.rank}>{rank}</Text>
      {excerpt ? null : <Move dir={move.dir} text={move.text} />}
      <Avatar name={name} uri={avatarUri} size={excerpt ? 24 : 32} tone={isYou ? 'you' : 'neutral'} />
      <Text variant="body" numberOfLines={1} style={[styles.name, yourNameStyle(isYou)]}>{name}</Text>
      <Text variant="callout" tone="secondary" style={styles.record}>{record}</Text>
      <Text variant="score.sm" color={colors[toneOf(seasonGain)]} style={styles.gain}>{gainText}</Text>
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
function Move({ dir, text }: { dir: 'up' | 'down' | 'none'; text: string }) {
  const { colors } = useTheme();
  if (dir === 'none') return <Text variant="caption" tone="secondary" style={styles.move}>{text}</Text>;
  const ink = dir === 'up' ? colors.gain : colors.loss;
  return (
    <View style={[styles.move, styles.moveRow]}>
      <Svg width={10} height={10} viewBox="0 0 10 10">
        <Path d={dir === 'up' ? 'M2 7 L5 3.5 L8 7' : 'M2 3 L5 6.5 L8 3'} stroke={ink} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
      <Text variant="caption" color={ink} style={styles.moveText}>{text}</Text>
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
  rank: {
    width: 22,
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
});
