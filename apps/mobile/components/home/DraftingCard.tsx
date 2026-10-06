/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { PixelRatio, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { space } from '@/constants/tokens';
import { Card } from '@/components/sp/Card';
import { Text } from '@/components/sp/Text';
import { Button } from '@/components/sp/Button';
import { LiveDot } from '@/components/sp/game/LiveDot';
import { useTheme } from '@/components/sp/ThemeProvider';
import { useDraftingData } from '@/lib/home/useDraftingData';
import { currentPickerFor, picksUntilTurn } from '@/lib/home/draftTurn';
import {
  YOURE_ON_THE_CLOCK, onTheClockLine, upNextLine, GO_TO_DRAFT_ROOM, YOUR_TEAM_SO_FAR, teamSoFarCaption,
  roundSlotLabel, DRAFTING_TAG, DRAFTING_CHIP,
} from '@/lib/home/homeCopy';

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
  // XXXL (XL check, 2026-10-05): see styles.slotWide. Default font scale (1)
  // keeps the 3-across grid, so the default layout does not move.
  const twoAcross = PixelRatio.getFontScale() >= 1.5;
  const { clock, order, myPicks } = useDraftingData(leagueId, myUserId);

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

  // B5 (Design Lead, 2026-09-30): a slot per round, filled with the
  // symbol once drafted, "Rd N" (this round's own position, never a
  // global pick number) while still empty.
  const slots = Array.from({ length: numRounds }, (_, i) => myPicks[i] ?? null);

  return (
    <>
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
            {upNextLine(turn.round, numRounds, turn.overallPick, picksUntilTurn(order, clock.picksMade, numRounds, myUserId))}
          </Text>
        )}

        <Button label={GO_TO_DRAFT_ROOM} onPress={() => router.push('/(tabs)/league')} variant="primary" />
      </Card>

      <Card style={styles.card}>
        <View style={styles.header}>
          <Text variant="headline">{YOUR_TEAM_SO_FAR}</Text>
          <Text variant="caption" tone="secondary">{teamSoFarCaption(myPicks.length, numRounds)}</Text>
        </View>
        <View style={styles.slotGrid}>
          {slots.map((symbol, i) =>
            symbol ? (
              <View key={i} style={[styles.slot, twoAcross && styles.slotWide, { backgroundColor: colors.youText, borderColor: colors.youText }]}>
                <Text variant="callout" numberOfLines={1} style={{ color: colors.surface, fontWeight: '700' }}>
                  {symbol}
                </Text>
              </View>
            ) : (
              <View key={i} style={[styles.slot, twoAcross && styles.slotWide, { borderColor: colors.border }]}>
                <Text variant="callout" tone="secondary" numberOfLines={1}>
                  {roundSlotLabel(i + 1)}
                </Text>
              </View>
            ),
          )}
        </View>
      </Card>
    </>
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
  slotGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
  },
  // XXXL (XL check, 2026-10-05): at large Dynamic Type a 3-across tile is too
  // narrow for a ticker like NVDA, so the grid drops to 2 across.
  slotWide: {
    width: '48%',
  },
  slot: {
    width: '31%',
    aspectRatio: 1.6,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space[1],
  },
});
