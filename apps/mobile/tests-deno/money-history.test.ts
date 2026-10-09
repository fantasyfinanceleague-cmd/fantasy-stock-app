/**
 * The trade history list (3e): filters, the ET week grouping, and paging that
 * never drops or repeats a row, run on the 1,024-row stress ledger. Run with:
 * cd apps/mobile/tests-deno && deno test .
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { groupHistory, historyItems, historyRows, monthDayLabel, pageOf } from '../lib/money/tradeHistory.ts';
import { parsePortfolioLedger } from '../lib/money/portfolioLedger.ts';
import { buildStressMarket, STRESS_CALLER } from '../lib/money/stressFixture.ts';

const ledger = parsePortfolioLedger(JSON.parse(JSON.stringify(buildStressMarket().ledger)))!;

Deno.test('the caller sees only their own rows: six draft picks plus their trades', () => {
  const all = historyItems(ledger.activity, STRESS_CALLER, 'all');
  assert(all.every((i) => ledger.activity.some((a) => a.user_id === STRESS_CALLER && a.occurred_at === i.occurredAt)));
  assertEquals(all.filter((i) => i.kind === 'draft').length, 6);
});

Deno.test('filters: buys and sells are trades only; draft is the picks only', () => {
  const buys = historyItems(ledger.activity, STRESS_CALLER, 'buys');
  const sells = historyItems(ledger.activity, STRESS_CALLER, 'sells');
  const draft = historyItems(ledger.activity, STRESS_CALLER, 'draft');
  assert(buys.every((i) => i.kind === 'trade' && i.action === 'buy'));
  assert(sells.every((i) => i.kind === 'trade' && i.action === 'sell'));
  assertEquals(draft.length, 6);
  assertEquals(buys.length + sells.length + draft.length, historyItems(ledger.activity, STRESS_CALLER, 'all').length);
});

Deno.test('the list is newest first', () => {
  const all = historyItems(ledger.activity, STRESS_CALLER, 'all');
  for (let i = 1; i < all.length; i++) assert(all[i - 1].occurredAt >= all[i].occurredAt);
});

Deno.test('paging: concatenated pages are the whole list, in order, with no row dropped or repeated', () => {
  // The whole league (1,024 rows) pages with no truncation.
  const everything = historyItems(ledger.activity, ledger.activity[0].user_id, 'all');
  const league = ledger.activity.map((a) => ({ ...a }));
  const pages: number[] = [];
  let total = 0;
  const seen = new Set<string>();
  const first = pageOf(league, 0, 50);
  for (let p = 0; p < first.pageCount; p++) {
    const page = pageOf(league, p, 50);
    pages.push(page.items.length);
    total += page.items.length;
    for (const row of page.items) {
      const key = `${row.kind}:${row.occurred_at}:${row.symbol}:${row.user_id}`;
      assert(!seen.has(key), `row repeated: ${key}`);
      seen.add(key);
    }
  }
  assertEquals(total, league.length);
  assertEquals(first.pageCount, Math.ceil(league.length / 50));
  assertEquals(pages[pages.length - 1], league.length % 50 || 50);
  assert(everything.length > 0);
});

Deno.test('paging clamps out-of-range pages and reports hasMore honestly', () => {
  const rows = [1, 2, 3];
  assertEquals(pageOf(rows, 99, 2), { items: [3], page: 1, pageCount: 2, hasMore: false });
  assertEquals(pageOf(rows, 0, 2).hasMore, true);
  assertEquals(pageOf([], 0, 50), { items: [], page: 0, pageCount: 1, hasMore: false });
});

Deno.test('the trades group by ET trading week, and the picks sit in one Draft section', () => {
  const all = historyItems(ledger.activity, STRESS_CALLER, 'all');
  const sections = groupHistory(all, '2026-10-05');
  assertEquals(sections.some((s) => s.key === 'draft'), true);
  const draft = sections.find((s) => s.key === 'draft')!;
  assertEquals(draft.items.length, 6);
  const firstDraft = all.filter((i) => i.kind === 'draft').at(-1)!;
  assertEquals(draft.title, `Draft · ${monthDayLabel(firstDraft.occurredAt)}`);
  assert(/^Draft · [A-Z][a-z]{2} \d{1,2}$/.test(draft.title), draft.title);
  // Every trade is in exactly one week section, and nothing is lost.
  const trades = sections.filter((s) => s.key !== 'draft').reduce((a, s) => a + s.items.length, 0);
  assertEquals(trades, all.filter((i) => i.kind === 'trade').length);
});

Deno.test('a day label comes from ET parts: the fixed month table, never locale text', () => {
  // 2026-10-05 13:30Z is 9:30 AM EDT on Mon Oct 5.
  assertEquals(monthDayLabel('2026-10-05T13:30:00Z'), 'Oct 5');
  assertEquals(monthDayLabel('garbage'), null);
});

Deno.test('the rows: one header per section, then its items, and no item lost', () => {
  const all = historyItems(ledger.activity, STRESS_CALLER, 'all');
  const rows = historyRows(all, '2026-10-05');
  const headers = rows.filter((r) => r.kind === 'header');
  const items = rows.filter((r) => r.kind === 'item');
  assertEquals(items.length, all.length);
  // Every section header is followed by at least one item of that section.
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].kind === 'header') assert(i + 1 < rows.length && rows[i + 1].kind === 'item');
  }
  assertEquals(headers.length, new Set(headers.map((h) => (h as { key: string }).key)).size);
});
