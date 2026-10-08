/**
 * 3c copy: every string the game screens show lives in lib/game/gameCopy.ts,
 * and each carries its source ('board', 'existing', 'giorgio' or 'new') so the
 * copy audit can check it. Minus signs are U+2212, as on the board.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals, assert } from 'jsr:@std/assert';
import { COPY, signedPct, leadLine, tiebreakLine, leadChangeChyron, COPY_SOURCES } from '../lib/game/gameCopy.ts';

Deno.test('signedPct: sign first, U+2212 minus, two decimals', () => {
  assertEquals(signedPct(1.76), '+1.76%');
  assertEquals(signedPct(-0.32), '−0.32%');
  assertEquals(signedPct(0), '0.00%');
});

Deno.test('tiebreakLine: matches the board\'s wording', () => {
  assertEquals(tiebreakLine(1.76, 0.74), 'Tiebreak +1.76% vs +0.74%');
});

Deno.test('leadLine: names the leader and the dollar gap, with cents', () => {
  assertEquals(leadLine('Roberto B.', 123.16), 'Roberto B. leads by $123.16');
});

Deno.test('leadChangeChyron: the mover, its day move, and who is ahead (new copy)', () => {
  assertEquals(leadChangeChyron({ symbol: 'NVDA', dayPct: 2.9, leaderName: 'Roberto B.' }), 'NVDA +2.9% puts Roberto B. ahead');
  assertEquals(leadChangeChyron({ symbol: 'NVDA', dayPct: null, leaderName: 'Roberto B.' }), 'NVDA puts Roberto B. ahead');
});

Deno.test('every copy key has a source tag from the allowed set', () => {
  const allowed = new Set(['board', 'existing', 'giorgio', 'new']);
  for (const key of Object.keys(COPY)) {
    assert(allowed.has(COPY_SOURCES[key as keyof typeof COPY]), `untagged copy: ${key}`);
  }
});

Deno.test('the pre-season chyron is the board\'s words, verbatim', () => {
  assertEquals(COPY.preSeasonChyron('Mon 9:30 AM ET'), 'Week 1 starts Mon 9:30 AM ET. No leader until the market opens.');
});
