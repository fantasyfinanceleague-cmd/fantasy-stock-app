/**
 * W4 Matchup roster: the row order and the slot groups (PRODUCT_RULES "Matchup roster row
 * order", Giorgio 2026-10-12): best first by week gain; slotted leagues (category slots AND
 * price tiers) grouped in slot order, best first within; unslotted one list; the order read
 * at the LAST MARKET CLOSE and held through the next day, never live; before the week's
 * first close, the draft/slot order. Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import {
  barCloseAt, cardSlotPill, closesBefore, gainsAtClose, isSlotted, lastWeekClose, orderBarsAt, orderSide, orderingClose, pairRows, recordedSlots, settlesAt,
  rosterGroups, slotGroupLabel,
  weekSessions, type RosterEntry, type SlotRow,
} from '../lib/game/matchupRoster.ts';
import { buildRosterView, seqOf } from '../lib/game/matchupRosterView.ts';
import { fixtureLedger, fixtureSlots } from '../lib/game/matchupFixture.ts';
import { standardWeekSessions } from '../lib/time/marketWeek.ts';
import { GIANLUIGI_HOLDINGS, ROBERTO_HOLDINGS, fixtureQty } from '../lib/home/homeFixtureData.ts';
import { liveWeekScore, type LiveSnapshot } from '../lib/home/liveWeekScore.ts';
import { lineupRows } from '../lib/game/lineupLedger.ts';
import { SOURCES } from './sourceManifest.generated.ts';

const e = (symbol: string, seq: number, closeGain: number | null, slotId: string | null = null): RosterEntry => ({ symbol, seq, closeGain, slotId });
const syms = (xs: RosterEntry[]) => xs.map((x) => x.symbol);

// ── The order ─────────────────────────────────────────────────────────────────────

Deno.test('orderSide: best first by the gain at the last close', () => {
  const xs = [e('A', 1, 10), e('B', 2, 50), e('C', 3, -20), e('D', 4, 30)];
  assertEquals(syms(orderSide(xs, true)), ['B', 'D', 'A', 'C']);
});

Deno.test('orderSide: before the week\'s first close, the draft/slot order (every gain is $0.00)', () => {
  // By gain these would read C, A, D, B: the draft order must win before the close.
  const xs = [e('A', 14, 30), e('B', 23, -20), e('C', 2, 50), e('D', 11, 10)];
  assertEquals(syms(orderSide(xs, false)), ['C', 'D', 'A', 'B']);
  assertEquals(syms(orderSide(xs, true)), ['C', 'A', 'D', 'B']);
});

Deno.test('orderSide: ties and stocks bought since the close keep the draft order, after every held number', () => {
  const xs = [e('A', 3, 5), e('B', 1, 5), e('NEW2', 9, null), e('NEW1', 7, null), e('C', 2, -1)];
  assertEquals(syms(orderSide(xs, true)), ['B', 'A', 'C', 'NEW1', 'NEW2']);
});

// ── The held order: live never re-sorts ───────────────────────────────────────────

const sessions = standardWeekSessions('2026-09-25T20:00:00Z'); // Mon Sep 21 … Fri Sep 25
const snaps = (rows: typeof ROBERTO_HOLDINGS): LiveSnapshot[] => rows.map((h) => ({ symbol: h.symbol, quantity: fixtureQty(h), weekStartPrice: h.mon, enteredMidWeek: false }));
const bars = Object.fromEntries([...ROBERTO_HOLDINGS, ...GIANLUIGI_HOLDINGS].map((h) => [h.symbol, [
  { date: '2026-09-21', close: h.mon }, { date: '2026-09-23', close: h.prev }, { date: '2026-09-24', close: h.thu },
]]));

Deno.test('lastWeekClose: null before Monday\'s close; the day that just closed after it', () => {
  assertEquals(lastWeekClose(new Date('2026-09-21T15:00:00Z'), sessions), null); // Mon 11 AM ET
  assertEquals(lastWeekClose(new Date('2026-09-21T20:00:00Z'), sessions)?.date, '2026-09-21'); // Mon 4 PM ET, the close itself
  assertEquals(lastWeekClose(new Date('2026-09-24T17:37:00Z'), sessions)?.date, '2026-09-23'); // Thu 1:37 PM → Wednesday's
  assertEquals(lastWeekClose(new Date('2026-09-25T00:00:00Z'), sessions)?.date, '2026-09-24'); // Thu 8 PM → Thursday's
  assertEquals(lastWeekClose(new Date('2026-09-24T17:37:00Z'), []), null); // no calendar: never a guessed close
});

Deno.test('weekSessions: the week\'s own sessions from its window', () => {
  assertEquals(weekSessions('2026-09-21T13:30:00Z', '2026-09-25T20:00:00Z', sessions).map((s) => s.sessionDate),
    ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25']);
  assertEquals(weekSessions(null, '2026-09-25T20:00:00Z', sessions), []);
});

const WED_CLOSE = { date: '2026-09-23', at: new Date('2026-09-23T20:00:00Z') };
const THU_CLOSE = { date: '2026-09-24', at: new Date('2026-09-24T20:00:00Z') };
const THU_1337 = new Date('2026-09-24T17:37:00Z');
const THU_8PM = new Date('2026-09-25T00:00:00Z');

Deno.test('gainsAtClose: priced at the close\'s settled bar; trades after the close don\'t count', () => {
  const g = gainsAtClose({ snapshots: snaps(ROBERTO_HOLDINGS), trades: [], close: WED_CLOSE, bars, barsAt: THU_1337 });
  const nvda = ROBERTO_HOLDINGS[0];
  assertEquals(Math.round(g.bySymbol.NVDA * 100), Math.round(fixtureQty(nvda) * (nvda.prev - nvda.mon) * 100));
  assertEquals(g.complete, true);
});

Deno.test('barCloseAt: no bar fetched before its close counts (Alpaca\'s 1Day bar for today is in progress)', () => {
  const at = barCloseAt(bars, THU_1337, THU_CLOSE); // fetched mid-Thursday: the Thursday bar is a mid-session price
  assertEquals(at('NVDA'), null);
  assertEquals(barCloseAt(bars, THU_8PM, THU_CLOSE)('NVDA'), ROBERTO_HOLDINGS[0].thu); // fetched after the close: settled
  assertEquals(barCloseAt(bars, THU_8PM, { date: '2026-09-22', at: new Date('2026-09-22T20:00:00Z') })('NVDA'), null); // no bar that day
});

Deno.test('the order never reads a quote (source guard: no quote reaches the ordering path)', () => {
  const roster = SOURCES['lib/game/matchupRoster.ts'];
  const path = roster.slice(roster.indexOf('export function barCloseAt('), roster.indexOf('// ── Slot heads'));
  assert(!/quote/i.test(path.replace(/\/\*\*[\s\S]*?\*\//g, '')), 'barCloseAt / gainsAtClose / orderingClose take no quote');
  const view = SOURCES['lib/game/matchupRosterView.ts'];
  assert(!/\bquote\b/.test(view.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), 'buildRosterView takes no quote');
});

/** The roster for the board's week at `now`, priced live by `quote`; the bars as fetched at
 * `barsAt` (default: now). */
