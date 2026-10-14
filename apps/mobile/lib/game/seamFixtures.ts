/**
 * The capture seam's fixture responses (3c), pure. Each write returns exactly the
 * status shape the screen checks, so a capture walks the real success path without
 * writing anything. Reads return the board's own data (the Season 1 roster and the
 * draft board). A name with no fixture gives null, and the real call is not made.
 */
import { STRESS_SEATS, draftRoomClock, draftRoomClockRead, type DraftRoomVariant } from './seamRoom';
import { SEAM_ME, seamLivePrices, seamPreviousRanks } from './seamTables';
import { draftStartStatusFixture, fixtureOrderSet, fixtureStartsAtMs, parseDraftStartFixture } from './autoStartFixture';
import { fixtureRoster } from './renewalFixture';

const SUCCESSOR = 'fixture-season-2';
const NOW = () => new Date().toISOString();

/** The board's Season 1 history (get_league_history rows, SQL shape). */
export function fixtureHistory() {
  return [
    {
      league_id: 'fixture-season-1', season_number: 1, is_current: false, draft_status: 'completed',
      completed_at: '2026-01-15T00:00:00Z', champion_user_id: SEAM_ME, champion_display_name: 'Roberto B.',
      my_rank: 1, my_wins: 11, my_losses: 3, my_ties: 0,
      final_standings: [
        { user_id: SEAM_ME, rank: 1, wins: 11, losses: 3, ties: 0, points_for: 1962.4, points_against: 0, display_name: 'Roberto B.' },
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

/** Season 1's playoff games (get_season_matchups rows, SQL shape; the playoff rows only:
 * History reads nothing else from it). 6 teams, seeds 1–2 bye. Wild card: Alessandro (3)
 * beats Andrea (6), Francesco (4) beats Gianluigi (5). Semifinals: you (1) beat Francesco,
 * Alessandro beats Paolo (2). Final: you beat Alessandro. So History's final standings
 * read you (Champion), Alessandro (Runner-up), Paolo (the better-seeded semifinal loser),
 * then Francesco, Gianluigi, Andrea: GS-8's reorder is visible. */
export function fixtureSeasonPlayoffs() {
  const game = (round: number, position: number, t1: string, t2: string, winner: string) => ({
    league_id: 'fixture-season-1', season_number: 1, is_playoff: true, playoff_round_number: round, bracket_position: position,
    team1_user_id: t1, team2_user_id: t2, winner_user_id: winner,
  });
  return [
    game(1, 0, 'alessandro', 'andrea', 'alessandro'),
    game(1, 1, 'francesco', 'gianluigi', 'francesco'),
    game(2, 0, SEAM_ME, 'francesco', SEAM_ME),
    game(2, 1, 'paolo', 'alessandro', 'alessandro'),
    game(3, 0, SEAM_ME, 'alessandro', SEAM_ME),
  ];
}

/** The draft order as get_draft_order returns it. With EXPO_PUBLIC_DRAFT_START_FIXTURE set
 * (the lobby's captures) it agrees with that start state: set only once the room is open, with
 * finalize_at = the draft time − 1h; before that it's open and unrevealed ("Draft order ·
 * waiting"). Without it (the room's captures) the order is set, as it is in a running draft. */
export function fixtureDraftOrder(userIds: readonly string[], draftStartFixture?: string | null, nowMs = Date.now()) {
  const start = parseDraftStartFixture(draftStartFixture);
  const set = start ? fixtureOrderSet(start.state) : true;
  const startsAt = start ? fixtureStartsAtMs(start.state, nowMs) : null;
  return {
    ok: true,
    mode: 'random',
    state: set ? 'finalized' : 'open',
    revealed: set,
    finalized: set,
    order: set ? userIds.map((user_id, i) => ({ position: i + 1, user_id })) : null,
    draft_date: startsAt !== null ? new Date(startsAt).toISOString() : null,
    finalize_at: startsAt !== null ? new Date(startsAt - 60 * 60 * 1000).toISOString() : null,
    member_count: userIds.length,
    min_members: 4,
    waiting_for_members: userIds.length < 4,
    server_now: new Date(nowMs).toISOString(),
  };
}

/** The draft board's clock, order and names (the board's Serie A / Stock Scudetto draft; 16
 * seats in the stress fixture). */
function fixtureDraftRoom(roomVariant: DraftRoomVariant = 'on_clock', draftStartFixture?: string | null) {
  const seats = roomVariant === 'stress'
    ? STRESS_SEATS.map((s) => ({ id: s.id === '__me__' ? SEAM_ME : s.id, name: s.name }))
    : [
      { id: 'paolo', name: 'Paolo M.' },
      { id: SEAM_ME, name: 'Roberto B.' },
      { id: 'alessandro', name: 'Alessandro D.' },
      { id: 'francesco', name: 'Francesco T.' },
      { id: 'gianluigi', name: 'Gianluigi B.' },
      { id: 'andrea', name: 'Andrea P.' },
    ];
  return {
    clock: [draftRoomClock(roomVariant, Date.now())],
    order: fixtureDraftOrder(seats.map((s) => s.id), draftStartFixture),
    names: seats.map((s) => ({ user_id: s.id, display_name: s.name, is_bot: false })),
  };
}

/** The fixture for a call, or null when there is none (the real call is then NOT made). */
export function fixtureFor(name: string, args: Record<string, unknown>, roomVariant: DraftRoomVariant = 'on_clock', draftStartFixture?: string | null): { data: unknown; error: null } | null {
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
    case 'get_season_matchups': return { data: fixtureSeasonPlayoffs(), error: null };
    // The through-week ranking (the League tab's movement): last week's order.
    case 'league_standings_ranked': return typeof args.p_through_week === 'number' ? { data: seamPreviousRanks(), error: null } : null;
    // ---- the draft room: reads ----
    case 'get_draft_clock':
      // 'failed': the read errors (the room's "Couldn't load" card). 'loading' is seamCalls' (a read that never answers).
      if (draftRoomClockRead(roomVariant) === 'error') return { data: null, error: { message: 'fixture: the clock read failed' } } as unknown as { data: unknown; error: null };
      return { data: fixtureDraftRoom(roomVariant).clock, error: null };
    case 'get_draft_order': return { data: fixtureDraftRoom(roomVariant, draftStartFixture).order, error: null };
    case 'get_league_display_names': return { data: fixtureDraftRoom(roomVariant).names, error: null };
    default: return null;
  }
}

/** leave-league's client response (logic.ts clientResponse's shape) for a capture. */
export function leaveLeagueFixture(body: Record<string, unknown>, fixture?: string | null): Record<string, unknown> {
  const [what, window] = String(fixture ?? '').split(':');
  if (what === 'left') return { ok: true, status: 'left', reconfirm_required: true };
  if (what === 'hidden') return { ok: true, status: 'hidden' };
  if (what === 'transferred') return { ok: true, status: 'transferred', reconfirm_owed: false };
  if (what) return window ? { ok: false, reason: what, window } : { ok: false, reason: what };
  return body.action === 'transfer' ? { ok: true, status: 'transferred', reconfirm_owed: false } : { ok: true, status: 'left', reconfirm_required: true };
}

/** symbols-search for a capture: the board's sample stocks whose ticker or name starts
 * with the query (case-insensitive), with prices; up to `limit`. */
const SEARCH_SAMPLE = [
  { symbol: 'AAPL', name: 'Apple Inc.', price: 211.42 },
  { symbol: 'AMD', name: 'Advanced Micro Devices', price: 160.0 },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', price: 236.4 },
  { symbol: 'AVGO', name: 'Broadcom Inc.', price: 184.5 },
  { symbol: 'ADBE', name: 'Adobe Inc.', price: 512.3 },
  { symbol: 'ABNB', name: 'Airbnb Inc.', price: 133.8 },
  { symbol: 'CRM', name: 'Salesforce Inc.', price: 274.1 },
  // W4 Portfolio's sell-from-search capture: your own NVDA (the Home fixture's live price).
  { symbol: 'NVDA', name: 'NVIDIA Corp.', price: 318.37 },
  { symbol: 'COST', name: 'Costco Wholesale', price: 912.3 },
  { symbol: 'V', name: 'Visa Inc.', price: 291.4 },
  // W4 Portfolio: a stock outside the league's list (an ETF), for the dimmed search row.
  { symbol: 'SPY', name: 'SPDR S&P 500 ETF Trust', price: 571.2, is_draftable: false },
];
/** A search sample's company name, for a sheet opened without one under the seam. */
export function seamSearchName(symbol: string): string | null {
  return SEARCH_SAMPLE.find((s) => s.symbol === symbol.toUpperCase())?.name ?? null;
}

/** A search sample's price, for the stock sheet under the seam (a stock nobody holds). */
export function seamSearchPrice(symbol: string): number | null {
  return SEARCH_SAMPLE.find((s) => s.symbol === symbol.toUpperCase())?.price ?? null;
}

export function symbolsSearchFixture(body: Record<string, unknown>): { items: { symbol: string; name: string; price: number; is_draftable: boolean }[] } {
  const q = String(body.q ?? '').trim().toUpperCase();
  const limit = typeof body.limit === 'number' ? body.limit : 8;
  const items = SEARCH_SAMPLE
    .filter((s) => q !== '' && (s.symbol.startsWith(q) || s.name.toUpperCase().startsWith(q)))
    .slice(0, limit)
    .map((s) => ({ symbol: s.symbol, name: s.name, price: s.price, is_draftable: (s as { is_draftable?: boolean }).is_draftable !== false }));
  return { items };
}

/** The fixture for a function invocation (validate-and-record-pick, draft-control), or null. */
export function invokeFixtureFor(
  fn: string,
  body: Record<string, unknown>,
  /** EXPO_PUBLIC_DRAFT_START_FIXTURE (e.g. "at_risk", "postponed:member"): draft-control status for that start_state. */
  draftStartFixture?: string | null,
  /** EXPO_PUBLIC_LEAVE_FIXTURE: a leave-league outcome ("left", "hidden", "transferred") or a refusal
   * reason, with an optional window ("locked_in:season"). Unset: leave → left, transfer → transferred. */
  leaveFixture?: string | null,
): { data: unknown; error: null } | null {
  if (fn === 'leave-league') return { data: leaveLeagueFixture(body, leaveFixture), error: null };
  if (fn === 'symbols-search') return { data: symbolsSearchFixture(body), error: null };
  if (fn === 'validate-and-record-pick') {
    const pick = body.action === 'auto_pick' ? { pick_source: 'auto_best' } : { pick_source: 'manual' };
    return { data: { ok: true, pick: { symbol: body.symbol ?? 'NVDA', ...pick }, pick_source: pick.pick_source, draft_complete: false }, error: null };
  }
  if (fn === 'quote') {
    // The board's live prices for the symbols asked for (a fixed sample; never a live quote).
    // The week-6 holdings' live prices (seamTables: the Home fixture's Thursday prices for your
    // and Gianluigi's teams) win over the draft sample's, so All matchups matches Matchup.
    const prices: Record<string, number> = { NVDA: 318.37, AAPL: 211.42, AMZN: 236.4, JPM: 215.45, MSFT: 421.0, META: 508.0, AVGO: 184.5, GOOGL: 166.0, PLTR: 65.0, V: 291.4, CRM: 274.1, COIN: 210.0, AMD: 160.0, ...seamLivePrices() };
    const symbols = Array.isArray(body.symbols) ? (body.symbols as string[]) : [];
    return { data: { prices: Object.fromEntries(symbols.filter((s) => s in prices).map((s) => [s, prices[s]])) }, error: null };
  }
  if (fn === 'draft-control') {
    if (body.action === 'start') return { data: { ok: true }, error: null };
    if (body.action === 'confirm_roster') return { data: { ok: true, members: 7, playoff_teams: body.playoff_teams ?? 6 }, error: null };
    const picked = parseDraftStartFixture(draftStartFixture);
    if (picked) return { data: draftStartStatusFixture(picked.state, picked.member, Date.now()), error: null };
    return { data: { ok: true, can_start: true, blockers: [], is_commissioner: true, member_count: 6, min_members: 4 }, error: null };
  }
  return null;
}

