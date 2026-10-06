/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { ActionSheetIOS, Alert, Platform, Pressable, View, StyleSheet } from 'react-native';
import { Card } from '@/components/sp/Card';
import { Text } from '@/components/sp/Text';
import { Icon } from '@/components/sp/Icon';
import { useTheme } from '@/components/sp/ThemeProvider';
import { space } from '@/constants/tokens';
import { supabase } from '@/lib/supabase';
import { seamRpc } from '@/lib/game/seamCalls';
import {
  groupCopy, countsLine, draftDisabled, nudgeWindow, orderRoster, buildNonReplySheet, askedLine, nudgedLine, type SheetAction,
} from '@/lib/game/renewal';
import type { RosterResult } from '@/lib/game/useRenewalRoster';

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
 * in). The order is Season 1's. A non-reply's actions open the native sheet (R7). */
export function RenewalRoster({ roster, leagueId, season1Order, createdAt, now, onChanged }: RenewalRosterProps) {
  const { colors } = useTheme();
  const people = orderRoster(roster.people, season1Order);
  const waiting = roster.people.filter((p) => p.group === 'pending').map((p) => p.display_name);

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
      <Text variant="caption" tone="secondary">{countsLine(roster.counts)}</Text>
      <Card>
        {people.map((p) => {
          const copy = groupCopy(p.group);
          return (
            <View key={p.user_id} style={styles.row}>
              <View style={styles.name}>
                <Text variant="callout" style={p.group === 'in' ? { fontWeight: '700' } : p.group === 'out' ? { color: colors.text2 } : undefined}>{p.display_name}</Text>
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

      <Card>
        <View style={styles.draftRow}>
          <Text variant="callout">Draft date</Text>
          <Text variant="callout" tone="secondary">Not set</Text>
        </View>
        <View style={[styles.draftRow, draftDisabled(roster.replies_pending) ? styles.disabled : null]}>
          <Text variant="callout">Draft order</Text>
          <Text variant="callout" tone="secondary">Random</Text>
        </View>
        {draftDisabled(roster.replies_pending) ? (
          <Text variant="caption" tone="secondary">{`You can set the draft once everyone has replied. Waiting on ${waiting.join(', ')}.`}</Text>
        ) : null}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space[3] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingVertical: space[2], flexWrap: 'wrap' },
  name: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space[1] },
  answer: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  // A text link's hit area reaches 44 pt (the craft floor).
  link: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space[1] },
  draftRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44 },
  disabled: { opacity: 0.5 },
});
