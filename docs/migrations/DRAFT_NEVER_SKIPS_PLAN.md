# Draft never skips — plan (fix/draft-never-skips)

Product rule (Giorgio, 2026-10-05): **a draft pick can never be unused**, and no pick (manual, queue, best-available, bot) may break league criteria (tiers, category slots, budget, draftable universe).

Status: PLAN, awaiting "go". Provisional migrations 20261101000000–09.

## 0. Today's gaps (recon)

- `decideNoPick` writes SKIP for bots always, and for humans on a legality refusal (`auto_skip`).
- `action:'skip'` lets a human forfeit their own turn voluntarily, and lets any member skip a bot's turn ("stuck-bot escape hatch"). Both write SKIP.
- Setup feasibility is a comment-level WARNING (`20260810000004` ~l.40). The client only enforces Σslot_count == num_rounds (`validateSlotConfig`).
- `validatePick` checks only the picker. Nothing protects OTHER managers:
  - **Slot stranding:** a scarce category stock drafted into a Flex slot (first-fit by slot_index) can leave someone's Tech slot with no eligible stock left.
  - **Budget dead-end:** the budget check is `spent + price <= budget`, with no reserve for the remaining slots.
- Price rounding: the gate compares the RAW live price against `price_min/max`, and `entry_price` stores it raw. The SQL search compares raw `last_price`. No shared rounding rule exists.
- Setup writes are direct PostgREST: `league_draft_slots` RLS is commissioner-only, written by mobile `saveLeagueSlots` as a delete-then-insert in two requests. A DB trigger therefore can't judge the final slot set, so the server can't refuse at write time without moving the writes server-side.

## 1. The feasibility model

Some terms:
- **Slot types** j = the league's `league_draft_slots` rows (k ≤ num_rounds ≤ 12). A slot-less league is one implicit flex type with count R.
- **Demand:** each manager has open instances `o[m][j]`. At start, `o = c_j` for everyone.
- **Pool:** symbols that are active, not `price_unsupported`, draftable (unless `allow_undraftable`), priced, and not owned in the league.
- **Signature** σ(s) = the set of slot types that accept s, judged on the ROBUST price (§3). The pool is aggregated as signature → count, plus that signature's ascending price list, truncated at the depth we need.

### 1a. Slot dimension: exact, a max-flow (Hall's condition)

The graph is source → type j (capacity Σ_m o[m][j]) → signature σ ∋ j (∞) → sink (capacity count(σ)).

- **Feasible ⇔ maxflow == total open demand.** This is Hall's condition over every subset of slot types at once, so overlapping slots (Flex ⊇ Tech, nested tiers) are counted correctly.
- On failure, the residual-reachable set of types is the min cut. That is exactly the Hall-violating set T: "slots {2,5} need 48 stocks, only 31 qualify". It goes into the refusal detail.

Size and complexity:
- Signatures are bounded by price cells × categories: S ≤ (2k+1)(C+1). With k=12 and C≈25, that is about 650. Typically it is under 60, because most symbols share a few signatures.
- The graph has V ≈ k+S+2 nodes and E ≤ k·S edges.
- Dinic's worst case is O(V²E), about 6e9 at that ceiling, which is purely theoretical. Real graphs here are bipartite and shallow, so augmenting phases are tiny.
- **Worst case 16 managers × 12 slots, 12 distinct types, 25 categories:** I'll benchmark it in a test and assert < 50 ms per flow. I expect under 1 ms.
- Aggregation cost is in SQL: one pass over ~15k symbols × k slot predicates, about 180k cheap comparisons, one query.

### 1b. Pick-time rule: "never worsen" (exact, drift-tolerant)

A pick of stock s into slot j is legal only if **maxflow(post) == maxflow(pre) − 1**. In words, the league's unfillable-instance count (the deficit) does not grow.

- In a feasible state (deficit 0), this is exactly "the draft stays fillable for everyone". Some legal pick always exists: the stock the matching assigns to one of the picker's open instances.
- If price drift already opened a deficit, the rule still allows picks that don't make it worse. The draft degrades gracefully instead of freezing, because a plain "post must be feasible" rule would refuse every pick once drift happened.

**Slot assignment becomes feasibility-aware.** It still tries slots first-fit in slot_index order, but takes the first eligible open slot whose post-state passes. A tech stock then lands in the Tech slot instead of Flex when Flex would strand someone.
- Today's order is unchanged whenever it is safe, so existing tests stay green.
- If eligible slots exist but none is safe, the new refusal is `would_strand_slot`.

