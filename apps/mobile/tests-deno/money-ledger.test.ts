/**
 * Hermetic tests for lib/money/portfolioLedger.ts: the get_portfolio_ledger
 * response is validated as a whole, and maps to the sheet's ownership inputs.
 * Run with: cd apps/mobile/tests-deno && deno test .
 */
import { assertEquals } from 'jsr:@std/assert';
import { parsePortfolioLedger, sheetInputsFromLedger } from '../lib/money/portfolioLedger.ts';
import { deriveStockSheetFacts } from '../lib/money/stockSheetFacts.ts';

const ACT = (over: Record<string, unknown>) => ({
  kind: 'draft', user_id: 'me', symbol: 'NVDA', action: 'buy', quantity: 6.8942,
  round: 1, pick_number: 2, occurred_at: '2026-09-13T14:00:00Z', total_value: 2000, price: 290.1,
  ...over,
});

const VALID = {
  activity: [
    ACT({}),
    ACT({ kind: 'trade', user_id: 'paolo', symbol: 'AMZN', action: 'buy', quantity: 9, round: null, pick_number: null, price: 221.3, total_value: 1991.7 }),
  ],
  symbol_names: { NVDA: 'NVIDIA Corp', AMZN: 'Amazon.com Inc' },
  members: [
    { user_id: 'me', display_name: 'roberto', is_bot: false },
    { user_id: 'paolo', display_name: 'Paolo M.', is_bot: false },
  ],
};

Deno.test('a valid ledger parses to the same shape', () => {
  const l = parsePortfolioLedger(VALID);
  assertEquals(l?.activity.length, 2);
  assertEquals(l?.symbol_names.NVDA, 'NVIDIA Corp');
  assertEquals(l?.members[1].display_name, 'Paolo M.');
});

Deno.test('the whole read is refused when any part is malformed: no partial ledger', () => {
  assertEquals(parsePortfolioLedger(null), null);
  assertEquals(parsePortfolioLedger({ ...VALID, activity: 'nope' }), null);
  assertEquals(parsePortfolioLedger({ ...VALID, members: [{ user_id: 'me', display_name: 'x' }] }), null);
  assertEquals(parsePortfolioLedger({ ...VALID, activity: [ACT({ quantity: 'six' })] }), null);
  assertEquals(parsePortfolioLedger({ ...VALID, symbol_names: { NVDA: 7 } }), null);
});

Deno.test('a draft row missing its round is skipped for ownership, never given a made-up pick', () => {
  const l = parsePortfolioLedger({ ...VALID, activity: [ACT({ round: null, pick_number: null })] });
  assertEquals(l !== null, true);
  const inputs = sheetInputsFromLedger(l!);
  assertEquals(inputs.drafts.length, 0);
});

Deno.test('the ledger feeds the sheet: held by me, owned by Paolo, with names and no extra reads', () => {
  const l = parsePortfolioLedger(VALID)!;
  const inputs = sheetInputsFromLedger(l);
  const mine = deriveStockSheetFacts({ symbol: 'NVDA', userId: 'me', ...inputs });
  assertEquals(mine.owner, { kind: 'me' });
  assertEquals(mine.draft, { round: 1, inRoundPick: 2 });
  const theirs = deriveStockSheetFacts({ symbol: 'AMZN', userId: 'me', ...inputs });
  assertEquals(theirs.owner, { kind: 'other', name: 'Paolo M.', isBot: false });
});
