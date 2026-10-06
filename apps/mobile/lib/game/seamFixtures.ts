/**
 * The capture seam's fixture responses (3c), pure. Each write returns exactly the
 * status shape the screen checks, so a capture walks the real success path without
 * writing anything. Reads return the board's own data (the Season 1 roster and the
 * draft board). A name with no fixture gives null, and the real call is not made.
 */
import { fixtureRoster } from './renewalFixture';

const SUCCESSOR = 'fixture-season-2';
const NOW = () => new Date().toISOString();

/** The board's Season 1 history (get_league_history rows, SQL shape). */
export function fixtureHistory() {
  return [
    {
      league_id: 'fixture-season-1', season_number: 1, is_current: false, draft_status: 'completed',
      completed_at: '2026-01-15T00:00:00Z', champion_user_id: 'roberto', champion_display_name: 'Roberto B.',
      my_rank: 1, my_wins: 11, my_losses: 3, my_ties: 0,
      final_standings: [
        { user_id: 'roberto', rank: 1, wins: 11, losses: 3, ties: 0, points_for: 1962.4, points_against: 0, display_name: 'Roberto B.' },
        { user_id: 'paolo', rank: 2, wins: 10, losses: 4, ties: 0, points_for: 1744.1, points_against: 0, display_name: 'Paolo M.' },
        { user_id: 'alessandro', rank: 3, wins: 8, losses: 6, ties: 0, points_for: 1203.55, points_against: 0, display_name: 'Alessandro D.' },
        { user_id: 'francesco', rank: 4, wins: 6, losses: 8, ties: 0, points_for: 612.8, points_against: 0, display_name: 'Francesco T.' },
        { user_id: 'gianluigi', rank: 5, wins: 4, losses: 10, ties: 0, points_for: -148.25, points_against: 0, display_name: 'Gianluigi B.' },
        { user_id: 'andrea', rank: 6, wins: 3, losses: 11, ties: 0, points_for: -402.9, points_against: 0, display_name: 'Andrea P.' },
      ],
    },
    {
      league_id: SUCCESSOR, season_number: 2, is_current: true, draft_status: 'not_started', completed_at: null,
      champion_user_id: null, champion_display_name: null, my_rank: null, my_wins: null, my_losses: null,
      my_ties: null, final_standings: null,
    },
  ];
}

/** The draft board's clock and order (the board's Serie A / Stock Scudetto draft). */
function fixtureDraftRoom() {
  const order = ['paolo', 'roberto', 'alessandro', 'francesco', 'gianluigi', 'andrea'];
  return {
    clock: [{ league_id: 'fixture-draft', draft_status: 'in_progress', clock_running: true, pick_seconds: 60, picks_made: 10, turn_started_at: NOW(), deadline_at: new Date(Date.now() + 42_000).toISOString(), server_now: NOW() }],
    order: { ok: true, mode: 'random', state: 'finalized', order: order.map((user_id, i) => ({ position: i + 1, user_id })) },
    names: [
      { user_id: 'paolo', display_name: 'Paolo M.', is_bot: false },
      { user_id: 'roberto', display_name: 'Roberto B.', is_bot: false },
      { user_id: 'alessandro', display_name: 'Alessandro D.', is_bot: false },
      { user_id: 'francesco', display_name: 'Francesco T.', is_bot: false },
      { user_id: 'gianluigi', display_name: 'Gianluigi B.', is_bot: false },
      { user_id: 'andrea', display_name: 'Andrea P.', is_bot: false },
    ],
  };
}

/** The fixture for a call, or null when there is none (the real call is then NOT made). */
export function fixtureFor(name: string, args: Record<string, unknown>): { data: unknown; error: null } | null {
  switch (name) {
    // ---- Run it back: writes ----
    case 'renew_league': return { data: { status: 'renewed', league_id: SUCCESSOR, invite_code: 'SCUD26', invited: 4 }, error: null };
    case 'respond_to_renewal': return { data: { status: 'replied', response: args.p_response, in: 4, out: 1, pending: 1 }, error: null };
    case 'nudge_renewal': return { data: { status: 'nudged', nudge_count: 2 }, error: null };
    case 'remove_renewal_invitee': return { data: { status: 'removed' }, error: null };
    case 'start_renewed_season': {
      const settings = (args.p_settings ?? {}) as Record<string, unknown>;
      return { data: { status: 'season_set', draft_date: settings.draft_date ?? null }, error: null };
    }
    case 'set_draft_queue': return { data: { ok: true, symbols: args.p_symbols ?? [] }, error: null };
    // ---- Run it back: reads ----
    case 'get_renewal_roster': return { data: fixtureRoster('commissioner', new Date()), error: null };
    case 'get_league_history': return { data: fixtureHistory(), error: null };
    // ---- the draft room: reads ----
    case 'get_draft_clock': return { data: fixtureDraftRoom().clock, error: null };
    case 'get_draft_order': return { data: fixtureDraftRoom().order, error: null };
    case 'get_league_display_names': return { data: fixtureDraftRoom().names, error: null };
    default: return null;
  }
}

/** The fixture for a function invocation (validate-and-record-pick, draft-control), or null. */
export function invokeFixtureFor(fn: string, body: Record<string, unknown>): { data: unknown; error: null } | null {
  if (fn === 'validate-and-record-pick') {
    const pick = body.action === 'auto_pick' ? { pick_source: 'auto_best' } : { pick_source: 'manual' };
    return { data: { ok: true, pick: { symbol: body.symbol ?? 'NVDA', ...pick }, pick_source: pick.pick_source, draft_complete: false }, error: null };
  }
  if (fn === 'draft-control') {
    if (body.action === 'start') return { data: { ok: true }, error: null };
    return { data: { ok: true, can_start: true, blockers: [], is_commissioner: true, member_count: 6, min_members: 4 }, error: null };
  }
  return null;
}
