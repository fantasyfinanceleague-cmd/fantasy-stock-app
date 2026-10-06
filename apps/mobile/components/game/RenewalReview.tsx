/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useState } from 'react';
import { View, StyleSheet, Alert } from 'react-native';
import { Card } from '@/components/sp/Card';
import { Text } from '@/components/sp/Text';
import { Button } from '@/components/sp/Button';
import { space } from '@/constants/tokens';
import { supabase } from '@/lib/supabase';
import { teamsLine, canSchedule, buildRenewalSettings } from '@/lib/game/renewalReview';
import { byeNoticeCopy } from '@/lib/game/draftLobby';
import { playoffLine } from '@/lib/playoffs';

export interface RenewalReviewProps {
  leagueId: string;
  inviteCode: string;
  counts: { in: number; new: number };
  repliesPending: boolean;
  /** The Season 1 settings carried over, as stored on the renewed league. */
  settings: { name: string; num_weeks: number; pick_seconds: number; draft_date: string | null; draft_order_mode: string; playoff_teams: number | null };
  onScheduled: () => void;
}

/** R8, the Season 2 review: every Season 1 setting carried over. Schedule the
 * draft is the one action (no extra sheet, per §9B), and it is enabled only once
 * nobody is pending and a draft date is set. */
export function RenewalReview({ leagueId, inviteCode, counts, repliesPending, settings, onScheduled }: RenewalReviewProps) {
  const [busy, setBusy] = useState(false);
  const teams = teamsLine(counts, inviteCode);
  const bye = byeNoticeCopy(counts.in + counts.new, settings.num_weeks);
  const playoffs = playoffLine(settings.playoff_teams);
  const enabled = canSchedule({ repliesPending, draftDate: settings.draft_date }) && !busy;

  const schedule = async () => {
    if (!enabled) return;
    setBusy(true);
    const payload = buildRenewalSettings({ ...settings });
    const { data, error } = await supabase.rpc('start_renewed_season', { p_league_id: leagueId, p_settings: payload });
    setBusy(false);
    const res = data as { status?: string } | null;
    if (error || !res || res.status !== 'season_set') {
      Alert.alert('Not scheduled', 'The draft was not scheduled. Check the review, then try again.');
      return;
    }
    onScheduled();
  };

  return (
    <View style={styles.stack}>
      <Text variant="tag" tone="secondary">{settings.name}</Text>
      <Text variant="title">Season 2</Text>
      <Text variant="callout" tone="secondary">Everything carries over from Season 1. Change anything before the draft.</Text>
      <Card>
        <Row label="Who's in" value={`${counts.in} back · ${counts.new} new`} />
        <Row label="Teams" value={teams.value} sub={teams.sub} />
        <Row label="Draft" value={settings.draft_date ?? 'Not set'} />
        <Row label="Draft order" value={settings.draft_order_mode} />
        <Row label="Pick clock" value={`${settings.pick_seconds} seconds`} />
        <Row label="Season" value={`${settings.num_weeks} weeks`} />
        {playoffs ? <Row label="Playoffs" value={playoffs} /> : null}
      </Card>
      {bye ? <Text variant="caption" tone="secondary">{bye}</Text> : null}
      <Button label="Schedule the draft" onPress={() => void schedule()} disabled={!enabled} />
      <Text variant="caption" tone="secondary">Everyone who's in gets a notification. Season 1 stays in History.</Text>
    </View>
  );
}

function Row({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={styles.row}>
      <Text variant="callout">{label}</Text>
      <View style={styles.value}>
        <Text variant="callout" tone="secondary">{value}</Text>
        {sub ? <Text variant="caption" tone="secondary">{sub}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space[3] },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', minHeight: 44, paddingVertical: space[1] },
  value: { alignItems: 'flex-end', flexShrink: 1 },
});
