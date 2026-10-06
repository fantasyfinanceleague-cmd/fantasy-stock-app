/**
 * "A draft pick can never be unused" (Giorgio, 2026-10-05) — the feasibility
 * model. PURE: no DB, no fetch, no Deno APIs. The SQL twin is
 * public.draft_feasibility_pool (20261101000000); supabase/tests proves the two
 * produce identical groups on one fixture (PGlite parity).
 *
 * THE MODEL
 *   types      the league's slot types (draft-validation Slot), ordinal = index.
 *              A slot-less league is ONE implicit flex type (FLEX_TYPE_ID).
 *   demand[j]  open instances of type j, summed over every manager.
 *   groups     the pool, grouped by SIGNATURE: the set of types a stock fits.
 *              Each group carries its cheapest prices (for the budget reserve).
 *
 * SLOTS — exact (Hall's condition, max-flow)
 *   source -> type j (cap demand[j]) -> signature g containing j (cap inf)
 *   -> sink (cap n_g). Feasible iff maxflow == total demand. Overlapping types
 *   (Tech inside Flex) are counted together, which per-slot counting cannot do.
 *   On failure the residual-reachable types are the violating set (Hall).
 *
 * PICK TIME — never worsen
 *   A pick is legal only if the league's deficit (total demand - maxflow) does
 *   not grow. In a feasible state that always leaves a legal pick; with drift
 *   already open it degrades instead of freezing.
 *
 * BUDGET — an adversarial reserve (sufficient, not exact)
 *   Exact multi-manager budget feasibility is generalized assignment (NP-hard).
 *   For type j with B_j = demand of types sharing a stock with j (league-wide),
 *   a manager's i-th open j-instance is charged E_j[B_j - o_j + i - 1] (E_j =
 *   the type's stocks, cheapest first; capped at its most expensive), inflated
 *   by RESERVE_INFLATE so drift between the cached and live price cannot make
 *   the last slot unaffordable. Taking a stock can only lower everyone else's
 *   reserve, so only the PICKER needs checking at pick time.
 *
 * MARGINS (one place each)
 *   ROBUST_MARGIN     membership: a stock counts toward a bracket only if its
 *                     cached price is >= 10% inside a floor / <= 10% inside a
 *                     ceiling (cached last_price is up to ~2 trading days old).
 *   RESERVE_INFLATE   1.10 on reserve prices (same 10%).
 *   DEMAND_HEADROOM   setup + start only: each type must have ceil(1.1 x need)
 *                     robust stocks, covering pool shrinkage the model does not
 *                     see (halts, undraftable flips at the daily recompute).
 *                     Integer arithmetic, so 10 x 1.1 is 11, not 11.000...2.
 */
import { tierPrice } from './tier-price.ts';
import { type PickRow, SKIP_SYMBOL, type Slot } from './draft-validation.ts';

export const FLEX_TYPE_ID = '__flex__';
export const ROBUST_MARGIN = 0.1;
export const RESERVE_INFLATE = 1.1;
const EPS = 1e-9;
const INF = 1e15;

export interface PoolStock {
  symbol: string;
  /** symbols.last_price (cached). null = unpriced: never in the pool. */
  cachedPrice: number | null;
  /** effective category ids (DR-001 three layers). */
  eligibility: Set<string>;
  isDraftable: boolean;
}

/** One signature group: the types its stocks fit, how many, cheapest prices
 * first (tierPrice-rounded, capped at the caller's depth). */
export interface PoolGroup {
  ordinals: number[];
  n: number;
  prices: number[];
}

export interface HallViolation {
  /** Violating slot-type ordinals (indices into the types array). */
  ordinals: number[];
  need: number;
  have: number;
}

