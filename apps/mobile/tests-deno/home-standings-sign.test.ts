/**
 * U-50 (Design Lead, P2): Home's standings excerpt shows season gains with their
 * sign ("+$512.40"), like the Home hero and League's standings table.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { formatMoney } from '../components/sp/logic/money.ts';
import { SOURCES } from './sourceManifest.generated.ts';

Deno.test('the excerpt\'s gain column renders with sign="always"', () => {
  const card = SOURCES['components/home/StandingsCard.tsx'];
  assertEquals(card.includes('<Money value={r.pointsFor} size="callout" colorBySign sign="always" />'), true);
  assertEquals(card.includes('<Money value={r.pointsFor} size="callout" colorBySign />'), false);
});

Deno.test('what sign="always" shows: "+" for a gain, the minus sign for a loss', () => {
  assertEquals(formatMoney(512.4, { sign: 'always' }), '+$512.40');
  assertEquals(formatMoney(-61.5, { sign: 'always' }).startsWith('−'), true);
  assertEquals(formatMoney(512.4), '$512.40'); // the old, unsigned look
});
