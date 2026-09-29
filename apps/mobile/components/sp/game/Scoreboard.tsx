/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { StyleSheet, useWindowDimensions, View } from 'react-native';

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
//
// Amended 2026-09-29 (Design Lead, DESIGN-CHANGES on the accessibility-XL
// capture): at large Dynamic Type sizes the name-left/score-right row ran
// out of room and the name column collapsed to a sliver while the score
// overflowed the card. Two changes work together: `ScoreDigits`/its digit
// Text nodes now cap their own growth and shrink-to-fit as a safety net
// (see ScoreDigits.tsx), and this component reflows the row itself past a
// threshold — name gets its own full-width line, score moves below it,
// right-aligned. Below the threshold, the name gets a minWidth floor so it
// can never be squeezed to nothing, and flexShrink moves to the score's
// wrapping View (not the name) so it's the score, not the name, that gives
// ground first.
const STACKED_FONT_SCALE = 1.35;

interface TeamRowProps {
  name: string;
  gain: number;
  teamColor: string;
  stacked: boolean;
}

function TeamRow({ name, gain, teamColor, stacked }: TeamRowProps) {
  const scoreText = formatMoney(gain, { sign: 'always' });

  if (stacked) {
    return (
      <View style={styles.teamRowStacked}>
        <Text variant="headline" numberOfLines={2} style={styles.teamNameStacked}>
          {name}
        </Text>
        <View style={styles.scoreRowStacked}>
          <ScoreDigits text={scoreText} variant="score.lg" color={teamColor} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.teamRow}>
      <Text variant="headline" numberOfLines={1} style={styles.teamName}>
        {name}
      </Text>
      <View style={styles.scoreShrinkWrap}>
        <ScoreDigits text={scoreText} variant="score.lg" color={teamColor} />
      </View>
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
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= STACKED_FONT_SCALE;
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
        <TeamRow name={you.name} gain={you.gain} teamColor={color.team.you.onGame} stacked={stacked} />
        <TeamRow name={opponent.name} gain={opponent.gain} teamColor={color.team.opponent} stacked={stacked} />
      </View>

      <View style={styles.tugWrap}>
        <TugBar you={you.gain} opponent={opponent.gain} opponentName={opponent.name} />
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
  // The name never collapses — it's the score's flexShrink wrap (below)
  // that gives ground when space is tight, not the name.
  teamName: {
    minWidth: 64,
  },
  scoreShrinkWrap: {
    flexShrink: 1,
  },
  teamRowStacked: {
    gap: space[1],
  },
  teamNameStacked: {
    width: '100%',
  },
  scoreRowStacked: {
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
