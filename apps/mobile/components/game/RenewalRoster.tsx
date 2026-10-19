/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useState } from 'react';
import { ActionSheetIOS, Alert, Platform, Pressable, View, StyleSheet } from 'react-native';
import { Card } from '@/components/sp/Card';
import { Text } from '@/components/sp/Text';
import { Icon } from '@/components/sp/Icon';
import { useTheme } from '@/components/sp/ThemeProvider';
import { radius, space } from '@/constants/tokens';
import { supabase } from '@/lib/supabase';
import { seamRpc } from '@/lib/game/seamCalls';
import {
  groupCopy, countsLine, draftDisabled, nudgeWindow, orderRoster, buildNonReplySheet, askedLine, nudgedLine, type SheetAction, waitingOnSentence,
  rosterView, rosterCommissionerName, MEMBER_DRAFT_LINE, RUNNING_BACK_BANNER, CHANGE_ANSWER } from '@/lib/game/renewal';
import type { RosterResult } from '@/lib/game/useRenewalRoster';
import { yourNameStyle, yourRowTint, youA11y } from '@/lib/game/managerRow';
import { useAuth } from '@/lib/useAuth';
import { RenewalChangeSheet } from './RenewalChangeSheet';

type FullRoster = Extract<RosterResult, { full_list: true }>;

export interface RenewalRosterProps {
  roster: FullRoster;
  leagueId: string;
  /** Season 1 order (the server's frozen rank, from get_league_history). */
  season1Order: string[];
  /** The renewed league's creation time, for "Asked {date}" (every invitee is asked at once). */
  createdAt: string;
  now: Date;
  onChanged: () => void;
}

/** Who's running back (R5 for the commissioner, R6 read-only for a member who is
 * in). The order is Season 1's. A non-reply's actions open the native sheet (R7).
 * GS-10 (board RibMemberList): the draft card is the commissioner's; a member who is
 * in gets "You're running back" with Change (until the draft is set) and the board's
 * line under the list. What shows is decided in rosterView (lib/game/renewal). */
