/**
 * The capture seam's TABLE fixtures (3c), pure. Each game read from a table has a
 * fixture here, shaped as the query returns it. They return null when the seam is off,
 * so the real query stands. Derived from the board's sample league (Stock Scudetto,
 * week 6) so a capture shows the board's own numbers.
 */
export type SeamTableName = 'drafts' | 'draft_queue' | 'matchups_week' | 'matchups_week_one' | 'matchups_playoff' | 'week_snapshots' | 'trades';

const WEEK = 6;
const WEEK_START = '2026-09-28T13:30:00Z';
const WEEK_END = '2026-10-02T20:00:00Z';

// The board's live holdings (quantity, Monday open) for each side of the week-6 games.
const HOLDINGS: Record<string, { symbol: string; quantity: number; start: number; end: number }[]> = {
  roberto: [
    { symbol: 'NVDA', quantity: 6.8942, start: 300.2, end: 318.37 },
    { symbol: 'AAPL', quantity: 10.0705, start: 205.1, end: 211.42 },
  ],
  gianluigi: [
    { symbol: 'AMZN', quantity: 9.0375, start: 238.1, end: 236.4 },
    { symbol: 'JPM', quantity: 9.7609, start: 214.2, end: 215.45 },
  ],
  paolo: [{ symbol: 'MSFT', quantity: 4.2, start: 410.0, end: 421.0 }],
  alessandro: [{ symbol: 'META', quantity: 3.1, start: 512.0, end: 508.0 }],
  francesco: [{ symbol: 'AVGO', quantity: 5.5, start: 180.0, end: 184.5 }],
  andrea: [{ symbol: 'GOOGL', quantity: 2.2, start: 170.0, end: 166.0 }],
};

function snapshotRows() {
  return Object.entries(HOLDINGS).flatMap(([user, rows]) =>
    rows.map((h) => ({ user_id: user, symbol: h.symbol, quantity: h.quantity, week_start_price: h.start, week_end_price: null, entered_mid_week: false, created_at: WEEK_START })),
  );
}

function weekMatchups() {
  return [
    { team1_user_id: 'roberto', team2_user_id: 'gianluigi', team1_gain: null, team2_gain: null, winner_user_id: null, is_tie: false, is_playoff: false, week_start: WEEK_START, week_end: WEEK_END, week_number: WEEK },
    { team1_user_id: 'paolo', team2_user_id: 'alessandro', team1_gain: null, team2_gain: null, winner_user_id: null, is_tie: false, is_playoff: false, week_start: WEEK_START, week_end: WEEK_END, week_number: WEEK },
    { team1_user_id: 'francesco', team2_user_id: 'andrea', team1_gain: null, team2_gain: null, winner_user_id: null, is_tie: false, is_playoff: false, week_start: WEEK_START, week_end: WEEK_END, week_number: WEEK },
  ];
}

/** The board's 4-team bracket: round 1 played (the board's scores), round 2 to be decided. */
function playoffMatchups() {
  return [
    { playoff_round_number: 1, bracket_position: 0, team1_user_id: 'roberto', team2_user_id: 'francesco', team1_gain: 288.1, team2_gain: 96.42, winner_user_id: 'roberto' },
    { playoff_round_number: 1, bracket_position: 1, team1_user_id: 'paolo', team2_user_id: 'alessandro', team1_gain: -41.3, team2_gain: 120.55, winner_user_id: 'alessandro' },
    { playoff_round_number: 2, bracket_position: 0, team1_user_id: 'roberto', team2_user_id: 'alessandro', team1_gain: null, team2_gain: null, winner_user_id: null },
  ];
}

/** The fixture rows for a table read, or null when the seam is off (the real query stands). */
export function seamTableRows(on: boolean, table: SeamTableName): unknown[] | null {
  if (!on) return null;
  switch (table) {
    case 'drafts':
      // The board's first picks (Paolo 1, Roberto 2 …); pick 4 is a legacy SKIP row from an old test league.
      return [
        { pick_number: 1, symbol: 'MSFT', pick_source: 'manual' },
        { pick_number: 2, symbol: 'NVDA', pick_source: 'manual' },
        { pick_number: 3, symbol: 'META', pick_source: 'manual' },
        { pick_number: 4, symbol: 'SKIP', pick_source: 'skip' },
        { pick_number: 5, symbol: 'AMZN', pick_source: 'manual' },
        { pick_number: 6, symbol: 'GOOGL', pick_source: 'manual' },
        { pick_number: 7, symbol: 'COIN', pick_source: 'manual' },
        { pick_number: 8, symbol: 'JPM', pick_source: 'manual' },
        { pick_number: 9, symbol: 'AMD', pick_source: 'manual' },
        { pick_number: 10, symbol: 'PLTR', pick_source: 'auto_queue' },
      ];
    case 'draft_queue':
      return [
        { symbol: 'AAPL', position: 1 },
        { symbol: 'CRM', position: 2 },
        { symbol: 'V', position: 3 },
      ];
    case 'matchups_week': return weekMatchups();
    // The draft's ending (U-10): Week 1 as finalize writes it (nominal Tuesday 14:30Z;
    // the room resolves it to Monday's open through the market calendar).
    case 'matchups_week_one': return [
      { team1_user_id: 'roberto', team2_user_id: 'gianluigi', week_start: '2026-10-06T14:30:00.000Z' },
    ];
    case 'matchups_playoff': return playoffMatchups();
    case 'week_snapshots': return snapshotRows();
    case 'trades': return [];
  }
}
