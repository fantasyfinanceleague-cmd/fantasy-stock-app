/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { View, StyleSheet } from 'react-native';
import { Card } from '@/components/sp/Card';
import { Text } from '@/components/sp/Text';
import { Icon } from '@/components/sp/Icon';
import { useTheme } from '@/components/sp/ThemeProvider';
import { formatMoney } from '@/components/sp/logic/money';
import { toneOf, YOU_RING } from '@/components/sp/logic/gameNight';
import { radius, space } from '@/constants/tokens';
import type { Bracket, BracketGame, BracketSide } from '@/lib/game/bracket';
import { advancesLine, bracketChampion, bracketRounds, championLine } from '@/lib/game/leagueView';
import { COPY as GAME_COPY } from '@/lib/game/gameCopy';
import { yourRowTint, youA11y } from '@/lib/game/managerRow';

/** Every line of a game stops at the score's own cap (score.sm, 1.3×), so the score stays the
 * row's loudest text at every size (the checklist's "The standout stays loudest"). */
const ROW_TEXT_CAP = 1.3;

export interface BracketViewProps {
  bracket: Bracket;
  /** The explanatory line under the bracket (new copy, flagged). */
  caption: string | null;
  myUserId: string;
}

/** The playoff bracket on Game Night: one heading per round (a `tag`), each game a rimmed
 * card of its two sides (seed, name, score by sign). GS-6: the first round's byes are rows
 * OF that round ("1 Paolo M. · Bye", "Advances to the Semifinals", the board's Playoffs6),
 * never a card under a second heading. GS-7: once the Final is scored, one row under it,
 * the trophy and "{name} · Champion". Your side is shaded (B: you vs someone), win or
 * lose; bold marks the winner, so the shade alone marks you (board #call-manager-row). */
export function BracketView({ bracket, caption, myUserId }: BracketViewProps) {
  const { colors } = useTheme();
  const rounds = bracketRounds(bracket);
  const champion = bracketChampion(bracket);
  return (
    <View style={styles.stack}>
      {rounds.map((round) => (
        <View key={round.round} style={styles.stack}>
          <Text variant="tag" tone="secondary">{`${round.label} · playoff week ${round.round}`}</Text>
          {round.items.map((item) =>
            item.kind === 'bye' ? (
              <ByeCard key={`bye-${item.side.userId ?? item.side.name}`} side={item.side} mine={item.side.userId === myUserId} advances={advancesLine(item.advancesTo)} />
            ) : (
              <GameCard key={item.game.position} game={item.game} myUserId={myUserId} />
            ),
          )}
        </View>
      ))}
      {champion ? (
        // ManagerRow's tile: `surface`; when it's you, the `youTint` over it and the 1.5pt `you`
        // ring, as your Standings row (DL ruling at the W4 gate: "the ring, yes").
        <View style={[styles.champion, { backgroundColor: colors.surface }]} accessible accessibilityLabel={`${championLine(champion.name, GAME_COPY.champion)}${youA11y(champion.userId === myUserId)}`}>
          {champion.userId === myUserId ? <View testID="champion-you" pointerEvents="none" style={[styles.championYou, { backgroundColor: colors.youTint, borderColor: colors.you }]} /> : null}
          <Icon name="trophy" size="headline" tone="live" />
          <Text variant="callout" maxFontSizeMultiplier={ROW_TEXT_CAP} style={styles.bold}>{championLine(champion.name, GAME_COPY.champion)}</Text>
        </View>
      ) : null}
      {caption ? <Text variant="caption" maxFontSizeMultiplier={ROW_TEXT_CAP} tone="secondary">{caption}</Text> : null}
    </View>
  );
}