export function RenewalRoster({ roster, leagueId, season1Order, createdAt, now, onChanged }: RenewalRosterProps) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const myUserId = user?.id ?? '';
  const people = orderRoster(roster.people, season1Order);
  const waiting = roster.people.filter((p) => p.group === 'pending').map((p) => p.display_name);
  const view = rosterView(roster);
  const [changing, setChanging] = useState(false);

  const runSheet = (p: FullRoster['people'][number]) => {
    const window = nudgeWindow({ lastNudgedAt: p.last_nudged_at, now });
    const sheet = buildNonReplySheet({
      name: p.display_name,
      askedLine: askedLine(createdAt),
      nudgedLine: p.last_nudged_at ? nudgedLine(p.last_nudged_at) : null,
      nudgeEnabled: window.enabled && p.can_nudge,
      unlocksLine: window.unlocksLine,
    });
    const run = async (action: SheetAction) => {
      if (action === 'cancel') return;
      const rpc = action === 'nudge' ? 'nudge_renewal' : 'remove_renewal_invitee';
      const { error } = await seamRpc(rpc, { p_league_id: leagueId, p_user_id: p.user_id });
      if (error) Alert.alert('Not done', 'That did not go through. Try again.');
      else onChanged();
    };
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { title: sheet.title, message: sheet.message, options: sheet.options.map((o) => o.label), cancelButtonIndex: sheet.cancelIndex, destructiveButtonIndex: sheet.destructiveIndex },
        (i) => void run(sheet.actions[i]),
      );
    } else {
      Alert.alert(sheet.title, sheet.message, sheet.options.map((o) => ({
        text: o.label,
        style: o.action === 'cancel' ? 'cancel' : o.action === 'remove' ? 'destructive' : 'default',
        onPress: () => void run(o.action),
      })));
    }
  };

  return (
    <View style={styles.stack}>
      {view.banner ? (
        <View style={[styles.banner, { backgroundColor: colors.inset }]}>
          <View style={styles.answer}>
            <Icon name="check" size="callout" tone="accent" />
            <Text variant="callout" style={[styles.bold, { color: colors.accent }]}>{RUNNING_BACK_BANNER}</Text>
          </View>
          {view.change ? (
            <Pressable onPress={() => setChanging(true)} accessibilityRole="button" accessibilityLabel="Change your answer" style={styles.link} hitSlop={{ left: 8, right: 8 }}>
              <Text variant="caption" style={[styles.bold, { color: colors.accent }]}>{CHANGE_ANSWER}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <Text variant="caption" tone="secondary">{countsLine(roster.counts)}</Text>
      <Card style={styles.card}>
        {people.map((p) => {
          const copy = groupCopy(p.group);
          return (
            // Bold here already means "Running back", so the tint alone marks you (board #call-manager-row).
            <View key={p.user_id} style={[styles.row, yourRowTint(p.user_id === myUserId, colors.youTint)]}>
              <View style={styles.name}>
                <Text variant="callout" accessibilityLabel={`${p.display_name}${youA11y(p.user_id === myUserId)}`} style={p.group === 'in' ? { fontWeight: '700' } : p.group === 'out' ? { color: colors.text2 } : undefined}>{p.display_name}</Text>
                {copy.marker ? <Text variant="tag" tone="secondary">{copy.marker}</Text> : null}
              </View>
              <View style={styles.answer}>
                {p.group === 'in' ? <Icon name="check" size="callout" tone="accent" /> : null}
                <Text variant="callout" style={p.group === 'in' ? { color: colors.accent } : p.group === 'out' ? { color: colors.text2 } : { color: colors.text2 }}>{copy.label}</Text>
              </View>
              {roster.is_commissioner && p.group === 'pending' ? (
                <Pressable onPress={() => runSheet(p)} accessibilityRole="button" accessibilityLabel={`${p.display_name}, no reply yet. Nudge or remove`} style={styles.link}>
                  <Text variant="caption" style={{ color: colors.accent }}>Nudge again · Remove</Text>
                </Pressable>
              ) : null}
            </View>
          );
        })}
      </Card>

      {view.draftCard ? (
        <Card style={styles.card}>
          <View style={styles.draftRow}>
            <Text variant="callout">Draft time</Text>
            <Text variant="callout" tone="secondary">Not set</Text>
          </View>
          <View style={[styles.draftRow, draftDisabled(roster.replies_pending) ? styles.disabled : null]}>
            <Text variant="callout">Draft order</Text>
            <Text variant="callout" tone="secondary">Random</Text>
          </View>
          {draftDisabled(roster.replies_pending) ? (
            <Text variant="caption" tone="secondary">{`You can set the draft once everyone has replied. ${waitingOnSentence(waiting)}`}</Text>
          ) : null}
        </Card>
      ) : null}
      {view.memberLine ? <Text variant="caption" tone="secondary">{MEMBER_DRAFT_LINE}</Text> : null}
      {view.change ? (
        <RenewalChangeSheet
          visible={changing}
          leagueId={leagueId}
          commissionerName={rosterCommissionerName(roster.people) ?? ''}
          current="in"
          onClose={() => setChanging(false)}
          onChanged={() => {
            setChanging(false);
            onChanged();
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // The sp Card has no padding or radius of its own (callers set both); bare, the
  // text sat flush on the card edge (final sweep S-1, seen in the capture pass).
  card: { borderRadius: radius.lg, padding: space[5], gap: space[2] },
  stack: { gap: space[3] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingVertical: space[2], flexWrap: 'wrap' },
  name: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space[1] },
  answer: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  // A text link's hit area reaches 44 pt (the craft floor).
  link: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space[1] },
  // Board RibMemberList's banner (ks-raised: the inset fill, radius md, 10/12 pt padding). Its own
  // height, so it keeps its size once Change (a 44 pt target) goes with the draft set.
  banner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 48, borderRadius: radius.md, paddingVertical: space[1], paddingHorizontal: space[4] },
  bold: { fontWeight: '700' },
  // flexWrap: a value that does not fit beside its label drops under it, so neither is clipped or squeezed.
  draftRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', alignContent: 'center', minHeight: 44, columnGap: space[3], rowGap: space[1] },
  disabled: { opacity: 0.5 },
});
