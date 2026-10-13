/**
 * GS-4 / GS-8 on the screens: League › Standings, League › History and the season-complete
 * card all take a finished season's order from lib/game/finalStandings.ts, so they tell
 * one story (Giorgio, option A, 2026-10-10). Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { buildStandingsRows, standingsView } from '../lib/game/standings.ts';
import { historySeasons, historyStandings, type HistoryRow } from '../lib/game/history.ts';
import { COPY } from '../lib/game/gameCopy.ts';
import { fixtureHistory, fixtureSeasonPlayoffs } from '../lib/game/seamFixtures.ts';
import { SOURCES } from './sourceManifest.generated.ts';

// The fixture's Summer Cup: Paolo tops the regular season, you win the Final over him.
const standings = [
  { user_id: 'paolo', rank: 1, wins: 6, losses: 0, ties: 0, points_for: 900, display_name: 'Paolo M.', is_bot: false },
  { user_id: 'me', rank: 2, wins: 5, losses: 1, ties: 0, points_for: 800, display_name: 'Roberto B.', is_bot: false },
  { user_id: 'luca', rank: 3, wins: 4, losses: 2, ties: 0, points_for: 700, display_name: 'Luca V.', is_bot: false },
  { user_id: 'chiara', rank: 4, wins: 2, losses: 4, ties: 0, points_for: 100, display_name: 'Chiara R.', is_bot: false },
  { user_id: 'marco', rank: 5, wins: 2, losses: 4, ties: 0, points_for: -50, display_name: 'Marco T.', is_bot: false },
  { user_id: 'gianluigi', rank: 6, wins: 1, losses: 5, ties: 0, points_for: -300, display_name: 'Gianluigi B.', is_bot: false },
];
const g = (round: number, t1: string, t2: string, winner: string) => ({ playoff_round_number: round, team1_user_id: t1, team2_user_id: t2, winner_user_id: winner });
const bracket = [g(1, 'luca', 'gianluigi', 'luca'), g(1, 'chiara', 'marco', 'chiara'), g(2, 'paolo', 'chiara', 'paolo'), g(2, 'me', 'luca', 'me'), g(3, 'me', 'paolo', 'me')];
const rows = buildStandingsRows(standings, 'me', new Map([['paolo', 2], ['me', 1]]));

Deno.test('Standings, season complete: the podium on top, ranks become places, records and gains unchanged, no movement', () => {
  const v = standingsView({ rows, completed: true, playoffTeams: 6, bracketStatus: 'ready', playoffRows: bracket });
  assertEquals(v.kind, 'final');
  if (v.kind !== 'final') return;
  assertEquals(v.rows.map((r) => r.userId), ['me', 'paolo', 'luca', 'chiara', 'marco', 'gianluigi']);
  assertEquals(v.rows.map((r) => r.rank), [1, 2, 3, 4, 5, 6]);
  assertEquals(v.rows.map((r) => r.tag), ['Champion', 'Runner-up', null, null, null, null]);
  assertEquals(v.rows[1].record, '6–0'); // Paolo's regular-season record stays
  assertEquals(v.rows[0].seasonGain, 800);
  assert(v.rows.every((r) => r.move === null));
});

Deno.test('Standings: in season unchanged; never the regular-season medals while the bracket loads or fails', () => {
  assertEquals(standingsView({ rows, completed: false, playoffTeams: 6, bracketStatus: 'idle', playoffRows: [] }), { kind: 'regular', rows, medals: false });
  assertEquals(standingsView({ rows, completed: true, playoffTeams: 6, bracketStatus: 'loading', playoffRows: [] }).kind, 'loading');
  assertEquals(standingsView({ rows, completed: true, playoffTeams: 6, bracketStatus: 'error', playoffRows: [] }), { kind: 'regular', rows, medals: false });
  // Read, but the Final isn't there: no medals.
  assertEquals(standingsView({ rows, completed: true, playoffTeams: 6, bracketStatus: 'ready', playoffRows: bracket.slice(0, 4) }), { kind: 'regular', rows, medals: false });
  // No playoffs at all: the regular season decided it, so its order takes the medals.
  assertEquals(standingsView({ rows, completed: true, playoffTeams: null, bracketStatus: 'idle', playoffRows: [] }), { kind: 'regular', rows, medals: true });
});

Deno.test('History: the fixture\'s Season 1 follows its playoffs (Alessandro, 3rd seed, is runner-up; Paolo bronze)', () => {
  const season = historySeasons(fixtureHistory() as HistoryRow[]).find((s) => s.seasonNumber === 1)!;
  const t = historyStandings(season, fixtureSeasonPlayoffs());
  assertEquals(t.medals, true);
  assertEquals(t.places.map((p) => p.standing.display_name), ['Roberto B.', 'Alessandro D.', 'Paolo M.', 'Francesco T.', 'Gianluigi B.', 'Andrea P.']);
  assertEquals(t.places.map((p) => p.tag), ['Champion', 'Runner-up', null, null, null, null]);
});

Deno.test('History: no playoff rows, or a Final the server\'s champion did not win, shows the frozen order with no medals', () => {
  const season = historySeasons(fixtureHistory() as HistoryRow[]).find((s) => s.seasonNumber === 1)!;
  const none = historyStandings(season, null);
  assertEquals(none.medals, false);
  assertEquals(none.places.map((p) => p.place), [1, 2, 3, 4, 5, 6]);
  const wrongChamp = historyStandings({ ...season, championId: 'paolo' }, fixtureSeasonPlayoffs());
  assertEquals(wrongChamp.medals, false);
  const unfinished = historySeasons(fixtureHistory() as HistoryRow[]).find((s) => s.seasonNumber === 2)!;
  assertEquals(historyStandings(unfinished, fixtureSeasonPlayoffs()), { places: [], medals: false });
});

Deno.test('the board\'s #call-medals copy, verbatim', () => {
  assertEquals(COPY.finalStandingsTitle, 'Final standings');
  assertEquals(COPY.finalStandingsSubtitle, 'After the playoffs');
  assertEquals(COPY.champion, 'Champion');
  assertEquals(COPY.runnerUp, 'Runner-up');
  assertEquals(
    COPY.finalStandingsCaption,
    'The playoffs decide the top three: the champion, the runner-up, then the higher seed of the two semifinal losers. Everyone else keeps their regular-season place. Records and gains are the regular season’s.',
  );
});

Deno.test('the three screens read the one order (source guards)', () => {
  const league = SOURCES['app/(tabs)/league.tsx'];
  assert(league.includes('const standings = standingsView({'));
  assert(league.includes("header={{ title: GAME_COPY.finalStandingsTitle, subtitle: GAME_COPY.finalStandingsSubtitle }}"));
  assert(league.includes('caption={GAME_COPY.finalStandingsCaption}'));
  assert(league.includes("segment === 'playoffs' || (completed && segment === 'standings'),"));
  assert(league.includes('playoffs={seasonPlayoffs.status === \'ready\' ? seasonPlayoffs.byLeague : null}'));
  const history = SOURCES['components/game/HistoryList.tsx'];
  assert(history.includes('historyStandings(s, playoffs?.get(s.leagueId) ?? null)'));
  // W4: History's rows are the one ManagerRow, its medal disc in the rank cell (MedalDisc).
  assert(history.includes('medal={table.medals}'));
  assert(SOURCES['components/sp/gn/ManagerRow.tsx'].includes('<MedalDisc place={rank} size={disc} />'));
  const card = SOURCES['components/home/SeasonCompleteCard.tsx'];
  assert(card.includes('const finalPlace = seasonCompletePlace({'));
  assert(!card.includes('placeLabel(finalRank)'), 'the headline no longer reads the regular-season rank');
  // The "Champion"/"Runner-up" sub-labels are the tags the lib sets (finalStandingsOrder).
  assert(SOURCES['lib/game/finalStandings.ts'].includes("tag: i === 0 ? 'Champion' : i === 1 ? 'Runner-up' : null,"));
});

Deno.test('GS-8b: History labels the playoff order the way Standings does (source guard)', () => {
  const history = SOURCES['components/game/HistoryList.tsx'];
  // The same subtitle key as Standings' header, shown only when the playoffs ordered the season.
  // (W4: inside each season's SeasonBlock, which takes the season's table as `table`.)
  assert(history.includes('{table.medals ? <Text variant="caption" tone="secondary">{GAME_COPY.finalStandingsSubtitle}</Text> : null}'));
  // The podium tags under the name (ManagerRow's `tag`), in both the one-line and the stacked layout.
  assert(history.includes('tag={tag}'));
  const row = SOURCES['components/sp/gn/ManagerRow.tsx'];
  assert(row.includes('{tag ? <Text variant="caption" tone="secondary">{tag}</Text> : null}'));
  assert(row.includes('{tag ? <Text variant="caption" tone="secondary" maxFontSizeMultiplier={textCap}>{tag}</Text> : null}'));
  // No new copy: History's only strings for this are Standings' keys and the lib's tags.
  assert(!history.includes("'After the playoffs'") && !history.includes('"After the playoffs"'));
  assert(SOURCES['components/game/StandingsTable.tsx'].includes("tag={r.tag ?? (r.isBot ? 'Bot' : null)}"));
});
