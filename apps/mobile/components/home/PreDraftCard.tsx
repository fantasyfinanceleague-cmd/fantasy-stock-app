/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useState } from 'react';
import { ActivityIndicator, Share, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { space } from '@/constants/tokens';
import { Card } from '@/components/sp/Card';
import { Text } from '@/components/sp/Text';
import { Button } from '@/components/sp/Button';
import { useTheme } from '@/components/sp/ThemeProvider';
import { usePreDraftData } from '@/lib/home/usePreDraftData';
import { draftDateTimeLabel, orderSetLine } from '@/lib/home/draftCountdown';
import { ordinal } from '@/lib/home/ordinal';
import { useAuth } from '@/lib/useAuth';
import { useLeagueContext } from '@/lib/LeagueContext';
import { useDraftAutoStart } from '@/lib/game/useDraftAutoStart';
import {
  COMMISSIONER_FALLBACK,
  NO_DATE_TITLE,
  countdownCopy,
  etWhenLabel,
  homeView,
  memberPostponedCopy,
  noDateCopy,
  startClock,
  yourPickLine,
} from '@/lib/game/autoStart';
import { AutoStartBlockers } from '@/components/game/AutoStartBlockers';
import { DraftDateSheet } from '@/components/game/DraftDateSheet';
import { PICK_A_TIME_HOME, SET_DRAFT_TIME, homeSetsDraftTime } from '@/lib/game/draftTimeSheet';
import {
  pickClockLine, BUILD_YOUR_QUEUE, GO_TO_DRAFT_ROOM, PRE_DRAFT_TAG, PRE_DRAFT_CHIP,
  MEMBERS_TITLE, membersJoinedCaption, membersNeededCaption, INVITE_CODE_LABEL, NO_BUYING_BEFORE_DRAFT,
  DRAFT_ORDER_WAITING_TAG, orderWaitingLine, managersProgressCaption,
} from '@/lib/home/homeCopy';

// Stockpile — <PreDraftCard> (Phase 3b-2, states 6 — "before the draft" +
// "waiting for managers"). Rebuilt to match the board's HomePreDraft/
// OrderWaiting exactly (Design Lead ruling, 2026-09-30, B4) -- three
// cards (the draft card, a Members card, a note card), not one plain
// message card. get_draft_order's own fetch lives in usePreDraftData, not
// here (Design Lead ruling, 2026-09-30) -- this component is render only.
//
// 3c-2, draft auto-start: the draft card runs on the SAME hook and rules as
// the League tab's lobby (useDraftAutoStart, lib/game/autoStart homeView), so
// Home and the League tab never disagree: the countdown on the server's
// clock, "Draft room open · starts in" with your position, "Starting the
// draft" at 0:00, the commissioner's needs-you card when the draft is at risk
// (board ReconfirmHome: on top of the draft card), and postponed for everyone.
// Home never asks the server to start (the lobby does; the server does anyway).

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
  const { user } = useAuth();
  const { activeLeague } = useLeagueContext();
  const { waiting, members, loading, finalizeAt, memberCount, minMembers, orderRevealed } = usePreDraftData(leagueId);
  const auto = useDraftAutoStart(leagueId, { kick: false });
  const { ds, phase, serverNow } = auto;
  const view = phase ? homeView(phase, ds.isCommissioner, auto.fixable.length) : null;
  const commissionerName = members.find((m) => m.userId === activeLeague?.commissioner_id)?.displayName || COMMISSIONER_FALLBACK;

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
  // The server's draft time once the status is read; the league row's until then.
  const startsAt = ds.startsAt ?? (phase === null ? draftDate : null);
  const dateLabel = startsAt ? etWhenLabel(new Date(startsAt).getTime()) : draftDateTimeLabel(null);
  const countdown = view?.countdown && startsAt ? countdownCopy(view.countdown, startsAt, serverNow) : null;
  const clock = countdown ? countdown.clock : startsAt && phase === null ? startClock(new Date(startsAt).getTime() - serverNow) : null;
  // Once the room is open (room_open / starting): your position, and the button goes to the room.
  const roomOpen = view?.countdown === 'room_open' || view?.countdown === 'starting';
  const pick = roomOpen ? yourPickLine(orderRevealed, user?.id ?? '', ordinal) : null;
  const postponed = phase === 'postponed';
  // Ruling B (board #call-ux-pass1): the commissioner sets the time right here,
  // in the same Draft time sheet, opened in place (its own, so it never doubles
  // up with the blockers card's sheet). No Set later: there's no time yet.
  const setsTime = homeSetsDraftTime(!!view?.noDate, ds.isCommissioner);
  const [picking, setPicking] = useState(false);

  return (
    <>
      {view?.blockers ? (
        <AutoStartBlockers
          auto={auto}
          phase={view.blockers}
          playoffTeams={activeLeague?.playoff_teams ?? null}
          inviteCode={inviteCode}
        />
      ) : null}

      {view?.blockers === 'postponed' ? null : (
      <Card style={styles.card}>
        <View style={styles.header}>
          <Text variant="tag" style={{ color: colors.liveText }}>
            {view?.memberPostponed ? memberPostponedCopy(commissionerName, 'home').tag : PRE_DRAFT_TAG}
          </Text>
          <View style={[styles.chip, { backgroundColor: colors.inset }]}>
            <Text variant="tag" tone="secondary">
              {postponed ? 'Postponed' : PRE_DRAFT_CHIP}
            </Text>
          </View>
        </View>

        {view?.memberPostponed ? (
          <>
            <Text variant="title">{memberPostponedCopy(commissionerName, 'home').title}</Text>
            <Text variant="callout" tone="secondary">{memberPostponedCopy(commissionerName, 'home').line}</Text>
          </>
        ) : view?.noDate ? (
          <>
            <Text variant="title">{NO_DATE_TITLE}</Text>
            <Text variant="callout" tone="secondary">{setsTime ? PICK_A_TIME_HOME : noDateCopy(ds.isCommissioner, commissionerName)}</Text>
          </>
        ) : (
          <>
            {dateLabel ? <Text variant="title">{dateLabel}</Text> : null}
            {countdown && view?.countdown === 'room_open' ? (
              <Text variant="tag" style={{ color: colors.liveText }}>
                {countdown.tag}
              </Text>
            ) : null}
            {clock ? (
              <Text variant="score.lg" style={styles.countdown}>
                {clock}
              </Text>
            ) : null}
            {countdown?.starting ? (
              <View style={styles.starting}>
                <ActivityIndicator color={colors.text} />
                <Text variant="callout" style={styles.bold}>{countdown.starting}</Text>
              </View>
            ) : null}
            {pick ? <Text variant="callout" style={[styles.bold, { color: colors.youText }]}>{pick}</Text> : null}
          </>
        )}
        {!postponed ? (
          <Text variant="callout" tone="secondary">
            {pickClockLine(pickSeconds, numRounds)}
          </Text>
        ) : null}

        {!postponed && !roomOpen && !loading && !waiting && finalizeAt ? (
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

        {!waiting && setsTime ? (
          <>
            <Button label={SET_DRAFT_TIME} onPress={() => setPicking(true)} variant="primary" status={auto.fixes.busy ? 'loading' : 'idle'} />
            <Button label={BUILD_YOUR_QUEUE} onPress={() => router.push('/(tabs)/league')} variant="secondary" />
            {auto.fixes.fixError ? (
              <Text variant="callout" color={colors.danger} accessibilityLiveRegion="polite">{auto.fixes.fixError}</Text>
            ) : null}
          </>
        ) : !waiting ? (
          <Button label={roomOpen ? GO_TO_DRAFT_ROOM : BUILD_YOUR_QUEUE} onPress={() => router.push('/(tabs)/league')} variant="primary" />
        ) : null}
      </Card>
      )}

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

      <DraftDateSheet
        visible={picking && setsTime}
        initial={null}
        onConfirm={(d) => void auto.fixes.saveDraftTime(d, { firstTime: true })}
        onClose={() => setPicking(false)}
      />

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
  starting: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
  },
  bold: {
    fontWeight: '700',
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
