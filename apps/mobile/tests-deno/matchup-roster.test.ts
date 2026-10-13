/**
 * W4 Matchup roster: the row order and the slot groups (PRODUCT_RULES "Matchup roster row
 * order", Giorgio 2026-10-12): best first by week gain; slotted leagues (category slots AND
 * price tiers) grouped in slot order, best first within; unslotted one list; the order read
 * at the LAST MARKET CLOSE and held through the next day, never live; before the week's
 * first close, the draft/slot order. Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import {
  cardSlotPill, gainsAtClose, isSlotted, lastWeekClose, orderSide, pairRows, recordedSlots, rosterGroups, slotGroupLabel,
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

Deno.test('gainsAtClose: priced at the close (the bar), not the live quote; trades after the close don\'t count', () => {
  const close = { date: '2026-09-23', at: new Date('2026-09-23T20:00:00Z') };
  const live = () => 99999; // a wild live quote must change nothing
  const g = gainsAtClose({ snapshots: snaps(ROBERTO_HOLDINGS), trades: [], close, bars, todayEt: '2026-09-24', quote: live });
  const nvda = ROBERTO_HOLDINGS[0];
  assertEquals(Math.round(g.NVDA * 100), Math.round(fixtureQty(nvda) * (nvda.prev - nvda.mon) * 100));
  const after = gainsAtClose({
    snapshots: [], trades: [{ symbol: 'ZZZ', action: 'buy', quantity: 1, price: 10, createdAt: new Date('2026-09-24T15:00:00Z') }],
    close, bars, todayEt: '2026-09-24', quote: live,
  });
  assertEquals(after.ZZZ, undefined, 'a buy after the close has no held number');
});

Deno.test('gainsAtClose: on the close\'s own evening, before the bar lands, the quote IS the close', () => {
  const close = { date: '2026-09-24', at: new Date('2026-09-24T20:00:00Z') };
  const g = gainsAtClose({ snapshots: snaps(ROBERTO_HOLDINGS.slice(0, 1)), trades: [], close, bars: {}, todayEt: '2026-09-24', quote: () => 320 });
  assert(g.NVDA > 0);
  const stale = gainsAtClose({ snapshots: snaps(ROBERTO_HOLDINGS.slice(0, 1)), trades: [], close, bars: {}, todayEt: '2026-09-25', quote: () => 320 });
  assertEquals(stale.NVDA, undefined, 'a quote the day after is not that close');
});

/** The roster for the board's week at `now`, priced live by `quote`. */
function view(now: Date, quote: (s: string) => number | null, variant: 'unslotted' | 'category' | 'tiers' = 'unslotted') {
  const side = (userId: string, rows: typeof ROBERTO_HOLDINGS) => {
    const live = liveWeekScore(snaps(rows), [], quote);
    return { userId, lineup: lineupRows(live.bySymbol, live.gain), snapshots: snaps(rows), trades: [] };
  };
  const ledger = fixtureLedger('unslotted', 'me', 'gia');
  const slots = fixtureSlots(variant, 'me', 'gia');
  return buildRosterView({
    me: side('me', ROBERTO_HOLDINGS),
    opp: side('gia', GIANLUIGI_HOLDINGS),
    activity: ledger.activity,
    names: ledger.symbol_names,
    slots: slots?.slots ?? [],
    slotOf: slots?.bySide ?? {},
    close: lastWeekClose(now, sessions),
    bars,
    todayEt: '2026-09-24',
    quote,
    rowPrice: quote,
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

Deno.test('Monday before the first close: the draft order (by pick), every gain $0.00', () => {
  const g = view(new Date('2026-09-21T14:00:00Z'), (s) => [...ROBERTO_HOLDINGS, ...GIANLUIGI_HOLDINGS].find((h) => h.symbol === s)?.mon ?? null);
  assertEquals(left(g), ['NVDA', 'AAPL', 'CRM', 'TSLA', 'COST', 'V']); // picks 2, 11, 14, 23, 26, 35
  assertEquals(right(g), ['AMZN', 'JPM', 'DIS', 'NKE', 'KO', 'BA']); // picks 5, 8, 17, 20, 29, 32
  assert(g[0].rows.every((r) => r.left!.weekGain === 0 && r.right!.weekGain === 0));
});

// ── Groups ────────────────────────────────────────────────────────────────────────

Deno.test('a category league groups by slot in slot order, best first within each group', () => {
  const g = view(new Date('2026-09-24T17:37:00Z'), thuQuote, 'category');
  assertEquals(g.map((x) => x.label), ['Tech ×3', 'Finance', 'Retail ×2', 'Flex ×3']);
  const tech = g[0];
  assertEquals(tech.rows.map((r) => r.left?.symbol), ['NVDA', 'CRM', 'AAPL'].sort((a, b) => {
    const h = (s: string) => ROBERTO_HOLDINGS.find((x) => x.symbol === s)!;
    return fixtureQty(h(b)) * (h(b).prev - h(b).mon) - fixtureQty(h(a)) * (h(a).prev - h(a).mon);
  }));
  assert(tech.rows.every((r) => r.right === null), 'Gianluigi has no Tech: his halves stay empty');
  assertEquals(g[2].rows.map((r) => r.right?.symbol).filter(Boolean).length, 2); // AMZN, NKE
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
  assert(seq.get('COST')! > seq.get('V')!, 'COST was bought: after the last pick');
});

// ── Source guards ─────────────────────────────────────────────────────────────────

Deno.test('Matchup: the order reads the last CLOSE (never the live gain), and the roster waits for its order', () => {
  const src = SOURCES['app/(tabs)/matchup.tsx'];
  assert(src.includes('const close = useMemo(() => lastWeekClose(now, sessions), [now, sessions]);'));
  assert(src.includes('if (!groups) return <RosterRowsSkeleton />;'), 'no list that re-sorts once the ledger lands');
  const view = SOURCES['lib/game/matchupRosterView.ts'];
  assert(view.includes('closeGain: close ? gains[sym] ?? null : null,'));
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