export interface FeasibilityState {
  types: Slot[];
  demand: number[];
  groups: PoolGroup[];
  /** budget_cap budget; null = no budget rule. */
  budget: number | null;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The implicit single flex type of a slot-less league. */
export function flexTypes(numRounds: number): Slot[] {
  return [{ id: FLEX_TYPE_ID, slotIndex: 0, slotCount: numRounds, priceMin: null, priceMax: null, categoryId: null }];
}

/** Slots sorted by slot_index (ordinal = position), or the flex type. */
export function typesFromSlots(slots: Slot[], numRounds: number): Slot[] {
  if (slots.length === 0) return flexTypes(numRounds);
  return [...slots].sort((a, b) => a.slotIndex - b.slotIndex);
}

const isFlex = (types: Slot[]) => types.length === 1 && types[0].id === FLEX_TYPE_ID;

// ---------------------------------------------------------------------------
// Membership / signatures
// ---------------------------------------------------------------------------

/** Robust bracket test on the ROUNDED cached price (see margins above). */
export function robustFits(t: Slot, px: number, eligibility: Set<string>): boolean {
  if (t.priceMin != null && px + EPS < t.priceMin * (1 + ROBUST_MARGIN)) return false;
  if (t.priceMax != null && px > t.priceMax * (1 - ROBUST_MARGIN) + EPS) return false;
  if (t.categoryId != null && !eligibility.has(t.categoryId)) return false;
  return true;
}

/** Ascending ordinals of the types a stock robustly fits. Empty = unusable. */
export function signatureOf(types: Slot[], cachedPrice: number, eligibility: Set<string>): number[] {
  const px = tierPrice(cachedPrice);
  const out: number[] = [];
  types.forEach((t, j) => {
    if (robustFits(t, px, eligibility)) out.push(j);
  });
  return out;
}

const sameOrdinals = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);

// ---------------------------------------------------------------------------
// Pool (mirror of public.draft_feasibility_pool)
// ---------------------------------------------------------------------------

export interface PoolOptions {
  exclude: Iterable<string>;
  draftableOnly: boolean;
  /** Cheapest prices kept per group. Use >= the total open demand + 1. */
  depth: number;
}

export function buildPoolGroups(types: Slot[], stocks: PoolStock[], opts: PoolOptions): PoolGroup[] {
  const excl = new Set([...opts.exclude].map((s) => s.toUpperCase()));
  const byKey = new Map<string, { ordinals: number[]; n: number; prices: number[] }>();
  for (const s of stocks) {
    if (s.cachedPrice == null || !(s.cachedPrice > 0)) continue;
    if (opts.draftableOnly && !s.isDraftable) continue;
    if (excl.has(s.symbol.toUpperCase())) continue;
    const sig = signatureOf(types, s.cachedPrice, s.eligibility);
    if (sig.length === 0) continue;
    const key = sig.join(',');
    const g = byKey.get(key) ?? { ordinals: sig, n: 0, prices: [] };
    g.n += 1;
    g.prices.push(tierPrice(s.cachedPrice));
    byKey.set(key, g);
  }
  return [...byKey.values()].map((g) => ({
    ordinals: g.ordinals,
    n: g.n,
    prices: g.prices.sort((a, b) => a - b).slice(0, Math.max(opts.depth, 1)),
  }));
}

// ---------------------------------------------------------------------------
// Demand
// ---------------------------------------------------------------------------

/**
 * One manager's open instances per type. Occupancy comes from their non-SKIP
 * picks; their REMAINING TURNS cap the total (a legacy SKIP turn never gets a
 * pick, so its slot instance must not count as demand forever). Allocation
 * takes instances in slot order until the turns run out.
 */
export function openInstances(types: Slot[], picks: PickRow[], pickerId: string, numRounds: number): number[] {
  const mine = picks.filter((p) => String(p.user_id) === pickerId);
  const turnsLeft = Math.max(numRounds - mine.length, 0);
  const flex = isFlex(types);
  const occupied = new Map<string, number>();
  let nonSkip = 0;
  for (const p of mine) {
    if ((p.symbol ?? '').toUpperCase() === SKIP_SYMBOL) continue;
    nonSkip++;
    if (p.slot_id) occupied.set(p.slot_id, (occupied.get(p.slot_id) ?? 0) + 1);
  }
  let rem = turnsLeft;
  return types.map((t) => {
    const occ = flex ? nonSkip : (occupied.get(t.id) ?? 0);
    const want = Math.max(t.slotCount - occ, 0);
    const take = Math.min(want, rem);
    rem -= take;
    return take;
  });
}

