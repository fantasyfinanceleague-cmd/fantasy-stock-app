/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { View, StyleSheet } from 'react-native';
import { Card } from '@/components/sp/Card';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { formatMoney } from '@/components/sp/logic/money';
import { space } from '@/constants/tokens';
import type { Bracket, BracketGame, BracketSide } from '@/lib/game/bracket';

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
        <Card>
          <Text variant="tag" tone="secondary">{`${bracket.rounds[0]?.label ?? ''} · playoff week 1`}</Text>
          {bracket.byes.map((b) => (
            <ByeRow key={b.userId ?? b.name} side={b} />
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

function ByeRow({ side }: { side: BracketSide }) {
  return (
    <View style={styles.row} accessible accessibilityLabel={`Seed ${side.seed ?? ''}, ${side.name}, bye`}>
      <Text variant="caption" tone="secondary" style={styles.seed}>{side.seed ?? ''}</Text>
      <Text variant="callout">{side.name}</Text>
      <Text variant="callout" tone="secondary" style={styles.end}>Bye</Text>
    </View>
  );
}

function GameCard({ game, myUserId }: { game: BracketGame; myUserId: string }) {
  const { colors } = useTheme();
  return (
    <Card>
      <SideRow side={game.a} winner={game.winnerUserId} scored={game.scored} mine={game.a?.userId === myUserId} colors={colors} />
      <SideRow side={game.b} winner={game.winnerUserId} scored={game.scored} mine={game.b?.userId === myUserId} colors={colors} />
    </Card>
  );
}

function SideRow({ side, winner, scored, mine, colors }: { side: BracketSide | null; winner: string | null; scored: boolean; mine: boolean; colors: { youText: string; text: string; text2: string } }) {
  if (side === null) return <View style={styles.row}><Text variant="callout" tone="secondary">To be decided</Text></View>;
  const isWinner = winner !== null && winner === side.userId;
  const loser = scored && winner !== null && !isWinner;
  return (
    <View style={[styles.row, loser ? { opacity: 0.55 } : null]} accessible accessibilityLabel={`Seed ${side.seed ?? ''}, ${side.name}${side.gain !== null ? `, ${formatMoney(side.gain, { sign: 'always' })}` : ''}`}>
      <Text variant="caption" tone="secondary" style={styles.seed}>{side.seed ?? ''}</Text>
      <Text variant="callout" style={[isWinner ? styles.bold : null, mine ? { color: colors.youText } : null]}>
        {side.name}{mine ? <Text variant="callout" tone="secondary"> (you)</Text> : null}
      </Text>
      {side.gain !== null ? <Text variant="callout" style={styles.end}>{formatMoney(side.gain, { sign: 'always' })}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space[3] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingVertical: space[2] },
  seed: { minWidth: 16, textAlign: 'right' },
  end: { marginLeft: 'auto' },
  bold: { fontWeight: '800' },
});
