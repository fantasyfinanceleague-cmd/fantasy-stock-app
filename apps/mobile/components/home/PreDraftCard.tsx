/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useEffect, useState } from 'react';
import { Share, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { space } from '@/constants/tokens';
import { Card } from '@/components/sp/Card';
import { Text } from '@/components/sp/Text';
import { Button } from '@/components/sp/Button';
import { useTheme } from '@/components/sp/ThemeProvider';
import { usePreDraftData } from '@/lib/home/usePreDraftData';
import { draftDateTimeLabel, orderSetLine, countdownLabel } from '@/lib/home/draftCountdown';
import {
  pickClockLine, BUILD_YOUR_QUEUE, PRE_DRAFT_TAG, PRE_DRAFT_CHIP,
  MEMBERS_TITLE, membersJoinedCaption, membersNeededCaption, INVITE_CODE_LABEL, NO_BUYING_BEFORE_DRAFT,
  DRAFT_ORDER_WAITING_TAG, orderWaitingLine, managersProgressCaption,
} from '@/lib/home/homeCopy';

// Stockpile — <PreDraftCard> (Phase 3b-2, states 6 — "before the draft" +
// "waiting for managers"). Rebuilt to match the board's HomePreDraft/
// OrderWaiting exactly (Design Lead ruling, 2026-09-30, B4) -- three
// cards (the draft card, a Members card, a note card), not one plain
// message card. get_draft_order's own fetch lives in usePreDraftData, not
// here (Design Lead ruling, 2026-09-30) -- this component is render only.

export interface PreDraftCardProps {
  leagueId: string;
  inviteCode: string;
  pickSeconds: number;
  numRounds: number;
  /** league.draft_date, straight from the caller (the SAME value
   * get_draft_order itself reads) -- never re-fetched here. */
  draftDate: string | null;
  /** league.num_participants -- the league's full roster CAPACITY, a
   * different number from DraftOrderInfo.minMembers (the draft-order
   * threshold): the board's "6 of 8 joined" uses this one. */
  numParticipants: number;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return `${first}${last}`.toUpperCase();
}

export function PreDraftCard({ leagueId, inviteCode, pickSeconds, numRounds, draftDate, numParticipants }: PreDraftCardProps) {
  const { colors } = useTheme();
  const { waiting, members, loading, finalizeAt, memberCount, minMembers } = usePreDraftData(leagueId);

  // The countdown "updates each minute, no animation" (spec) -- a plain
  // tick on a fixed interval, not a live poll of any kind.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  async function onShare() {
    try {
      await Share.share({ message: `Join my Stockpile league! Use code: ${inviteCode}` });
    } catch {
      // A dismissed share sheet is not an error.
    }
  }

  // S9 (Design Lead, 2026-09-30): while WAITING, the caption above is
  // about reaching the draft-order threshold ("3 joined · 4 needed to
  // draft"), not filling the whole roster -- the dashed avatar's own "+N"
  // must track the SAME milestone (minMembers), or it contradicts the
  // caption right next to it ("+3" toward an 8-seat league that hasn't
  // even started counting down yet, instead of "+1" until the order sets).
  // Once the order IS set, "+N" goes back to counting toward the full
  // roster (numParticipants) -- the board's "6 of 8 joined" case.
  const overflow = waiting
    ? Math.max(0, minMembers - members.length)
    : Math.max(0, numParticipants - members.length);
  const dateLabel = draftDateTimeLabel(draftDate);
  const countdown = countdownLabel(now, draftDate);

  return (
    <>
      <Card style={styles.card}>
        <View style={styles.header}>
          <Text variant="tag" style={{ color: colors.liveText }}>
            {PRE_DRAFT_TAG}
          </Text>
          <View style={[styles.chip, { backgroundColor: colors.inset }]}>
            <Text variant="tag" tone="secondary">
              {PRE_DRAFT_CHIP}
            </Text>
          </View>
        </View>

        {dateLabel ? <Text variant="title">{dateLabel}</Text> : null}
        {countdown ? (
          <Text variant="score.lg" style={styles.countdown}>
            {countdown}
          </Text>
        ) : null}
        <Text variant="callout" tone="secondary">
          {pickClockLine(pickSeconds, numRounds)}
        </Text>

        {!loading && !waiting && finalizeAt ? (
          <View style={styles.orderRow}>
            <View style={[styles.dot, { backgroundColor: colors.liveText }]} />
            <Text variant="callout">{orderSetLine(finalizeAt)}</Text>
          </View>
        ) : null}

        {!loading && waiting ? (
          <View style={[styles.orderWaiting, { backgroundColor: colors.inset }]}>
            <Text variant="tag" style={{ color: colors.liveText }}>
              {DRAFT_ORDER_WAITING_TAG}
            </Text>
            <Text variant="callout" style={styles.orderWaitingLine}>
              {orderWaitingLine(minMembers)}
            </Text>
            <View style={styles.progressRow} accessibilityLabel={`${memberCount} of ${minMembers} managers`}>
              {Array.from({ length: minMembers }, (_, i) => (
                <View key={i} style={[styles.progressSeg, { backgroundColor: i < memberCount ? colors.youText : colors.track }]} />
              ))}
            </View>
            <Text variant="caption" style={styles.progressCaption}>
              {managersProgressCaption(memberCount, minMembers)}
            </Text>
          </View>
        ) : null}

        {!waiting ? <Button label={BUILD_YOUR_QUEUE} onPress={() => router.push('/draft')} variant="primary" /> : null}
      </Card>

      <Card style={styles.card}>
        <View style={styles.sectionHeader}>
          <Text variant="headline">{MEMBERS_TITLE}</Text>
          <Text variant="caption" tone="secondary">
            {waiting ? membersNeededCaption(memberCount, minMembers) : membersJoinedCaption(members.length, numParticipants)}
          </Text>
        </View>
        <View style={styles.membersRow}>
          {members.map((m, i) => (
            <View key={m.userId} style={[styles.avatarCircle, { backgroundColor: i === 0 ? colors.youText : colors.inset }]}>
              <Text variant="callout" style={{ color: i === 0 ? colors.surface : colors.text }}>
                {initialsOf(m.displayName)}
              </Text>
            </View>
          ))}
          {overflow > 0 ? (
            <View style={[styles.avatarCircle, styles.avatarDashed, { borderColor: colors.borderStrong }]}>
              <Text variant="callout" tone="secondary">
                +{overflow}
              </Text>
            </View>
          ) : null}
        </View>
        <View style={[styles.codeRow, { backgroundColor: colors.sunken }]}>
          <View>
            <Text variant="caption" tone="secondary">
              {INVITE_CODE_LABEL}
            </Text>
            <Text variant="callout" style={styles.code}>
              {inviteCode}
            </Text>
          </View>
          <Button label="Share" onPress={onShare} variant="secondary" size="sm" />
        </View>
      </Card>

      {!waiting ? (
        <Card style={styles.card}>
          <Text variant="callout" tone="secondary">
            {NO_BUYING_BEFORE_DRAFT}
          </Text>
        </Card>
      ) : null}
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
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  chip: {
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: 999,
  },
  countdown: {
    fontVariant: ['tabular-nums'],
  },
  orderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[2],
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    // S2 (Design Lead gate, 2026-10-05): with flex-start the dot must sit on
    // the first line of a wrapped sentence. (callout's 18 pt line - 6 pt dot) / 2.
    marginTop: 6,
  },
  orderWaiting: {
    padding: space[4],
    borderRadius: 10,
    gap: space[2],
  },
  orderWaitingLine: {
    fontWeight: '600',
  },
  progressRow: {
    flexDirection: 'row',
    gap: space[1],
  },
  progressSeg: {
    flex: 1,
    height: 6,
    borderRadius: 3,
  },
  progressCaption: {
    fontVariant: ['tabular-nums'],
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  membersRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
  },
  avatarCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarDashed: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderStyle: 'dashed',
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