function view(now: Date, quote: (s: string) => number | null, variant: 'unslotted' | 'category' | 'tiers' = 'unslotted',
  opts: { barsAt?: Date; bars?: typeof bars; myTrades?: import('../lib/home/liveWeekScore.ts').LiveTrade[] } = {}) {
  return viewFull(now, quote, variant, opts).groups;
}

/** The whole view: the groups and the close the order uses (`orderedBy`). */
function viewFull(now: Date, quote: (s: string) => number | null, variant: 'unslotted' | 'category' | 'tiers' = 'unslotted',
  opts: { barsAt?: Date; bars?: typeof bars; myTrades?: import('../lib/home/liveWeekScore.ts').LiveTrade[]; bye?: boolean } = {}) {
  const side = (userId: string, rows: typeof ROBERTO_HOLDINGS, trades: import('../lib/home/liveWeekScore.ts').LiveTrade[] = []) => {
    const live = liveWeekScore(snaps(rows), trades, quote);
    return { userId, lineup: lineupRows(live.bySymbol, live.gain), snapshots: snaps(rows), trades };
  };
  const ledger = fixtureLedger('unslotted', 'me', 'gia');
  const slots = fixtureSlots(variant, 'me', 'gia');
  return buildRosterView({
    me: side('me', ROBERTO_HOLDINGS, opts.myTrades),
    opp: opts.bye ? null : side('gia', GIANLUIGI_HOLDINGS),
    activity: ledger.activity,
    names: ledger.symbol_names,
    slots: slots?.slots ?? [],
    slotOf: slots?.bySide ?? {},
    closes: closesBefore(now, sessions),
    bars: opts.bars ?? bars,
    barsAt: opts.barsAt ?? now,
  });
}
const thuQuote = (s: string) => [...ROBERTO_HOLDINGS, ...GIANLUIGI_HOLDINGS].find((h) => h.symbol === s)?.thu ?? null;
const left = (g: ReturnType<typeof view>) => g.flatMap((x) => x.rows.map((r) => r.left?.symbol ?? null));
const right = (g: ReturnType<typeof view>) => g.flatMap((x) => x.rows.map((r) => r.right?.symbol ?? null));

