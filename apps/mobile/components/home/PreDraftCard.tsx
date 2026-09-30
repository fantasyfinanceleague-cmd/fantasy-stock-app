/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { Share, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { space } from '@/constants/tokens';
import { Card } from '@/components/sp/Card';
import { Text } from '@/components/sp/Text';
import { Button } from '@/components/sp/Button';
import { useTheme } from '@/components/sp/ThemeProvider';
import { Avatar } from '@/components/sp/Avatar';
import { usePreDraftData } from '@/lib/home/usePreDraftData';
import { pickClockLine, BUILD_YOUR_QUEUE, BEFORE_THE_DRAFT_TITLE } from '@/lib/home/homeCopy';

// Stockpile — <PreDraftCard> (Phase 3b-2, states 6 — "before the draft" +
// "waiting for managers"). One fetch of get_draft_order on mount (no live
// polling — the countdown text is a snapshot, not a ticking clock; the
// draft room itself, not Home, is where a manager watches the clock tick
// down). get_league_display_names supplies names + bot marks. The fetch
// itself (and its DEV-ONLY fixture seam) lives in usePreDraftData, not
// here — Design Lead ruling, 2026-09-30.

export interface PreDraftCardProps {
  leagueId: string;
  inviteCode: string;
  pickSeconds: number;
  numRounds: number;
}

export function PreDraftCard({ leagueId, inviteCode, pickSeconds, numRounds }: PreDraftCardProps) {
  const { colors } = useTheme();
  const { waiting, orderRevealed, members, loading } = usePreDraftData(leagueId);

  async function onShare() {
    try {
      await Share.share({ message: `Join my Stockpile league! Use code: ${inviteCode}` });
    } catch {
      // A dismissed share sheet is not an error.
    }
  }

  return (
    <Card style={styles.card}>
      <Text variant="headline">{BEFORE_THE_DRAFT_TITLE}</Text>
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
