/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { View, StyleSheet } from 'react-native';
import { Text } from '@/components/sp/Text';
import { space } from '@/constants/tokens';
import { useRenewalRoster } from '@/lib/game/useRenewalRoster';
import { screenFor } from '@/lib/game/renewal';
import { RenewalRoster } from './RenewalRoster';
import { RenewalAsk } from './RenewalAsk';
import { RenewalReview } from './RenewalReview';

export interface LeagueRenewalProps {
  /** The renewed (successor) league: a new season that has not drafted yet. */
  successorId: string;
  /** The renewed league's settings (carried over from Season 1), for the review. */
  settings: { name: string; num_weeks: number; pick_seconds: number; draft_date: string | null; draft_order_mode: string; playoff_teams: number | null };
  inviteCode: string;
  onScheduled: () => void;
  leagueId: string;
  createdAt: string;
  now: Date;
  onChanged: () => void;
}

/** A renewed league before its draft (R3 for a Season 1 player, R5/R6 for the
 * roster). Pending and out invitees and strangers get the ask or nothing: the
 * server decides what each one may see. */
export function LeagueRenewal({ successorId, leagueId, createdAt, now, onChanged, settings, inviteCode, onScheduled }: LeagueRenewalProps) {
  const st = useRenewalRoster(successorId, null, 0);
  if (st.status === 'loading' || st.status === 'idle') return null;
  if (st.status === 'error' || !st.roster) {
    return <Text variant="callout" tone="secondary">Couldn't load the renewal. Pull down to try again.</Text>;
  }
  const screen = screenFor(st.roster);
  if (screen === 'ask') {
    // A pending invitee's roster carries no people, so the commissioner's name is
    // not in this read. The fallback is a placeholder until the backend returns it.
    return <View style={styles.stack}><RenewalAsk leagueId={successorId} commissionerName="Your commissioner" onAnswered={onChanged} /></View>;
  }
  if (screen === 'reconcile' || screen === 'member_list') {
    const r = st.roster;
    if (r.status !== 'ok' || !r.full_list) return null;
    // R8: once everyone has replied, the commissioner reviews the carried-over settings.
    if (r.is_commissioner && !r.replies_pending) {
      return <RenewalReview leagueId={leagueId} inviteCode={inviteCode} counts={{ in: r.counts.in, new: r.counts.new }} repliesPending={false} settings={settings} onScheduled={onScheduled} />;
    }
    return (
      <RenewalRoster
        roster={r}
        leagueId={leagueId}
        season1Order={[]}
        createdAt={createdAt}
        now={now}
        onChanged={onChanged}
      />
    );
  }
  return null;
}

const styles = StyleSheet.create({
  stack: { gap: space[3] },
});