Deno.test('a live update moves the numbers, never the rows (the order holds until the next close)', () => {
  const thu = new Date('2026-09-24T17:37:00Z');
  const before = view(thu, thuQuote);
  // A live tick that would flip the live order completely: TSLA rockets, NVDA collapses.
  const wild = (s: string) => (s === 'TSLA' ? 400 : s === 'NVDA' ? 200 : thuQuote(s));
  const after = view(thu, wild);
  assertEquals(left(after), left(before));
  assertEquals(right(after), right(before));
  // …but the numbers on the rows did move.
  const tsla = (g: ReturnType<typeof view>) => g[0].rows.find((r) => r.left?.symbol === 'TSLA')!.left!.weekGain;
  assert(tsla(after) > tsla(before));
});

Deno.test('the order IS the gain at Wednesday\'s close, best first, on Thursday', () => {
  const g = view(new Date('2026-09-24T17:37:00Z'), thuQuote);
  assertEquals(g.length, 1);
  assertEquals(g[0].label, null, 'unslotted: one list, no head');
  const atWed = (rows: typeof ROBERTO_HOLDINGS) =>
    [...rows].sort((a, b) => fixtureQty(b) * (b.prev - b.mon) - fixtureQty(a) * (a.prev - a.mon)).map((h) => h.symbol);
  assertEquals(left(g), atWed(ROBERTO_HOLDINGS));
  assertEquals(right(g), atWed(GIANLUIGI_HOLDINGS));
});

Deno.test('after Thursday\'s close the order re-reads Thursday\'s closes', () => {
  const g = view(new Date('2026-09-25T00:00:00Z'), thuQuote);
  const atThu = (rows: typeof ROBERTO_HOLDINGS) =>
    [...rows].sort((a, b) => fixtureQty(b) * (b.thu - b.mon) - fixtureQty(a) * (a.thu - a.mon)).map((h) => h.symbol);
  assertEquals(left(g), atThu(ROBERTO_HOLDINGS));
});

const atClose = (rows: typeof ROBERTO_HOLDINGS, k: 'prev' | 'thu') =>
  [...rows].sort((a, b) => fixtureQty(b) * (b[k] - b.mon) - fixtureQty(a) * (a[k] - a.mon)).map((h) => h.symbol);

