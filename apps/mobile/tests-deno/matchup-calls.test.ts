/**
 * W4: Giorgio's four Matchup calls (2026-10-13, B on each — the DL board design/matchup-calls,
 * #call-mx-order / -empty / -bye / -withheld), the DL gate's fixes (the bye in All matchups,
 * the lost fixture, line heights at XL, the 1-point season line, names that never wrap) and
 * item 6 (a mid-week buy's card says what its row scores). Copy is his, VERBATIM.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { BYE_HALF, buildRosterView, buildWithheldView, orderLabel, WITHHELD_LINE } from '../lib/game/matchupRosterView.ts';
import { closesBefore } from '../lib/game/matchupRoster.ts';
import { boughtWeekTrades, fixtureLedger, fixtureWeekBars, MSFT_BUY } from '../lib/game/matchupFixture.ts';
import { closeFor, seamTableRows, SEAM_ME } from '../lib/game/seamTables.ts';
import { buildAllMatchups } from '../lib/game/allMatchups.ts';
import { finalLineup } from '../lib/game/finalLineup.ts';
import { playerCardData, stockBasis, weekPctOf } from '../lib/game/playerCardModel.ts';
import { liveWeekScore, type LiveSnapshot } from '../lib/home/liveWeekScore.ts';
import { lineupRows } from '../lib/game/lineupLedger.ts';
import { standardWeekSessions } from '../lib/time/marketWeek.ts';
import { GIANLUIGI_HOLDINGS, ROBERTO_HOLDINGS, fixtureQty } from '../lib/home/homeFixtureData.ts';
import { estimateMoneyWidth, fitScale } from '../components/sp/logic/fitScale.ts';
import { buildLine } from '../components/sp/logic/lineChart.ts';
import { estimateNameWidth, NAME_MIN_SCALE, NAME_MIN_SCALE_COMPACT, nameBesideAvatar } from '../components/sp/logic/gameNight.ts';
import { COPY } from '../lib/game/gameCopy.ts';
import { SOURCES } from './sourceManifest.generated.ts';

const strip = (src: string) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const sessions = standardWeekSessions('2026-09-25T20:00:00Z');
const snaps = (rows: typeof ROBERTO_HOLDINGS): LiveSnapshot[] => rows.map((h) => ({ symbol: h.symbol, quantity: fixtureQty(h), weekStartPrice: h.mon, enteredMidWeek: false }));
const thu = (s: string) => [...ROBERTO_HOLDINGS, ...GIANLUIGI_HOLDINGS].find((h) => h.symbol === s)?.thu ?? (s === 'MSFT' ? MSFT_BUY.live : null);
const bars = Object.fromEntries([...ROBERTO_HOLDINGS, ...GIANLUIGI_HOLDINGS].map((h) => [h.symbol, [{ date: '2026-09-23', close: h.prev }]]));
const side = (userId: string, rows: typeof ROBERTO_HOLDINGS) => {
  const live = liveWeekScore(snaps(rows), [], thu);
  return { userId, lineup: lineupRows(live.bySymbol, live.gain), snapshots: snaps(rows), trades: [] };
};
const ledger = fixtureLedger('unslotted', 'me', 'gia');
const build = (now: Date, opts: { bye?: boolean } = {}) => buildRosterView({
  me: side('me', ROBERTO_HOLDINGS), opp: opts.bye ? null : side('gia', GIANLUIGI_HOLDINGS),
  activity: ledger.activity, names: ledger.symbol_names, slots: [], slotOf: {},
  closes: closesBefore(now, sessions), bars, barsAt: now,
});

// ── 1. The order label (#call-mx-order, B) ─────────────────────────────────────

Deno.test('order label: "Ordered by Wednesday\'s close" — the close the order USES, none before one settles', () => {
  assertEquals(orderLabel('2026-09-23'), "Ordered by Wednesday's close");
  assertEquals(orderLabel('2026-09-21'), "Ordered by Monday's close");
  // Thursday 1:37 PM: Wednesday's close settled at 8 PM Wednesday.
  assertEquals(build(new Date('2026-09-24T17:37:00Z')).orderedBy, '2026-09-23');
  // Wednesday 6 PM: Wednesday closed but hasn't settled (extended hours), and Tuesday has no
  // bar here — nothing settled orders the rows, so no label.
  assertEquals(build(new Date('2026-09-23T22:00:00Z')).orderedBy, null);
  const src = SOURCES['app/(tabs)/matchup.tsx'];
  assert(src.includes('{view.orderedBy ? ('), 'no label while the draft order holds');
  assert(src.includes('{orderLabel(view.orderedBy)}'));
});

// ── 2. Empty slots (#call-mx-empty, B) ─────────────────────────────────────────

Deno.test('an empty slot: a dashed edge and "Empty", on both sides', () => {
  const src = strip(SOURCES['components/sp/gn/RosterRow.tsx']);
  assert(src.includes("export const EMPTY_SLOT = 'Empty';"));
  assert(src.includes("testID={shaded ? 'roster-empty-yours' : 'roster-empty-theirs'}"), 'either side');
  assert(/emptyHalf: \{\s*borderWidth: 1\.5,\s*borderStyle: 'dashed',/.test(src));
  assert(src.includes('>{EMPTY_SLOT}</Text>'));
  assert(src.includes('if (!half && !markEmpty) return <View style={slab} />;'), 'unslotted: an unmatched half is space, not a slot');
  assert(SOURCES['app/(tabs)/matchup.tsx'].includes('markEmpty={g.label !== null}'), '"Empty" only under a slot group');
});

// ── 3. The bye (#call-mx-bye, B) ───────────────────────────────────────────────

Deno.test('bye: your half, "Bye week" in theirs, the app\'s bye line, your stocks in ONE column, same order', () => {
  assertEquals(BYE_HALF, 'Bye week');
  assertEquals(COPY.byeNoResult, 'Bye week · no result');
  const v = build(new Date('2026-09-24T17:37:00Z'), { bye: true });
  assertEquals(v.groups.length, 1);
  assert(v.groups[0].rows.every((r) => r.right === null && r.left !== null), 'your stocks alone');
  const twoSided = build(new Date('2026-09-24T17:37:00Z'));
  assertEquals(v.groups[0].rows.map((r) => r.left!.symbol), twoSided.groups[0].rows.map((r) => r.left!.symbol), 'the same order rules');
  const src = SOURCES['app/(tabs)/matchup.tsx'];
  assert(src.includes("bye={{ label: BYE_HALF, line: COPY.byeNoResult }}"));
  assert(src.includes('theirRows={null}') && src.includes('single={!sides.opp}'));
  assert(SOURCES['components/sp/gn/Scoreboard.tsx'].includes('const line = bye || !model ? bye?.line ?? \'\' : model.line;'), 'never a "leads by" on a bye');
  const data = SOURCES['lib/game/useRosterData.ts'];
  assert(data.includes('if (!leagueId || !me) return;'), 'the roster loads with no opponent (else a bye shows a skeleton forever)');
  assert(data.includes('const users = opp ? [me, opp] : [me];'));
});

Deno.test('All matchups: a bye is the bye — the team and "Bye week · no result", never a nameless "?" opponent', () => {
  const rows = seamTableRows(true, 'matchups_week', 'on_clock', { bye: true }) as Parameters<typeof buildAllMatchups>[0]['matchups'];
  const names = [{ user_id: SEAM_ME, display_name: 'Roberto B.', is_bot: false }, { user_id: 'gianluigi', display_name: 'Gianluigi B.', is_bot: false }];
  const all = buildAllMatchups({ matchups: rows, names, myUserId: SEAM_ME, snapshots: [], trades: [], quote: () => null } as never);
  assert(all.some((r) => r.b === null), 'the fixture has byes');
  const src = SOURCES['app/(tabs)/matchup.tsx'];
  assert(src.includes('{state.rows.map((r, i) => (!r.b ? ('));
  assert(src.includes('<ByeGame key='));
  assert(!src.includes("r.b?.name ?? ''"), 'no nameless opponent');
});

// ── 4. The withheld final (#call-mx-withheld, B) ───────────────────────────────

Deno.test('withheld: the line, then who held what — draft order, no figures', () => {
  assertEquals(WITHHELD_LINE, "Stock-by-stock results aren't available for this week.");
  const g = buildWithheldView({
    me: { userId: 'me', symbols: ['TSLA', 'NVDA', 'V', 'AAPL', 'COST', 'CRM'] },
    opp: { userId: 'gia', symbols: ['BA', 'AMZN', 'KO', 'JPM', 'NKE', 'DIS'] },
    activity: ledger.activity, names: ledger.symbol_names,
  });
  assertEquals(g.rows.map((r) => r.left!.symbol), ['NVDA', 'AAPL', 'CRM', 'TSLA', 'COST', 'V']); // picks 2 11 14 23 26 35
  assertEquals(g.rows.map((r) => r.right!.symbol), ['AMZN', 'JPM', 'DIS', 'NKE', 'KO', 'BA']);
  const src = SOURCES['app/(tabs)/matchup.tsx'];
  assert(src.includes('weekGain: 0, weekPct: 0, figures: false'), 'the halves carry no numbers');
  assert(src.includes('<Withheld raw={raw} roster={roster} me={user.id} opp={live.opp} />'));
  assert(strip(SOURCES['components/sp/gn/RosterRow.tsx']).includes("const content = !figures ? [name, null]"));
});

// ── DL gate fixes ──────────────────────────────────────────────────────────────

Deno.test('lost fixture: Roberto\'s week mirrored, so the rows still reconcile (never the totals swapped)', () => {
  const rows = seamTableRows(true, 'week_snapshots', 'on_clock', { weekClosed: true, lost: true }) as { user_id: string; symbol: string; quantity: number; week_start_price: number; week_end_price: number; entered_mid_week: boolean }[];
  const mine = rows.filter((r) => r.user_id === SEAM_ME);
  const won = Math.round(ROBERTO_HOLDINGS.reduce((s, h) => s + fixtureQty(h) * (h.fri - h.mon), 0) * 100) / 100;
  const r = finalLineup({ snapshots: mine, trades: [], teamGain: -won });
  assert(r.ok, 'the mirrored rows add up to −won');
  assertEquals(closeFor('gianluigi', { symbol: 'X', quantity: 1, start: 10, live: 11, close: 12 }, true), 12, 'only your week mirrors');
});

Deno.test('XL: a stacked roster number is fitted by measurement (fitScale, floor 0.7), never iOS\'s shrink', () => {
  // iOS adjustsFontSizeToFit on a not-yet-laid-out frame drew the first row's week at ~3pt.
  assertEquals(fitScale(165, estimateMoneyWidth('+$287,268.00', 22.1)), Math.min(1, Math.max(0.7, 165 / estimateMoneyWidth('+$287,268.00', 22.1))));
  assertEquals(fitScale(null, 200), 1, 'unmeasured: full size, never a guess');
  assertEquals(fitScale(50, 400), 0.7, 'never under the floor (17 × 1.3 × 0.7 ≥ 11)');
  const src = SOURCES['components/sp/gn/RosterRow.tsx'];
  assert(src.includes('const stackedScale = fitScale(numWidth, estimateMoneyWidth(gainText, SCORE_MD_PT * Math.min(fontScale, SCORE_MD_MAX)));'));
  assert(src.includes('style={[{ fontSize: SCORE_MD_PT * stackedScale }, mirror ? styles.textEnd : null]}'));
});

Deno.test('a 1-point season line: the dot at the RIGHT end (now), the scale centred on the dashed base', () => {
  const box = { width: 300, height: 100, padLeft: 0, padRight: 0, padTop: 0, padBottom: 0 };
  const g = buildLine([{ t: 0, value: 418.92 }], [0, 0], 412.3, box);
  assertEquals(g.end!.x, 300);
  assertEquals(g.baseY, 50, 'the base on the middle');
  assertEquals(g.end!.y, 0, 'the dot above it by its own move');
  const two = buildLine([{ t: 0, value: 1 }, { t: 5, value: 3 }], [0, 5], 2, box);
  assertEquals(two.points[0].x, 0, 'longer lines unchanged');
});

Deno.test('names: one line beside the avatar while it fits at 75%, else the stacked layout — never "Gianluigi" / "B."', () => {
  assertEquals(NAME_MIN_SCALE, 0.75);
  // A 17e at Large: a half is ~175pt, ~83pt beside a 44pt ringed avatar.
  assert(nameBesideAvatar('Gianluigi B.', 83, 15));
  assert(!nameBesideAvatar('Alessandro Mart.', 83, 15), 'a 16-character name stacks');
  assert(estimateNameWidth('MW', 15) > estimateNameWidth('il', 15));
  assert(SOURCES['components/sp/gn/Scoreboard.tsx'].includes('const stacked = halfWidth > 0 && !nameBesideAvatar(team.name, besideRoom, fontPt, minScale);'));
  assert(15 * NAME_MIN_SCALE >= 11 && 13 * NAME_MIN_SCALE_COMPACT >= 11, 'names never shrink under the 11pt floor');
});

Deno.test('the splash-screen promise rejections are handled (the red toast over every reloaded screen)', () => {
  const src = SOURCES['app/_layout.tsx'];
  assert(src.includes('SplashScreen.hideAsync().catch(() => {});'));
  assert(src.includes('SplashScreen.preventAutoHideAsync().catch(() => {});'));
});

// ── Item 6: a mid-week buy's card says what its row scores ─────────────────────

Deno.test('mid-week buy (sold V Tue, bought MSFT Thu): the card\'s week figures equal the row; the line starts at the buy', () => {
  const trades = boughtWeekTrades().map((t) => ({ symbol: t.symbol, action: t.action, quantity: t.quantity, price: t.price, createdAt: new Date(t.created_at) }));
  const live = liveWeekScore(snaps(ROBERTO_HOLDINGS), trades, thu);
  const rows = lineupRows(live.bySymbol, live.gain);
  const msftRow = rows.find((r) => r.symbol === 'MSFT')!;
  const rowPct = weekPctOf(msftRow.cents / 100, stockBasis('MSFT', snaps(ROBERTO_HOLDINGS), trades));
  const card = playerCardData({
    symbol: 'MSFT', company: 'Microsoft', userId: 'me', activity: fixtureLedger('bought', 'me', 'g').activity,
    snapshots: snaps(ROBERTO_HOLDINGS), trades, weekGain: msftRow.cents / 100, price: MSFT_BUY.live,
    bars: [{ date: '2026-09-23', close: MSFT_BUY.prevClose }], seasonBars: [], sessions, now: new Date('2026-09-24T17:37:00Z'),
  })!;
  assertEquals(card.weekGain, msftRow.cents / 100);
  assertEquals(card.weekPct, rowPct);
  assertEquals(Math.round(card.weekGain * 100), Math.round(trades[1].quantity * (MSFT_BUY.live - MSFT_BUY.price) * 100), 'scored from the buy, not Monday');
  assertEquals(card.acquisition, { kind: 'bought', date: 'Sep 24', price: MSFT_BUY.price });
  assertEquals(card.week.points[0].value, MSFT_BUY.price, 'the week line starts at the buy price');
  assert(card.week.points[0].t > 3 && card.week.points[0].t < 4, '…on Thursday, at the buy\'s time');
  assertEquals(card.week.base, MSFT_BUY.price);
  // V, sold Tuesday, still on this week's roster with its realized gain.
  assert(rows.some((r) => r.symbol === 'V'));
});

Deno.test('fixture realism: the week moves every day, and Wednesday is the ordering close', () => {
  for (const h of ROBERTO_HOLDINGS) {
    const w = fixtureWeekBars(h.symbol);
    assertEquals(w.map((b) => b.date), ['2026-09-21', '2026-09-22', '2026-09-23']);
    assert(w[0].close !== h.mon, `${h.symbol}: Monday moves`);
    assertEquals(w[2].close, h.prev);
  }
});
