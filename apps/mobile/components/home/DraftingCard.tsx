/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { space } from '@/constants/tokens';
import { Card } from '@/components/sp/Card';
import { Text } from '@/components/sp/Text';
import { Button } from '@/components/sp/Button';
import { LiveDot } from '@/components/sp/game/LiveDot';
import { useTheme } from '@/components/sp/ThemeProvider';
import { useDraftingData } from '@/lib/home/useDraftingData';
import { currentPickerFor, picksUntilTurn } from '@/lib/home/draftTurn';
import { YOURE_ON_THE_CLOCK, onTheClockLine, upNextLine, GO_TO_DRAFT_ROOM, YOUR_TEAM_SO_FAR, DRAFTING_TAG, DRAFTING_CHIP } from '@/lib/home/homeCopy';

// Stockpile — <DraftingCard> (Phase 3b-2, state 7 — "draft in progress").
// One fetch of get_draft_clock + get_draft_order on mount — no live
// polling (the seconds-left figure is a snapshot; the draft room itself
// is where a manager watches it tick down and picks). Home's job here is
// just "should I go to the draft room right now", not to BE the draft
// room. The fetch itself (and its DEV-ONLY fixture seam) lives in
// useDraftingData, not here — Design Lead ruling, 2026-09-30.

export interface DraftingCardProps {
  leagueId: string;
  myUserId: string;
  numRounds: number;
}

export function DraftingCard({ leagueId, myUserId, numRounds }: DraftingCardProps) {
  const { colors } = useTheme();
  const { clock, order, myPickCount } = useDraftingData(leagueId, myUserId);

  if (!clock || !order) {
    return (
      <Card style={styles.card}>
        <Text variant="tag" style={{ color: colors.liveText }}>{DRAFTING_TAG}</Text>
      </Card>
    );
  }

  const turn = currentPickerFor(order, clock.picksMade, numRounds);
  const isMyTurn = turn.pickerId === myUserId;
  const deadline = clock.deadlineAt ? new Date(clock.deadlineAt).getTime() : null;
  const now = new Date(clock.serverNow).getTime();
  const secondsLeft = deadline != null ? Math.max(0, Math.round((deadline - now) / 1000)) : clock.pickSeconds;

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Text variant="tag" style={{ color: colors.liveText }}>{DRAFTING_TAG}</Text>
        <View style={[styles.chip, { backgroundColor: colors.inset }]}>
          <LiveDot size={7} />
          <Text variant="tag" style={{ color: colors.liveText }}>{DRAFTING_CHIP}</Text>
        </View>
      </View>

      {isMyTurn ? (
        <>
          {/* B5 (Design Lead, 2026-09-30): the board's "You're on the
              clock" is in the live-text colour, not accent blue. */}
          <Text variant="title" style={{ color: colors.liveText }}>
            {YOURE_ON_THE_CLOCK}
          </Text>
          <Text variant="callout" tone="secondary">
            {onTheClockLine(turn.round, turn.overallPick, secondsLeft)}
          </Text>
        </>
      ) : (
        <Text variant="callout" tone="secondary">
          {upNextLine(turn.round, turn.overallPick, picksUntilTurn(order, clock.picksMade, numRounds, myUserId))}
        </Text>
      )}

      <Button label={GO_TO_DRAFT_ROOM} onPress={() => router.push('/draft')} variant="primary" />

      {myPickCount > 0 ? (
        <Text variant="caption" tone="secondary">
          {YOUR_TEAM_SO_FAR}: {myPickCount} pick{myPickCount === 1 ? '' : 's'}
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: space[6],
    gap: space[3],
    borderRadius: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: 999,
  },
});