Deno.test('the fixture\'s Wednesday and Thursday orders differ (so the cases below can tell them apart)', () => {
  assert(JSON.stringify(atClose(GIANLUIGI_HOLDINGS, 'prev')) !== JSON.stringify(atClose(GIANLUIGI_HOLDINGS, 'thu')));
});

Deno.test('F1: a buy AFTER the close is not in the held order (it would lead the rows if counted)', () => {
  // Roberto buys 100 TSLA at $100 on Thursday — after Wednesday's close. Counted at Wednesday's
  // close it would be +$14,966 and lead his rows; it must not move them.
  const buy = { symbol: 'TSLA', action: 'buy' as const, quantity: 100, price: 100, createdAt: new Date('2026-09-24T15:00:00Z') };
  const g = view(THU_1337, thuQuote, 'unslotted', { myTrades: [buy] });
  assertEquals(left(g), atClose(ROBERTO_HOLDINGS, 'prev'));
  const direct = gainsAtClose({ snapshots: snaps(ROBERTO_HOLDINGS), trades: [buy], close: WED_CLOSE, bars, barsAt: THU_1337 });
  const tsla = ROBERTO_HOLDINGS.find((h) => h.symbol === 'TSLA')!;
  assertEquals(Math.round(direct.bySymbol.TSLA * 100), Math.round(fixtureQty(tsla) * (tsla.prev - tsla.mon) * 100));
});

Deno.test('F2a: on the close\'s evening, before its bar lands, a polled quote can\'t re-sort — the previous close holds', () => {
  const noThuBar = Object.fromEntries(Object.entries(bars).map(([k, v]) => [k, v.filter((b) => b.date !== '2026-09-24')]));
  // An after-hours IEX print that would flip both rosters if it reached the order.
  const wild = (s: string) => (s === 'TSLA' || s === 'BA' ? 9999 : thuQuote(s));
  const g = view(THU_8PM, wild, 'unslotted', { bars: noThuBar });
  assertEquals(left(g), atClose(ROBERTO_HOLDINGS, 'prev'));
  assertEquals(right(g), atClose(GIANLUIGI_HOLDINGS, 'prev'));
});

Deno.test('F2b: bars fetched BEFORE the close (today\'s in-progress bar) never order the rows after it', () => {
  // The fetch ran at 1:37 PM and carries a Thursday bar; at 8 PM, with no refetch, the order
  // stays on Wednesday's close rather than a mid-session "close".
  const g = view(THU_8PM, thuQuote, 'unslotted', { barsAt: THU_1337 });
  assertEquals(right(g), atClose(GIANLUIGI_HOLDINGS, 'prev'));
  // Refetched after the close, Thursday's settled bar orders them.
  assertEquals(right(view(THU_8PM, thuQuote)), atClose(GIANLUIGI_HOLDINGS, 'thu'));
});

Deno.test('F2: one close for BOTH rosters — a stock missing its settled bar holds both sides on the previous close', () => {
  const kiBar = Object.fromEntries(Object.entries(bars).map(([k, v]) => [k, k === 'KO' ? v.filter((b) => b.date !== '2026-09-24') : v]));
  const o = orderingClose({
    closes: closesBefore(THU_8PM, sessions),
    sides: [{ snapshots: snaps(ROBERTO_HOLDINGS), trades: [] }, { snapshots: snaps(GIANLUIGI_HOLDINGS), trades: [] }],
    bars: kiBar,
    barsAt: THU_8PM,
  });
  assertEquals(o?.close.date, '2026-09-23', 'Gianluigi\'s KO has no Thursday bar: neither side reads Thursday');
  const g = view(THU_8PM, thuQuote, 'unslotted', { bars: kiBar });
  assertEquals(left(g), atClose(ROBERTO_HOLDINGS, 'prev'));
  assertEquals(right(g), atClose(GIANLUIGI_HOLDINGS, 'prev'));
});

