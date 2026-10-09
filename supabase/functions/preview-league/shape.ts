// Pure response shaping for preview-league, extracted out of index.ts so the
// field whitelist is hermetically testable (no DB, no Deno.serve).
//
// The preview is served for ANY valid invite code to ANY signed-in caller, so
// what it returns is the whole disclosure surface: this builds the `league`
// object from an explicit pick list and never spreads the row. The row is
// `select('*')`, which means a column added to `leagues` later (an id, the
// commissioner's uuid, the invite code itself) is NOT returned unless it is
// added here on purpose.

import type { PreviewReason } from './reason.ts';

/** The leagues columns the preview reads (a subset of the `select('*')` row). */
export interface PreviewLeagueRow {
  name: string;
  league_type: string | null;
  num_participants: number;
  budget_mode: string | null;
  budget_amount: number | null;
  stake_mode: string | null;
  /** The per-slot simulated stake (leagues.notional_per_slot, NOT NULL default 1000). */
  notional_per_slot: number | null;
  duration_days: number | null;
  num_weeks: number | null;
  draft_date: string | null;
  draft_status: string;
}

export interface PreviewLeagueBody {
  found: true;
  joinable: boolean;
  reason: PreviewReason;
  league: {
    name: string;
    commissioner_name: string;
    league_type: string | null;
    num_participants: number;
    current_members: number;
    budget_mode: string | null;
    budget_amount: number | null;
    stake_mode: string | null;
    /** Added 2026-10 for the 1.2.0 Join screen's stakes line ("$2,000 per slot"). */
    notional_per_slot: number | null;
    duration_days: number | null;
    num_weeks: number | null;
    draft_date: string | null;
    draft_status: string;
  };
}

export function previewLeagueBody(
  league: PreviewLeagueRow,
  commissionerName: string | null | undefined,
  currentMembers: number,
  result: { joinable: boolean; reason: PreviewReason },
): PreviewLeagueBody {
  return {
    found: true,
    joinable: result.joinable,
    reason: result.reason,
    league: {
      name: league.name,
      commissioner_name: commissionerName ?? 'Unknown',
      league_type: league.league_type,
      num_participants: league.num_participants,
      current_members: currentMembers,
      budget_mode: league.budget_mode,
      budget_amount: league.budget_amount,
      stake_mode: league.stake_mode,
      notional_per_slot: league.notional_per_slot ?? null,
      duration_days: league.duration_days,
      num_weeks: league.num_weeks,
      draft_date: league.draft_date,
      draft_status: league.draft_status,
    },
  };
}
