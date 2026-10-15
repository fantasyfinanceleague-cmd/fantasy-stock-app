/**
 * The facts card on "You're in {league}" (onboarding W4; Giorgio's C1 ruling, 2026-10-14): Managers,
 * Stakes, Season. The app keeps its own draft sentence, so there is no Draft row. The data is read
 * AFTER the join, from what a member may read (the league row and its member count in
 * LeagueContext, which join-league refreshes before this screen), never from the preview. Pure.
 */
import { stakesLine } from '../stakesLine';
import { seasonLine, type PreviewLeague, type PreviewRow } from './joinPreview';

/** The league columns the card needs (LeagueContext's League has them all). */
export interface JoinedLeagueFacts {
  num_participants: number;
  stake_mode: string | null;
  notional_per_slot: number | null;
  budget_amount: number | null;
  league_type: string | null;
  num_weeks: number | null;
  duration_days: number | null;
}

/** Managers is dropped when the count could not be read (never a guessed "N of N"); Season when the league has no length. */
export function joinedFactRows(l: JoinedLeagueFacts, members: number | null): PreviewRow[] {
  const rows: PreviewRow[] = [];
  if (members !== null) rows.push({ label: 'Managers', value: `${members} of ${l.num_participants}` });
  rows.push({ label: 'Stakes', value: stakesLine(l.stake_mode, { notionalPerSlot: l.notional_per_slot, budgetAmount: l.budget_amount }) });
  const season = seasonLine({ leagueType: l.league_type, numWeeks: l.num_weeks, durationDays: l.duration_days });
  if (season) rows.push({ label: 'Season', value: season });
  return rows;
}

/** DEV fixtures only: a fixture joins nothing, so the card reads the preview it holds (one member added). */
export function fixtureJoinedRows(p: PreviewLeague): PreviewRow[] {
  return joinedFactRows(
    {
      num_participants: p.max,
      stake_mode: p.stakeMode,
      notional_per_slot: p.notionalPerSlot,
      budget_amount: p.budgetAmount,
      league_type: p.leagueType,
      num_weeks: p.numWeeks,
      duration_days: p.durationDays,
    },
    Math.min(p.members + 1, p.max),
  );
}