Deno.test('Monday before the first close: the draft order (by pick), every gain $0.00', () => {
  const g = view(new Date('2026-09-21T14:00:00Z'), (s) => [...ROBERTO_HOLDINGS, ...GIANLUIGI_HOLDINGS].find((h) => h.symbol === s)?.mon ?? null);
  assertEquals(left(g), ['NVDA', 'AAPL', 'CRM', 'TSLA', 'COST', 'V']); // picks 2, 11, 14, 23, 26, 35
  assertEquals(right(g), ['AMZN', 'JPM', 'DIS', 'NKE', 'KO', 'BA']); // picks 5, 8, 17, 20, 29, 32
  assert(g[0].rows.every((r) => r.left!.weekGain === 0 && r.right!.weekGain === 0));
});

// ── Groups ────────────────────────────────────────────────────────────────────────

Deno.test('a category league groups by slot in slot order, best first within each group', () => {
  const g = view(new Date('2026-09-24T17:37:00Z'), thuQuote, 'category');
  assertEquals(g.map((x) => x.label), ['Tech', 'Retail ×2', 'Finance', 'Flex ×3']);
  assertEquals(g[0].rows.map((r) => [r.left?.symbol ?? null, r.right?.symbol ?? null]), [['NVDA', null]], 'Gianluigi\'s Tech slot is open');
  assertEquals(g[1].rows.map((r) => r.left?.symbol ?? null)[1], null, 'Roberto\'s second Retail slot is open');
  assertEquals(g[1].rows.map((r) => r.right?.symbol).filter(Boolean).length, 2); // AMZN, NKE
  const flex = g[3];
  assertEquals(flex.rows.map((r) => r.left?.symbol), ['AAPL', 'CRM', 'TSLA'].sort((a, b) => {
    const h = (s: string) => ROBERTO_HOLDINGS.find((x) => x.symbol === s)!;
    return fixtureQty(h(b)) * (h(b).prev - h(b).mon) - fixtureQty(h(a)) * (h(a).prev - h(a).mon);
  }));
});

Deno.test('a price-tier league groups the same way, under its bands', () => {
  const g = view(new Date('2026-09-24T17:37:00Z'), thuQuote, 'tiers');
  assertEquals(g.map((x) => x.label), ['$200 or more ×5', '$100–$200 ×2', 'up to $100 ×2']);
  assertEquals(g[2].rows.map((r) => r.left), [null, null]);
});

Deno.test('rosterGroups: an unrecorded position is never guessed into a slot — a headless tail, best first', () => {
  const slots = [{ id: 's1', index: 0, label: 'Tech' }];
  const groups = rosterGroups({ mine: [e('A', 1, 5, 's1'), e('L1', 2, 1, null), e('L2', 3, 9, 'gone')], theirs: [], slots, hasClose: true });
  assertEquals(groups.map((g) => g.slot?.label ?? null), ['Tech', null]);
  assertEquals(syms(groups[1].mine), ['L2', 'L1']);
});

Deno.test('rosterGroups: an empty slot on both sides draws no head', () => {
  const slots = [{ id: 'a', index: 0, label: 'A' }, { id: 'b', index: 1, label: 'B' }];
  assertEquals(rosterGroups({ mine: [e('X', 1, 0, 'b')], theirs: [], slots, hasClose: false }).map((g) => g.slot?.id), ['b']);
});

Deno.test('pairRows: i-th against i-th, the shorter side leaves its half empty', () => {
  const rows = pairRows({ slot: null, mine: [e('A', 1, 1), e('B', 2, 0)], theirs: [e('X', 1, 1)] });
  assertEquals(rows.map((r) => [r.left?.symbol ?? null, r.right?.symbol ?? null]), [['A', 'X'], ['B', null]]);
});

// ── Slots ─────────────────────────────────────────────────────────────────────────

