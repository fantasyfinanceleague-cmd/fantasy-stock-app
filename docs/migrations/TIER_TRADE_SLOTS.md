# Tier trade slots: "Replace in the same tier" (2026-10-06)

Status: authored on `fix/tier-trade-slots`, **not applied, not deployed**. Provisional
migration `20261103000000` (re-stamped at release). Ruling: Giorgio 2026-10-06, board
`#call-tier-trades`, option A.

## The rule
- Selling a stock frees THAT stock's slot.
- A buy must fit a FREE slot by its price (`price_min`/`price_max`, judged with
  `_shared/tier-price.ts` `tierPrice`, like the draft's `slotAccepts`) and takes it.
- No free slot fits: refused, and the client says e.g. "AAPL is $211.42. Your open slot
  takes stocks priced $100 to $200."
- A tier is set by the ENTRY price (draft or buy) and never moves when the price drifts.
- Unchanged: one share per buy, the whole position per sell, a sale's cash back to the
  budget, the budget check.
- Applies to every slotted league (price_tiers AND category slots; same bug, same rule).

## The bug
`validateTradeAdd` counted occupancy from `drafts.slot_id` only. A trade-bought position
held no slot, so after a trade a manager could buy a second stock into a filled one-share
tier (picks = NVDA in `hi`; MSFT bought at $100 fills `lo`; GOOG at $150 was `legal:true`).
Only `num_rounds` capped the total.

## Design
1. **Data model.** `trades.slot_id uuid NULL REFERENCES league_draft_slots(id) ON DELETE
   SET NULL`, `CHECK (slot_id IS NULL OR action = 'buy')`, partial index. Written ONLY
   through `record_trade_atomic` (new 13th arg `p_slot_id uuid DEFAULT NULL`).
2. **Occupancy** (`userSlotOccupancy`, `_shared/draft-validation.ts`): per HELD position,
   from the event that OPENED it: the user's last buy of the symbol (`trades.slot_id`),
   else the draft pick (`drafts.slot_id`). A whole-position sell closes it and frees the slot.
   (Draft NVDA, sell, buy NVDA back counts the buy's slot once.)
3. **Legacy rows: derived at read time, NOT backfilled.** After this ships a slotted-league
   buy always has `slot_id`, so NULL means exactly one thing: unattributed (pre-fix row, or
   its slot was deleted). Derivation: recorded positions are placed first (never moved); then
   unattributed ones, picks by `pick_number` then trades chronologically, take the first slot
   by `slot_index` that accepts their ENTRY price + category and has capacity (same
   `assignSlot` as the draft). No backfill: it would copy the tier/category rule into SQL,
   freeze an overflow, and rewrite trade history (same call as `funded_by_trade_id`).
4. **Overflow never strands.** A manager already holding two stocks in a one-share tier: the
   extra goes OVER capacity into the first slot that accepts it, so that tier stays closed to
   new buys. Sells never check slots, so they can sell EITHER; the derivation re-runs and once
   the tier is back to one stock it is simply "held", and selling that last one reopens it.
   A position no slot accepts occupies nothing.
5. **Which slot when several are free:** server first-fit by `slot_index` (the draft's rule;
   overlap only at shared inclusive boundaries). No client choice. The preview shows the
   slot before the user confirms.
6. **Concurrency.** The new reads are trades/drafts content, already covered by the exact id
   sets in the CAS. The RPC adds three guards AFTER CAS 4 (so a concurrent slot edit is
   `ledger_changed` and retried): slot only on a buy; slot belongs to this league; a buy in a
   league that HAS slots must carry one.
7. **Scoring is unaffected.** `process-week-results`, `snapshot-week-start/end` and
   `draft-write.ts` read `trades` with explicit column lists; slots never enter scoring.

## Client contract (for the 3e worker)
Existing code `no_eligible_slot` is kept (older builds already map it).

**Refusal** (HTTP 200):
```json
{ "ok": false, "reason": "no_eligible_slot", "price": 211.42,
  "open_slots": [ { "slot_id": "…", "slot_index": 0, "slot_count": 1,
                    "price_min": 100, "price_max": 200, "category_id": null } ] }
```
`price` is the cents-rounded fill price. `open_slots` = slots that still have room (price_min /
price_max may be null = no floor / no ceiling); `[]` = every slot is held. Sentence template:
"{symbol} is ${price}. Your open slot takes stocks priced ${min} to ${max}." (null min =
"up to", null max = "or more"; several open slots: list them, or name the nearest.)

**Buy success**: `{ ok: true, trade: { …, slot_id }, slot: { slot_id, slot_index, slot_count,
price_min, price_max, category_id }, price_source }`: "Filled your $100–$200 slot".
(`slot` is absent in slot-less leagues.)

**Preview** (`action: 'preview'`, read-only, no vendor call, no write). Existing
fixed_notional fields unchanged. New fields, every league:
```json
{ "slots": [ { "slot_id", "slot_index", "slot_count", "price_min", "price_max",
               "category_id", "held": ["MSFT"], "open": 0 } ],
  "unplaced": [] }
```
`slots` is the CALLER's derived slot map (Portfolio's "· $100–$200 slot" label: find the slot
whose `held` contains the symbol; `[]` for slot-less leagues). `unplaced` = held symbols no
slot accepts. Optional request fields `price` (the quote the client is showing) and, for
category leagues, `symbol`: the response then adds `would_fill` (the slot a buy at that price
would take, same shape as `slot`) or `would_fill: null` + `open_slots`. Advisory only: the buy
re-validates against the live fill price and ledger. `would_fill` ignores budget/roster (the
client shows those itself).

`get_portfolio_ledger` (3e's RPC) is not on main. Recommendation: Portfolio takes the slot label
from preview's `slots`, not from the ledger RPC; the legacy derivation then stays in ONE TS copy.

## Read-only counts for Giorgio (run in the SQL editor; nothing here writes)
All three were run against a PGlite fixture and return the expected rows.

**Q1: trade rows in slotted leagues (every pre-fix one is unattributed):**
```sql
SELECT l.id, l.name, l.stake_mode,
       count(*) FILTER (WHERE t.action = 'buy')  AS buys,
       count(*) FILTER (WHERE t.action = 'sell') AS sells,
       count(DISTINCT t.user_id)                 AS traders
FROM trades t JOIN leagues l ON l.id = t.league_id
WHERE EXISTS (SELECT 1 FROM league_draft_slots s WHERE s.league_id = l.id)
GROUP BY l.id, l.name, l.stake_mode ORDER BY buys DESC;
```
**Q2: held positions per manager vs roster slots** (how many held positions came in through trades):
```sql
WITH legs AS (
  SELECT league_id, user_id::text u, upper(symbol) sym, quantity::numeric q FROM drafts WHERE upper(symbol) <> 'SKIP'
  UNION ALL
  SELECT league_id, user_id::text, upper(symbol), (CASE WHEN action = 'sell' THEN -quantity ELSE quantity END)::numeric FROM trades),
held AS (SELECT league_id, u, sym FROM legs GROUP BY 1, 2, 3 HAVING sum(q) > 1e-9)
SELECT h.league_id, h.u AS user_id, count(*) AS held,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM trades t WHERE t.league_id = h.league_id AND t.user_id::text = h.u
                                       AND upper(t.symbol) = h.sym AND t.action = 'buy')) AS held_via_trade,
       (SELECT sum(slot_count) FROM league_draft_slots s WHERE s.league_id = h.league_id) AS roster_slots
FROM held h
WHERE EXISTS (SELECT 1 FROM league_draft_slots s WHERE s.league_id = h.league_id)
GROUP BY h.league_id, h.u ORDER BY held_via_trade DESC;
```
**Q3: OVERFLOW candidates: a tier bracket holding more stocks than it has capacity** (price
brackets only, by ENTRY price; an upper bound: brackets that overlap at a shared boundary can
over-count; `via_trade > 0` rows are the ones the bug produced). Any row = that manager's tier
stays closed to new buys until they sell down:
```sql
WITH legs AS (
  SELECT league_id, user_id::text u, upper(symbol) sym, quantity::numeric q FROM drafts WHERE upper(symbol) <> 'SKIP'
  UNION ALL
  SELECT league_id, user_id::text, upper(symbol), (CASE WHEN action = 'sell' THEN -quantity ELSE quantity END)::numeric FROM trades),
held AS (SELECT league_id, u, sym FROM legs GROUP BY 1, 2, 3 HAVING sum(q) > 1e-9),
entry AS (
  SELECT h.league_id, h.u, h.sym,
    EXISTS (SELECT 1 FROM trades t WHERE t.league_id = h.league_id AND t.user_id::text = h.u AND upper(t.symbol) = h.sym AND t.action = 'buy') AS via_trade,
    COALESCE(
      (SELECT t.price FROM trades t WHERE t.league_id = h.league_id AND t.user_id::text = h.u AND upper(t.symbol) = h.sym AND t.action = 'buy' ORDER BY t.created_at DESC, t.id DESC LIMIT 1),
      (SELECT d.entry_price FROM drafts d WHERE d.league_id = h.league_id AND d.user_id = h.u AND upper(d.symbol) = h.sym ORDER BY d.pick_number DESC LIMIT 1)) AS px
  FROM held h)
SELECT e.league_id, e.u AS user_id, s.slot_index, s.slot_count, s.price_min, s.price_max,
       count(*) AS held_in_bracket, count(*) FILTER (WHERE e.via_trade) AS via_trade, string_agg(e.sym, ',' ORDER BY e.sym) AS symbols
FROM entry e
JOIN league_draft_slots s ON s.league_id = e.league_id AND s.category_id IS NULL
 AND round(e.px, 2) >= COALESCE(s.price_min, -1e18) AND round(e.px, 2) <= COALESCE(s.price_max, 1e18)
GROUP BY e.league_id, e.u, s.slot_index, s.slot_count, s.price_min, s.price_max
HAVING count(*) > s.slot_count
ORDER BY e.league_id, e.u, s.slot_index;
```

## Release steps (Giorgio only)
1. #113's `20261102000000` is applied (live in prod as of 2026-10-06, record-trade at `e49df95`); this migration replaces the function it created. The CLI-splitter guard (#115) already covers this file.
2. Confirm `20261102000000` is applied: `SELECT version FROM supabase_migrations.schema_migrations WHERE version IN ('20261102000000','20261103000000');` (only the first should be present).
3. `supabase db push --dry-run` from `/Users/giorgio/fantasy-stock-deploy` (refreshed first; merging to `main` auto-deploys the web app, so the merge is itself a prod deploy), confirm it lists only `20261103000000`, then `supabase db push`.
4. Verify by proacl, never by the push output. Expect exactly ONE row: `pronargs = 13`, `service_role=X` and no anon/authenticated/bare `=X`, `prosecdef = false`, `provolatile = 'v'`, `proconfig = {"search_path=public, pg_temp",lock_timeout=5s}`:
   ```sql
   SELECT proname, pronargs, proacl, prosecdef, provolatile, proconfig
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND proname = 'record_trade_atomic';
   SELECT conname, confdeltype FROM pg_constraint
    WHERE conrelid = 'public.trades'::regclass AND conname IN ('trades_slot_id_fkey', 'trades_slot_id_buy_only');
   ```
   Expect `confdeltype = 'n'` (SET NULL) for the FK and the CHECK present.
5. Effect check: paste the `DO $$ ... $$` block from the migration header (the "Effect check" step) as ONE statement. It writes nothing and always ends in an error whose text is the verdict: `PASS` = everything ran; `PARTIAL` = prod has no completed slotted league, so only schema/lockdown/slot-on-sell ran and the league guards are covered by PGlite only (that is NOT a clean PASS); `FAIL` lists what broke.
6. Deploy `record-trade` ONLY after step 5: `supabase functions deploy record-trade --project-ref haiaaifjcclsvmkfqgmd` from the same checkout. Order matters: the new function needs the 13-arg RPC; the old function keeps working against it for non-slotted leagues, and slotted BUYS from the old function get `bad_request`→500 until the new one is up (fails closed, on exactly the buggy path). The reverse order (function before push) fails EVERY action closed until the push lands. If the first post-deploy call returns PGRST202, run `NOTIFY pgrst, 'reload schema';`.
7. Byte-verify: grep the source for `p_slot_id` first; the "Uploading asset" list must include `_shared/draft-validation.ts`, `_shared/tier-price.ts`, `_shared/category-eligibility.ts`, `record-trade/commit.ts`; then `supabase functions download record-trade --workdir <scratch>` and diff against the commit.
8. Refresh `docs/architecture/db-snapshot.json` (run `docs/architecture/db-snapshot.sql` against prod: a function/grant change), then `node scripts/gen-architecture.mjs`, and update `docs/STATUS.md`.

## Review findings (supabase-reviewer + security-reviewer, no blockers)
Fixed in this branch: a slot deleted between the guard reads and the INSERT (FK 23503) now returns
`ledger_changed` (retry) instead of a 500; the effect-check reads `PARTIAL`, never `PASS`, when the
league guards could not run; `slotAccepts` fails CLOSED on a price `tierPrice` cannot judge (it is NaN
from ~1e19, and NaN accepted any bracket: reachable only via the advisory preview price hint, but the
same fail-open sat in the draft gate); header wording.

Deliberately NOT changed, for Giorgio:
- **Commissioner slot writes are open post-draft** (`league_draft_slots_*_commissioner`, the "interim"
  policies of `20260810000004`): slots are now the enforcement boundary for tier limits, so a commissioner
  could retune or delete slots mid-season (a delete sets `trades.slot_id`/`drafts.slot_id` NULL and the
  positions are re-derived). Pre-existing, but now load-bearing; the fix is separate (freeze slot writes
  once `draft_status = 'completed'`, or route them through a function). The web `saveLeagueSlots` is a
  delete + reinsert with new UUIDs and is only client-gated.
- The refusal echoes the server's quote (`price`) for any symbol a member names (the 30/min rate limit and the
  market-hours gate bound it; previously a failed buy returned only `symbol`). Kept: the client sentence needs it.
- The RPC checks that a slot belongs to the league, not that it accepts the price or has room: the lockdown
  (service_role only) + the TS validator + the CAS cover that, which is why the proacl check above is load-bearing.