/** League-wide open demand per type: every member's open instances. */
export function demandVector(types: Slot[], order: string[], picks: PickRow[], numRounds: number): number[] {
  const total = types.map(() => 0);
  for (const id of order) {
    openInstances(types, picks, id, numRounds).forEach((v, j) => (total[j] += v));
  }
  return total;
}

// ---------------------------------------------------------------------------
// Max-flow (Edmonds-Karp; the graph is tiny: <= 12 types, <= ~650 signatures)
// ---------------------------------------------------------------------------

export function maxFlow(demand: number[], groups: PoolGroup[]): { flow: number; hall: HallViolation | null } {
  const k = demand.length;
  const g = groups.length;
  const N = k + g + 2;
  const S = k + g;
  const T = S + 1;
  const cap: number[][] = Array.from({ length: N }, () => new Array<number>(N).fill(0));
  demand.forEach((d, j) => (cap[S][j] = Math.max(d, 0)));
  groups.forEach((grp, gi) => {
    cap[k + gi][T] = grp.n;
    for (const j of grp.ordinals) cap[j][k + gi] = INF;
  });

  let flow = 0;
  let reached: boolean[] = [];
  for (;;) {
    const parent = new Array<number>(N).fill(-1);
    parent[S] = S;
    const queue = [S];
    for (let qi = 0; qi < queue.length && parent[T] === -1; qi++) {
      const u = queue[qi];
      for (let v = 0; v < N; v++) {
        if (parent[v] === -1 && cap[u][v] > 0) {
          parent[v] = u;
          queue.push(v);
        }
      }
    }
    reached = parent.map((p) => p !== -1);
    if (parent[T] === -1) break;
    let bottleneck = INF;
    for (let v = T; v !== S; v = parent[v]) bottleneck = Math.min(bottleneck, cap[parent[v]][v]);
    for (let v = T; v !== S; v = parent[v]) {
      cap[parent[v]][v] -= bottleneck;
      cap[v][parent[v]] += bottleneck;
    }
    flow += bottleneck;
  }

  const demandTotal = demand.reduce((a, b) => a + Math.max(b, 0), 0);
  if (flow >= demandTotal) return { flow, hall: null };
  // Residual-reachable types = the Hall-violating set.
  const R: number[] = [];
  for (let j = 0; j < k; j++) if (reached[j] && demand[j] > 0) R.push(j);
  const adj = new Set<number>();
  for (let gi = 0; gi < g; gi++) if (reached[k + gi]) adj.add(gi);
  let need = 0;
  for (const j of R) need += demand[j];
  let have = 0;
  for (const gi of adj) have += groups[gi].n;
  return { flow, hall: R.length ? { ordinals: R, need, have } : null };
}

/** total demand - maxflow. 0 = every open instance has a distinct stock. */
export function deficit(demand: number[], groups: PoolGroup[]): number {
  const total = demand.reduce((a, b) => a + Math.max(b, 0), 0);
  return total - maxFlow(demand, groups).flow;
}

// ---------------------------------------------------------------------------
// Budget reserve
// ---------------------------------------------------------------------------

/**
 * The reserve for one manager with `open` instances, in a league with `demand`
 * open instances in total. Infinity = no stock can fill an instance.
 */
export function reserveFor(open: number[], demand: number[], types: Slot[], groups: PoolGroup[]): number {
  let total = 0;
  for (let j = 0; j < types.length; j++) {
    const o = open[j] ?? 0;
    if (o <= 0) continue;
    const E: number[] = [];
    let B = 0;
    const sharing = new Set<number>([j]);
    for (const grp of groups) {
      if (!grp.ordinals.includes(j)) continue;
      E.push(...grp.prices);
      for (const k of grp.ordinals) sharing.add(k);
    }
    for (const k of sharing) B += demand[k] ?? 0;
    if (E.length === 0) return Infinity;
    E.sort((a, b) => a - b);
    for (let i = 1; i <= o; i++) {
      const idx = Math.max(Math.min(B - o + i - 1, E.length - 1), 0);
      total += E[idx] * RESERVE_INFLATE;
    }
  }
  return total;
}