const slot = (o: Partial<SlotRow>): SlotRow => ({ id: 'x', slot_index: 0, slot_count: 1, price_min: null, price_max: null, category: null, ...o });

Deno.test('slotGroupLabel: the rules\' own examples', () => {
  assertEquals(slotGroupLabel(slot({ category: 'tech', slot_count: 3 })), 'Tech ×3');
  assertEquals(slotGroupLabel(slot({ category: 'transport', slot_count: 2 })), 'Autos ×2');
  assertEquals(slotGroupLabel(slot({ price_min: 100, price_max: 200, slot_count: 2 })), '$100–$200 ×2');
  assertEquals(slotGroupLabel(slot({ price_min: 100, price_max: 200 })), '$100–$200');
  assertEquals(slotGroupLabel(slot({ price_min: 100, price_max: 200, category: 'tech' })), '$100–$200 Tech');
  assertEquals(slotGroupLabel(slot({})), 'Flex');
  assertEquals(slotGroupLabel(slot({ slot_count: 3 })), 'Flex ×3');
});

Deno.test('isSlotted: only a filter makes a league slotted; flex-only slots are one flat list', () => {
  assertEquals(isSlotted([]), false);
  assertEquals(isSlotted([slot({}), slot({ slot_count: 3 })]), false);
  assertEquals(isSlotted([slot({}), slot({ category: 'tech' })]), true);
  assertEquals(isSlotted([slot({ price_max: 50 })]), true);
});

Deno.test('cardSlotPill: a category shows its pill, a tier its band, Flex nothing', () => {
  assertEquals(cardSlotPill(slot({ category: 'retail' })), { category: 'retail' });
  assertEquals(cardSlotPill(slot({ price_min: 100, price_max: 200 })), { slot: '$100–$200' });
  assertEquals(cardSlotPill(slot({})), null);
  assertEquals(cardSlotPill(null), null);
});

Deno.test('recordedSlots: the position\'s opening event — the last BUY, else the pick; a null buy stays null', () => {
  const ev = (symbol: string, kind: 'draft' | 'buy', slot_id: string | null, at: string) => ({ user_id: 'u', symbol, kind, slot_id, at });
  const out = recordedSlots('u', [
    ev('NVDA', 'draft', 'tech', '2026-09-01'),
    ev('AAPL', 'draft', 'tech', '2026-09-01'),
    ev('AAPL', 'buy', 'flex', '2026-09-10'), // drafted, sold, bought back: the BUY's slot
    ev('KO', 'buy', null, '2026-09-11'), // a pre-fix buy: unrecorded, never derived
    { user_id: 'other', symbol: 'NVDA', kind: 'draft', slot_id: 'z', at: '2026-09-01' },
  ]);
  assertEquals(out, { NVDA: 'tech', AAPL: 'flex', KO: null });
});

Deno.test('seqOf: picks by number, later buys after every pick in the order bought', () => {
  const ledger = fixtureLedger('bought', 'me', 'gia');
  const seq = seqOf('me', ledger.activity);
  assertEquals(seq.get('NVDA'), 2);
  assert(seq.get('MSFT')! > seq.get('V')!, 'MSFT was bought: after the last pick');
});

// ── Source guards ─────────────────────────────────────────────────────────────────

