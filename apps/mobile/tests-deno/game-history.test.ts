/**
 * League › History (3c, R10) and the Season 1 order. get_league_history gives one
 * row per season (its frozen final standings); the Season 1 order is the first
 * season's frozen rank, never a client sort. Run: `deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { historySeasons, season1Order, type HistoryRow } from '../lib/game/history.ts';

const ROWS: HistoryRow[] = [
  {
    league_id: 'l2', season_number: 2, is_current: true, draft_status: 'not_started', completed_at: null,
    champion_user_id: null, champion_display_name: null, my_rank: null, my_wins: null, my_losses: null, final_standings: null,
  },
  {
    league_id: 'l1', season_number: 1, is_current: false, draft_status: 'completed', completed_at: '2026-01-15T00:00:00Z',
    champion_user_id: 'roberto', champion_display_name: 'Roberto B.', my_rank: 5, my_wins: 4, my_losses: 10, final_standings: [
      { user_id: 'alessandro', rank: 3, wins: 8, losses: 6, ties: 0, points_for: 1203.55, points_against: 0, display_name: 'Alessandro D.' },
      { user_id: 'roberto', rank: 1, wins: 11, losses: 3, ties: 0, points_for: 1962.4, points_against: 0, display_name: 'Roberto B.' },
      { user_id: 'paolo', rank: 2, wins: 10, losses: 4, ties: 0, points_for: 1744.1, points_against: 0, display_name: 'Paolo M.' },
    ],
  },
];

Deno.test('the seasons read newest first, each with its champion and the caller\'s record', () => {
  const seasons = historySeasons(ROWS);
  assertEquals(seasons.map((s) => s.seasonNumber), [2, 1]);
  assertEquals(seasons[1].champion, 'Roberto B.');
  assertEquals(seasons[1].myRecord, '4–10');
  assertEquals(seasons[0].champion, null); // not finished: no champion is invented
});

Deno.test('Season 1 order is the frozen final-standings rank, never a client sort', () => {
  assertEquals(season1Order(ROWS), ['roberto', 'paolo', 'alessandro']);
});

Deno.test('with no finished season there is no Season 1 order, so the roster keeps the server\'s order', () => {
  assertEquals(season1Order([ROWS[0]]), []);
});
