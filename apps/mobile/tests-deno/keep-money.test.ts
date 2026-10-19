/**
 * keepMoney (W8 follow-up, Design Lead ruling 2026-10-16; gate rule: "a money amount never breaks inside itself").
 * At XXXL the Renewal review's Stakes value broke as "$1,000. / 00 a / slot". keepMoney puts a word joiner
 * (U+2060) between every glyph of an amount or signed percent in WRAPPING text, so a line can end before or after
 * it, never inside it. The unit after the amount still wraps.
 *
 * The pin simulates a WORST-CASE line breaker over each surface's real displayed string: a break is allowed between
 * any two characters except next to a word joiner or no-break space, or inside a run of letters. Greedy wrap at
 * every width from 6 to 60 characters; no line break may fall inside an amount. A negative control proves the
 * simulator sees the original bug in the unjoined string.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { NBSP, WORD_JOINER, keepDots, keepMoney } from '../lib/game/keepDots.ts';
import { formatMoney, formatPercent } from '../components/sp/logic/money.ts';
import { stakesLine } from '../lib/stakesLine.ts';
import { scoreboardModel, acquisitionLine } from '../components/sp/logic/gameNight.ts';
import { rosterCaption } from '../lib/game/draftRoom.ts';
import { rosterPickCaption } from '../lib/game/draftComplete.ts';
import { joinedFactRows } from '../lib/join/joinedFacts.ts';
import { previewView, type PreviewLeague } from '../lib/join/joinPreview.ts';
import { COPY } from '../lib/money/moneyCopy.ts';
import { formatShares } from '../lib/money/formatShares.ts';
import { SOURCES } from './sourceManifest.generated.ts';

const WJ = WORD_JOINER;

/** The amounts in `text` (WJ ignored): [startIdx, endIdx] in `text`'s own indices, inclusive. */
function amountRanges(text: string): [number, number][] {
  const keep: number[] = [];
  let plain = '';
  for (let i = 0; i < text.length; i++) if (text[i] !== WJ) { keep.push(i); plain += text[i]; }
  const re = /[+−]?\$\d[\d,]*(?:\.\d+)?[KMBT]?|[+−]?\d[\d,]*(?:\.\d+)?%/g;
  const out: [number, number][] = [];
  for (const m of plain.matchAll(re)) out.push([keep[m.index!], keep[m.index! + m[0].length - 1]]);
  return out;
}

/** Worst-case break opportunity BEFORE index i (i >= 1). */
function canBreakBefore(text: string, i: number): boolean {
  const a = text[i - 1];
  const b = text[i];
  if (a === WJ || b === WJ || a === NBSP || b === NBSP) return false;
  if (/\p{L}/u.test(a) && /\p{L}/u.test(b)) return false; // never inside a word
  return true;
}

/** Greedy wrap at `width` visible characters; returns the indices where a line break fell. */
function lineBreaks(text: string, width: number): number[] {
  const breaks: number[] = [];
  let atomStart = 0;
  let lineVisible = 0;
  const atoms: [number, number][] = [];
  for (let i = 1; i <= text.length; i++) {
    if (i === text.length || canBreakBefore(text, i)) { atoms.push([atomStart, i]); atomStart = i; }
  }
  for (const [s, e] of atoms) {
    const vis = [...text.slice(s, e)].filter((c) => c !== WJ).length;
    // a plain space at an atom's end/start is trailing/leading whitespace, not content
    const content = text.slice(s, e).trim().length === 0 ? 0 : vis;
    if (lineVisible > 0 && lineVisible + content > width && s > 0) { breaks.push(s); lineVisible = 0; }
    lineVisible += content === 0 ? 0 : vis;
  }
  return breaks;
}

/** No wrapped line, at any width, breaks inside an amount. Returns the offenders. */
function splitAmounts(display: string): string[] {
  const bad: string[] = [];
  const ranges = amountRanges(display);
  for (let width = 6; width <= 60; width++) {
    for (const b of lineBreaks(display, width)) {
      for (const [s, e] of ranges) if (b > s && b <= e) bad.push(`width ${width}: broke inside ${JSON.stringify(display.slice(s, e + 1).replaceAll(WJ, ''))}`);
    }
  }
  return bad;
}

