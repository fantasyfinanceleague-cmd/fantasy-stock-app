/**
 * The DEV-only money fixture seam (3e). It must be INERT in production: it
 * resolves only when the dev flag is on AND the stress flag is exactly "stress".
 * Its submit answers are produced without any write. Run with:
 * cd apps/mobile/tests-deno && deno test .
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import {
  fixtureLeague, fixtureMarket, fixturePreview, fixtureSubmitOutcome, resolveMoneyFixture, MONEY_SCENARIOS,
  searchFixtureBehavior, SEARCH_FIXTURE_DELAY_MS,
} from '../lib/money/fixtureMode.ts';

const ON = { stress: 'stress', scenario: 'ok', stake: 'price_tiers' };

Deno.test('INERT when __DEV__ is false, even with the flag set (it can never ship)', () => {
  assertEquals(resolveMoneyFixture(false, ON), null);
  assertEquals(resolveMoneyFixture(false, { stress: 'stress', scenario: 'conflict' }), null);
});

Deno.test('INERT when the stress flag is unset or any other value', () => {
  assertEquals(resolveMoneyFixture(true, {}), null);
  assertEquals(resolveMoneyFixture(true, { stress: null }), null);
  assertEquals(resolveMoneyFixture(true, { stress: '' }), null);
  assertEquals(resolveMoneyFixture(true, { stress: 'Stress' }), null);
  assertEquals(resolveMoneyFixture(true, { stress: 'true' }), null);
});

Deno.test('active only when dev is on AND the flag is exactly "stress"', () => {
  assertEquals(resolveMoneyFixture(true, ON), { scenario: 'ok', stake: 'price_tiers' });
});

Deno.test('an unknown scenario or stake falls back to the defaults, never to a live path', () => {
  assertEquals(resolveMoneyFixture(true, { stress: 'stress', scenario: 'bogus', stake: 'nope' }), { scenario: 'ok', stake: 'price_tiers' });
});

Deno.test('every scenario resolves, and the scenario list is the nine states', () => {
  for (const s of MONEY_SCENARIOS) assertEquals(resolveMoneyFixture(true, { stress: 'stress', scenario: s })?.scenario, s);
  assertEquals(MONEY_SCENARIOS.length, 9);
});

Deno.test('the submit outcomes: each scenario maps to its state, and "ok" writes nothing', () => {
  const fx = (scenario: string) => resolveMoneyFixture(true, { stress: 'stress', scenario })!;
  assertEquals(fixtureSubmitOutcome(fx('conflict'), 10), { kind: 'refused', reason: 'trade_conflict' });
  assertEquals(fixtureSubmitOutcome(fx('unconfirmed'), 10), { kind: 'network' });
  assertEquals(fixtureSubmitOutcome(fx('market_closed'), 10).kind, 'refused');
  assertEquals(fixtureSubmitOutcome(fx('no_open_slots'), 211.42), {
    kind: 'refused', reason: 'no_eligible_slot', tier: { price: 211.42, openSlots: [] },
  });
  const ok = fixtureSubmitOutcome(fx('ok'), 10);
  assertEquals(ok.kind, 'ok');
});

Deno.test('the tier preview: a refusal names the slot; a fit names the slot that would fill', () => {
  const refuse = fixturePreview(resolveMoneyFixture(true, { stress: 'stress', scenario: 'no_eligible_slot', stake: 'price_tiers' })!, []);
  assertEquals(refuse.wouldFill, null);
  assertEquals(refuse.openSlots?.length, 1);
  const fit = fixturePreview(resolveMoneyFixture(true, { stress: 'stress', scenario: 'ok', stake: 'price_tiers' })!, []);
  assert(fit.wouldFill != null);
  assertEquals(fit.wouldFill?.price_min, 100);
});

Deno.test('the per-slot preview offers the sale proceeds as the funding source', () => {
  const fx = resolveMoneyFixture(true, { stress: 'stress', scenario: 'ok', stake: 'fixed_notional' })!;
  const p = fixturePreview(fx, [{ tradeId: 't1', symbol: 'JPM', amount: 971.91 }]);
  assertEquals(p.sources.length, 1);
  assertEquals(p.sources[0].amount, 971.91);
});

Deno.test('the market: open for the session, or closed with the next open for market_closed', () => {
  const now = new Date('2026-10-05T15:00:00Z');
  assertEquals(fixtureMarket('ok', now).status, 'open');
  const closed = fixtureMarket('market_closed', now);
  assertEquals(closed.status, 'closed');
  assertEquals(closed.next_open_at, '2026-10-06T13:30:00Z');
});

Deno.test('the league settings per stake mode', () => {
  assertEquals(fixtureLeague('budget_cap').budget_amount, 2500);
  assertEquals(fixtureLeague('fixed_notional').notional_per_slot, 2000);
  assertEquals(fixtureLeague('price_tiers').stake_mode, 'price_tiers');
});

// E-1/E-2 (3e UX audit stills): the stock-search screen's own fixture scenarios.
Deno.test('searchFixtureBehavior: search_fail answers every attempt as a failure', () => {
  assertEquals(searchFixtureBehavior('search_fail'), { kind: 'fail' });
});

Deno.test('searchFixtureBehavior: search_delay holds the loading state for SEARCH_FIXTURE_DELAY_MS', () => {
  assertEquals(searchFixtureBehavior('search_delay'), { kind: 'delay', ms: SEARCH_FIXTURE_DELAY_MS });
});

Deno.test('searchFixtureBehavior: every other scenario searches the stress catalog immediately', () => {
  for (const s of MONEY_SCENARIOS) {
    if (s === 'search_fail' || s === 'search_delay') continue;
    assertEquals(searchFixtureBehavior(s), { kind: 'normal' });
  }
});
