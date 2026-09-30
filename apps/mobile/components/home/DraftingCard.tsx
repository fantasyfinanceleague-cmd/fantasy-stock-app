/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { space } from '@/constants/tokens';
import { Card } from '@/components/sp/Card';
import { Text } from '@/components/sp/Text';
import { Button } from '@/components/sp/Button';
import { LiveDot } from '@/components/sp/game/LiveDot';
import { useTheme } from '@/components/sp/ThemeProvider';
import { supabase } from '@/lib/supabase';
import { parseDraftOrder } from '@/lib/draftOrder';
import { currentPickerFor, picksUntilTurn } from '@/lib/home/draftTurn';
import { YOURE_ON_THE_CLOCK, onTheClockLine, upNextLine, GO_TO_DRAFT_ROOM, YOUR_TEAM_SO_FAR, DRAFT_IN_PROGRESS_TITLE } from '@/lib/home/homeCopy';

// Stockpile — <DraftingCard> (Phase 3b-2, state 7 — "draft in progress").
// One fetch of get_draft_clock + get_draft_order on mount — no live
// polling (the seconds-left figure is a snapshot; the draft room itself
// is where a manager watches it tick down and picks). Home's job here is
// just "should I go to the draft room right now", not to BE the draft
// room.

export interface DraftingCardProps {
  leagueId: string;
  myUserId: string;
  numRounds: number;
}

interface ClockState {
  pickSeconds: number;
  picksMade: number;
  deadlineAt: string | null;
  serverNow: string;
}

export function DraftingCard({ leagueId, myUserId, numRounds }: DraftingCardProps) {
  const { colors } = useTheme();
  const [clock, setClock] = useState<ClockState | null>(null);
  const [order, setOrder] = useState<string[] | null>(null);
  const [myPickCount, setMyPickCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ data: clockRaw }, { data: orderRaw }, { data: picksRaw }] = await Promise.all([
        supabase.rpc('get_draft_clock', { p_league_id: leagueId }),
        supabase.rpc('get_draft_order', { p_league_id: leagueId }),
        supabase.from('drafts').select('symbol').eq('league_id', leagueId).eq('user_id', myUserId),
      ]);
      if (cancelled) return;
      const c = Array.isArray(clockRaw) ? clockRaw[0] : clockRaw;
      if (c) {
        setClock({ pickSeconds: c.pick_seconds, picksMade: c.picks_made, deadlineAt: c.deadline_at, serverNow: c.server_now });
      }
      const parsed = parseDraftOrder(orderRaw);
      setOrder(parsed?.order ?? null);
      setMyPickCount((picksRaw ?? []).length);
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId, myUserId]);

  if (!clock || !order) {
    return (
      <Card style={styles.card}>
        <Text variant="headline">{DRAFT_IN_PROGRESS_TITLE}</Text>
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
        <Text variant="headline">{DRAFT_IN_PROGRESS_TITLE}</Text>
        <LiveDot size={7} />
      </View>

      {isMyTurn ? (
        <>
          <Text variant="title" style={{ color: colors.accent }}>
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
});
