/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { radius, space } from '@/constants/tokens';
import { Avatar, AVATAR_RING, AVATAR_RING_GAP } from '@/components/sp/Avatar';
import { Card } from '@/components/sp/Card';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { formatMoney } from '@/components/sp/logic/money';
import { NAME_MIN_SCALE, NAME_MIN_SCALE_COMPACT, nameBesideAvatar, scoreboardModel, type ScoreSide } from '@/components/sp/logic/gameNight';
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
  /** null only with `bye` (a bye week has no opponent). */
  opponent: (ScoreSide & { avatarUri?: string | null }) | null;
  final?: boolean;
  /** 'hero' is Matchup's header; 'compact' is a game in All matchups (smaller avatars and
   * totals, the same two halves and the same line). */
  size?: 'hero' | 'compact';
  /** All matchups: a game you're NOT in has no "you" — neither half is shaded or ringed,
   * and the left side is just the first team. Default true (your game). */
  mine?: boolean;
  /** Before the season (both at $0.00, no game played) there's nobody leading or even: the
   * line is left off. Default true. */
  showLine?: boolean;
  /** A bye week (#call-mx-bye, B): no opponent. Their half reads `label` ("Bye week") and the
   * line under the card is `line` (the app's "Bye week · no result") — never a "leads by". */
  bye?: { label: string; line: string };
}

const AVATAR = { hero: 44, compact: 32 } as const;
/** The names' Dynamic Type ceiling (the headline's 1.6): beyond it two names can't share a card. */
const NAME_MAX_SCALE = 1.6;
/** The name's size per variant (body 15, callout 13), the half's padding and the who gap. */
const NAME_PT = { hero: 15, compact: 13 } as const;
const HALF_PAD = space[5];
const WHO_GAP = space[3];
/** The leads-by line under the card. */
export const LINE_MAX_SCALE = 1.3;

export function Scoreboard({ you, opponent, final = false, size = 'hero', mine = true, showLine = true, bye }: GnScoreboardProps) {
  const { colors } = useTheme();
  const model = opponent ? scoreboardModel(you, opponent, final) : null;
  const line = bye || !model ? bye?.line ?? '' : model.line;
  // Each half's width, measured: decides whether a name fits beside its avatar.
  const [cardWidth, setCardWidth] = useState(0);
  const label = bye
    ? `${you.name}, you, ${formatMoney(you.gain, { sign: 'always' })}. ${line}.`
    : `${you.name}${mine ? ', you' : ''}, ${formatMoney(you.gain, { sign: 'always' })}. ${opponent?.name ?? ''}, ${formatMoney(opponent?.gain ?? 0, { sign: 'always' })}.${showLine ? ` ${line}.` : ''}`;

  return (
    <View style={styles.wrap}>
      <Card style={styles.card} accessible accessibilityLabel={label} onLayout={(e) => setCardWidth(e.nativeEvent.layout.width)}>
        <Half side={mine ? 'you' : 'opp'} team={you} mirror={false} size={size} halfWidth={cardWidth / 2} />
        {bye || !opponent ? (
          <View style={[styles.half, styles.byeHalf]} testID="scoreboard-bye">
            <Text variant="callout" color={colors.text2} maxFontSizeMultiplier={NAME_MAX_SCALE} style={styles.byeLabel}>{bye?.label ?? ''}</Text>
          </View>
        ) : (
          <Half side="opp" team={opponent} mirror size={size} halfWidth={cardWidth / 2} />
        )}
      </Card>
      {showLine ? (
        // Capped at 1.3× so the totals above stay the loudest thing on the card at XL.
        <Text variant="callout" tone="secondary" maxFontSizeMultiplier={LINE_MAX_SCALE} style={styles.line} importantForAccessibility="no" accessibilityElementsHidden>
          {line}
        </Text>
      ) : null}
    </View>
  );
}

function Half({ side, team, mirror, size, halfWidth }: { side: 'you' | 'opp'; team: ScoreSide & { avatarUri?: string | null }; mirror: boolean; size: 'hero' | 'compact'; halfWidth: number }) {
  const { colors } = useTheme();
  const { fontScale } = useWindowDimensions();
  const you = side === 'you';
  // A name is ONE line, beside its avatar while it fits at ≥ 75% of its size; otherwise the
  // avatar stacks over it and the name takes the half's whole width (never "Gianluigi" / "B.").
  const fontPt = NAME_PT[size] * Math.min(fontScale, NAME_MAX_SCALE);
  const besideRoom = halfWidth - 2 * HALF_PAD - (AVATAR[size] + 2 * (AVATAR_RING + AVATAR_RING_GAP)) - WHO_GAP;
  const minScale = size === 'compact' ? NAME_MIN_SCALE_COMPACT : NAME_MIN_SCALE;
  const stacked = halfWidth > 0 && !nameBesideAvatar(team.name, besideRoom, fontPt, minScale);
  return (
    <View
      testID={you ? 'scoreboard-you' : undefined}
      style={[
        styles.half,
        size === 'compact' ? styles.halfCompact : null,
        mirror ? styles.halfRight : styles.halfLeft,
        you ? { backgroundColor: colors.youTint } : null,
      ]}
    >
      <View style={[styles.who, stacked ? (mirror ? styles.whoStackedMirror : styles.whoStacked) : mirror ? styles.whoMirror : null]}>
        {you ? (
          <Avatar name={team.name} uri={team.avatarUri} size={AVATAR[size]} tone="you" ring />
        ) : (
          // The same footprint as your ringed avatar, so both totals sit on one line.
          <View style={styles.ringFootprint}>
            <Avatar name={team.name} uri={team.avatarUri} size={AVATAR[size]} tone="opp" />
          </View>
        )}
        {/* The board's 15pt name (a 17pt headline cut "Roberto B." to "Robert…" beside the 44pt
            avatar on a 17e); a long name wraps to a second line before it truncates. */}
        <Text variant={size === 'compact' ? 'callout' : 'body'} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={minScale} maxFontSizeMultiplier={NAME_MAX_SCALE} style={[styles.name, mirror ? styles.right : null, you ? { fontWeight: YOUR_NAME_WEIGHT } : styles.oppName]}>
          {team.name}
        </Text>
      </View>
      <Text variant={size === 'compact' ? 'score.lg' : 'score.xl'} adjustsFontSizeToFit minimumFontScale={0.6} style={mirror ? styles.right : null}>
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
    paddingHorizontal: HALF_PAD,
  },
  halfCompact: {
    gap: space[3],
    paddingVertical: space[4],
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
    gap: WHO_GAP,
    maxWidth: '100%',
  },
  whoMirror: {
    flexDirection: 'row-reverse',
  },
  whoStacked: {
    flexDirection: 'column',
    alignItems: 'flex-start',
  },
  whoStackedMirror: {
    flexDirection: 'column',
    alignItems: 'flex-end',
  },
  name: {
    flexShrink: 1,
  },
  oppName: {
    fontWeight: '600',
  },
  ringFootprint: {
    padding: AVATAR_RING + AVATAR_RING_GAP,
  },
  right: {
    textAlign: 'right',
  },
  line: {
    textAlign: 'center',
  },
  byeHalf: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  byeLabel: {
    fontWeight: '600',
  },
});