Deno.test('Matchup: the order reads the last CLOSE (never the live gain), and the roster waits for its order', () => {
  const src = SOURCES['app/(tabs)/matchup.tsx'];
  assert(src.includes('const closes = useMemo(() => closesBefore(now, sessions), [now, sessions]);'));
  assert(src.includes('barsAt: orderBarsAt(raw.now, orderAsOf, SEAM_ON),'), 'the fetch time, held to the last focus or refresh');
  assert(src.includes('useFocusEffect(useCallback(() => {\n    setOrderAsOf(new Date());'), 'a new order applies on arrival');
  assert(src.includes('setOrderAsOf(new Date());\n    await Promise.all([refresh(), mRefresh()]);'), '…and on pull to refresh');
  assert(src.includes('if (!view) return <RosterRowsSkeleton />;'), 'no list that re-sorts once the ledger lands');
  const view = SOURCES['lib/game/matchupRosterView.ts'];
  assert(view.includes('const ordering = orderingClose({ closes, sides: opp ? [me, opp] : [me], bars, barsAt });'));
  assert(view.includes('closeGain: gains ? gains[sym] ?? null : null,'));
  assert(!/closeGain:[^\n]*cents/.test(view), 'the order never reads the live cents');
});

Deno.test('Matchup: nothing else — no race chart, no chyron, no old scoreboard; the centre column stays empty', () => {
  const src = SOURCES['app/(tabs)/matchup.tsx'];
  assert(!/<Chyron|useLeadChyron|<MatchScoreboard|<WeekRace|TugBar/.test(src));
  const row = SOURCES['components/sp/gn/RosterRow.tsx'];
  assert(row.includes('<View style={{ width: CENTRE_GAP }} />'), 'the centre is a gap, nothing in it');
  assert(row.includes('const CENTRE_GAP = space[4];'));
});

Deno.test('Matchup: any stock on either side opens the player card; a half that can\'t is not pressable', () => {
  const src = SOURCES['app/(tabs)/matchup.tsx'];
  assert(src.includes("left={half('me', r.left)}"));
  assert(src.includes("right={half('opp', r.right)}"));
  assert(src.includes('onPress: openable(side, c.symbol) ? () => open(side, c.symbol) : undefined'));
  assert(SOURCES['components/sp/gn/RosterRow.tsx'].includes('if (!half.onPress) {'), 'no onPress → a plain View');
});

// ── Giorgio, 2026-10-12: a close orders the rows "AFTER TRADING ENDS" ─────────────

Deno.test('settle: a normal close counts only once extended hours end (4:00 PM close → 8:00 PM ET)', () => {
  const close = THU_CLOSE; // Thu 4:00 PM ET
  assertEquals(settlesAt(close).toISOString(), '2026-09-25T00:00:00.000Z'); // 8:00 PM EDT
  assertEquals(barCloseAt(bars, new Date('2026-09-24T23:59:00Z'), close)('NVDA'), null); // 7:59 PM: not yet
  assertEquals(barCloseAt(bars, new Date('2026-09-25T00:00:00Z'), close)('NVDA'), ROBERTO_HOLDINGS[0].thu);
});

Deno.test('settle: an EARLY close settles from its own close (1:00 PM → 5:00 PM ET)', () => {
  const early = closesBefore(new Date('2026-11-28T00:00:00Z'), [{ sessionDate: '2026-11-27', openEt: '09:30:00', closeEt: '13:00:00' }])[0];
  assertEquals(early.at.toISOString(), '2026-11-27T18:00:00.000Z'); // 1:00 PM EST
  assertEquals(settlesAt(early).toISOString(), '2026-11-27T22:00:00.000Z'); // 5:00 PM EST
  const b = { NVDA: [{ date: '2026-11-27', close: 180 }] };
  assertEquals(barCloseAt(b, new Date('2026-11-27T21:59:00Z'), early)('NVDA'), null);
  assertEquals(barCloseAt(b, new Date('2026-11-27T22:00:00Z'), early)('NVDA'), 180);
});

Deno.test('the order never moves under a poll: the fetch time is held to the last focus or refresh', () => {
  const focus = new Date('2026-09-24T23:00:00Z');
  assertEquals(orderBarsAt(new Date('2026-09-25T01:00:00Z'), focus, false), focus); // a 9 PM poll after a 7 PM focus
  assertEquals(orderBarsAt(new Date('2026-09-24T22:00:00Z'), focus, false).toISOString(), '2026-09-24T22:00:00.000Z');
});
