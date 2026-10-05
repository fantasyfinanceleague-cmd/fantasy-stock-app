/**
 * Hermetic tests for _shared/renewal-copy.ts. Run:
 *   deno test supabase/functions/_shared/renewal-copy.test.ts
 */
import { assertEquals } from 'jsr:@std/assert';
import {
  formatDraftWhen,
  renewalInviteBody,
  renewalRemovedBody,
  renewalReplyBody,
  seasonSetBody,
} from './renewal-copy.ts';

Deno.test('the approved copy is verbatim', () => {
  assertEquals(renewalInviteBody({ commissioner: 'Roberto B.', season: 2 }),
    'Roberto B. is running it back. Are you in for Season 2?');
  assertEquals(renewalReplyBody({ name: 'Paolo', response: 'in', season: 2, running: 4, out: 1, noReply: 1 }),
    'Paolo is running back for Season 2. 4 running back · 1 out · 1 no reply yet.');
  assertEquals(renewalReplyBody({ name: 'Paolo', response: 'out', season: 2, running: 3, out: 2, noReply: 0 }),
    'Paolo is out for Season 2. 3 running back · 2 out · 0 no reply yet.');
});

Deno.test('the new copy, pending Giorgio: removed and season set', () => {
  assertEquals(renewalRemovedBody({ commissioner: 'Roberto B.', season: 2, league: 'Stock Scudetto' }),
    'Roberto B. set up Season 2 of Stock Scudetto without you.');
  assertEquals(seasonSetBody({ league: 'Stock Scudetto', season: 2, draftDate: '2026-10-21T00:00:00Z' }),
    'Season 2 of Stock Scudetto is set. The draft is Tue, Oct 20 · 8:00 PM ET.');
});

Deno.test('formatDraftWhen: Eastern, 12-hour clock with the period, no locale separators', () => {
  // Jan (EST, UTC-5): 19:00 ET = 00:00 UTC next day
  assertEquals(formatDraftWhen('2027-01-24T00:00:00Z'), 'Sat, Jan 23 · 7:00 PM ET');
  // Midnight and noon are the two edge cases for an h12 clock.
  assertEquals(formatDraftWhen('2027-01-23T05:00:00Z'), 'Sat, Jan 23 · 12:00 AM ET');
  assertEquals(formatDraftWhen('2027-01-23T17:00:00Z'), 'Sat, Jan 23 · 12:00 PM ET');
});

Deno.test('seasonSetBody: a TBD date drops the draft sentence', () => {
  assertEquals(seasonSetBody({ league: 'L', season: 3, draftDate: null }), 'Season 3 of L is set.');
});