/** No wrapped line, at any width, breaks between "a"/"per" and "slot"/"share" after an amount (never "a / slot"). */
function splitUnits(display: string): string[] {
  const bad: string[] = [];
  const units = [...display.matchAll(/[\d%KMBT] ((?:a|per)[ \u00a0](?:slot|share)(?![A-Za-z]))/g)].map((m) => {
    const start = m.index! + 2;
    return [start, start + m[1].length - 1] as const;
  });
  for (let width = 6; width <= 60; width++) {
    for (const b of lineBreaks(display, width)) for (const [s0, e] of units) if (b > s0 && b <= e) bad.push(`width ${width}: broke inside ${JSON.stringify(display.slice(s0, e + 1))}`);
  }
  return bad;
}

const L = (over: Partial<PreviewLeague> = {}): PreviewLeague => ({
  name: 'Serie A Traders', leagueType: 'matchup', numWeeks: 10, durationDays: null, numParticipants: 8, membersJoined: 6,
  draftDate: '2026-10-10T23:00:00Z', stakeMode: 'fixed_notional', notionalPerSlot: 2000, budgetAmount: null, draftStatus: 'not_started',
  seasonStatus: 'active', ...over,
} as PreviewLeague);

/** Each surface: the string its file renders (through the same pipe), and a source pin for the wiring. */
const SURFACES: { surface: string; file: string; pin: string; strings: string[] }[] = [
  {
    surface: 'Join preview rows', file: 'app/join-league.tsx', pin: '{keepMoney(keepDots(row.value))}',
    strings: [
      keepDots(previewView(L(), null).rows.find((r) => r.label === 'Stakes')!.value),
      keepDots(previewView(L({ stakeMode: 'budget_cap', notionalPerSlot: null, budgetAmount: 1500000 }), null).rows.find((r) => r.label === 'Stakes')!.value),
    ],
  },
  {
    surface: 'The facts card (You\'re in)', file: 'app/join-league.tsx', pin: '{keepMoney(keepDots(row.value))}',
    strings: [keepDots(joinedFactRows({ num_participants: 8, stake_mode: 'fixed_notional', notional_per_slot: 1000.5, budget_amount: null, league_type: 'matchup', num_weeks: 10, duration_days: null }, 7).find((r) => r.label === 'Stakes')!.value)],
  },
  { surface: 'Create league summary', file: 'app/create-league.tsx', pin: 'value={keepMoney(keepDots(stakesLine(state.stakeMode, {', strings: [keepDots(stakesLine('fixed_notional', { notionalPerSlot: 1000 })), keepDots(stakesLine('budget_cap', { budgetAmount: 10000 }))] },
  { surface: 'Renewal review (Stakes row)', file: 'components/game/RenewalReview.tsx', pin: '{keepMoney(value)}', strings: [`${formatMoney(1000)} a slot`, `${formatMoney(2345678.9)} a slot`] },
  {
    surface: 'Portfolio rows', file: 'components/money/PortfolioScreen.tsx', pin: '{keepMoney(v.perSlotText)}',
    strings: [COPY.perSlotAtDraft(formatMoney(2000.01)), formatMoney(12345.67), COPY.oneSaleReady(formatMoney(3538500), 'S049'), COPY.twoSalesReady(formatMoney(2194.91), 'NVDA', formatMoney(1890.12), 'TSLA'), COPY.budgetLeftToSpend(formatMoney(1240))],
  },
  {
    surface: 'Stock sheet', file: 'components/money/StockSheetBody.tsx', pin: '{keepMoney(model.sell.summary)}',
    strings: [`${formatMoney(11.69, { sign: 'always' })} · ${formatPercent(3.81, { sign: 'always' })}`, `${formatMoney(-194.9, { sign: 'always' })} · ${formatPercent(-9.74, { sign: 'always' })}`, formatMoney(1234567.89), COPY.sellAll(formatShares(6.8942), formatMoney(2194.91))],
  },
  {
    surface: 'Trade review panel', file: 'components/money/TradeReviewPanel.tsx', pin: '{keepMoney(review.card)}',
    strings: [COPY.vsSlotStart(formatMoney(2000.01)), `${formatMoney(2194.91)} ${COPY.slotCashStays}`, COPY.buyOutcome(formatMoney(2000), 'NVDA'), `${formatMoney(318.37)} · ${COPY.marketPrice}`],
  },
  { surface: 'Trade history rows', file: 'components/money/TradeHistoryScreen.tsx', pin: '{keepMoney(detail)}', strings: [`Mon 8:30 PM ET · ${formatShares(6.8942)} sh at ${formatMoney(290.1)}`, formatMoney(2000.01)] },
  { surface: 'Sale picker', file: 'components/money/SalePicker.tsx', pin: '{keepMoney(formatMoney(r.amount))}', strings: [formatMoney(2194.91), formatMoney(1500)] },
  { surface: 'Stock search price', file: 'components/money/StockSearchScreen.tsx', pin: '{keepMoney(formatMoney(item.price))}', strings: [formatMoney(1234.56), formatMoney(912.3)] },
  { surface: 'Draft room strip caption', file: 'components/game/DraftRoom.tsx', pin: 'caption={keepMoney(keepDots(caption))}', strings: [keepDots(rosterCaption(1, 6, { stakeMode: 'fixed_notional', notionalPerSlot: 2000 })), keepDots(rosterCaption(2, 6, { stakeMode: 'budget_cap', budgetLeft: 1240.5 }))] },
  { surface: 'Draft complete caption', file: 'components/game/DraftComplete.tsx', pin: '{keepMoney(keepDots(rosterPickCaption(r)))}', strings: [keepDots(rosterPickCaption({ round: 2, pick: 11 }))] },
  { surface: 'This week lead', file: 'components/home/ThisWeekCard.tsx', pin: '{keepMoney(formatMoney(gap))}', strings: [`You lead by ${formatMoney(123.15)}`, `You lead by ${formatMoney(1234567.89)}`] },
  { surface: 'Player card season caption', file: 'components/sp/gn/PlayerCard.tsx', pin: 'keepMoney(`${formatMoney(acquisition.price)} → ${formatMoney(price)}`)', strings: [`${formatMoney(290.1)} → ${formatMoney(318.37)}`] },
  { surface: 'Scoreboard lead line', file: 'components/sp/gn/Scoreboard.tsx', pin: '{keepMoney(line)}', strings: [scoreboardModel({ name: 'Roberto B.', gain: 1284.6 }, { name: 'Gianluigi B.', gain: -1038.25 }, false).line, scoreboardModel({ name: 'Roberto B.', gain: 213.6 }, { name: 'Gianluigi B.', gain: 90.45 }, true).line] },
  { surface: 'Player card acquisition line', file: 'components/sp/gn/PlayerCard.tsx', pin: '{keepMoney(acquisitionLine(acquisition))}', strings: [acquisitionLine({ kind: 'drafted', pick: 2, date: 'Aug 31', price: 290.1 }), acquisitionLine({ kind: 'bought', date: 'Oct 2', price: 1214.8 })] },
  { surface: 'Standings gains', file: 'components/sp/gn/ManagerRow.tsx', pin: '{keepMoney(gainText)}', strings: [formatMoney(512.4, { sign: 'always' }), formatMoney(-1234567.89, { sign: 'always' })] },
  { surface: 'Schedule gains', file: 'components/game/ScheduleList.tsx', pin: "keepMoney(formatMoney(r.gain, { sign: 'always' }))", strings: [formatMoney(-96.4, { sign: 'always' }), formatMoney(1204.55, { sign: 'always' })] },
];

