/**
 * W4 League on Game Night (DESIGN_DIRECTION §9C; the board's "League › Standings in full";
 * docs/design/reviews/w4-gate-checklist.md). The pure decisions (lib/game/leagueView.ts,
 * lib/game/leagueFixture.ts) and the source guards that keep the screens on them.
 * Run: `cd apps/mobile/tests-deno && deno test --allow-read --allow-env --allow-sys --allow-run .`
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import {
  BRACKET_LOAD_FAILED, HISTORY_LOAD_FAILED, NAME_ROOM_MIN, advancesLine, bracketChampion, bracketRounds, championLine, figureWidth,
  leagueThroughWeek, managerListStacks, nameRoom, segmentTabsScroll, stackedRowTextCap, standingsColumnLabel,
} from '../lib/game/leagueView.ts';
import { leagueFixturePreviousRanks, leagueFixtureStandings, parseLeagueFixture } from '../lib/game/leagueFixture.ts';
import { buildBracket, type BracketRow } from '../lib/game/bracket.ts';
import { standingsThroughWeek } from '../lib/home/homeCopy.ts';
import { formatMoney } from '../components/sp/logic/money.ts';
import { SOURCES } from './sourceManifest.generated.ts';

const code = (src: string) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

// ── "Through Week N" agrees with Home ─────────────────────────────────────────────

Deno.test('League\'s "Through Week N" is the last completed week, the way Home counts it', () => {
  assertEquals(leagueThroughWeek({ phase: 'regular', week: 6, numWeeks: 14 }), 5);
  assertEquals(leagueThroughWeek({ phase: 'regular', week: 1, numWeeks: 14 }), 0);
  assertEquals(leagueThroughWeek({ phase: 'pre_season', week: 1, numWeeks: 14 }), 0);
  assertEquals(leagueThroughWeek({ phase: 'playoffs', week: 15, numWeeks: 14 }), 14);
  assertEquals(leagueThroughWeek({ phase: 'completed', week: 16, numWeeks: 14 }), 14);
  // A playoff week number past the season never reads "Through Week 15".
  assertEquals(leagueThroughWeek({ phase: 'regular', week: 15, numWeeks: 14 }), 14);
  // Home's own function on the same facts.
  assertEquals(standingsThroughWeek({ kind: 'live_open', week: 6, numWeeks: 14 } as never), 5);
});

Deno.test('the column head hides "Through Week 0" (no label that names nothing)', () => {
  assertEquals(standingsColumnLabel(0), null);
  assertEquals(standingsColumnLabel(5), 'Through Week 5');
});

// ── The manager list's one shape ─────────────────────────────────────────────────

const normal = [{ record: '5–1', gainText: '+$614.88' }, { record: '4–2', gainText: '−$402.90' }];
const million = [{ record: '6–0', gainText: '+$1,532,118.40' }, { record: '3–3', gainText: '−$1,234,567.80' }];

Deno.test('a list stacks at the large sizes, or when a ≥ $1M gain leaves the name no room', () => {
  // 17e: 390 − 2 × 20 gutter.
  assertEquals(managerListStacks({ rowWidth: 350, fontScale: 1, move: true, rows: normal }), false);
  assert(nameRoom({ rowWidth: 350, fontScale: 1, move: true, rows: normal }) >= NAME_ROOM_MIN);
  assertEquals(managerListStacks({ rowWidth: 350, fontScale: 1, move: true, rows: million }), true);
  assertEquals(managerListStacks({ rowWidth: 350, fontScale: 1.35, move: true, rows: normal }), true); // xxxLarge
  assertEquals(managerListStacks({ rowWidth: 350, fontScale: 2.35, move: false, rows: normal }), true); // XL
  // Final standings drop the move column: the name has 30pt more.
  assertEquals(nameRoom({ rowWidth: 350, fontScale: 1, move: false, rows: normal }) - nameRoom({ rowWidth: 350, fontScale: 1, move: true, rows: normal }), 30);
});

Deno.test('a stacked row never draws its name, record or tag larger than its season gain (the standout stays loudest)', () => {
  for (const gain of [614.88, -402.9, 1532118.4, -1999999.99]) {
    const gainText = formatMoney(gain, { sign: 'always' });
    for (const fontScale of [1.35, 2.35, 3.12]) {
      const cap = stackedRowTextCap({ gainText, fontScale, rowWidth: 350, move: true });
      assert(cap >= 1 && cap <= 1.3, `${gainText} @ ${fontScale}: ${cap}`);
      // The gain as drawn: 15pt × min(scale, 1.3), shrunk to its line.
      const totalPt = 15 * Math.min(fontScale, 1.3);
      const inner = 350 - 24 - 22 - 30 - 32 - 16;
      const fitted = totalPt * Math.min(1, inner / figureWidth(gainText, totalPt));
      // The name (15pt) at its cap is never larger than the fitted gain, unless the gain is
      // under the name's own base size (the cap never takes a name below 1x).
      assert(15 * cap <= Math.max(fitted, 15) + 0.01, `${gainText} @ ${fontScale}: name ${15 * cap} vs gain ${fitted}`);
    }
  }
  // A gain too long for its line shrinks, and the cap follows it down (at the 17e's width
  // even −$1,999,999.99 fits at full size, so these are past what a league can reach).
  const huge = stackedRowTextCap({ gainText: '+$1,234,567,890,123.45', fontScale: 2.35, rowWidth: 350, move: true });
  assert(huge > 1 && huge < 1.3, `the cap follows a shrunk gain: ${huge}`);
  assertEquals(stackedRowTextCap({ gainText: '+$1,234,567,890,123,456.78', fontScale: 2.35, rowWidth: 350, move: true }), 1);
});

// ── The playoffs (GS-6, GS-7) ────────────────────────────────────────────────────

const STANDINGS = [
  { user_id: 'a', rank: 1, display_name: 'Paolo M.' },
  { user_id: 'b', rank: 2, display_name: 'Roberto B.' },
  { user_id: 'c', rank: 3, display_name: 'Luca V.' },
  { user_id: 'd', rank: 4, display_name: 'Chiara R.' },
  { user_id: 'e', rank: 5, display_name: 'Marco T.' },
  { user_id: 'f', rank: 6, display_name: 'Gianluigi B.' },
];
const g = (round: number, pos: number, t1: string, t2: string, g1: number | null, g2: number | null): BracketRow => ({
  playoff_round_number: round, bracket_position: pos, team1_user_id: t1, team2_user_id: t2, team1_gain: g1, team2_gain: g2,
  winner_user_id: g1 === null || g2 === null ? null : g1 > g2 ? t1 : t2,
});
const FINISHED = [g(1, 0, 'c', 'f', 142.6, 88.15), g(1, 1, 'd', 'e', 61.4, -12.9), g(2, 0, 'a', 'd', 203.75, 118.2), g(2, 1, 'b', 'c', 288.1, 96.42), g(3, 0, 'b', 'a', 176.3, 120.55)];
const LIVE = FINISHED.slice(0, 2).concat([g(2, 0, 'a', 'd', null, null), g(2, 1, 'b', 'c', null, null)]);

Deno.test('GS-6: the byes are rows OF the first round, first, each saying where it goes; one heading per round', () => {
  const rounds = bracketRounds(buildBracket({ rows: FINISHED, teams: 6, standings: STANDINGS }));
  assertEquals(rounds.map((r) => r.label), ['Wild card', 'Semifinals', 'Final']);
  assertEquals(rounds[0].items.map((i) => i.kind), ['bye', 'bye', 'game', 'game']);
  const bye = rounds[0].items[0];
  assert(bye.kind === 'bye' && bye.side.name === 'Paolo M.' && bye.advancesTo === 'Semifinals');
  assertEquals(advancesLine('Semifinals'), 'Advances to the Semifinals');
  assertEquals(advancesLine(null), null);
  // Four teams: no byes, so no bye rows.
  const four = bracketRounds(buildBracket({ rows: [g(1, 0, 'a', 'd', 1, 0), g(1, 1, 'b', 'c', 1, 0)], teams: 4, standings: STANDINGS.slice(0, 4) }));
  assert(four[0].items.every((i) => i.kind === 'game'));
});

Deno.test('GS-7: the champion row appears only once the Final is scored', () => {
  const done = bracketChampion(buildBracket({ rows: FINISHED, teams: 6, standings: STANDINGS }));
  assertEquals(done?.name, 'Roberto B.');
  assertEquals(championLine('Roberto B.', 'Champion'), 'Roberto B. · Champion');
  assertEquals(bracketChampion(buildBracket({ rows: LIVE, teams: 6, standings: STANDINGS })), null);
  // A Final with a winner but only one score posted is not finished: no crown before the score.
  const half = FINISHED.slice(0, 4).concat([{ ...g(3, 0, 'b', 'a', 176.3, 120.55), team2_gain: null }]);
  assertEquals(bracketChampion(buildBracket({ rows: half, teams: 6, standings: STANDINGS })), null);
  assertEquals(bracketChampion(buildBracket({ rows: [], teams: 6, standings: STANDINGS })), null);
  const src = SOURCES['components/game/BracketView.tsx'];
  // One heading per round (no second "· playoff week 1" heading over a bye card).
  assertEquals((code(src).match(/playoff week \$\{round\.round\}/g) ?? []).length, 1);
  assert(!code(src).includes('bracket.byes.map('), 'byes come through bracketRounds, never their own card');
});

// ── Load failures and reload (Giorgio, 2026-10-13: the two strings, verbatim) ────

Deno.test('History and Playoffs say when their read failed, with Try again that re-reads', () => {
  assertEquals(HISTORY_LOAD_FAILED, "Your league's history didn't load.");
  assertEquals(BRACKET_LOAD_FAILED, "The bracket didn't load.");
  const league = SOURCES['app/(tabs)/league.tsx'];
  assert(league.includes('<LoadFailed line={HISTORY_LOAD_FAILED} onRetry={retry} />'));
  assert(league.includes('<LoadFailed line={BRACKET_LOAD_FAILED} onRetry={retry} />'));
  assert(league.includes('const retry = useCallback(() => setReload((k) => k + 1), []);'));
  // Every read on the tab takes the key, and the pull bumps it (it re-read nothing before).
  assert(league.includes('useLeagueStandings(inSeason ? activeLeagueId : null, reload)'));
  assert(league.includes("useLeagueHistory(inSeason ? activeLeagueId : null, segment === 'history' && inSeason, reload)"));
  assert(league.includes("useSeasonPlayoffs(inSeason ? activeLeagueId : null, segment === 'history' && inSeason, reload)"));
  assert(league.includes('<BarsRefresh onRefresh={onPull}'));
  assert(league.includes('onRefresh={onPull} />'), 'the error state pulls to re-read too');
  for (const hook of ['lib/game/useLeagueStandings.ts', 'lib/game/useLeagueHistory.ts', 'lib/game/useSeasonPlayoffs.ts', 'lib/game/useBracket.ts']) {
    assert(/\}, \[[^\]]*reloadKey\]\);/.test(SOURCES[hook]), `${hook} re-reads on its key`);
  }
  // The Try again button acts (TRY_AGAIN, never a no-op handler).
  assert(SOURCES['components/league/LeagueStates.tsx'].includes('<Button label={TRY_AGAIN} variant="secondary" size="sm" onPress={onRetry} />'));
});

Deno.test('with no leagues, League is Home\'s own empty state, and both buttons go somewhere', () => {
  const league = SOURCES['app/(tabs)/league.tsx'];
  assert(!code(league).includes('Standings are on the way'));
  assert(!code(league).includes('in the next update'));
  assert(league.includes('heading="No leagues yet"'));
  assert(league.includes("onAction={() => router.push('/create-league')}"));
  assert(league.includes("onSecondaryAction={() => router.push('/join-league')}"));
  const home = SOURCES['app/(tabs)/index.tsx'];
  assert(home.includes('heading="No leagues yet"') && home.includes('message="Create or join a league to get started."'));
});

// ── The segment tabs ─────────────────────────────────────────────────────────────

Deno.test('League\'s sections are the board\'s text tabs, not a segmented control', () => {
  const league = SOURCES['app/(tabs)/league.tsx'];
  assert(league.includes('<SegmentTabs'));
  assert(!league.includes('<SegmentedControl'));
  assert(segmentTabsScroll(['Standings', 'Schedule', 'Playoffs', 'History'], 2.35, 350));
});

// ── Game Night look (§9C) ────────────────────────────────────────────────────────

Deno.test('League\'s rows divide by space: no rule lines, no Card around the standings, no drop shadow on the pinned row', () => {
  for (const p of ['components/game/StandingsTable.tsx', 'components/game/ScheduleList.tsx', 'components/game/HistoryList.tsx', 'components/game/BracketView.tsx', 'components/sp/gn/SegmentTabs.tsx', 'components/league/LeagueStates.tsx']) {
    const src = code(SOURCES[p]);
    assert(!/borderBottomWidth|borderTopWidth|hairlineWidth/.test(src), `${p} draws a rule line`);
  }
  const league = code(SOURCES['app/(tabs)/league.tsx']);
  assert(!league.includes('elevation.card'), 'the pinned row casts no shadow (Dark: depth is lightness, §9C rule 1)');
  assert(league.includes('<View style={[styles.pinnedCard, { borderColor: colors.rim }]}>'));
  // SetupRows' divider is space now (settings, create league, the leave sheets).
  const rows = SOURCES['components/game/SetupRows.tsx'];
  assert(rows.includes('  divider: {\n    height: space[2],\n  },'));
  assert(!code(rows).includes('colors.line'));
});

Deno.test('the accent keeps its meaning on League: the invite code is plain text, the live week is the §9C chip', () => {
  const settings = SOURCES['app/league-settings.tsx'];
  assert(!settings.includes('valueColor={colors.accent}'));
  assert(!settings.includes('color={colors.accent} style={styles.bold}>{code}'));
  const schedule = SOURCES['components/game/ScheduleList.tsx'];
  assert(schedule.includes("const live = chipLook('live', colors);"));
  // No week's row is shaded: every row is your game (B shades your side against someone).
  assert(!code(schedule).includes('youTint'));
});

Deno.test('the member\'s Run it back ask: two equal-width buttons (the board; P3)', () => {
  const ask = SOURCES['components/game/RenewalAsk.tsx'];
  assert(ask.includes('<View style={styles.choice}>'));
  assert(ask.includes('choice: { flex: 1 },'));
  assert(ask.includes('fullWidth'));
});

Deno.test('GS-13: the renewal review\'s sub-line sits under the label, full width', () => {
  const review = SOURCES['components/game/RenewalReview.tsx'];
  const row = review.slice(review.indexOf('function Row('), review.indexOf('return onPress'));
  // The value column closes BEFORE the sub-line: the sub-line is the row's own second line.
  const valueEnd = row.indexOf('<Text variant="callout" tone="secondary">{value}</Text>\n        </View>');
  const sub = row.indexOf('{sub ? <Text variant="caption" tone="secondary">{sub}</Text> : null}');
  assert(valueEnd > 0 && sub > valueEnd, `value ${valueEnd}, sub ${sub}`);
});

// ── The capture fixture ──────────────────────────────────────────────────────────

Deno.test('the League capture fixture: 12 and 16 managers, ties, your row in the middle and at the bottom', () => {
  assertEquals(parseLeagueFixture('twelve'), 'twelve');
  assertEquals(parseLeagueFixture('nope'), null);
  assertEquals(parseLeagueFixture(undefined), null);
  const twelve = leagueFixtureStandings('twelve')!;
  assertEquals(twelve.length, 12);
  assertEquals(twelve.map((r) => r.rank), Array.from({ length: 12 }, (_, i) => i + 1));
  assertEquals(twelve.find((r) => r.user_id === 'fixture-user')?.rank ?? twelve.find((r) => r.display_name === 'Robertino Bartolomeo')?.rank, 7);
  assert(twelve.every((r) => r.display_name.length >= 19), 'stress names');
  assert(twelve.some((r) => r.points_for >= 1_000_000) && twelve.some((r) => r.points_for <= -1_000_000));
  assert(twelve.some((r, i) => i > 0 && r.wins === twelve[i - 1].wins && r.losses === twelve[i - 1].losses), 'a tied record');
  const sixteen = leagueFixtureStandings('sixteen')!;
  assertEquals(sixteen.length, 16);
  assertEquals(sixteen[15].display_name, 'Robertino Bartolomeo');
  // In the server's order: win % never rises down the list.
  const pct = (r: { wins: number; losses: number; ties: number }) => (r.wins + 0.5 * r.ties) / Math.max(1, r.wins + r.losses + r.ties);
  for (let i = 1; i < sixteen.length; i++) assert(pct(sixteen[i]) <= pct(sixteen[i - 1]), `${sixteen[i].display_name}`);
  // Last week's order: neighbours swapped, so the arrows go both ways.
  const prev = leagueFixturePreviousRanks(twelve);
  assertEquals(prev[0], { user_id: twelve[0].user_id, rank: 2 });
  assertEquals(prev[1], { user_id: twelve[1].user_id, rank: 1 });
  assertEquals(leagueFixtureStandings('error'), null);
});

Deno.test('the League fixture is the capture seam\'s only (never a production read)', () => {
  assert(SOURCES['lib/game/devSeam.ts'].includes('export const LEAGUE_FIXTURE_VARIANT: LeagueFixture | null = SEAM_ON ? parseLeagueFixture(process.env.EXPO_PUBLIC_LEAGUE_FIXTURE) : null;'));
  assert(SOURCES['lib/shell/devFixture.ts'].includes("export const FIXTURE_PLAYOFFS_LIVE: boolean = __DEV__ ? process.env.EXPO_PUBLIC_LEAGUE_FIXTURE === 'playoffs_live' : false;"));
  // League reads the same Home fixture Home does, so the card and the full standings agree.
  assert(SOURCES['lib/game/useLeagueStandings.ts'].includes("const seamHome = SEAM_ON ? fixtureHomeLeague(HOME_FIXTURE ?? 'scored').data : null;"));
});

Deno.test("League's gains never shrink-to-fit (iOS drew a flex-shrinking one at a few points; the list stacks first)", () => {
  for (const p of ['components/sp/gn/ManagerRow.tsx', 'components/game/StandingsTable.tsx', 'components/game/ScheduleList.tsx', 'components/game/BracketView.tsx']) {
    assert(!code(SOURCES[p]).includes('adjustsFontSizeToFit'), `${p} shrinks a figure to fit`);
  }
  // The line under the list stays under the rows' gains at every size (19.2pt < 19.5pt).
  assert(SOURCES['components/game/StandingsTable.tsx'].includes('<Text variant="caption" tone="secondary" maxFontSizeMultiplier={1.6} style={styles.caption}>{caption}</Text>'));
  // "After the playoffs" over Final standings, as History's own line is (1.6×).
  assert(SOURCES['components/game/StandingsTable.tsx'].includes('<Text variant="caption" tone="secondary" maxFontSizeMultiplier={1.6}>{header.subtitle}</Text>'));
});

Deno.test('Schedule and the bracket: every line of a row stops at the score\'s cap (1.3×), so the score stays loudest', () => {
  for (const p of ['components/game/ScheduleList.tsx', 'components/game/BracketView.tsx']) {
    const src = code(SOURCES[p]);
    assert(src.includes('const ROW_TEXT_CAP = 1.3;'), p);
    for (const m of src.matchAll(/<Text variant="(body|callout|caption)"[^>]*>/g)) {
      assert(m[0].includes('maxFontSizeMultiplier={ROW_TEXT_CAP}'), `${p}: ${m[0].slice(0, 70)}`);
    }
  }
});

Deno.test('the headless capture knobs are DEV-only and fire once (never in a production build)', () => {
  const f = SOURCES['lib/shell/fixtureRoute.ts'];
  assert(f.includes("export const FIXTURE_INITIAL_ROUTE: string | null = __DEV__ ? (process.env.EXPO_PUBLIC_SHELL_INITIAL_ROUTE || null) : null;"));
  assert(f.includes("export const FIXTURE_SCROLL_END: boolean = __DEV__ ? process.env.EXPO_PUBLIC_SHELL_SCROLL_END === '1' : false;"));
  assert(f.includes('if (!FIXTURE_INITIAL_ROUTE || consumed) return;'));
  assert(SOURCES['lib/shell/devFixture.ts'].includes("export const FIXTURE_ACTIVE_LEAGUE: string | null = __DEV__ ? (process.env.EXPO_PUBLIC_SHELL_ACTIVE_LEAGUE || null) : null;"));
  // The active-league override is read only inside LeagueContext's fixture branch.
  const ctx = SOURCES['lib/LeagueContext.tsx'];
  assert(ctx.indexOf('FIXTURE_ACTIVE_LEAGUE ?? stored') > ctx.indexOf('if (LEAGUE_FIXTURE) {'));
  assert(ctx.indexOf('FIXTURE_ACTIVE_LEAGUE ?? stored') < ctx.indexOf('// A finished league you left is hidden'));
});

Deno.test("League's settings row stops at the gains' size at XL; the shared forms keep full Dynamic Type", () => {
  const league = SOURCES['app/(tabs)/league.tsx'];
  assert(league.includes('const LEAGUE_ROW_MAX_SCALE = 1.5;'));
  assertEquals((league.match(/maxScale=\{LEAGUE_ROW_MAX_SCALE\}/g) ?? []).length, 2);
  // 13 × 1.5 = 19.5 = 15 × 1.3 (the gains' cap).
  assertEquals(13 * 1.5, 15 * 1.3);
  const rows = SOURCES['components/game/SetupRows.tsx'];
  assert(rows.includes('<RowKey maxScale={maxScale}>{label}</RowKey>'));
  assert(!SOURCES['app/create-league.tsx'].includes('maxScale='), 'create league is not capped');
});

Deno.test("lobby gap (Draft gate item 4): League's pre-draft lobby uses the draft room's 16pt block gap", () => {
  const league = SOURCES['app/(tabs)/league.tsx'];
  const lobby = league.slice(league.indexOf('function LeagueLobby('));
  assert(lobby.includes('contentContainerStyle={{ paddingHorizontal: space[6], paddingBottom: space[9], gap: space[5] }}'));
  assert(!lobby.includes('gap: space[6] }}'), 'the lobby is not on the 20pt gap');
});

Deno.test('SegmentTabs never shift sideways when the selection moves (each tab sized by its 800 label)', () => {
  const tabs = SOURCES['components/sp/gn/SegmentTabs.tsx'];
  assert(tabs.includes('style={[styles.selected, styles.sizer]} accessibilityElementsHidden'));
  assert(tabs.includes('sizer: {\n    opacity: 0,\n  },'));
  assert(tabs.includes('<View style={styles.labelOver} pointerEvents="none">'));
});

// ── W4 DL gate (BLOCK on 89274804): the fixes ─────────────────────────────────────

import { gainColumnWidth, headCapsWidth, leagueFallback } from '../lib/game/leagueView.ts';
import { inviteShareShown } from '../lib/game/leagueSettingsEntry.ts';

Deno.test('P1: "No leagues yet" only for someone with no leagues; Run it back reads the list BEFORE switching', () => {
  assertEquals(leagueFallback({ loading: false, leagueCount: 0, loadFailed: false }), 'empty');
  assertEquals(leagueFallback({ loading: true, leagueCount: 0, loadFailed: false }), 'pending');
  // Leagues exist, none active yet (the instant after Run it back): never the empty state.
  assertEquals(leagueFallback({ loading: false, leagueCount: 3, loadFailed: false }), 'pending');
  assertEquals(leagueFallback({ loading: true, leagueCount: 3, loadFailed: false }), 'pending');
  const league = SOURCES['app/(tabs)/league.tsx'];
  const run = league.slice(league.indexOf('const runItBack = async () => {'), league.indexOf('const isCommissioner ='));
  assert(run.indexOf('await refresh();') < run.indexOf('setActiveLeagueId(res.league_id);'), 'refresh first, then switch');
  assert(league.includes("const fallback = leagueFallback({ loading, leagueCount: leagues.length, loadFailed });\n  if (fallback === 'pending') {"));
});

Deno.test('P1 XL: the Run it back line 1.5×, History\'s season record 1.5× (under the 19.5pt gains)', () => {
  assert(SOURCES['app/(tabs)/league.tsx'].includes('<Text variant="callout" tone="secondary" maxFontSizeMultiplier={1.5}>Start Season 2 with the same group. Season 1 stays in History.</Text>'));
  assert(SOURCES['components/game/HistoryList.tsx'].includes('{s.myRecord ? <Text variant="callout" tone="secondary" maxFontSizeMultiplier={1.5}>{s.myRecord}</Text> : null}'));
});

Deno.test('P2: the pinned row sits on an opaque bg band down to the tab bar', () => {
  const league = SOURCES['app/(tabs)/league.tsx'];
  assert(league.includes('<View style={[styles.pinned, { backgroundColor: colors.bg }]} pointerEvents="box-none">'));
  assert(league.includes("pinned: { position: 'absolute', left: 0, right: 0, bottom: 0,"));
});

Deno.test("P2: the champion row is ManagerRow's tile; yours carries the tint AND the ring", () => {
  const src = SOURCES['components/game/BracketView.tsx'];
  assert(src.includes('{champion.userId === myUserId ? <View testID="champion-you" pointerEvents="none" style={[styles.championYou, { backgroundColor: colors.youTint, borderColor: colors.you }]} /> : null}'));
  assert(src.includes("championYou: { ...StyleSheet.absoluteFillObject, borderRadius: radius.row, borderWidth: YOU_RING },"));
  assert(src.includes("champion: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 56, padding: space[4], borderRadius: radius.row, overflow: 'hidden' },"));
});

Deno.test('P2 GS-13: a review row with a sub-line has no minimum height; the sub-line 4pt under its label', () => {
  const review = SOURCES['components/game/RenewalReview.tsx'];
  assert(review.includes('<View style={[styles.row, sub ? null : styles.rowMin]}>'));
  assert(review.includes('rowStack: { gap: space[2], paddingVertical: space[1] },'));
  assert(!/row: \{[^}]*minHeight/.test(review.slice(review.indexOf('const styles'))), 'the row itself has no minHeight');
});

Deno.test('P3: the gain column is as wide as its "SEASON GAIN" head, so W–L sits over the records', () => {
  assert(headCapsWidth('Season gain', 1) > 86, 'the head is wider than the board\'s 86');
  assertEquals(gainColumnWidth(1), Math.ceil(headCapsWidth('Season gain', 1)));
  assert(gainColumnWidth(2.35) >= gainColumnWidth(1));
  const table = SOURCES['components/game/StandingsTable.tsx'];
  assert(table.includes('<HeadLabel text="Season gain" style={[styles.headRight, { minWidth: layout.gainWidth }]} />'));
  assert(table.includes('gainWidth={layout.gainWidth}'));
  assert(SOURCES['components/sp/gn/ManagerRow.tsx'].includes('style={[styles.gain, gainWidth ? { minWidth: gainWidth } : null]}'));
});

Deno.test('P3: the small fixes (bye indent, final head, week-1 ranks, error avatar, no History title, tight bracket, one Share)', () => {
  const bracket = SOURCES['components/game/BracketView.tsx'];
  assert(bracket.includes('advances: { marginLeft: 24 },'));
  assert(bracket.includes("row: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[1] },"));
  const league = SOURCES['app/(tabs)/league.tsx'];
  assert(league.includes('throughLabel={null}'), 'final standings: no "Through Week N" beside "After the playoffs"');
  assert(league.includes('nothingScored={throughWeek === 0}'));
  assert(SOURCES['components/sp/gn/ManagerRow.tsx'].includes('color={rank === 1 && rankLeads ? colors.text : colors.text2}'));
  assert(league.includes('<PhasePlaceholder title="League" showAvatar icon={() => <Icon name="alert"'));
  assert(!SOURCES['components/game/HistoryList.tsx'].includes('<Text variant="title">History</Text>'));
  const settings = SOURCES['app/league-settings.tsx'];
  assertEquals((settings.match(/<InviteRow code=/g) ?? []).length, 2, 'commissioner and member share the one row');
  assert(settings.includes('{inviteShareShown(window) ? ('));
  // Both views pass the leave rule's window (the one place "locked" is decided).
  assertEquals((settings.match(/window=\{membershipWindow\}/g) ?? []).length, 2);
});

Deno.test("Share hides while teams are locked (Giorgio, 2026-10-13, B, #call-share-locked); the code stays", () => {
  // Locked: an hour before the draft until the season ends.
  assertEquals(inviteShareShown('locked_order_set'), false);
  assertEquals(inviteShareShown('locked_season'), false);
  // After the season, until a renewal: a code can't be used (preview-league: 'season_completed').
  assertEquals(inviteShareShown('after_season'), false);
  // Shown only before the draft (a renewed Season 2 too), when a code can be used.
  assertEquals(inviteShareShown('before_draft'), true);
  // The code itself is always drawn; only the pill is conditional.
  const row = SOURCES['app/league-settings.tsx'].slice(SOURCES['app/league-settings.tsx'].indexOf('function InviteRow('));
  assert(row.indexOf('>Invite code</Text>') < row.indexOf('{inviteShareShown(window) ? ('));
  assert(row.includes('<Text variant="callout" style={[styles.bold, styles.tabular]}>{code}</Text>'));
});

Deno.test("Season 2's roster loading shows the skeleton, never an empty body (right after Run it back)", () => {
  assert(SOURCES['components/game/LeagueRenewal.tsx'].includes("if (st.status === 'loading' || st.status === 'idle') return <TilesSkeleton rows={4} />;"));
});
