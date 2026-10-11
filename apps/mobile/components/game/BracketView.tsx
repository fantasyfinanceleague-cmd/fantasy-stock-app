/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { View, StyleSheet } from 'react-native';
import { Card } from '@/components/sp/Card';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { formatMoney } from '@/components/sp/logic/money';
import { radius, space } from '@/constants/tokens';
import type { Bracket, BracketGame, BracketSide } from '@/lib/game/bracket';
import { yourNameStyle, yourRowTint, youA11y } from '@/lib/game/managerRow';

export interface BracketViewProps {
  bracket: Bracket;
  /** The explanatory line under the bracket (new copy, flagged). */
  caption: string | null;
  myUserId: string;
}

/** The playoff bracket: each round's tag, its games with seeds and your score,
 * the winner emphasised, and the first-round byes as neutral rows. */
export function BracketView({ bracket, caption, myUserId }: BracketViewProps) {
  return (
    <View style={styles.stack}>
      {bracket.byes.length > 0 ? (
        <Card style={styles.card}>
          <Text variant="tag" tone="secondary">{`${bracket.rounds[0]?.label ?? ''} · playoff week 1`}</Text>
          {bracket.byes.map((b) => (
            <ByeRow key={b.userId ?? b.name} side={b} mine={b.userId === myUserId} />
          ))}
        </Card>
      ) : null}
      {bracket.rounds.map((round) =>
        round.games.length === 0 ? null : (
          <View key={round.round} style={styles.stack}>
            <Text variant="tag" tone="secondary">{`${round.label} · playoff week ${round.round}`}</Text>
            {round.games.map((g) => (
              <GameCard key={g.position} game={g} myUserId={myUserId} />
            ))}
          </View>
        ),
      )}
      {caption ? <Text variant="caption" tone="secondary">{caption}</Text> : null}
    </View>
  );
}

function ByeRow({ side, mine }: { side: BracketSide; mine: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.row, yourRowTint(mine, colors.youTint)]} accessible accessibilityLabel={`Seed ${side.seed ?? ''}, ${side.name}${youA11y(mine)}, bye`}>
      <Text variant="caption" tone="secondary" style={styles.seed}>{side.seed ?? ''}</Text>
      <Text variant="callout" style={styles.name}>{side.name}</Text>
      <Text variant="callout" tone="secondary" style={styles.end}>Bye</Text>
    </View>
  );
}

function GameCard({ game, myUserId }: { game: BracketGame; myUserId: string }) {
  const { colors } = useTheme();
  return (
    <Card style={styles.card}>
      <SideRow side={game.a} winner={game.winnerUserId} scored={game.scored} mine={game.a?.userId === myUserId} colors={colors} />
      <SideRow side={game.b} winner={game.winnerUserId} scored={game.scored} mine={game.b?.userId === myUserId} colors={colors} />
    </Card>
  );
}

function SideRow({ side, winner, scored, mine, colors }: { side: BracketSide | null; winner: string | null; scored: boolean; mine: boolean; colors: { youTint: string; text: string; text2: string } }) {
  if (side === null) return <View style={styles.row}><Text variant="callout" tone="secondary">To be decided</Text></View>;
  const isWinner = winner !== null && winner === side.userId;
  const loser = scored && winner !== null && !isWinner;
  return (
    // Bold here means the winner, so the tint alone marks your line (board #call-manager-row).
    <View style={[styles.row, yourRowTint(mine, colors.youTint), loser ? { opacity: 0.55 } : null]} accessible accessibilityLabel={`Seed ${side.seed ?? ''}, ${side.name}${youA11y(mine)}${side.gain !== null ? `, ${formatMoney(side.gain, { sign: 'always' })}` : ''}`}>
      <Text variant="caption" tone="secondary" style={styles.seed}>{side.seed ?? ''}</Text>
      <Text variant="callout" style={[styles.name, isWinner ? styles.bold : null]}>{side.name}</Text>
      {side.gain !== null ? <Text variant="callout" style={styles.end}>{formatMoney(side.gain, { sign: 'always' })}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // The sp Card has no padding or radius of its own (callers set both); bare, the
  // text sat flush on the card edge (final sweep S-1, seen in the capture pass).
  card: { borderRadius: radius.lg, padding: space[5], gap: space[2] },
  stack: { gap: space[3] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingVertical: space[2] },
  seed: { minWidth: 16, textAlign: 'right' },
  // The name gives way (wraps) before the score does: at large text the score ran off the card.
  name: { flexShrink: 1, minWidth: 0 },
  end: { marginLeft: 'auto', flexShrink: 0 },
  bold: { fontWeight: '800' },
});
