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
//
// Teams stack in their own full-width rows (name left, score right) rather
// than sitting side by side — amended 2026-09-26: ui/foundation-web found two
// score.xl values didn't fit side by side under ~420pt, and needed to stack
// for the same reason. `TeamRow` is declared BEFORE `Scoreboard` (an ordinary
// forward reference), not covered by the file's own styles-at-bottom
// eslint-disable above, which is scoped to `styles` only.

interface TeamRowProps {
  name: string;
  gain: number;
  teamColor: string;
}

function TeamRow({ name, gain, teamColor }: TeamRowProps) {
  return (
    <View style={styles.teamRow}>
      <Text variant="headline" numberOfLines={1} style={styles.teamName}>
        {name}
      </Text>
      <ScoreDigits text={formatMoney(gain, { sign: 'always' })} variant="score.lg" color={teamColor} />
    </View>
  );
}

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

  // Verb agreement (§9, amended 2026-09-26): "you" is grammatically second
  // person ("You lead by..."), the opponent's real name is third person
  // ("Priya leads by..."). This is independent of whichever display name the
  // caller passes for `you.name` (shown in the team row above) — the lead
  // line always addresses the caller directly as "You".
  let leadLineText: string;
  if (leader === 'tie') {
    leadLineText = 'Dead even';
  } else if (leader === 'you') {
    leadLineText = `You lead by ${formatMoney(gap)}`;
  } else {
    leadLineText = `${opponent.name} leads by ${formatMoney(gap)}`;
  }

  return (
    <Surface kind="game" style={styles.surface}>
      <View style={styles.header}>
        <Text variant="tag" tone="secondary">
          {`WEEK ${week} · ${leagueName}`.toUpperCase()}
        </Text>
        {live ? <LiveDot size={8} /> : null}
      </View>

      <View style={styles.teams}>
        <TeamRow name={you.name} gain={you.gain} teamColor={color.team.you.onGame} />
        <TeamRow name={opponent.name} gain={opponent.gain} teamColor={color.team.opponent} />
      </View>

      <View style={styles.tugWrap}>
        <TugBar you={you.gain} opponent={opponent.gain} />
      </View>

      <View style={styles.leadLine}>
        <Text variant="callout" tone="secondary">
          {leadLineText}
        </Text>
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
    gap: space[3],
  },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[4],
  },
  teamName: {
    flexShrink: 1,
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
