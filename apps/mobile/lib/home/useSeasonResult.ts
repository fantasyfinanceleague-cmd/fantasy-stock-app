/**
 * useSeasonResult: SeasonCompleteCard's own data fetch (get_season_result),
 * extracted out of the component so the DEV-ONLY fixture seam lives in a
 * hook, not the component (same pattern as usePreDraftData/
 * useDraftingData, Design Lead ruling, 2026-09-30).
 *
 * PRODUCTION PATH IS UNCHANGED: when HOME_FIXTURE is unset, this hook's
 * effect is the exact `supabase.rpc('get_season_result', ...)` call
 * SeasonCompleteCard used to make directly, same params, same parsing,
 * same "honest degrade on any error or non-'complete' status" discipline
 * (#77 merged, so this now runs on real leagues -- the honest-minimum
 * fallback below the RPC in the component's OWN render logic still
 * applies for a league whose season predates that migration).
 */
import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';
import { HOME_FIXTURE } from './devFixture';

export interface SeasonResultRow {
  status: string;
  reason: string | null;
  detail_scope: string | null;
  season_number: number | null;
  champion_display_name: string | null;
  runner_up_display_name: string | null;
  playoff_wins: number | null;
  playoff_losses: number | null;
  playoff_result: 'champion' | 'runner_up' | 'eliminated' | 'missed' | null;
  playoff_exit_round: number | null;
  best_week_number: number | null;
  best_week_gain: number | null;
}

/** The board's HomeComplete champion sample (docs/design/screens/
 * inventory.jsx): "1st of 6 · 11–3", "2–0 · won the Final", best week 11. */
function fixtureChampion(): SeasonResultRow {
  return {
    status: 'complete', reason: null, detail_scope: 'full', season_number: 1,
    champion_display_name: 'Roberto B.', runner_up_display_name: 'Gianluigi B.',
    playoff_wins: 2, playoff_losses: 0,
    playoff_result: 'champion', playoff_exit_round: null,
    best_week_number: 11, best_week_gain: 412.08,
  };
}

/** B6's non-champion capture (Design Lead, 2026-09-30): "2nd place" --
 * runner_up, not eliminated (2nd place means LOST the Final, a distinct
 * RPC status from being knocked out earlier -- playoffTileLine's
 * 'runner_up' case ignores exit_round entirely, since it's always the
 * Final by definition). */
function fixtureRunnerUp(): SeasonResultRow {
  return {
    status: 'complete', reason: null, detail_scope: 'full', season_number: 1,
    champion_display_name: 'Paolo M.', runner_up_display_name: 'Roberto B.',
    playoff_wins: 1, playoff_losses: 1,
    playoff_result: 'runner_up', playoff_exit_round: null,
    best_week_number: 11, best_week_gain: 412.08,
  };
}

export function useSeasonResult(leagueId: string): SeasonResultRow | null {
  const [result, setResult] = useState<SeasonResultRow | null>(null);

  useEffect(() => {
    if (HOME_FIXTURE === 'complete') {
      setResult(fixtureChampion());
      return;
    }
    if (HOME_FIXTURE === 'complete_runner_up') {
      setResult(fixtureRunnerUp());
      return;
    }

    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc('get_season_result', { p_league_id: leagueId });
      if (cancelled) return;
      // Honest degrade: an unmerged RPC (function does not exist), any
      // other error, or a non-'complete' status all fall through to the
      // caller's own minimum -- never a half-filled tile.
      if (error || !data) return;
      const row = (Array.isArray(data) ? data[0] : data) as SeasonResultRow | undefined;
      if (row && row.status === 'complete') setResult(row);
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  return result;
}
