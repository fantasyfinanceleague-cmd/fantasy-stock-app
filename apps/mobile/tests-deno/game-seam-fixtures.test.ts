/**
 * The capture seam's fixtures return the shapes the screens check (3c). A fixture
 * that drifted from a screen's success test would make a capture pass the wrong
 * path. Run: `deno test .`
 */
import { assertEquals, assert } from 'jsr:@std/assert';
import { fixtureFor, invokeFixtureFor } from '../lib/game/seamFixtures.ts';

Deno.test('the writes return the success status each screen checks', () => {
  assertEquals((fixtureFor('renew_league', {})!.data as { status: string }).status, 'renewed');
  assertEquals((fixtureFor('respond_to_renewal', { p_response: 'in' })!.data as { status: string }).status, 'replied');
  assertEquals((fixtureFor('nudge_renewal', {})!.data as { status: string }).status, 'nudged');
  assertEquals((fixtureFor('remove_renewal_invitee', {})!.data as { status: string }).status, 'removed');
  assertEquals((fixtureFor('start_renewed_season', { p_settings: { draft_date: 'x' } })!.data as { status: string }).status, 'season_set');
  assertEquals((fixtureFor('set_draft_queue', { p_symbols: ['NVDA'] })!.data as { ok: boolean }).ok, true);
});

Deno.test('the pick and start calls return the success shape the room checks', () => {
  assertEquals((invokeFixtureFor('validate-and-record-pick', { symbol: 'NVDA' })!.data as { ok: boolean }).ok, true);
  assertEquals((invokeFixtureFor('draft-control', { action: 'start' })!.data as { ok: boolean }).ok, true);
});

Deno.test('a call with no fixture gives null, so the real call is the only path (never a silent fake)', () => {
  assertEquals(fixtureFor('some_unknown_rpc', {}), null);
  assertEquals(invokeFixtureFor('some-unknown-function', {}), null);
});

Deno.test('the history fixture is the board\'s Season 1, with its champion and the successor season', () => {
  const rows = fixtureFor('get_league_history', {})!.data as { season_number: number; champion_display_name: string | null }[];
  assertEquals(rows.map((r) => r.season_number), [1, 2]);
  assertEquals(rows[0].champion_display_name, 'Roberto B.');
  assert(rows[1].champion_display_name === null);
});

Deno.test('the quote fixture returns a price for each symbol asked for, and no others', () => {
  const r = invokeFixtureFor('quote', { symbols: ['NVDA', 'UNKNOWN_SYM'] })!.data as { prices: Record<string, number> };
  assertEquals(Object.keys(r.prices), ['NVDA']);
  assert(r.prices.NVDA > 0);
});