Deno.test('keepMoney: a word joiner between every glyph of each amount; the text around it is untouched', () => {
  assertEquals(keepMoney('$1,000.00 a slot'), ['$', '1', ',', '0', '0', '0', '.', '0', '0'].join(WJ) + ` a${NBSP}slot`, 'the short unit is glued, the space before it is not');
  assertEquals(keepMoney('Equal stakes · $2,000 per slot'), `Equal stakes · ${['$', '2', ',', '0', '0', '0'].join(WJ)} per${NBSP}slot`);
  assertEquals(keepMoney('−$12.34 · +9.74% today'), `${['−', '$', '1', '2', '.', '3', '4'].join(WJ)} · ${['+', '9', '.', '7', '4', '%'].join(WJ)} today`);
  assertEquals(keepMoney('$1.23M'), ['$', '1', '.', '2', '3', 'M'].join(WJ));
  assertEquals(keepMoney('He paid $3.50.'), `He paid ${['$', '3', '.', '5', '0'].join(WJ)}.`, 'the sentence period is not part of the amount');
  assertEquals(keepMoney('Week 6 of 14'), 'Week 6 of 14');
  assertEquals(keepMoney('Sat, Oct 10 · 7:00 PM ET'), 'Sat, Oct 10 · 7:00 PM ET');
  assertEquals(keepMoney(''), '');
  assertEquals(keepMoney(keepMoney('$1,000.00')), keepMoney('$1,000.00'), 'applying it twice changes nothing');
  assertEquals(keepMoney('$1,000.00').replaceAll(WJ, ''), '$1,000.00', 'display only: strip the joiners and the copy is unchanged');
});