### 1c. Budget dimension (budget_cap): an adversarial reserve, conservative but rigorous

Exact multi-manager budget feasibility is a generalized-assignment problem, which is NP-hard, so I use a provable sufficient condition instead.

**The bound.** For manager m and open type j, let:
- E_j = the pool stocks fitting j, sorted ascending by robust price (cached × (1+δ));
- B_j = the open instances league-wide (all managers, including m's own) of types whose eligible set intersects E_j. Only those can ever consume an E_j stock.

Then m's i-th open instance of j (i = 1..o[m][j]) costs at most:

  `bound(m,j,i) = min( E_j[B_j − o[m][j] + i − 1], max(E_j) )`

The first term holds because at most B_j − o + (i−1) other instances can have taken cheaper E_j stocks. The `max` term holds because the slot invariant (1b) guarantees some E_j stock survives for m.

The reserve is `reserve(m) = Σ_j Σ_i bound(m,j,i)`.

**Pick rule.** `spent + price·qty + reserve(picker, post-pick) <= budget`. A failure is the new refusal `budget_reserve`, which carries {reserve, open_slots}.

**Only the picker needs checking (monotonicity).** When p picks s, every OTHER manager m's B_j drops by 1 and E_j loses at most s, so every index shifts down by ≥ 0 and `bound` can only fall. m's reserve never rises and m's budget is untouched. So the invariant "every manager can afford their remaining slots" is preserved for others without re-checking them. That is the proof the hermetic property test will exercise (§6).

**Size in practice.** With δ=10% and a $1 draftable floor, the reserve is roughly "R × the B-th cheapest eligible price". B ≈ 192 at worst (16×12), and the 192nd-cheapest draftable stock is single-digit dollars. So the rule only bites on genuine dead-ends: an early $990 pick in a $1,000 league with 9 slots left. In tight-tier leagues it bites where it should.

**Effect on auto-pick search.** Each open-slot spec's `max` is clamped to `budget − spent − reserve(picker, after filling j)` instead of `budget − spent`. The search then only proposes affordable-with-reserve stocks, and the 15-attempt bound isn't wasted on reserve refusals.

## 2. Where each check lives

| Check | Where | Inputs |
|---|---|---|
| Pure model: flow, min-cut, signatures, reserve, never-worsen | NEW `_shared/draft-feasibility.ts` (pure, hermetic) | slot types, open counts, pool |
| Pool aggregation | NEW RPC `public.draft_feasibility_pool(p_slots jsonb, p_allow_undraftable bool, p_exclude text[], p_margin numeric, p_depth int)` → (slot_ordinals int[], n bigint, prices numeric[]) | service_role only (revoke anon + authenticated BY NAME, proacl-verified) |
| Pick gate | `validatePick` gains a REQUIRED `pool: FeasibilityPool`, so the type forces every caller (manual, bot, auto) to load it. `gatePick` is unchanged in shape, so all writers stay on the ONE gate. `validateTradeAdd` (post-draft) is unchanged. | loaded once per request in `draft-write.ts` (`loadDraftContext` / `autoPickTurn`) |
| Setup check | `draft-control` new `action:'check_setup'` (commissioner, before draft start), with the PROPOSED config {slots, num_participants, num_rounds, stake_mode, budget_amount, allow_undraftable} → {ok} or refusal. Uses M = num_participants (the cap: worst case). | mobile create-league + league-settings call it and block Next/Save, like `validateSlotConfig` hard errors |
| Start check | `draft-control` `status` + `start`: new blockers `slots_infeasible`, `budget_infeasible`, `feasibility_unavailable` (fail CLOSED if the pool RPC errors). Uses the ACTUAL member count and CURRENT cached prices. | same model |
| Stall alert | `draft-write.ts`: auto-pick never writes SKIP; on no legal pick → `stalled` | §4 |

**Residual (to flag, not fix here).**
- A hand-crafted PostgREST write can still SAVE an infeasible config, because slot/league writes are client-direct.
- The commissioner can still flip `draft_status` directly via [I2a] and bypass draft-control's start check. Mobile always goes through draft-control.
- Closing both means moving slot writes server-side and landing the already-deferred I6/I2b drop. That is a follow-up.
- Pick-time "never worsen" + no-SKIP still hold even in a league that slipped through.

## 3. Price source, rounding and the safety margin (item 5)

**One rounding rule.** `tierPrice(x) = round(x, 2)` (cents, half away from zero): `Math.round(x*100)/100` in TS (with an epsilon guard) and `round(x::numeric, 2)` in SQL.
- `slotAccepts` judges `tierPrice(livePrice)`, so $50.004 counts as $50.00 and is legal in ≤ $50.
- The pool RPC judges `tierPrice(last_price)`.
- `entry_price` keeps the raw fill, so no money changes. Budget math is unchanged (raw).
- Tests pin 49.995 → 50.00 (in), 50.005 → 50.01 (out), and SQL/TS parity on the same fixture via PGlite.

**Source.** Start and setup necessarily use CACHED `symbols.last_price`, because 15k symbols can't be live-priced. The pick gate uses the LIVE price for the picked stock, and the cached pool for everyone else's feasibility. Both read the same RPC and the same rounding. The margin bridges cached vs live.

**Margin (proposed).**
- **δ = 10%, a robust-bracket shrink.** A stock counts toward a tier only if its cached cents-price is in `[min·1.10, max·0.90]`, and reserve prices use cached × 1.10.
- Why 10%:
  - `last_price` is refreshed only by enrich-symbols, at 50 symbols per 10 min ≈ 7,200/day, so a ~2-day full cycle over 14.7k symbols. That makes cached prices up to ~2 trading days stale.
  - A >10% two-day move in a ≥$250M-cap, ≥$1 stock is a low-single-digit-percent event.
  - Only stocks near a boundary are at risk, and those are exactly what the shrink excludes.
- **h = +10% demand headroom (ceil) at setup AND start only.** A type needing 16 must show ≥ 18 robust stocks.
- Why headroom: it covers pool shrinkage during the draft that drift doesn't model (a symbol going inactive/undraftable at the daily recompute, halts, `price_unsupported` flips).
- No headroom at pick time: there, the exact never-worsen rule plus drift tolerance apply.

## 4. No SKIP, for anyone (item 3)

**Humans.**
- `decideNoPick` no longer returns skip.
- Outcomes:
  - nothing priceable → `retry_later` (unchanged: the turn stays open, and the sweep/clients retry);
  - legality exhaustion → `stalled`. No row is written, the turn stays open, it is logged `console.error('[draft-stall]', …)`, and it is recorded in NEW table `draft_stalls` (league_id, pick_number, picker_id, reason, attempts, first_seen_at, last_seen_at, PK (league_id, pick_number)).
- I recommend a push to the commissioner on first insert via `_shared/push.ts`, "auto-pick couldn't find a legal stock for X — pick manually". The Orchestrator decides.

**Voluntary skip.**
- `action:'skip'` is refused for everyone with a new reason `skip_disabled`.
- The rule is "never unused", so a human can no longer forfeit their own pick either.
- **This changes a product behaviour; flag it to Giorgio.**

**Bots (my choice): the same rule, they never skip.**
- `bot_pick` / `auto_pick` on a bot's turn → pick, `retry_later`, or `stalled`. Nobody can skip a bot either: the stuck-bot escape hatch is removed.
- With the invariant in place, a bot stall needs drift or an outage, and retries come from the next client trigger.
  - Clocked drafts: a connected client fires `auto_pick` at deadline. The sweep cron would retry once scheduled.
  - Unclocked drafts: mobile re-fires `bot_pick` when it remounts.
- Known limit: mobile fires `bot_pick` once per turn per app session, so an unclocked bot stall waits for a remount. That is acceptable for test-only bots; I'll note it in STATUS.

**DB backstop (deferred).** `20261101000002_drafts_refuse_new_skip.sql` adds a BEFORE INSERT trigger refusing `upper(symbol)='SKIP'`, so the rule becomes structural.
- Existing rows are untouched, and turn math / fixed_notional unfilled-slot credit still read legacy SKIPs.
- It goes in `supabase/migrations/deferred/` with the precondition "new functions deployed and byte-verified", because the OLD deployed code would 500 on its skip paths.

**Legacy rows.** The SKIP-reading code (turn math, `fixedNotionalFunding.unfilledSlots`, ownership/budget exclusion) stays as-is.

## 5. Migrations (all in range)

1. `20261101000000_draft_feasibility_pool.sql`: the RPC.
   - Category three-layer logic is mirrored from `auto_pick_search_candidates`, and a PGlite test asserts both agree.
   - SECURITY DEFINER with a pinned `search_path`. Revoke from PUBLIC, anon and authenticated by name. Grant service_role.
2. `20261101000001_draft_stalls.sql`: the table.
   - RLS on: members SELECT their league's rows, writes service-role only.
   - Members SELECTing means a stalled draft can show "auto-pick paused" later.
3. `deferred/20261101000002_drafts_refuse_new_skip.sql`: the trigger, plus a README precondition.

There are no data migrations. SKIP rows stay (item 4).

## 6. Test plan (TDD: tests first, then code)

**Hermetic Deno tests.**

NEW `_shared/draft-feasibility.test.ts`:
- **Flow basics:** single flex; disjoint tiers; nested tiers.
- **Overlapping slots:** Tech(1)+Flex(9), M=16, 20 tech stocks → feasible. A tech→Flex pick that would strand is refused, and the same stock goes to Tech when that is open.
- **Min-cut detail** names the exact deficient slot set with need/have.
- **Tier boundary at rounding:** 49.995/50.005; robust-margin exclusion at min·1.10 / max·0.90; TS `tierPrice` matches SQL fixtures.
- **Budget dead-end prevented:**
  - a $990 first pick with 9 slots left is refused `budget_reserve`;
  - an affordable alternative passes;
  - an adversarial schedule (others always take the cheapest) never leaves anyone unable to afford their last slot.
- **16 managers:**
  - 16×12 with 12 types / 25 categories: feasibility < 50 ms;
  - **a seeded randomized full-draft property test.** 200 drafts × random legal picks + adversarial "cheapest-first" and "scarce-first" pickers. Assert every turn has ≥ 1 legal pick and every draft completes with 0 SKIP and 0 stalls (no drift in the model).
- **Drift tolerance:** a pre-state with deficit 1 still allows non-worsening picks.

Updated `draft-validation.test.ts`: new refusals and feasibility-aware assignment. All existing cases stay green with a permissive pool.

Updated `auto-pick.test.ts`:
- never `skip`;
- human and bot → `stalled`; outage → `retry_later`;
- reserve-clamped specs;
- "never illegal" still holds.

Updated `draft-control/rules.test.ts`: the three new blockers + `check_setup` decisions.

**PGlite (`supabase/tests/`).**
- `draft_feasibility_pool.pglite.test.ts`:
  - signature counts, the category 3-layer, margin, exclude, depth;
  - the anon/authenticated EXECUTE is refused (42501, not a raise — the known trap);
  - TS↔SQL parity.
- `drafts_refuse_new_skip.pglite.test.ts`: refuses new SKIP, allows normal rows, and legacy rows remain readable.
- `draft_insert_sites.test.ts` structural check: no SKIP insert site remains in functions.

**Suites.** `deno test supabase/functions/` + `deno test --allow-read --allow-env supabase/tests/`, all green.

**Then.**
- architecture regen;
- security-reviewer + supabase-reviewer;
- `git status` / `git diff --cached --stat` before each commit.

## 7. Client (mobile) scope

I propose minimal in-branch wiring:
- `check_setup` call in create-league + league-settings (block on refusal);
- remove the Skip button / bot-skip affordance in draft.tsx;
- map the new reason codes to copy keys.

Copy keys (placeholder English, for Design Lead/Giorgio to set verbatim):

| Key | Placeholder |
|---|---|
| `draft.feasibility.slots_infeasible` | "Not enough eligible stocks for {slots}: {managers} managers need {need}, only {have} qualify." |
| `draft.feasibility.budget_infeasible` | "A ${budget} budget can't guarantee every pick — filling all {n} slots can cost up to ${worst}." |
| `draft.feasibility.unavailable` | "Couldn't check the stock pool. Try again." |
| `draft.pick.would_strand_slot` | "This pick would leave a {slot} slot unfillable for another manager." |
| `draft.pick.budget_reserve` | "Keep ${reserve} for your {n} remaining picks." |
| `draft.skip_disabled` | "Every pick must be used." |

Alternatively, client wiring is a separate follow-up branch. The Orchestrator decides.

## 8. Item 4: legacy SKIP count (READ-ONLY, for the Orchestrator)

```sql
-- READ-ONLY. Legacy SKIP rows by source / league state / bot-vs-human.
SELECT coalesce(d.pick_source, '(null)')           AS pick_source,
       l.draft_status,
       (d.user_id LIKE 'bot-%')                    AS is_bot,
       count(*)                                    AS skip_rows,
       count(DISTINCT d.league_id)                 AS leagues
FROM public.drafts d
JOIN public.leagues l ON l.id = d.league_id
WHERE upper(d.symbol) = 'SKIP'
GROUP BY 1, 2, 3
ORDER BY skip_rows DESC;

-- Total + the leagues still drafting (where this change matters live):
SELECT count(*) AS total_skip_rows,
       count(*) FILTER (WHERE l.draft_status = 'in_progress') AS in_progress_skip_rows
FROM public.drafts d JOIN public.leagues l ON l.id = d.league_id
WHERE upper(d.symbol) = 'SKIP';
```

## 9. HUMAN ACTION (at DONE)

1. **`db push` from the deploy checkout:** `20261101000000`, `20261101000001`. Verify with `schema_migrations` + proacl on `draft_feasibility_pool`.
2. **Deploy** `validate-and-record-pick`, `draft-control`, `draft-autopick-sweep` (shares `_shared/draft-write.ts`). Byte-verify: the upload list includes `_shared/draft-feasibility.ts`, then download + diff.
3. **Promote** `deferred/20261101000002` → `migrations/` → `db push` → effect test: an insert of SKIP is refused. *(Done on the branch as `20261106000002`, released with the sweep cron; see `docs/migrations/AUTOPICK_CRON_LIVE.md`. Effect test: `docs/security/refuse-new-skip-effect-test.sql`.)*

## Residuals and follow-ups (as built, 2026-10-05)

Tied to the deferred I6/I2b drop (`supabase/migrations/deferred/20260929000000_drop_I6_I2b.sql`) unless noted.

1. **Direct PostgREST config writes.** League slot rows are still written client-direct (delete + insert). A crafted write can save a league whose slots cannot be filled. `check_setup` is advisory until slot writes move server-side.
2. **[I2a] draft_status flip.** The commissioner can still flip `draft_status` over PostgREST and bypass the start check.
3. **Persistent vendor outage — FIXED (2026-10-05).** A dead symbol is negative-cached in `auto_pick_price_failures` for `PRICE_COOLDOWN_MS` (5 min), so the walk moves to the next priced legal candidate. A turn stopped only by outages is escalated once after `OUTAGE_ESCALATE_MS` (5 min): a `draft_stalls` row with reason `vendor_outage` (members see "Paused") and one commissioner push, tracked in `draft_turn_outages`. Recovery clears both rows in `insertGatedPick`. Migration `20261101000003`.
4. **Alpaca quota.** `LIVE_MAX_ATTEMPTS` counts logical price calls, and each can be up to three HTTP requests on the shared app key. Bound HTTP requests instead, and skip the later price stages after a 404.
5. **Search exclude array (SQL cost).** `auto_pick_search_candidates` tests `upper(symbol) = any(p_exclude)`, which grows each round. Replace with an anti-join against `unnest(p_exclude)`. Needs a migration.
6. **Catalog staleness beyond the 10% band (definition of "stalled").** "stalled" means no legal stock at cached prices within the 10% band, verified live. A stock whose cached price is more than 10% outside its bracket is not priced live until enrich-symbols refreshes it. The start-time check (with 10% headroom) should make a stall unreachable; this sentence is the accepted product definition (Orchestrator, 2026-10-05), and it is noted at the `stalled` decision in `auto-pick.ts`.
7. **Unparseable price responses.** `alpaca-price.ts` has no try/catch around `fetch`. A network rejection turns the whole turn into `unhandled` (fail-closed, not silent).
8. **Budget free check** no longer short-circuits: budget refusals at the cached price are priced live.
9. **Permanent limbo (review, 2026-10-05).** A symbol that passes the free check but never prices (for example, no data feed for it) keeps the turn in outage: `retry_later`, labelled "Paused", with no legality verdict and no stall alert. The turn stays open either way, so no illegal pick results, but the label is not truthful. Fix: after N consecutive live failures on one symbol, treat it as refused.
10. **Fill race in the escalation writers.** `noteOutage` and `recordStall` can run just after `insertGatedPick` cleared the turn's rows and write an orphan row for a filled pick, then push about it. Fix: before the escalation insert, confirm the pick number is still open. The pattern predates this change in `recordStall`.
11. **Platform outage vs per-symbol gap.** `fetchFillPrice` returns no price both for a symbol with no data and for a vendor-wide outage. Both write per-symbol failure rows, so a vendor blip cools the catalog for the cooldown window. Fix: distinguish HTTP-level failures from empty data.

