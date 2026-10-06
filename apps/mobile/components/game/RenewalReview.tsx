/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useState } from 'react';
import { View, StyleSheet, Alert, Pressable } from 'react-native';
import { Card } from '@/components/sp/Card';
import { Text } from '@/components/sp/Text';
import { Button } from '@/components/sp/Button';
import { Icon } from '@/components/sp/Icon';
import { useTheme } from '@/components/sp/ThemeProvider';
import { space } from '@/constants/tokens';
import { supabase } from '@/lib/supabase';
import { seamRpc } from '@/lib/game/seamCalls';
import { teamsLine, canSchedule, buildRenewalSettings } from '@/lib/game/renewalReview';
import { byeNoticeCopy } from '@/lib/game/draftLobby';
import { playoffLine } from '@/lib/playoffs';
import { SegmentedControl } from '@/components/sp/SegmentedControl';
import DateTimePicker from '@react-native-community/datetimepicker';
import { PICK_CLOCK_OPTIONS, DRAFT_ORDER_OPTIONS, isFutureDraftDate, stepSeasonWeeks, seasonWeeksFloor } from '@/lib/game/renewalPickers';
import { playoffStepperBounds, stepPlayoffTeams } from '@/lib/game/draftLobby';

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
  // The commissioner's picks, held locally until Schedule: start_renewed_season takes
  // them in its settings, so nothing is written before the one action.
  const [pickSeconds, setPickSeconds] = useState(settings.pick_seconds);
  const [draftOrder, setDraftOrder] = useState<string>(settings.draft_order_mode);
  const [draftDate, setDraftDate] = useState<string | null>(settings.draft_date);
  const [editingDate, setEditingDate] = useState(false);
  const [weeks, setWeeks] = useState(settings.num_weeks);
  const [playoffTeams, setPlayoffTeams] = useState(settings.playoff_teams ?? 2);
  const managers = counts.in + counts.new;
  const teams = teamsLine(counts, inviteCode);
  const bye = byeNoticeCopy(managers, weeks);
  const playoffs = playoffLine(playoffTeams);
  const enabled = canSchedule({ repliesPending, draftDate }) && !busy;

  const schedule = async () => {
    if (!enabled) return;
    setBusy(true);
    const payload = buildRenewalSettings({ ...settings, pick_seconds: pickSeconds, draft_order_mode: draftOrder, draft_date: draftDate, num_weeks: weeks, playoff_teams: playoffTeams });
    const { data, error } = await seamRpc('start_renewed_season', { p_league_id: leagueId, p_settings: payload });
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
        <Row label="Draft" value={draftDate ? new Date(draftDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : 'Not set'} onPress={() => setEditingDate((v) => !v)} />
        {editingDate ? (
          <DateTimePicker
            value={draftDate ? new Date(draftDate) : new Date()}
            mode="datetime"
            minimumDate={new Date()}
            onChange={(_, d) => {
              if (d && isFutureDraftDate(d.toISOString(), new Date())) setDraftDate(d.toISOString());
            }}
          />
        ) : null}
        <View style={styles.picker}>
          <Text variant="callout">Draft order</Text>
          <SegmentedControl options={DRAFT_ORDER_OPTIONS.map((o) => ({ label: o.label, value: o.value }))} value={draftOrder} onChange={setDraftOrder} />
        </View>
        <View style={styles.picker}>
          <Text variant="callout">Pick clock</Text>
          <SegmentedControl options={PICK_CLOCK_OPTIONS.map((s) => ({ label: `${s}s`, value: String(s) }))} value={String(pickSeconds)} onChange={(v) => setPickSeconds(Number(v))} />
        </View>
        <Stepper label="Season" value={weeks} min={seasonWeeksFloor(managers)} onChange={(d) => setWeeks((w) => stepSeasonWeeks(w, d, managers))} unit="weeks" />
        <Stepper label="Playoffs" value={playoffTeams} min={playoffStepperBounds(managers).min} max={playoffStepperBounds(managers).max} onChange={(d) => setPlayoffTeams((t) => stepPlayoffTeams(t, d, managers))} unit="teams" sub={playoffs ?? undefined} />
      </Card>
      {bye ? <Text variant="caption" tone="secondary">{bye}</Text> : null}
      <Button label="Schedule the draft" onPress={() => void schedule()} disabled={!enabled} />
      <Text variant="caption" tone="secondary">Everyone who's in gets a notification. Season 1 stays in History.</Text>
    </View>
  );
}

function Stepper({ label, value, min, max, onChange, unit, sub }: { label: string; value: number; min: number; max?: number; onChange: (d: 1 | -1) => void; unit: string; sub?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.picker}>
      <View style={styles.stepRow}>
        <Text variant="callout">{label}</Text>
        <View style={styles.stepBox}>
          <Pressable onPress={() => onChange(-1)} disabled={value <= min} accessibilityRole="button" accessibilityLabel={`Fewer ${label.toLowerCase()}`} style={styles.stepHit}>
            <Icon name="chevronDown" size="callout" tone={value <= min ? 'text3' : 'text2'} />
          </Pressable>
          <Text variant="callout" style={{ color: colors.text }}>{`${value} ${unit}`}</Text>
          <Pressable onPress={() => onChange(1)} disabled={max !== undefined && value >= max} accessibilityRole="button" accessibilityLabel={`More ${label.toLowerCase()}`} style={styles.stepHit}>
            <Icon name="chevronUp" size="callout" tone={max !== undefined && value >= max ? 'text3' : 'text2'} />
          </Pressable>
        </View>
      </View>
      {sub ? <Text variant="caption" tone="secondary">{sub}</Text> : null}
    </View>
  );
}

function Row({ label, value, sub, onPress }: { label: string; value: string; sub?: string; onPress?: () => void }) {
  const body = (
    <View style={styles.row}>
      <Text variant="callout">{label}</Text>
      <View style={styles.value}>
        <Text variant="callout" tone="secondary">{value}</Text>
        {sub ? <Text variant="caption" tone="secondary">{sub}</Text> : null}
      </View>
    </View>
  );
  return onPress ? <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}, ${value}. Change`} style={{ minHeight: 44, justifyContent: 'center' }}>{body}</Pressable> : body;
}

const styles = StyleSheet.create({
  stack: { gap: space[3] },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', minHeight: 44, paddingVertical: space[1] },
  value: { alignItems: 'flex-end', flexShrink: 1 },
  picker: { gap: space[2], paddingVertical: space[2] },
  stepRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44 },
  stepBox: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  stepHit: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
