/**
 * Hermetic tests for lib/money/stockSheetFacts.ts: who owns a symbol in a
 * league, and the in-round pick the sheet's ownership line shows. Run with:
 * cd apps/mobile/tests-deno && deno test .
 */
import { assertEquals } from 'jsr:@std/assert';
import { deriveStockSheetFacts, type FactsDraft, type FactsTrade } from '../lib/money/stockSheetFacts.ts';

const ME = 'me-uuid';
const PAOLO = 'paolo-uuid';
const BOT = 'bot-rico';
const NAMES = {
  [PAOLO]: { displayName: 'Paolo M.', isBot: false },
  [BOT]: { displayName: 'Rico', isBot: true },
};
// Six managers over two rounds: round 1 is picks 1-6, round 2 is picks 7-12.
const LEAGUE_PICKS = [1, 2, 3, 4, 5, 6].flatMap((n) => [
  { round: 1, user_id: `m${n}` },
  { round: 2, user_id: `m${n}` },
]);

const draft = (over: Partial<FactsDraft> & Pick<FactsDraft, 'user_id' | 'symbol' | 'pick_number' | 'round'>): FactsDraft => ({
  quantity: 6.8942,
  ...over,
});

Deno.test('held and drafted by me: quantity, and the in-round pick from the overall pick', () => {
  const f = deriveStockSheetFacts({
    symbol: 'NVDA', userId: ME, names: NAMES, leaguePicks: LEAGUE_PICKS, trades: [],
    drafts: [draft({ user_id: ME, symbol: 'NVDA', round: 1, pick_number: 2 })],
  });
  assertEquals(f.held, { quantity: 6.8942 });
  assertEquals(f.draft, { round: 1, inRoundPick: 2 });
  assertEquals(f.owner, { kind: 'me' });
  assertEquals(f.conflict, false);
});

Deno.test('round 2: the in-round pick subtracts the picks before the round (overall 7 is pick 1)', () => {
  const f = deriveStockSheetFacts({
    symbol: 'NVDA', userId: ME, names: NAMES, leaguePicks: LEAGUE_PICKS, trades: [],
    drafts: [draft({ user_id: ME, symbol: 'NVDA', round: 2, pick_number: 7 })],
  });
  assertEquals(f.draft, { round: 2, inRoundPick: 1 });
});

Deno.test('bought later (no draft row): held, with no draft line', () => {
  const trades: FactsTrade[] = [{ user_id: ME, symbol: 'SHOP', action: 'buy', quantity: 1 }];
  const f = deriveStockSheetFacts({ symbol: 'SHOP', userId: ME, names: NAMES, leaguePicks: LEAGUE_PICKS, drafts: [], trades });
  assertEquals(f.held, { quantity: 1 });
  assertEquals(f.draft, null);
});

Deno.test('owned by another manager: named, and no held position for me', () => {
  const f = deriveStockSheetFacts({
    symbol: 'AMZN', userId: ME, names: NAMES, leaguePicks: LEAGUE_PICKS, trades: [],
    drafts: [draft({ user_id: PAOLO, symbol: 'AMZN', round: 1, pick_number: 5 })],
  });
  assertEquals(f.held, null);
  assertEquals(f.owner, { kind: 'other', name: 'Paolo M.', isBot: false });
});

Deno.test('a bot owner carries the bot flag', () => {
  const f = deriveStockSheetFacts({
    symbol: 'AMZN', userId: ME, names: NAMES, leaguePicks: LEAGUE_PICKS, trades: [],
    drafts: [draft({ user_id: BOT, symbol: 'AMZN', round: 1, pick_number: 3 })],
  });
  assertEquals(f.owner, { kind: 'other', name: 'Rico', isBot: true });
});

Deno.test('an owner with no display name is named generically, never invented', () => {
  const f = deriveStockSheetFacts({
    symbol: 'AMZN', userId: ME, names: {}, leaguePicks: LEAGUE_PICKS, trades: [],
    drafts: [draft({ user_id: PAOLO, symbol: 'AMZN', round: 1, pick_number: 5 })],
  });
  assertEquals(f.owner, { kind: 'other', name: null, isBot: false });
});

Deno.test('sold out: nobody owns it, and no held position', () => {
  const f = deriveStockSheetFacts({
    symbol: 'TSLA', userId: ME, names: NAMES, leaguePicks: LEAGUE_PICKS,
    drafts: [draft({ user_id: ME, symbol: 'TSLA', round: 1, pick_number: 4 })],
    trades: [{ user_id: ME, symbol: 'TSLA', action: 'sell', quantity: 6.8942 }],
  });
  assertEquals(f, { held: null, draft: null, owner: null, conflict: false });
});

Deno.test('two owners is a partial-state conflict: the sheet refuses to say who owns it', () => {
  const f = deriveStockSheetFacts({
    symbol: 'AMZN', userId: ME, names: NAMES, leaguePicks: LEAGUE_PICKS, trades: [],
    drafts: [
      draft({ user_id: PAOLO, symbol: 'AMZN', round: 1, pick_number: 5 }),
      draft({ user_id: BOT, symbol: 'AMZN', round: 1, pick_number: 3 }),
    ],
  });
  assertEquals(f.conflict, true);
  assertEquals(f.owner, null);
  assertEquals(f.held, null);
});

Deno.test('symbol matching is case-insensitive and ignores other symbols', () => {
  const f = deriveStockSheetFacts({
    symbol: 'nvda', userId: ME, names: NAMES, leaguePicks: LEAGUE_PICKS, trades: [],
    drafts: [draft({ user_id: ME, symbol: 'NVDA', round: 1, pick_number: 2 }), draft({ user_id: PAOLO, symbol: 'AMZN', round: 1, pick_number: 5 })],
  });
  assertEquals(f.owner, { kind: 'me' });
});
