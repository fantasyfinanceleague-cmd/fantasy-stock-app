/**
 * UX final sweep S-3: Home's pre-draft Members row marked the FIRST member as you, but
 * the list is in the server's order, so most players saw someone else (usually the
 * commissioner) marked as themselves. You are now found by your own id and put first.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { membersYouFirst } from '../lib/home/preDraftMembers.ts';
import { SOURCES } from './sourceManifest.generated.ts';

const M = (userId: string) => ({ userId, displayName: userId });

Deno.test('you are marked by id and moved first; the rest keep the server order', () => {
  const rows = membersYouFirst([M('paolo'), M('gianluigi'), M('me'), M('luca')], 'me');
  assertEquals(rows.map((r) => [r.member.userId, r.isYou]), [['me', true], ['paolo', false], ['gianluigi', false], ['luca', false]]);
});

Deno.test('the first member is never assumed to be you', () => {
  assertEquals(membersYouFirst([M('paolo'), M('luca')], 'me').some((r) => r.isYou), false); // not joined yet: nobody marked
  assertEquals(membersYouFirst([M('paolo')], null).some((r) => r.isYou), false); // no session: nobody marked
  assertEquals(membersYouFirst([M('me'), M('paolo')], 'me')[0].isYou, true); // already first: unchanged
});

Deno.test('the card uses it (no index-based "you")', () => {
  const card = SOURCES['components/home/PreDraftCard.tsx'];
  assert(card.includes('membersYouFirst(members, user?.id).map(({ member: m, isYou }) => ('));
  assert(!card.includes('i === 0 ? colors.youText'));
});
