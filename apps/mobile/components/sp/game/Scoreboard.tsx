/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { StyleSheet, View } from 'react-native';

import { color, radius, space } from '@/constants/tokens';
import { Surface } from '@/components/sp/Surface';
import { Text } from '@/components/sp/Text';
import { formatMoney } from '@/components/sp/logic/money';
import { leaderOf } from '@/components/sp/logic/tug';
import { ScoreDigits } from '@/components/sp/game/ScoreDigits';
import { TugBar } from '@/components/sp/game/TugBar';
import { LiveDot } from '@/components/sp/game/LiveDot';
import { Chyron } from '@/components/sp/game/Chyron';

// Stockpile — <Scoreboard> (Phase 2 foundation). SOURCE OF TRUTH: the Phase 2
// brief: "composes them: league/week line, two teams, tug, lead line."
//
// Self-contained (wraps its own <Surface kind="game">), so it can drop into
// a "this week" strip on an otherwise money-surface screen (Home) without
// the host screen needing to know it's entering the game register — the
// same self-containment reasoning as <PhaseChip>.
//
// Team colours mark PEOPLE (§9 non-negotiable): each side's score digits use
// its team colour, never a gain/loss colour. The one line that mixes
// registers on purpose is the "lead line", which states the dollar gap in
// words and colours it by gain/loss/zero, since that IS a money figure.

export interface ScoreboardTeam {
  name: string;
  gain: number;
}

export interface ScoreboardProps {
  leagueName: string;
  week: number;
  you: ScoreboardTeam;
  opponent: ScoreboardTeam;
  live?: boolean;
  chyronMessage?: string | null;
  onChyronDismiss?: () => void;
}

export function Scoreboard({ leagueName, week, you, opponent, live = false, chyronMessage, onChyronDismiss }: ScoreboardProps) {
  const leader = leaderOf(you.gain, opponent.gain);
  const gap = Math.abs(you.gain - opponent.gain);

  return (
    <Surface kind="game" style={styles.surface}>
      <View style={styles.header}>
        <Text variant="tag" tone="secondary">
          {`WEEK ${week} · ${leagueName}`.toUpperCase()}
        </Text>
        {live ? <LiveDot size={8} /> : null}
      </View>

      <View style={styles.teams}>
        <View style={styles.team}>
          <Text variant="headline" numberOfLines={1}>
            {you.name}
          </Text>
          <ScoreDigits text={formatMoney(you.gain, { sign: 'always' })} variant="score.lg" color={color.team.you.onGame} />
        </View>
        <Text variant="title" tone="secondary">
          vs
        </Text>
        <View style={[styles.team, styles.teamRight]}>
          <Text variant="headline" numberOfLines={1}>
            {opponent.name}
          </Text>
          <ScoreDigits text={formatMoney(opponent.gain, { sign: 'always' })} variant="score.lg" color={color.team.opponent} />
        </View>
      </View>

      <View style={styles.tugWrap}>
        <TugBar you={you.gain} opponent={opponent.gain} />
      </View>

      <View style={styles.leadLine}>
        {leader === 'tie' ? (
          <Text variant="callout" tone="secondary">
            Dead even
          </Text>
        ) : (
          <Text variant="callout" tone="secondary">
            {`${leader === 'you' ? you.name : opponent.name} leads by ${formatMoney(gap)}`}
          </Text>
        )}
      </View>

      {chyronMessage ? (
        <View style={styles.chyronWrap}>
          <Chyron message={chyronMessage} onDismiss={onChyronDismiss} />
        </View>
      ) : null}
    </Surface>
  );
}

const styles = StyleSheet.create({
  surface: {
    borderRadius: radius.lg,
    padding: space[5],
    gap: space[5],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  teams: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  team: {
    flex: 1,
    gap: space[2],
  },
  teamRight: {
    alignItems: 'flex-end',
  },
  tugWrap: {
    width: '100%',
  },
  leadLine: {
    alignItems: 'center',
  },
  chyronWrap: {
    alignItems: 'flex-start',
  },
});
