/**
 * W4 the player card: its numbers (playerCardModel.ts), its one action (gameNight.cardAction,
 * typed so no button renders without its handler), and the W3 gate's carried details.
 * `deno test` TYPE-CHECKS this file: the `@ts-expect-error` lines below are the required-
 * handler guard — if the ownership union ever lets a Sell or a Save through without its
 * handler, the expected error disappears and this file fails to compile.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { cardAction, type PlayerCardOwnership } from '../components/sp/logic/gameNight.ts';
import { openingOf, playerCardData, prevCloseOf, seasonLine, sinceFigures, stockWeek, weekLine } from '../lib/game/playerCardModel.ts';
import { fixtureLedger, fixtureSeasonBars } from '../lib/game/matchupFixture.ts';
import { standardWeekSessions } from '../lib/time/marketWeek.ts';
import { ROBERTO_HOLDINGS, fixtureQty } from '../lib/home/homeFixtureData.ts';
import type { LedgerActivityRow } from '../lib/money/portfolioLedger.ts';
import { SOURCES } from './sourceManifest.generated.ts';

const strip = (src: string) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const noop = () => {};

// ── Required handlers (compile-time) ──────────────────────────────────────────────

Deno.test('ownership: Sell needs onSell, Save needs its toggle — by type', () => {
  // @ts-expect-error yours, held, with no onSell: a Sell button with no action
  const a: PlayerCardOwnership = { owner: 'you' };
  // @ts-expect-error theirs with no `save` key at all: the caller must say "no watchlist" (null)
  const b: PlayerCardOwnership = { owner: { name: 'Gianluigi B.' } };
  // @ts-expect-error theirs with a Save and no toggle
  const c: PlayerCardOwnership = { owner: { name: 'Gianluigi B.' }, save: { saved: false } };
  // @ts-expect-error yours can never carry a Save
  const d: PlayerCardOwnership = { owner: 'you', onSell: noop, save: { saved: false, onToggle: noop } };
  // @ts-expect-error "sold" and a Sell handler together
  const e: PlayerCardOwnership = { owner: 'you', sold: true, onSell: noop };
  const ok: PlayerCardOwnership[] = [
    { owner: 'you', onSell: noop },
    { owner: 'you', sold: true },
    { owner: { name: 'Gianluigi B.' }, save: null },
    { owner: { name: 'Gianluigi B.' }, save: { saved: true, onToggle: noop } },
  ];
  assertEquals([a, b, c, d, e].length + ok.length, 9);
});

// ── The one action ────────────────────────────────────────────────────────────────

Deno.test('cardAction: yours → Sell (its handler) while open; disabled WITH the reason while closed; never Save', () => {
  let sold = 0;
  const open = cardAction({ owner: 'you', onSell: () => sold++, marketOpen: true, opens: 'Mon 9:30 AM ET' })!;
  assertEquals([open.label, open.disabled, open.note, open.star], ['Sell', false, null, null]);
  open.onPress!();
  assertEquals(sold, 1);
  const closed = cardAction({ owner: 'you', onSell: noop, marketOpen: false, opens: 'Mon 9:30 AM ET' })!;
  assertEquals([closed.label, closed.disabled, closed.onPress], ['Sell', true, undefined]);
  assertEquals(closed.note, "Market's closed. Opens Mon 9:30 AM ET.");
  // The next open unknown: the app's own closed line, never "Opens ." with a hole in it.
  assertEquals(cardAction({ owner: 'you', onSell: noop, marketOpen: false, opens: null })!.note, 'Trading is closed right now.');
});

Deno.test('cardAction: a disabled button only ever comes with its reason', () => {
  for (const marketOpen of [true, false]) {
    for (const p of [
      { owner: 'you' as const, onSell: noop },
      { owner: { name: 'G' }, save: { saved: false, onToggle: noop } },
      { owner: { name: 'G' }, save: { saved: true, onToggle: noop } },
    ]) {
      const a = cardAction({ ...p, marketOpen, opens: null });
      if (a?.disabled) assert(a.note, 'disabled without a reason');
      if (a && !a.disabled) assert(a.onPress, 'enabled without a handler');
    }
  }
});

Deno.test('cardAction: theirs → Save (outline star) / Saved (the same star filled, "Saved"); no watchlist → nothing', () => {
  let toggled = 0;
  const save = cardAction({ owner: { name: 'G' }, save: { saved: false, onToggle: () => toggled++ }, marketOpen: false, opens: null })!;
  assertEquals([save.label, save.star, save.disabled, save.saved], ['Save', 'star', false, false]);
  save.onPress!();
  assertEquals(toggled, 1);
  const saved = cardAction({ owner: { name: 'G' }, save: { saved: true, onToggle: noop }, marketOpen: true, opens: null })!;
  assertEquals([saved.label, saved.star], ['Saved', 'starFilled']);
  assertEquals(cardAction({ owner: { name: 'G' }, save: null, marketOpen: true, opens: null }), null);
  assertEquals(cardAction({ owner: 'you', sold: true, marketOpen: true, opens: null }), null, 'a stock sold this week: no action');
});

Deno.test('cardAction: NO Save on your own stock, in any market state', () => {
  for (const marketOpen of [true, false]) {
    const a = cardAction({ owner: 'you', onSell: noop, marketOpen, opens: 'Mon 9:30 AM ET' })!;
    assert(a.label !== 'Save' && a.label !== 'Saved' && a.star === null);
  }
});

// ── How it was got ────────────────────────────────────────────────────────────────

const row = (o: Partial<LedgerActivityRow>): LedgerActivityRow => ({
  kind: 'draft', user_id: 'u', symbol: 'NVDA', action: 'buy', quantity: 3, round: 1, pick_number: 2,
  occurred_at: '2026-09-29T23:00:00.000Z', total_value: null, price: 290.1, ...o,
});

Deno.test('openingOf: a draft pick → "Drafted 2nd overall · Sep 29 · $290.10" (the ET date, the price per share)', () => {
  const o = openingOf('u', 'NVDA', [row({})])!;
  assertEquals(o.acquisition, { kind: 'drafted', pick: 2, date: 'Sep 29', price: 290.1 });
  assertEquals([o.dateIso, o.quantity], ['2026-09-29', 3]);
  // 11 PM UTC on Sep 30 is 7 PM ET the same day; 1 AM UTC Oct 1 is still Sep 30 in ET.
  assertEquals(openingOf('u', 'NVDA', [row({ occurred_at: '2026-10-01T01:00:00.000Z' })])!.acquisition.date, 'Sep 30');
});

Deno.test('openingOf: the LAST buy opens the position (drafted, sold, bought back → "Bought")', () => {
  const o = openingOf('u', 'NVDA', [
    row({}),
    row({ kind: 'trade', action: 'sell', pick_number: null, round: null, occurred_at: '2026-10-01T15:00:00Z', price: 300 }),
    row({ kind: 'trade', action: 'buy', pick_number: null, round: null, occurred_at: '2026-10-02T15:00:00Z', price: 214.8, quantity: 4 }),
  ])!;
  assertEquals(o.acquisition, { kind: 'bought', date: 'Oct 2', price: 214.8 });
  assertEquals(o.quantity, 4);
});

Deno.test('openingOf: nothing in the ledger → null (the card is never shown without "How you got it")', () => {
  assertEquals(openingOf('u', 'AAPL', [row({})]), null);
  assertEquals(openingOf('other', 'NVDA', [row({})]), null);
});

Deno.test('no waiver claims are invented: trades carry no claim marker, so a buy reads "Bought"', () => {
  const src = strip(SOURCES['lib/game/playerCardModel.ts']);
  assert(!/kind: 'claimed'/.test(src));
});

// ── The figures ───────────────────────────────────────────────────────────────────

const nvda = ROBERTO_HOLDINGS[0];
const snap = [{ symbol: 'NVDA', quantity: fixtureQty(nvda), weekStartPrice: nvda.mon, enteredMidWeek: false }];

Deno.test('stockWeek: the row\'s own number (liveWeekScore over this one stock)', () => {
  const w = stockWeek('NVDA', snap, [], nvda.thu);
  assertEquals(Math.round(w.gain * 100), Math.round(fixtureQty(nvda) * (nvda.thu - nvda.mon) * 100));
  assertEquals(Math.round(w.pct * 100) / 100, Math.round(((nvda.thu - nvda.mon) / nvda.mon) * 10000) / 100);
});

Deno.test('since and today', () => {
  const o = openingOf('u', 'NVDA', [row({ quantity: 2 })])!;
  const s = sinceFigures(318.37, o);
  assertEquals(Math.round(s.gain * 100) / 100, Math.round((318.37 - 290.1) * 2 * 100) / 100);
  assertEquals(prevCloseOf([{ date: '2026-09-23', close: 1 }, { date: '2026-09-24', close: 2 }], '2026-09-24'), 1);
  assertEquals(prevCloseOf([{ date: '2026-09-24', close: 2 }], '2026-09-24'), null);
});

// ── The lines ─────────────────────────────────────────────────────────────────────

Deno.test('seasonLine: from the entry price on the acquisition date to the live price today, dated axis', () => {
  const o = openingOf('me', 'NVDA', fixtureLedger('unslotted', 'me', 'g').activity)!;
  const s = seasonLine({ opening: o, bars: fixtureSeasonBars('NVDA'), todayEt: '2026-09-24', price: nvda.thu });
  assertEquals(s.points[0], { t: 0, value: nvda.draft });
  assertEquals(s.points[s.points.length - 1].value, nvda.thu);
  assertEquals(s.axis, { kind: 'dated', start: o.dateIso, end: '2026-09-24' });
  assertEquals(s.base, nvda.draft);
  assert(s.points.every((p, i) => i === 0 || p.t > s.points[i - 1].t), 'ascending, one point per day');
});

Deno.test('seasonLine: a stock bought today is ONE point on its full (same-day) axis', () => {
  const o = openingOf('me', 'COST', fixtureLedger('bought', 'me', 'g').activity)!;
  assertEquals(o.dateIso, '2026-09-24');
  const s = seasonLine({ opening: o, bars: fixtureSeasonBars('COST'), todayEt: '2026-09-24', price: 918.1 });
  assertEquals(s.points, [{ t: 0, value: 918.1 }]);
  assertEquals(s.axis, { kind: 'dated', start: '2026-09-24', end: '2026-09-24' });
});

const week = standardWeekSessions('2026-09-25T20:00:00Z');
const weekBars = [{ date: '2026-09-21', close: 301 }, { date: '2026-09-22', close: 303 }, { date: '2026-09-23', close: 306.68 }, { date: '2026-09-24', close: 318 }];

Deno.test('weekLine: Mon open at 0, each closed day at its end, now mid-Thursday; the days to come empty', () => {
  const w = weekLine({ sessions: week, start: { t: 0, value: 300.2 }, bars: weekBars, price: 318.37, now: new Date('2026-09-24T17:37:00Z') });
  assertEquals(w.points.slice(0, 4), [{ t: 0, value: 300.2 }, { t: 1, value: 301 }, { t: 2, value: 303 }, { t: 3, value: 306.68 }]);
  const last = w.points[w.points.length - 1];
  assertEquals(last.value, 318.37);
  assert(last.t > 3 && last.t < 4, 'Thursday, part-way');
  assertEquals(w.base, 300.2);
});

Deno.test('weekLine: Monday before the open is the one point at the open (the 0/1-point state)', () => {
  const w = weekLine({ sessions: week, start: { t: 0, value: 300.2 }, bars: [], price: 300.2, now: new Date('2026-09-21T12:00:00Z') });
  assertEquals(w.points, [{ t: 0, value: 300.2 }]);
});

Deno.test('weekLine: a holiday leaves its own day\'s slot empty (slots by weekday, not by session count)', () => {
  const noTue = week.filter((s) => s.sessionDate !== '2026-09-22');
  const w = weekLine({ sessions: noTue, start: { t: 0, value: 300 }, bars: weekBars, price: 310, now: new Date('2026-09-25T00:00:00Z') });
  assertEquals(w.points.map((p) => p.t), [0, 1, 3, 4]);
});

Deno.test('playerCardData: the card agrees with the row and says how it was got', () => {
  const ledger = fixtureLedger('unslotted', 'me', 'g');
  const d = playerCardData({
    symbol: 'NVDA', company: 'NVIDIA', userId: 'me', activity: ledger.activity, snapshots: snap, trades: [],
    weekGain: 62.4, price: nvda.thu, bars: weekBars, seasonBars: null, sessions: week, now: new Date('2026-09-24T17:37:00Z'),
  })!;
  assertEquals(d.weekGain, 62.4, 'the row\'s own cents, so card and row never disagree');
  assertEquals(d.acquisition.kind, 'drafted');
  assertEquals(d.season.points, [], 'season bars still loading: the base and the axis, never a made-up segment');
  assertEquals(d.held, fixtureQty(nvda));
});

// ── The card as drawn (the W3 gate's carried items) ───────────────────────────────

Deno.test('PlayerCard: "How you got it" in its inset panel (radius 14, 12 / 14) with the card label as its title', () => {
  const src = strip(SOURCES['components/sp/gn/PlayerCard.tsx']);
  assert(src.includes('<View style={[styles.how, { backgroundColor: colors.inset }]}'));
  assert(/how: \{\s*gap: space\[2\],\s*borderRadius: radius\.lg,\s*paddingVertical: space\[4\],\s*paddingHorizontal: 14,/.test(src));
  assert(src.includes("<CardLabel text={howTitle(owner === 'you' ? 'you' : 'other')} />"));
  assert(/howLine: \{\s*fontWeight: '700',\s*fontVariant: \['tabular-nums'\],/.test(src));
  // The block is the LAST section before the credit.
  assert(src.indexOf('6. How you got it') > src.indexOf('5. The one action'));
  assert(src.indexOf('6. How you got it') < src.indexOf('7. The Alpaca credit'));
});

Deno.test('PlayerCard: Save carries the drawn star; the Season row carries "{entry} → {now}"', () => {
  const src = strip(SOURCES['components/sp/gn/PlayerCard.tsx']);
  assert(src.includes('{action.star ? <Icon name={action.star} size="body" tone="text" /> : null}'));
  assert(!/backgroundColor: colors\.accent/.test(src), 'Saved has no accent fill');
  assert(src.includes('{`${formatMoney(acquisition.price)} → ${formatMoney(price)}`}'));
});

Deno.test('PlayerCard: the action is drawn only from cardAction (never a handler-less button), and the X closes', () => {
  const src = strip(SOURCES['components/sp/gn/PlayerCard.tsx']);
  assert(src.includes('const action = cardAction(props);'));
  assert(src.includes('{action ? ('));
  assert(src.includes('onPress={action.onPress}'));
  assert(!/onToggleSave|saved = false/.test(src), 'no optional handler props left');
  assert(src.includes('<Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close"'));
});

Deno.test('PlayerCard: the 4pt scale (gap 16, pill padding 12, owner-pill gap 8, strip padding 8)', () => {
  const src = strip(SOURCES['components/sp/gn/PlayerCard.tsx']);
  assert(/body: \{\s*paddingHorizontal: SHEET_GUTTER,\s*paddingBottom: space\[7\],\s*gap: space\[5\],/.test(src));
  assert(!/gap: 14|paddingHorizontal: 10|gap: 6,|paddingLeft: 3|paddingHorizontal: 6,/.test(src));
  const sb = strip(SOURCES['components/sp/gn/Scoreboard.tsx']);
  assert(!/paddingHorizontal: 14|gap: 10,/.test(sb));
  const rr = strip(SOURCES['components/sp/gn/RosterRow.tsx']);
  assert(!/paddingVertical: 5|CENTRE_GAP = 10/.test(rr));
  assert(!/gap: 18/.test(strip(SOURCES['components/sp/gn/RangePills.tsx'])));
});

Deno.test('RosterRow: VoiceOver says whose half it is ("Yours, …" / "{name}, …")', () => {
  const src = strip(SOURCES['components/sp/gn/RosterRow.tsx']);
  assert(src.includes('return `${whose}, ${half.ticker}, ${half.company},'));
  assert(src.includes('const a11y = rosterHalfLabel(whose, half);'));
  assert(SOURCES['app/(tabs)/matchup.tsx'].includes('opponentName={opp.name}'));
});

Deno.test('Matchup: Sell hands off to the stock sheet only once the card has left; theirs shows no dead Save', () => {
  const src = SOURCES['app/(tabs)/matchup.tsx'];
  assert(src.includes('if (sell) stockSheet.open(sell.symbol, { name: sell.name });'));
  assert(src.indexOf('stockSheet.open(') > src.indexOf('onClosed={() => {'));
  assert(src.includes("ownership = { owner: { name: opp.name }, save: null };"), 'no watchlist exists yet: Save hidden, never dead');
  assert(SOURCES['components/sp/Sheet.tsx'].includes('onClosedRef.current?.();'));
});

// ── Found in the W4 capture pass (17e, XL) ────────────────────────────────────────

Deno.test('XL: the card stacks its three figures and caps its small text; the scoreboard names never break mid-word', () => {
  const card = strip(SOURCES['components/sp/gn/PlayerCard.tsx']);
  assert(card.includes('const stacked = useLargeText();'));
  assert(card.includes('stacked ? styles.stripStacked : null'));
  assert(/figureStacked: \{\s*flex: 0,/.test(card), 'a stacked figure takes no flex share, or it collapses');
  assert(card.includes('const CARD_TEXT_MAX_SCALE = 1.6;'));
  const sb = strip(SOURCES['components/sp/gn/Scoreboard.tsx']);
  assert(sb.includes('maxFontSizeMultiplier={NAME_MAX_SCALE}'));
  assert(sb.includes('stacked ? (mirror ? styles.whoStackedMirror : styles.whoStacked)'), 'the avatar sits over the name when it won\'t fit beside it');
  assert(sb.includes('numberOfLines={1} adjustsFontSizeToFit minimumFontScale={NAME_MIN_SCALE}'), 'one line, never "Gianluigi" / "B."');
  assert(sb.includes('maxFontSizeMultiplier={LINE_MAX_SCALE}') && sb.includes('export const LINE_MAX_SCALE = 1.3;'), 'the leads-by line stays under the totals');
  const row = strip(SOURCES['components/sp/gn/RosterRow.tsx']);
  assert((row.match(/maxFontSizeMultiplier=\{ROW_TEXT_MAX_SCALE\}/g) ?? []).length >= 2, 'ticker and company capped');
  assert(row.includes('maxFontSizeMultiplier={PCT_MAX_SCALE}') && row.includes('const PCT_MAX_SCALE = 1.3;'), 'the percent never outgrows the gain');
  assert(row.includes('stacked ? [styles.numStacked, mirror ? styles.alignEnd : styles.alignStart]'), 'stacked numbers on the outer edge, no 64% cap');
  assert(SOURCES['app/(tabs)/matchup.tsx'].includes('maxFontSizeMultiplier={LINE_MAX_SCALE}>{note}'), 'the unpriced note capped too');
  assert(row.includes('minimumFontScale={0.7}') && 17 * 0.7 >= 11, 'a seven-figure week shrinks, never under 11pt');
});
