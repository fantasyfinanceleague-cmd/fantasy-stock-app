/**
 * The Run it back fixture (3c): derived from one roster, shaped as the SQL
 * returns. The board's line falls out of the people; the draft gate follows
 * replies_pending; a non-member sees nothing. Run: `deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { fixtureRoster, fixtureCounts, fixturePeople } from '../lib/game/renewalFixture.ts';
import { countsLine, screenFor } from '../lib/game/renewal.ts';

const NOW = new Date('2026-01-17T15:00:00Z');

Deno.test('the counts are derived from the people: the board\'s line (4 running back · 1 new · 1 out · 1 no reply yet)', () => {
  const c = fixtureCounts(fixturePeople(NOW));
  assertEquals(countsLine(c), '4 running back · 1 new · 1 out · 1 no reply yet');
  assertEquals(c.team_count, 5);
});

Deno.test('the commissioner gets the full list with replies pending; the draft gate follows it', () => {
  const r = fixtureRoster('commissioner', NOW);
  assertEquals(r.status, 'ok');
  if (r.status !== 'ok' || !r.full_list) throw new Error('expected the full list');
  assertEquals(r.replies_pending, true);
  assertEquals(screenFor(r), 'reconcile');
});

Deno.test('a pending invitee gets only their caller_status: no people, no counts (SQL shape)', () => {
  const r = fixtureRoster('pending', NOW);
  assertEquals('people' in r, false);
  assertEquals('counts' in r, false);
  assertEquals(screenFor(r as never), 'ask');
});

Deno.test('a stranger is not_visible: nothing to show', () => {
  assertEquals(fixtureRoster('stranger', NOW), { status: 'not_visible' });
});

Deno.test('the nudge is available only to a pending invitee, and only after 24 h', () => {
  const people = fixturePeople(NOW);
  const andrea = people.find((p) => p.user_id === 'andrea')!;
  assertEquals(andrea.can_nudge, false); // nudged yesterday at 14:00Z, inside 24 h at 15:00Z today
  assertEquals(andrea.can_remove, true);
  assertEquals(people.find((p) => p.user_id === 'paolo')!.can_remove, false);
});
