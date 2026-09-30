/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useEffect, useState } from 'react';
import { Share, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { space } from '@/constants/tokens';
import { Card } from '@/components/sp/Card';
import { Text } from '@/components/sp/Text';
import { Button } from '@/components/sp/Button';
import { useTheme } from '@/components/sp/ThemeProvider';
import { Avatar } from '@/components/sp/Avatar';
import { supabase } from '@/lib/supabase';
import { parseDraftOrder } from '@/lib/draftOrder';
import { pickClockLine, BUILD_YOUR_QUEUE } from '@/lib/home/homeCopy';

// Stockpile — <PreDraftCard> (Phase 3b-2, states 6 — "before the draft" +
// "waiting for managers"). One fetch of get_draft_order on mount (no live
// polling — the countdown text is a snapshot, not a ticking clock; the
// draft room itself, not Home, is where a manager watches the clock tick
// down). get_league_display_names supplies names + bot marks.

export interface PreDraftCardProps {
  leagueId: string;
  inviteCode: string;
  pickSeconds: number;
  numRounds: number;
}

interface Member {
  userId: string;
  displayName: string;
  isBot: boolean;
}

export function PreDraftCard({ leagueId, inviteCode, pickSeconds, numRounds }: PreDraftCardProps) {
  const { colors } = useTheme();
  const [waiting, setWaiting] = useState<boolean | null>(null);
  const [orderRevealed, setOrderRevealed] = useState<string[] | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ data: orderRaw }, { data: namesRaw }] = await Promise.all([
        supabase.rpc('get_draft_order', { p_league_id: leagueId }),
        supabase.rpc('get_league_display_names', { p_league_id: leagueId }),
      ]);
      if (cancelled) return;
      const parsed = parseDraftOrder(orderRaw);
      setWaiting(parsed?.waitingForMembers ?? null);
      setOrderRevealed(parsed?.order ?? null);
      const names = (namesRaw ?? []) as { user_id: string; display_name: string; is_bot: boolean }[];
      setMembers(names.map((n) => ({ userId: n.user_id, displayName: n.display_name, isBot: n.is_bot })));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  async function onShare() {
    try {
      await Share.share({ message: `Join my Stockpile league! Use code: ${inviteCode}` });
    } catch {
      // A dismissed share sheet is not an error.
    }
  }

  return (
    <Card style={styles.card}>
      <Text variant="headline">Before the draft</Text>
      <Text variant="callout" tone="secondary">
        {pickClockLine(pickSeconds, numRounds)}
      </Text>

      {!loading && orderRevealed ? (
        <Text variant="callout" tone="secondary">
          Draft order: {orderRevealed.map((id) => members.find((m) => m.userId === id)?.displayName ?? id).join(' → ')}
        </Text>
      ) : !loading && waiting ? (
        <Text variant="callout" tone="secondary">
          Waiting for more managers to join before the draft order is set.
        </Text>
      ) : null}

      {members.length > 0 ? (
        <View style={styles.membersRow}>
          {members.map((m) => (
            <View key={m.userId} style={styles.memberChip}>
              <Avatar name={m.displayName} size={28} />
              <Text variant="caption" tone="secondary" numberOfLines={1} style={styles.memberName}>
                {m.displayName}
                {m.isBot ? ' \u{1F916}' : ''}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={[styles.codeRow, { backgroundColor: colors.sunken }]}>
        <Text variant="callout" style={styles.code}>
          {inviteCode}
        </Text>
        <Button label="Share" onPress={onShare} variant="secondary" size="sm" />
      </View>

      <Button label={BUILD_YOUR_QUEUE} onPress={() => router.push('/draft')} variant="primary" />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: space[6],
    gap: space[3],
    borderRadius: 14,
  },
  membersRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[3],
  },
  memberChip: {
    alignItems: 'center',
    width: 56,
    gap: space[1],
  },
  memberName: {
    maxWidth: 56,
  },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 10,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
  },
  code: {
    fontVariant: ['tabular-nums'],
    fontWeight: '700',
    letterSpacing: 2,
  },
});