Deno.test('keepMoney: the short units stay whole ("a slot", "per slot", "a share", "per share"), only after an amount', () => {
  const amt = (a: string) => Array.from(a).join(WJ);
  assertEquals(keepMoney('$318.37 per share'), `${amt('$318.37')} per${NBSP}share`);
  assertEquals(keepMoney('$5 a share'), `${amt('$5')} a${NBSP}share`);
  assertEquals(keepMoney('$2,000.01 per slot at the draft'), `${amt('$2,000.01')} per${NBSP}slot at the draft`);
  assertEquals(keepMoney('Optional: a slot can require a category'), 'Optional: a slot can require a category', 'prose without an amount is untouched');
  assertEquals(keepMoney('$5 a slots'), `${amt('$5')} a slots`, 'only the whole word');
  assertEquals(keepMoney('+9.74% per share'), `${amt('+9.74%')} per share`, 'a percent has no unit');
});

Deno.test('the simulator sees the bug: the UNJOINED Stakes value breaks inside "$1,000.00"', () => {
  assert(splitAmounts('$1,000.00 a slot').length > 0, 'the control: a break can fall inside the amount');
  assert(splitAmounts(`Stakes ${formatMoney(2000.01)} per slot`).length > 0);
});

for (const s of SURFACES) {
  Deno.test(`${s.surface}: no line breaks inside an amount at any width (real strings, the file's own pipe)`, () => {
    for (const raw of s.strings) {
      const display = keepMoney(raw);
      assertEquals(splitAmounts(display), [], JSON.stringify(raw));
      assertEquals(display.replaceAll(WJ, '').replaceAll(NBSP, ' '), raw.replaceAll(WJ, '').replaceAll(NBSP, ' '), 'display only: the same words');
    }
    for (const raw of s.strings) assertEquals(splitUnits(keepMoney(raw)), [], `a unit split: ${JSON.stringify(raw)}`);
    assert(SOURCES[s.file].includes(s.pin), `${s.file} no longer wraps this surface: ${s.pin}`);
  });
}

Deno.test('the unit after an amount still wraps ("a slot" / "per slot" are not glued to it)', () => {
  const d = keepMoney('$1,000.00 a slot');
  assert(lineBreaks(d, 12).length > 0, 'a narrow width wraps after the amount');
  assert(lineBreaks(d, 12).every((b) => d[b - 1] !== WJ && d[b] !== WJ));
});

Deno.test('single-line money is left alone: the hero numbers and the shrink / numberOfLines cells carry no keepMoney', () => {
  const none = ['components/home/HomeHero.tsx', 'components/home/RollingMoney.tsx', 'components/sp/gn/RosterRow.tsx', 'components/money/HoldingRow.tsx', 'components/sp/Money.tsx'];
  for (const f of none) assert(!SOURCES[f].includes('keepMoney'), `${f} is single-line / shrink-to-fit: no keepMoney`);
});

/** The wrapping sites per file (the grep set, W8 follow-up). A changed count means a site was added or dropped:
 * update the list on purpose, with the surface's real string in SURFACES above. */
