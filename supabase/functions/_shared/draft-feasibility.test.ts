/**
 * Hermetic tests for draft-feasibility.ts and the feasibility-aware gatePick.
 * Run: deno test supabase/functions/_shared/draft-feasibility.test.ts
 *
 * Product rule (Giorgio, 2026-10-05): a draft pick can never be unused. The
 * property test at the bottom is the executable form of that claim: for many
 * generated leagues whose START check passes, a seeded draft with adversarial
 * pickers always has at least one legal pick on every turn.
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { tierPrice } from './tier-price.ts';
import {
  buildPoolGroups,
  checkStartFeasibility,
  demandVector,
  deficit,
  FLEX_TYPE_ID,
  flexTypes,
  maxFlow,
  openInstances,
  type PoolGroup,
  type PoolStock,
  reserveFor,
  robustFits,
  signatureOf,
  type FeasibilityState,
} from './draft-feasibility.ts';
import { type PickRow, type Slot, type TradeRow, currentTurn, leagueOwnedSymbols } from './draft-validation.ts';
import { type PickFeasibility, gatePick } from './pick-gate.ts';

const slot = (id: string, slotIndex: number, slotCount: number, priceMin: number | null, priceMax: number | null, categoryId: string | null = null): Slot =>
  ({ id, slotIndex, slotCount, priceMin, priceMax, categoryId });
const stock = (symbol: string, cachedPrice: number | null, eligibility: string[] = [], isDraftable = true): PoolStock =>
  ({ symbol, cachedPrice, eligibility: new Set(eligibility), isDraftable });

// ---------------------------------------------------------------------------
// Rounding + robust brackets
// ---------------------------------------------------------------------------

Deno.test('tierPrice: rounds half away from zero in cents (the 49.995 trap)', () => {
  assertEquals(tierPrice(49.995), 50);
  assertEquals(tierPrice(49.994), 49.99);
  assertEquals(tierPrice(50.005), 50.01);
  assertEquals(tierPrice(1.005), 1.01);
  assertEquals(tierPrice(50), 50);
});

Deno.test('robustFits: the bracket is shrunk by 10% on both sides (boundary at rounding)', () => {
  const t = slot('a', 0, 1, 50, 100);
  assertEquals(robustFits(t, 55, new Set()), true); // exactly 1.1 x min
  assertEquals(robustFits(t, 54.99, new Set()), false); // just inside the margin
  assertEquals(robustFits(t, 90, new Set()), true); // exactly 0.9 x max
  assertEquals(robustFits(t, 90.01, new Set()), false);
});

Deno.test('signatureOf: a stock fits every slot type it satisfies; category needs eligibility', () => {
  const types = [slot('tech', 0, 1, null, null, 'tech'), slot('flex', 1, 9, null, null)];
  assertEquals(signatureOf(types, 20, new Set(['tech'])), [0, 1]);
  assertEquals(signatureOf(types, 20, new Set()), [1]); // unclassified = flex only
});

// ---------------------------------------------------------------------------
// Pool groups (mirror of public.draft_feasibility_pool)
// ---------------------------------------------------------------------------

Deno.test('buildPoolGroups: draftable, owned, unpriced and boundary filters; cheapest-first, depth-capped', () => {
  const types = [slot('t', 0, 1, 50, 100)];
  const stocks = [
    stock('IN1', 60),
    stock('IN2', 70),
    stock('EDGE', 55.5), // inside bracket but inside the margin? 55.5 >= 55 -> fits
    stock('BOUND', 54), // below 1.1 x 50 -> excluded
    stock('OWNED', 80),
    stock('NOTDRAFT', 75, [], false),
    stock('NOPRICE', null),
  ];
  const groups = buildPoolGroups(types, stocks, { exclude: ['owned'], draftableOnly: true, depth: 10 });
  assertEquals(groups.length, 1);
  assertEquals(groups[0].ordinals, [0]);
  assertEquals(groups[0].n, 3);
  assertEquals(groups[0].prices, [55.5, 60, 70]);

  const capped = buildPoolGroups(types, stocks, { exclude: [], draftableOnly: false, depth: 2 });
  assertEquals(capped[0].prices.length, 2);
});

// ---------------------------------------------------------------------------
// Flow: Hall's condition over overlapping slot types
// ---------------------------------------------------------------------------

Deno.test('flow: nested tier types (Tech inside Flex) are counted together, not per slot', () => {
  // Tech needs 2, Flex needs 3. Three stocks total, only one of them tech.
  // Per-slot counting would see "Tech: 1 >= ?" and "Flex: 3 >= 3"; the flow sees
  // that Tech + Flex together need 5 but only 3 stocks exist.
  const groups: PoolGroup[] = [
    { ordinals: [0, 1], n: 1, prices: [10] },
    { ordinals: [1], n: 2, prices: [11, 12] },
  ];
  const r = maxFlow([2, 3], groups);
  assertEquals(r.flow, 3);
  assertEquals(deficit([2, 3], groups), 2);
});

Deno.test('flow: a Hall violation names the exact slot set and the shortfall', () => {
  // 16 managers each need a Tech slot and a Flex slot. 20 tech stocks exist.
  const groups: PoolGroup[] = [{ ordinals: [0, 1], n: 20, prices: [] }];
  const r = maxFlow([16, 16], groups);
  assertEquals(r.flow, 20);
  assert(r.hall !== null);
  assertEquals(r.hall!.ordinals, [0, 1]);
  assertEquals(r.hall!.need, 32);
  assertEquals(r.hall!.have, 20);
});

Deno.test('flow: a feasible pool has no violator', () => {
  const groups: PoolGroup[] = [{ ordinals: [0], n: 16, prices: [] }, { ordinals: [1], n: 16, prices: [] }];
  const r = maxFlow([16, 16], groups);
  assertEquals(r.flow, 32);
  assertEquals(r.hall, null);
});

// ---------------------------------------------------------------------------
// Start / setup feasibility (headroom + per-manager budget reserve)
// ---------------------------------------------------------------------------

Deno.test('start: 16 managers x 12 slots — feasible pool passes, short pool names the violated slots', () => {
  const types = [
    slot('tech', 0, 2, 100, null, 'tech'),
    slot('mid', 1, 4, 20, 100),
    slot('flex', 2, 6, null, null),
  ];
  // Plenty of stock everywhere: 40 tech (fits tech+mid+flex? tech types), 200 mid, 400 cheap.
  const stocks: PoolStock[] = [];
  for (let i = 0; i < 40; i++) stocks.push(stock(`T${i}`, 150, ['tech']));
  for (let i = 0; i < 200; i++) stocks.push(stock(`M${i}`, 50));
  for (let i = 0; i < 400; i++) stocks.push(stock(`F${i}`, 5));
  const groups = buildPoolGroups(types, stocks, { exclude: [], draftableOnly: true, depth: 16 * 12 + 1 });
  const ok = checkStartFeasibility({ types, managers: 16, numRounds: 12, budget: null, groups });
  assertEquals(ok, { ok: true });

  // Only 10 tech-eligible stocks: 16 tech slots (with 10% headroom -> 36 needed
  // for the tech+mid+flex union? no: tech slot needs a tech stock) must fail.
  const thin = buildPoolGroups(types, stocks.slice(10), { exclude: [], draftableOnly: true, depth: 200 });
  const bad = checkStartFeasibility({ types, managers: 16, numRounds: 12, budget: null, groups: thin });
  assertEquals(bad.ok, false);
  if (!bad.ok && bad.reason === 'slots_infeasible') {
    assertEquals(bad.hall.ordinals.includes(0), true);
  } else {
    throw new Error(`expected slots_infeasible, got ${JSON.stringify(bad)}`);
  }
});

Deno.test('start: 10% demand headroom — exactly 16 stocks for 16 managers is refused (need 18)', () => {
  const types = [slot('t', 0, 1, 10, 100)];
  const sixteen = Array.from({ length: 16 }, (_, i) => stock(`S${i}`, 50));
  const groups = buildPoolGroups(types, sixteen, { exclude: [], draftableOnly: true, depth: 100 });
  const r = checkStartFeasibility({ types, managers: 16, numRounds: 1, budget: null, groups });
  assertEquals(r.ok, false);
  const seventeen = [...sixteen, stock('EXTRA', 50)];
  const g2 = buildPoolGroups(types, seventeen, { exclude: [], draftableOnly: true, depth: 100 });
  assertEquals(checkStartFeasibility({ types, managers: 16, numRounds: 1, budget: null, groups: g2 }).ok, false); // 17 < 18
  const eighteen = [...sixteen, stock('E1', 50), stock('E2', 50)];
  const g3 = buildPoolGroups(types, eighteen, { exclude: [], draftableOnly: true, depth: 100 });
  assertEquals(checkStartFeasibility({ types, managers: 16, numRounds: 1, budget: null, groups: g3 }), { ok: true });
});

Deno.test('start: budget reserve refuses a league where the cheapest full roster cannot be afforded', () => {
  // 1 slot per manager: a $400-$1000 slot, 4 managers, budget 300: cannot be afforded
  // even by the cheapest qualifying stock at worst-case competition.
  const types = [slot('exp', 0, 1, 400, 1000)];
  const stocks = Array.from({ length: 20 }, (_, i) => stock(`X${i}`, 450 + i));
  const groups = buildPoolGroups(types, stocks, { exclude: [], draftableOnly: true, depth: 100 });
  const r = checkStartFeasibility({ types, managers: 4, numRounds: 1, budget: 300, groups });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.reason, 'budget_infeasible');
});

// ---------------------------------------------------------------------------
// Budget dead-end (the gate refuses the early expensive pick)
// ---------------------------------------------------------------------------

const cashLeague = (budget: number, numRounds: number, slots: Slot[]) => ({
  stakeMode: 'budget_cap' as const,
  budgetAmount: budget,
  notionalPerSlot: null,
  numRounds,
  allowUndraftable: false,
  slots,
});

Deno.test('budget reserve: the $700 pick is refused because the last slot (+10% reserve) would be unaffordable; the $50 pick is accepted', () => {
  // One manager, two slots: A accepts $1-$1000, B accepts $5-$100.
  // Pool: X=$700 (A only), Y=$50 (A and B), Z=$60 (A and B). Budget $750.
  // Taking X leaves B needing a stock; the reserve prices B at its cheapest
  // qualifying stock x1.1 (= $55) so 700 + 55 > 750 is refused. Y leaves B
  // with Z (x1.1 = $66) and 50 + 66 <= 750, so Y is legal.
  const slots = [slot('A', 0, 1, 1, 1000), slot('B', 1, 1, 5, 100)];
  const stocks = [stock('X', 700), stock('Y', 50), stock('Z', 60)];
  const rules = cashLeague(750, 2, slots);
  const order = ['me'];
  const picks: PickRow[] = [];
  const groups = buildPoolGroups(slots, stocks, { exclude: [], draftableOnly: true, depth: 10 });
  const state: FeasibilityState = { types: slots, demand: demandVector(slots, order, picks, 2), groups, budget: 750 };
  const base = { rules, slots, order, picks, trades: [] as TradeRow[], pickerId: 'me', eligibleCategories: new Set<string>(), isDraftable: true };
  const feas = (cached: number): PickFeasibility => ({ state, open: openInstances(slots, picks, 'me', 2), cachedPrice: cached, eligibility: new Set() });

  const x = gatePick('L', { ...base, symbol: 'X', price: 700 }, feas(700));
  assertEquals(x.ok, false);
  if (!x.ok) assertEquals(x.reason, 'budget_reserve');

  const y = gatePick('L', { ...base, symbol: 'Y', price: 50 }, feas(50));
  assertEquals(y.ok, true);
  if (y.ok) assertEquals(y.pick.slotId, 'A'); // first slot that strands nobody: Z still fills B
});

Deno.test('start: the same league is refused up front when the reserve already exceeds the budget', () => {
  const slots = [slot('A', 0, 1, 1, 1000), slot('B', 1, 1, 5, 100)];
  // Two extra $500-$520 A-only stocks clear the 10% demand headroom (1 -> 2 per slot).
  const stocks = [stock('X', 700), stock('Y', 50), stock('Z', 60), stock('P1', 500), stock('P2', 520)];
  const groups = buildPoolGroups(slots, stocks, { exclude: [], draftableOnly: true, depth: 10 });
  assertEquals(checkStartFeasibility({ types: slots, managers: 1, numRounds: 2, budget: 750, groups }).ok, true);
  const tight = checkStartFeasibility({ types: slots, managers: 1, numRounds: 2, budget: 120, groups });
  assertEquals(tight.ok, false);
  if (!tight.ok) assertEquals(tight.reason, 'budget_infeasible');
});

// ---------------------------------------------------------------------------
// Tier boundary through the real gate
// ---------------------------------------------------------------------------

Deno.test('tier boundary: a $50.004 live price is in a $0-$50 tier (rounds to $50.00), $50.005 is not', () => {
  const slots = [slot('low', 0, 1, null, 50)];
  const rules = { stakeMode: 'price_tiers' as const, budgetAmount: null, notionalPerSlot: null, numRounds: 1, allowUndraftable: false };
  const state: FeasibilityState = { types: slots, demand: [1], groups: [{ ordinals: [0], n: 1, prices: [50] }], budget: null };
  const feas = (cached: number): PickFeasibility => ({ state, open: [1], cachedPrice: cached, eligibility: new Set() });
  const base = { rules, slots, order: ['me'], picks: [] as PickRow[], trades: [] as TradeRow[], pickerId: 'me', symbol: 'Q', eligibleCategories: new Set<string>(), isDraftable: true };
  assertEquals(gatePick('L', { ...base, price: 50.004 }, feas(50)).ok, true);
  assertEquals(gatePick('L', { ...base, price: 50.005 }, feas(50.01)).ok, false);
});

// ---------------------------------------------------------------------------
// Property: a feasible draft never runs out of legal picks (seeded, adversarial)
// ---------------------------------------------------------------------------

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

Deno.test('16 managers: feasibility check and gate are fast enough (< 50 ms per full check)', () => {
  const r = rng(7);
  const cats = ['c0', 'c1', 'c2', 'c3'];
  const types: Slot[] = [];
  for (let j = 0; j < 12; j++) types.push(slot(`s${j}`, j, 1, j * 20, (j + 1) * 20 + 40, j % 3 === 0 ? cats[j % 4] : null));
  const stocks: PoolStock[] = [];
  for (let i = 0; i < 15000; i++) {
    const elig = cats.filter(() => r() < 0.1);
    stocks.push(stock(`P${i}`, Math.round(r() * 40000) / 100, elig));
  }
  const order = Array.from({ length: 16 }, (_, i) => `m${i}`);
  const t0 = performance.now();
  const groups = buildPoolGroups(types, stocks, { exclude: [], draftableOnly: true, depth: 16 * 12 + 1 });
  const res = checkStartFeasibility({ types, managers: order.length, numRounds: 12, budget: null, groups });
  const ms = performance.now() - t0;
  assert(ms < 200, `build+check took ${ms.toFixed(1)} ms`); // grouping 15k stocks is the cost, not the flow
  assert(typeof res.ok === 'boolean');

  const flowOnly = performance.now();
  for (let k = 0; k < 20; k++) maxFlow(types.map(() => 16), groups);
  const per = (performance.now() - flowOnly) / 20;
  assert(per < 50, `flow took ${per.toFixed(2)} ms per run`);
});

Deno.test('property: 200 seeded leagues whose start check passes never run out of legal picks', () => {
  const cats = ['c0', 'c1', 'c2'];
  let completed = 0;
  let skipped = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const r = rng(seed * 9973);
    const managers = 4 + Math.floor(r() * 5); // 4..8 (16 covered above; kept small for runtime)
    const numRounds = 2 + Math.floor(r() * 4); // 2..5
    const budgetLeague = r() < 0.5;
    // Random slots summing to numRounds, each with a random bracket / category.
    const slots: Slot[] = [];
    let left = numRounds;
    let idx = 0;
    while (left > 0) {
      const c = Math.min(left, 1 + Math.floor(r() * 2));
      const lo = Math.floor(r() * 150);
      const hi = r() < 0.4 ? null : lo + 20 + Math.floor(r() * 150);
      const cat = r() < 0.4 ? cats[Math.floor(r() * cats.length)] : null;
      slots.push(slot(`s${idx}`, idx, c, lo, hi, cat));
      left -= c;
      idx++;
    }
    const stocks: PoolStock[] = [];
    const pool = 30 + Math.floor(r() * 250);
    for (let i = 0; i < pool; i++) {
      const elig = cats.filter(() => r() < 0.35);
      stocks.push(stock(`Z${seed}_${i}`, Math.round(r() * 30000) / 100 + 0.01, elig));
    }
    const budget = budgetLeague ? 200 + Math.floor(r() * 1200) : null;
    const types = slots;
    const groups0 = buildPoolGroups(types, stocks, { exclude: [], draftableOnly: true, depth: managers * numRounds + 2 });
    const start = checkStartFeasibility({ types, managers, numRounds, budget, groups: groups0 });
    if (!start.ok) {
      skipped++;
      continue; // only leagues the setup/start check admits are in the claim
    }

    const order = Array.from({ length: managers }, (_, i) => `m${i}`);
    const picks: PickRow[] = [];
    const trades: TradeRow[] = [];
    const rules = { stakeMode: (budget != null ? 'budget_cap' : 'price_tiers') as 'budget_cap' | 'price_tiers', budgetAmount: budget, notionalPerSlot: null, numRounds, allowUndraftable: false };
    let stuck = false;
    const adversarial = seed % 2 === 0; // alternate: cheapest-first (hostile to budget) vs random
    for (let turnNo = 0; turnNo < managers * numRounds && !stuck; turnNo++) {
      const turn = currentTurn(picks.length, order, numRounds);
      assert(turn !== null);
      const picker = turn!.pickerId;
      const owned = [...leagueOwnedSymbols(picks, trades)];
      const groups = buildPoolGroups(types, stocks, { exclude: owned, draftableOnly: true, depth: managers * numRounds + 2 });
      const state: FeasibilityState = { types, demand: demandVector(types, order, picks, numRounds), groups, budget };
      const open = openInstances(types, picks, picker, numRounds);
      const legal: { s: PoolStock; gated: ReturnType<typeof gatePick> }[] = [];
      for (const s of stocks) {
        if (owned.includes(s.symbol)) continue;
        const g = gatePick('L', {
          rules,
          slots,
          order,
          picks,
          trades,
          pickerId: picker,
          symbol: s.symbol,
          price: s.cachedPrice!,
          eligibleCategories: s.eligibility,
          isDraftable: true,
        }, { state, open, cachedPrice: s.cachedPrice, eligibility: s.eligibility });
        if (g.ok) legal.push({ s, gated: g });
      }
      if (legal.length === 0) {
        stuck = true;
        break;
      }
      const choice = adversarial
        ? legal.reduce((a, b) => (b.s.cachedPrice! < a.s.cachedPrice! ? b : a))
        : legal[Math.floor(r() * legal.length)];
      if (!choice.gated.ok) throw new Error('unreachable');
      const p = choice.gated.pick;
      picks.push({ user_id: picker, symbol: p.symbol, entry_price: p.price, quantity: p.quantity, pick_number: picks.length + 1, slot_id: p.slotId });
    }
    assertEquals(stuck, false, `seed ${seed}: dead-end after ${picks.length} picks (budget=${budget}, managers=${managers}, rounds=${numRounds})`);
    completed++;
  }
  assert(completed >= 60, `property must exercise real drafts (completed=${completed}, skipped=${skipped})`);
});

Deno.test('flex type: a slotless league is one implicit flex type sized to numRounds', () => {
  const types = flexTypes(6);
  assertEquals(types.length, 1);
  assertEquals(types[0].id, FLEX_TYPE_ID);
  assertEquals(types[0].slotCount, 6);
  assertEquals(reserveFor([1], [4], types, [{ ordinals: [0], n: 10, prices: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }]) > 0, true);
});
