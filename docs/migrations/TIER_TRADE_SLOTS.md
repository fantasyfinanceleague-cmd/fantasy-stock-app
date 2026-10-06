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
1. #113's `20261102000000` must be applied FIRST (it creates the function this replaces).
   Its first push failed on the CLI splitter; the fix is PR #115. This branch carries a local
   cherry-pick of that fix (`7a8506c`) ONLY so the splitter guard runs; drop it when rebasing
   onto a `main` that has #115.
2. `supabase db push` from `/Users/giorgio/fantasy-stock-deploy` (refreshed first), market
   closed if possible. Then verify by proacl + the effect check in the migration header
   (one DO block, ends in RAISE PASS/FAIL, writes nothing).
3. Deploy `record-trade` (`--project-ref haiaaifjcclsvmkfqgmd`) from the same checkout. Order matters:
   the new function needs the 13-arg RPC; the old function keeps working against it for
   non-slotted leagues, and slotted BUYS from the old function get `bad_request`→500 until the
   new one is up (fails closed, on exactly the buggy path).
4. Byte-verify: "Uploading asset" list includes `_shared/draft-validation.ts`, `_shared/tier-price.ts`,
   `_shared/category-eligibility.ts`, `record-trade/commit.ts`; grep the source for
   `userSlotOccupancy` first; then `supabase functions download record-trade --workdir <scratch>`
   and diff against the commit.