function ByeCard({ side, mine, advances }: { side: BracketSide; mine: boolean; advances: string | null }) {
  const { colors } = useTheme();
  return (
    <Card style={styles.card}>
      <View style={[styles.row, yourRowTint(mine, colors.youTint)]} accessible accessibilityLabel={`Seed ${side.seed ?? ''}, ${side.name}${youA11y(mine)}, bye${advances ? `. ${advances}` : ''}`}>
        <Text variant="callout" maxFontSizeMultiplier={ROW_TEXT_CAP} tone="secondary" style={styles.seed}>{side.seed ?? ''}</Text>
        <Text variant="callout" maxFontSizeMultiplier={ROW_TEXT_CAP} style={styles.name}>{side.name}</Text>
        <Text variant="callout" maxFontSizeMultiplier={ROW_TEXT_CAP} tone="secondary" style={styles.end}>Bye</Text>
      </View>
      {advances ? <Text variant="caption" maxFontSizeMultiplier={ROW_TEXT_CAP} tone="secondary" style={styles.advances}>{advances}</Text> : null}
    </Card>
  );
}

function GameCard({ game, myUserId }: { game: BracketGame; myUserId: string }) {
  return (
    <Card style={styles.card}>
      <SideRow side={game.a} winner={game.winnerUserId} scored={game.scored} mine={game.a?.userId === myUserId} />
      <SideRow side={game.b} winner={game.winnerUserId} scored={game.scored} mine={game.b?.userId === myUserId} />
    </Card>
  );
}

function SideRow({ side, winner, scored, mine }: { side: BracketSide | null; winner: string | null; scored: boolean; mine: boolean }) {
  const { colors } = useTheme();
  if (side === null) return <View style={styles.row}><Text variant="callout" maxFontSizeMultiplier={ROW_TEXT_CAP} tone="secondary">To be decided</Text></View>;
  const isWinner = winner !== null && winner === side.userId;
  const loser = scored && winner !== null && !isWinner;
  return (
    // Bold here means the winner, so the tint alone marks your line (board #call-manager-row).
    // The loser reads in text2 (it was 55% opacity, under contrast); bold still names the winner.
    <View style={[styles.row, yourRowTint(mine, colors.youTint)]} accessible accessibilityLabel={`Seed ${side.seed ?? ''}, ${side.name}${youA11y(mine)}${side.gain !== null ? `, ${formatMoney(side.gain, { sign: 'always' })}` : ''}${isWinner ? ', won' : ''}`}>
      <Text variant="callout" maxFontSizeMultiplier={ROW_TEXT_CAP} tone="secondary" style={styles.seed}>{side.seed ?? ''}</Text>
      <Text variant="callout" maxFontSizeMultiplier={ROW_TEXT_CAP} tone={loser ? 'secondary' : undefined} style={[styles.name, isWinner ? styles.bold : null]}>{side.name}</Text>
      {side.gain !== null ? <Text variant="score.sm" color={colors[toneOf(side.gain)]} style={styles.end}>{formatMoney(side.gain, { sign: 'always' })}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // §9C Card: surface + the rim; the sp Card has no padding or radius of its own.
  // Toward the board's ≈64pt game card (W4 DL gate: a 6-team bracket took three screens):
  // 8pt top and bottom, 16 at the sides, rows 4pt apart; the card holds no tap, so no 44pt rows.
  card: { borderRadius: radius.lg, paddingVertical: space[3], paddingHorizontal: space[5], gap: space[2] },
  stack: { gap: space[3] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[1] },
  seed: { minWidth: 16, textAlign: 'right' },
  // The name gives way (wraps) before the score does: at large text the score ran off the card.
  name: { flexShrink: 1, minWidth: 0 },
  end: { marginLeft: 'auto', flexShrink: 0 },
  bold: { fontWeight: '800' },
  // Under the name, on its column (W4 DL gate: 24).
  advances: { marginLeft: 24 },
  // GS-7: the champion's row, a tile like the standings' (radius 12, 12pt padding).
  champion: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 56, padding: space[4], borderRadius: radius.row, overflow: 'hidden' },
  championYou: { ...StyleSheet.absoluteFillObject, borderRadius: radius.row, borderWidth: YOU_RING },
});