// ---------------------------------------------------------------------------
// Per-pick evaluation (used by gatePick, the auto-pick search and the property test)
// ---------------------------------------------------------------------------

/** Apply one pick to the state: one open instance of type `ordinal` is filled,
 * and the stock leaves its signature group (if it was in the pool). */
export function applyPick(
  state: FeasibilityState,
  ordinal: number,
  cachedPrice: number | null,
  eligibility: Set<string>,
): { demand: number[]; groups: PoolGroup[] } {
  const demand = state.demand.slice();
  demand[ordinal] = Math.max(demand[ordinal] - 1, 0);
  const groups = state.groups.map((g) => ({ ordinals: g.ordinals, n: g.n, prices: g.prices.slice() }));
  if (cachedPrice != null && cachedPrice > 0) {
    const sig = signatureOf(state.types, cachedPrice, eligibility);
    const gi = groups.findIndex((g) => sameOrdinals(g.ordinals, sig));
    if (sig.length && gi >= 0) {
      groups[gi].n = Math.max(groups[gi].n - 1, 0);
      const px = tierPrice(cachedPrice);
      const at = groups[gi].prices.indexOf(px);
      if (at >= 0) groups[gi].prices.splice(at, 1);
    }
  }
  return { demand, groups };
}

export type PickFeasibilityRefusal = 'would_strand_slot' | 'budget_reserve';

/**
 * Is taking one instance of type `ordinal` with this stock legal for the
 * league's feasibility? Never-worsen first (slots), then the picker's reserve.
 * `cost` = price x quantity; `spent` = the picker's cash already committed.
 */
export function evaluateFeasiblePick(
  state: FeasibilityState,
  a: {
    ordinal: number;
    cachedPrice: number | null;
    eligibility: Set<string>;
    cost: number;
    spent: number;
    open: number[];
  },
): { ok: true } | { ok: false; reason: PickFeasibilityRefusal } {
  const pre = deficit(state.demand, state.groups);
  const post = applyPick(state, a.ordinal, a.cachedPrice, a.eligibility);
  if (deficit(post.demand, post.groups) > pre) return { ok: false, reason: 'would_strand_slot' };
  if (state.budget != null) {
    const postOpen = a.open.slice();
    postOpen[a.ordinal] = Math.max((postOpen[a.ordinal] ?? 0) - 1, 0);
    const reserve = reserveFor(postOpen, post.demand, state.types, post.groups);
    if (a.spent + a.cost + reserve > state.budget + EPS) return { ok: false, reason: 'budget_reserve' };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Setup / start
// ---------------------------------------------------------------------------

export type LeagueFeasibilityVerdict =
  | { ok: true }
  | { ok: false; reason: 'slots_infeasible'; hall: HallViolation }
  | { ok: false; reason: 'budget_infeasible'; reserve: number; budget: number };

/**
 * Setup and start check: every manager (all identical pre-draft) can be filled,
 * with DEMAND_HEADROOM on the slot side and the budget reserve on the budget side.
 * `managers` is the member count at start, or the league cap at setup (the
 * worst case the league can reach).
 */
export function checkStartFeasibility(i: {
  types: Slot[];
  managers: number;
  numRounds: number;
  budget: number | null;
  groups: PoolGroup[];
}): LeagueFeasibilityVerdict {
  const base = i.types.map((t) => i.managers * t.slotCount);
  const headroom = base.map((d) => (d > 0 ? Math.ceil((d * 11) / 10) : 0));
  const slots = maxFlow(headroom, i.groups);
  if (slots.hall) return { ok: false, reason: 'slots_infeasible', hall: slots.hall };
  if (i.budget != null) {
    const open = i.types.map((t) => t.slotCount);
    const reserve = reserveFor(open, base, i.types, i.groups);
    if (!(reserve <= i.budget + EPS)) return { ok: false, reason: 'budget_infeasible', reserve, budget: i.budget };
  }
  return { ok: true };
}