const SITE_COUNTS: Record<string, number> = {
  'app/create-league.tsx': 1, 'app/join-league.tsx': 2, 'components/game/DraftComplete.tsx': 1, 'components/game/DraftRoom.tsx': 2,
  'components/game/RenewalReview.tsx': 1, 'components/game/ScheduleList.tsx': 2, 'components/home/ThisWeekCard.tsx': 1,
  'components/money/PortfolioScreen.tsx': 3, 'components/money/SalePicker.tsx': 1, 'components/money/StockSearchScreen.tsx': 1,
  'components/money/StockSheetBody.tsx': 5, 'components/money/TradeHistoryScreen.tsx': 2, 'components/money/TradeReviewPanel.tsx': 5,
  'components/sp/gn/ManagerRow.tsx': 4, 'components/sp/gn/PlayerCard.tsx': 2, 'components/sp/gn/Scoreboard.tsx': 1,
};

Deno.test('every wrapping site is wired: the exact keepMoney( count per file, and no other file uses it', () => {
  const found: Record<string, number> = {};
  for (const [path, src] of Object.entries(SOURCES)) {
    if (!path.startsWith('app/') && !path.startsWith('components/')) continue;
    const n = (src.match(/\bkeepMoney\(/g) ?? []).length;
    if (n > 0) found[path] = n;
  }
  assertEquals(found, SITE_COUNTS);
});

Deno.test('the joiner only helps if the amount can sit on a line: the Renewal Stakes row wraps its value UNDER its label', () => {
  // keepMoney removes every break opportunity inside an amount; a value column squeezed narrower than the amount
  // (XXXL, "Stakes | $1,000.00 a slot") then breaks it anywhere. flexWrap lets the value drop below the label.
  const src = SOURCES['components/game/RenewalReview.tsx'];
  assert(/row: \{ flexDirection: 'row', flexWrap: 'wrap',/.test(src), 'the review row wraps');
  assert(src.includes("value: { alignItems: 'flex-end', flexShrink: 1, marginLeft: 'auto' },"));
});

Deno.test('the unit is glued, the amount-to-unit space is not: "$1,000.00" / "a slot" or one line, never "a / slot"', () => {
  const d = keepMoney('Stakes $1,000.00 a slot');
  assertEquals(splitUnits(d), []);
  // the amount and the unit CAN part (a narrow line puts "a slot" under the amount) ...
  assert(lineBreaks(d, 12).some((b) => d.slice(b).trimStart().startsWith(`a${NBSP}slot`)), 'a narrow line wraps "a slot" whole');
  // ... and the control: an unglued unit splits
  assert(splitUnits('$1,000.00 a slot').length > 0);
});

Deno.test('SettingRow: a row wraps its value UNDER the label (a label is never dropped), the chevron rides with it', () => {
  const src = SOURCES['components/game/SetupRows.tsx'];
  assert(src.includes('styles.settingRow, styles.settingRowWrap, disabled && styles.dim'));
  assert(src.includes('<View style={styles.growWrap}>'));
  assert(src.includes('style={valueLines > 1 ? [styles.value, styles.valueMulti] : styles.value}'));
  assert(src.includes('onTextLayout={(e) => setValueLines(e.nativeEvent.lines.length)}'));
  assert(/settingRowWrap: \{\s*flexWrap: 'wrap',/.test(src));
  // flex: 1 has a basis of 0, which can never wrap; the wrapping label sizes to its content
  assert(/growWrap: \{[^}]*flexBasis: 'auto'/.test(src));
  // a wrapping row's lines hug the top; alignContent keeps the single line centred in the row's minHeight, so nothing
  // moves at normal size (found by the Large pixel diff: every static row's text sat ~1pt high without it)
  assert(/settingRowWrap: \{[^}]*alignContent: 'center'/.test(src));
  // a wrapped value drops to the LEFT under its label (space-between starts a lone item at the start), never flush-right:
  // no marginLeft: 'auto' pushing the VALUE (only the chevron / switch has one), and its text reads left on several lines
  assert(/settingRowWrap: \{[^}]*justifyContent: 'space-between'/.test(src));
  assert(/valueMulti: \{[^}]*textAlign: 'left'/.test(src));
  assert(!src.includes('valueWrap'));
  assert(!/\n  value: \{[^}]*marginLeft/.test(src) && !/valueMulti: \{[^}]*marginLeft/.test(src));
  // a one-line value keeps its right alignment: left-aligned, its glyphs sit up to a pixel off the box edge (the Large
  // pixel diff caught exactly that, 6,893 pixels), so the left alignment applies only once the text has several lines
  assert(!/\n  value: \{[^}]*textAlign: 'left'/.test(src));
});
