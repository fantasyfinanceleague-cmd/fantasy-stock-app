/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { StyleSheet, View } from 'react-native';

import { radius, space } from '@/constants/tokens';
import { Avatar } from '@/components/sp/Avatar';
import { Card } from '@/components/sp/Card';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { formatMoney } from '@/components/sp/logic/money';
import { scoreboardModel, type ScoreSide } from '@/components/sp/logic/gameNight';
import { YOUR_NAME_WEIGHT } from '@/lib/game/managerRow';

// Stockpile — <Scoreboard>, Game Night (§9C "Scoreboard"; Giorgio, 2026-10-12: "I like the
// way that where you are is kind of shaded. And then I like the way that it says like the
// leads by"). The Matchup header, and nothing else (his Matchup ruling): two halves in one
// card, avatars (44) at the outer edges — yours ringed in `you` across a 2pt `bg` gap —
// names, the totals in `score.xl`. YOUR half is always shaded in your colour (`youTint`),
// win or lose (Giorgio's ruling, 2026-10-12, replacing §9C's leader wash); who leads is said
// by the totals and the one line under the card: "{name} leads by {margin}" (or "won by").
//
// The opponent is marked by POSITION (the right half), not colour: its avatar is the slate
// `opp`, its total plain `text` like yours. Beside the old components/sp/game/Scoreboard
// (Home's This week still uses that one); W4 moves Matchup onto this.

export interface GnScoreboardProps {
  you: ScoreSide & { avatarUri?: string | null };
  opponent: ScoreSide & { avatarUri?: string | null };
  final?: boolean;
}

const AVATAR = 44;

export function Scoreboard({ you, opponent, final = false }: GnScoreboardProps) {
  const model = scoreboardModel(you, opponent, final);
  const label = `${you.name}, you, ${formatMoney(you.gain, { sign: 'always' })}. ${opponent.name}, ${formatMoney(opponent.gain, { sign: 'always' })}. ${model.line}.`;

  return (
    <View style={styles.wrap}>
      <Card style={styles.card} accessible accessibilityLabel={label}>
        <Half side="you" team={you} />
        <Half side="opp" team={opponent} />
      </Card>
      <Text variant="callout" tone="secondary" style={styles.line} importantForAccessibility="no" accessibilityElementsHidden>
        {model.line}
      </Text>
    </View>
  );
}

function Half({ side, team }: { side: 'you' | 'opp'; team: ScoreSide & { avatarUri?: string | null } }) {
  const { colors } = useTheme();
  const mirror = side === 'opp';
  return (
    <View
      testID={mirror ? undefined : 'scoreboard-you'}
      style={[
        styles.half,
        mirror ? styles.halfRight : styles.halfLeft,
        mirror ? null : { backgroundColor: colors.youTint },
      ]}
    >
      <View style={[styles.who, mirror ? styles.whoMirror : null]}>
        <Avatar name={team.name} uri={team.avatarUri} size={AVATAR} tone={side === 'you' ? 'you' : 'opp'} ring={side === 'you'} />
        <Text variant="headline" numberOfLines={1} style={[styles.name, side === 'you' ? { fontWeight: YOUR_NAME_WEIGHT } : null]}>
          {team.name}
        </Text>
      </View>
      <Text variant="score.xl" adjustsFontSizeToFit minimumFontScale={0.6} style={mirror ? styles.right : null}>
        {formatMoney(team.gain, { sign: 'always' })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: space[4],
  },
  card: {
    flexDirection: 'row',
  },
  half: {
    flex: 1,
    minWidth: 0,
    gap: space[3],
    paddingVertical: space[5],
    paddingHorizontal: 14,
  },
  // Your half's shading follows the card radius on its OUTER corners only (§9C).
  halfLeft: {
    alignItems: 'flex-start',
    borderTopLeftRadius: radius.lg,
    borderBottomLeftRadius: radius.lg,
  },
  halfRight: {
    alignItems: 'flex-end',
    borderTopRightRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
  },
  who: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    maxWidth: '100%',
  },
  whoMirror: {
    flexDirection: 'row-reverse',
  },
  name: {
    flexShrink: 1,
  },
  right: {
    textAlign: 'right',
  },
  line: {
    textAlign: 'center',
  },
});
