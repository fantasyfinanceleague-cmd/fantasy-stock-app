/**
 * The week's ending band (game-screens gate GS-2). The board's `.ks-winner` is a solid
 * band: your colour with on-accent text when you won, the record on the right
 * ("W · 5–1"). FinalBanner had become plain bold text with no fill and no record.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { buildFinalBanner } from '../lib/game/finalBanner.ts';
import { SOURCES } from './sourceManifest.generated.ts';

const base = { week: 6, youName: 'Roberto B.', oppName: 'Gianluigi B.', isPlayoff: false };

Deno.test('a win: your name, and the board\'s "W · 5–1"', () => {
  const m = buildFinalBanner({ ...base, me: 351.77, opp: -38.88, record: { wins: 5, losses: 1, ties: 0 } });
  assertEquals(m.outcome, 'won');
  assertEquals(m.text, 'Roberto B. wins Week 6');
  assertEquals(m.recordText, 'W · 5–1');
  assertEquals(m.a11yLabel, 'Roberto B. wins Week 6. Win, record 5–1.');
});

Deno.test('a loss names the winner and says L', () => {
  const m = buildFinalBanner({ ...base, me: -38.88, opp: 351.77, record: { wins: 4, losses: 2, ties: 0 } });
  assertEquals(m.outcome, 'lost');
  assertEquals(m.text, 'Gianluigi B. wins Week 6');
  assertEquals(m.recordText, 'L · 4–2');
});

Deno.test('a tie says T, and the record shows its ties', () => {
  const m = buildFinalBanner({ ...base, me: 10, opp: 10, record: { wins: 4, losses: 1, ties: 1 } });
  assertEquals(m.outcome, 'tied');
  assertEquals(m.text, 'Tied in Week 6');
  assertEquals(m.recordText, 'T · 4–1–1');
});

Deno.test('a playoff game or an unknown record shows the letter only, never a guessed record', () => {
  assertEquals(buildFinalBanner({ ...base, me: 5, opp: 1, record: { wins: 9, losses: 5, ties: 0 }, isPlayoff: true }).recordText, 'W');
  assertEquals(buildFinalBanner({ ...base, me: 1, opp: 5, record: null }).recordText, 'L');
});

Deno.test('the band: you colour + on-accent when you won, sunken + text otherwise; the record sits at the end (source guard)', () => {
  const src = SOURCES['components/game/FinalBanner.tsx'];
  assert(src.includes("const fill = won ? colors.you : colors.sunken;"));
  assert(src.includes("const ink = won ? colors.onAccent : colors.text;"));
  assert(src.includes('{model.recordText}'));
  assert(SOURCES['app/(tabs)/matchup.tsx'].includes('record: derived.myRecord,'));
});
