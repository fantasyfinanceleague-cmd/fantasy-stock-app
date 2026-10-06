// Hermetic unit tests for previewLeagueBody (see ./shape.ts). No DB, no
// secrets, no --allow-* flags. Run from repo root:
//   deno test supabase/functions/preview-league/shape.test.ts

import { assertEquals } from 'jsr:@std/assert';
import { previewLeagueBody, type PreviewLeagueRow } from './shape.ts';

// A realistic `select('*')` row: the extra columns are the ones the preview
// must NEVER echo (identity, the invite capability itself, internals).
const ROW = {
  id: '11111111-1111-1111-1111-111111111111',
  commissioner_id: '22222222-2222-2222-2222-222222222222',
  invite_code: 'SERIEA7',
  salary_cap_limit: 100000,
  season_status: 'active',
  name: 'Serie A Traders',
  league_type: 'matchup',
  num_participants: 8,
  budget_mode: 'no-budget',
  budget_amount: null,
  stake_mode: 'fixed_notional',
  notional_per_slot: 2000,
  duration_days: null,
  num_weeks: 10,
  draft_date: '2026-10-03T23:00:00Z',
  draft_status: 'not_started',
};

const OK = { joinable: true, reason: null } as const;

Deno.test('returns the per-slot stake for the Join screen stakes line', () => {
  const body = previewLeagueBody(ROW as PreviewLeagueRow, 'Roberto B.', 6, OK);
  assertEquals(body.league.notional_per_slot, 2000);
  assertEquals(body.league.stake_mode, 'fixed_notional');
});

Deno.test('exact league key set: no id / commissioner_id / invite_code / internals', () => {
  const body = previewLeagueBody(ROW as PreviewLeagueRow, 'Roberto B.', 6, OK);
  assertEquals(Object.keys(body.league).sort(), [
    'budget_amount',
    'budget_mode',
    'commissioner_name',
    'current_members',
    'draft_date',
    'draft_status',
    'duration_days',
    'league_type',
    'name',
    'notional_per_slot',
    'num_participants',
    'num_weeks',
    'stake_mode',
  ]);
  const serialised = JSON.stringify(body);
  for (const secret of [ROW.id, ROW.commissioner_id, ROW.invite_code]) {
    assertEquals(serialised.includes(secret), false);
  }
});

Deno.test('top-level shape carries found/joinable/reason through unchanged', () => {
  const body = previewLeagueBody(ROW as PreviewLeagueRow, 'Roberto B.', 8, { joinable: false, reason: 'league_full' });
  assertEquals(body.found, true);
  assertEquals(body.joinable, false);
  assertEquals(body.reason, 'league_full');
  assertEquals(body.league.current_members, 8);
});

Deno.test('a missing commissioner profile reads Unknown; a missing per-slot value is null, not undefined', () => {
  const row = { ...ROW, notional_per_slot: undefined } as unknown as PreviewLeagueRow;
  const body = previewLeagueBody(row, undefined, 0, OK);
  assertEquals(body.league.commissioner_name, 'Unknown');
  assertEquals(body.league.notional_per_slot, null);
  // JSON must carry the key (undefined would be dropped silently).
  assertEquals('notional_per_slot' in JSON.parse(JSON.stringify(body)).league, true);
});
