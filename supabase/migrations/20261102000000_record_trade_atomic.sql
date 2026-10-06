-- ============================================================================
-- record_trade_atomic: record-trade's INSERT, made atomic with its validation
-- (compare-and-swap under one league-wide advisory lock).
-- ============================================================================
--
-- THE BUG. record-trade validates a trade IN MEMORY (validateTradeAdd /
-- validateTradeDrop over a read of the league's drafts + trades) and then
-- INSERTs in a separate PostgREST request. Two concurrent requests could both
-- pass validation against the same ledger and both insert:
--   * a double SELL (double-tap, retry-in-flight, two devices) -> a NEGATIVE
--     net position;
--   * a double BUY in budget_cap / price_tiers -> two shares in a one-share
--     slot, or a budget overspend;
--   * a double fixed_notional BUY into a voluntarily SKIPPED slot (no
--     funded_by_trade_id, so trades_funded_by_trade_id_unique can't see it)
--     -> one skipped slot funded twice, money created;
--   * two DIFFERENT users buying the same symbol -> two owners of a symbol
--     the game says one manager owns (STATUS.md §4 item 10, the "KNOWN RACE").
-- The only backstop was trades_funded_by_trade_id_unique (20261006000000),
-- which closes exactly one case: one sale's proceeds funding two buys.
--
-- THE FIX: validate in TS, compare-and-swap in SQL. The TS validator stays
-- the ONE copy of the game rules (ownership, roster size, slot brackets and
-- categories, budget, the fixed_notional proceeds walk). This function does
-- not re-implement any of them. Instead, under a league-wide lock, it checks
-- that every LEAGUE-SCOPED input the validator read is still exactly what the
-- validator saw, and only then inserts. If anything moved, it writes nothing
-- and returns {ok:false, reason:'ledger_changed'}; record-trade then re-reads,
-- re-validates and re-submits (record-trade/commit.ts), so the losing request
-- gets the CORRECT game refusal (not_owned, symbol_owned, no_proceeds, ...)
-- rather than a generic one. Because the check is "nothing changed", it
-- covers every invariant the validator enforces, including future ones,
-- without a second copy of the rules that could drift.
--
-- WHAT THE CAS COVERS (each is a league-scoped input to validation that a
-- concurrent writer can change):
--   1. trades WHERE league_id = p_league_id -- EXACT id set (p_seen_trade_ids).
--      Same filter as record-trade's read (league_id only; trades has no
--      status/void column). Content is immutable: there is no UPDATE path into
--      trades (client INSERT policy dropped in 20260811000002, no UPDATE
--      policy ever existed, funded_by_trade_id is write-once), so the id set
--      IS the content. A set comparison also fails closed on a truncated or
--      duplicated paginated read: the count can't match.
--   2. drafts WHERE league_id = p_league_id -- EXACT id set (p_seen_draft_ids).
--      Post-draft the only drafts write a user session can make is the
--      commissioner's DELETE ("Commissioners can delete picks"); there is no
--      UPDATE policy and no server UPDATE path, so the id set is the content.
--   3. leagues: draft_status must be 'completed' (re-checked here, so a
--      season reset that flips it can't interleave), and -- for a buy, when
--      p_rules is given -- stake_mode, budget_amount, notional_per_slot,
--      num_rounds, allow_undraftable must equal what the validator read.
--      These CAN change post-draft (leagues_update_commissioner, interim).
--   4. league_draft_slots -- for a buy, when p_slots is given, the slot rows
--      (id, slot_index, slot_count, price_min, price_max, category_id) must
--      equal what the validator read. Commissioner-writable post-draft
--      (league_draft_slots_*_commissioner, interim).
--   5. league_members: the caller is still a member (defence in depth; there
--      is no leave-league flow today).
-- A sell passes p_rules/p_slots NULL because validateTradeDrop reads neither
-- (the verdict's scope matches the evidence's scope -- CLAUDE.md case 5): a
-- sell is not refused because a commissioner edited a budget it never read.
--
-- The league-scoped WRITERS other than this function (the commissioner's
-- drafts DELETE and rules/slots UPDATEs) do not take this lock, so one can
-- commit in the microseconds between the CAS reads and the INSERT. That is
-- still a serializable outcome: none of them reads the trades ledger, so the
-- history is equivalent to "the trade, then the edit" -- the same as a trade
-- that committed just before the edit. Any FUTURE writer that does read the
-- ledger or flips season state (season reset, #94) must take this same key.
--
-- NUMERIC FIDELITY: rules/slot numerics travel DB -> PostgREST JSON -> JS
-- double -> JSON -> ::numeric, exact to ~15 significant digits. Real values
-- (cents, whole notionals) are far inside that; a column value with 16+
-- significant digits would compare unequal forever (a permanent
-- ledger_changed -> trade_conflict). If such values ever appear, compare a
-- server-side digest instead.
--
-- WHAT IT DELIBERATELY DOES NOT COVER, and why that is safe: the GLOBAL
-- inputs -- the Alpaca fill price, symbols.is_draftable, category
-- eligibility, market_calendar. They are point-in-time facts about the
-- market, not league state, and none of their writers (enrich-symbols, the
-- category seed, the calendar refresh) READS the trades ledger. With no
-- read-write overlap there is no write skew: a trade that commits a moment
-- after a symbol's draftability flips is equivalent to the same trade
-- committing a moment before it. The market-hours re-check stays in TS, right
-- before this call, exactly as #89 placed it.
--
-- LOCKING AND DEADLOCK. Exactly ONE lock per transaction:
--   pg_advisory_xact_lock(hashtextextended('record-trade:' || league_id, 0))
-- With a single key there is no acquisition order, so no deadlock is
-- possible. The function pins lock_timeout = 5s: the lock is normally held
-- for milliseconds, so waiting longer means something is wrong; the wait
-- then raises 55P03 BEFORE any write (the lock precedes everything), which
-- record-trade surfaces as a 500 'unhandled' -- deliberately NOT
-- trade_conflict, which is reserved for "every attempt saw the ledger move". A hash collision between two leagues only over-serializes them;
-- it is never incorrect. No other code in this repo takes advisory locks.
-- The lock is held for the CAS reads + one INSERT -- never across the Alpaca
-- request, which happens in TS before this call. Why not two keys,
-- (league,symbol)+(league,user)? The invariants span both (ownership is per
-- symbol; budget/roster/funding are per user), so two keys would need an
-- order AND still a CAS; a league is 4-12 managers holding it for
-- milliseconds. Why not SELECT ... FOR UPDATE on leagues? That row lock
-- conflicts with the FOR KEY SHARE that EVERY foreign-key insert referencing
-- leagues takes (week_snapshots, matchups, trades themselves), so it would
-- stall unrelated writers; the advisory lock touches nothing else.
--
-- WHY THE CHECK SEES THE WINNER'S ROW (the load-bearing detail): under READ
-- COMMITTED, each SQL statement in a VOLATILE plpgsql function takes a FRESH
-- snapshot. The CAS reads run AFTER pg_advisory_xact_lock returns, and a
-- transaction-level advisory lock is released only after its holder commits,
-- so the second request's CAS read sees the first request's committed row and
-- returns ledger_changed. THIS FUNCTION MUST STAY VOLATILE: a STABLE function
-- reuses its caller's snapshot, taken before the lock wait, and the CAS
-- would read the stale ledger and pass. (PGlite has one connection, so the
-- lock's blocking cannot be executed in the test suite; the CAS is proven
-- behaviourally with a forced interleaving, and a structural test pins the
-- lock-before-reads order and the VOLATILE marking. Same limit, same
-- treatment as start_league_playoffs.)
--
-- SECURITY. SECURITY INVOKER, EXECUTE for service_role only (record-trade's
-- admin client). p_user_id is a parameter -- the join_league_by_code shape --
-- so this must never be callable by a user session. Two layers: the explicit
-- REVOKEs below (REVOKE FROM PUBLIC alone does NOT clear Supabase's default
-- anon/authenticated grants -- CLAUDE.md), and INVOKER itself: if a grant
-- ever leaked, an anon/authenticated caller would run the INSERT under trades
-- RLS, which has had no INSERT policy since 20260811000002, so it fails.
-- DEFINER would turn a leaked grant into a forged trade. search_path pinned.
--
-- #94 POINTER: the completed-season refusal ("Run it back", draft PR #94) is
-- not on main as this is written. When it lands, its season-state check
-- belongs IN HERE under the lock (or its writer must take the same lock
-- key), or a trade can interleave with the season flip.
--
-- REFUSALS (all write nothing):
--   bad_request          -- a required argument is NULL / p_rules or p_slots
--                           malformed (missing keys); a caller bug, not a race
--   league_not_found
--   draft_not_completed
--   not_a_member
--   ledger_changed       -- the CAS failed; re-read and re-validate
--   proceeds_unavailable -- trades_funded_by_trade_id_unique fired
-- Any other error (a CHECK violation, a bad cast) RAISES; record-trade maps
-- an rpc { error } to 500 'unhandled', never to success.
-- ============================================================================

create or replace function public.record_trade_atomic(
  p_league_id          uuid,
  p_user_id            uuid,
  p_symbol             text,
  p_action             text,
  p_quantity           numeric,
  p_price              numeric,
  p_total_value        numeric,
  p_funded_by_trade_id uuid,
  p_seen_trade_ids     uuid[],
  p_seen_draft_ids     text[],
  p_rules              jsonb,
  p_slots              jsonb
)
returns jsonb
language plpgsql
volatile          -- LOAD-BEARING: see "WHY THE CHECK SEES THE WINNER'S ROW"
security invoker
set search_path = public, pg_temp
set lock_timeout = '5s'  -- a stuck holder can't queue edge workers forever
as $$
declare
  v_league     record;
  v_n          bigint;
  v_seen       bigint;
  v_trade      trades%rowtype;
  v_constraint text;
begin
  -- A JSON null that arrives as the jsonb literal 'null' (rather than SQL
  -- NULL) means "not given" -- a sell passes no rules/slots, and the meaning
  -- must not depend on how the transport binds JSON null.
  p_rules := nullif(p_rules, 'null'::jsonb);
  p_slots := nullif(p_slots, 'null'::jsonb);

  if p_league_id is null or p_user_id is null or p_symbol is null or p_action is null
     or p_seen_trade_ids is null or p_seen_draft_ids is null then
    return jsonb_build_object('ok', false, 'reason', 'bad_request');
  end if;
  -- A NULL element would make any "is this row in the seen set?" test NULL
  -- rather than false -- fail-OPEN. The arrays are built server-side from
  -- non-NULL ids, so this is a caller bug, refused outright.
  if array_position(p_seen_trade_ids, null) is not null
     or array_position(p_seen_draft_ids, null) is not null then
    return jsonb_build_object('ok', false, 'reason', 'bad_request');
  end if;
  if p_rules is not null and not (
       jsonb_typeof(p_rules) = 'object'
       and p_rules ?& array['stake_mode', 'budget_amount', 'notional_per_slot', 'num_rounds', 'allow_undraftable']
     ) then
    return jsonb_build_object('ok', false, 'reason', 'bad_request');
  end if;
  if p_slots is not null and (case
       when jsonb_typeof(p_slots) <> 'array' then true  -- CASE: never expand a non-array
       else exists (
         select 1 from jsonb_array_elements(p_slots) e
         where jsonb_typeof(e) <> 'object'
            or not (e ?& array['id', 'slot_index', 'slot_count', 'price_min', 'price_max', 'category_id'])
       )
     end) then
    return jsonb_build_object('ok', false, 'reason', 'bad_request');
  end if;

  -- The fresh-snapshot argument (header) holds ONLY under READ COMMITTED.
  -- Under REPEATABLE READ / SERIALIZABLE the CAS would read a snapshot taken
  -- before the lock wait and pass a stale ledger, silently. Fail closed.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'record_trade_atomic requires READ COMMITTED, got %',
      current_setting('transaction_isolation');
  end if;

  -- The ONE lock. Everything below reads AFTER it, on fresh snapshots.
  perform pg_advisory_xact_lock(hashtextextended('record-trade:' || p_league_id::text, 0));

  select l.draft_status, l.stake_mode, l.budget_amount, l.notional_per_slot,
         l.num_rounds, l.allow_undraftable
    into v_league
    from leagues l
   where l.id = p_league_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'league_not_found');
  end if;
  if v_league.draft_status is distinct from 'completed' then
    return jsonb_build_object('ok', false, 'reason', 'draft_not_completed');
  end if;
  if not exists (
    select 1 from league_members m
     where m.league_id = p_league_id and m.user_id = p_user_id::text
  ) then
    return jsonb_build_object('ok', false, 'reason', 'not_a_member');
  end if;

  -- CAS 1: trades, exact set. With no NULL elements (guarded above):
  --   v_n    = rows in the table for this league
  --   v_seen = how many of those rows have their id in the DISTINCT seen set
  -- v_seen = v_n says every row was seen; cardinality = v_n then says the
  -- seen array has no extra or duplicated element (pigeonhole) -- so the seen
  -- set is exactly the table's, whatever order or page boundaries produced
  -- it. A join on the distinct unnested set (not `<> ALL (array)`, which is
  -- rows x array-length under the lock) lets the planner hash it.
  select count(*) into v_n from trades t where t.league_id = p_league_id;
  select count(*) into v_seen
    from trades t
    join (select distinct x from unnest(p_seen_trade_ids) x) s on s.x = t.id
   where t.league_id = p_league_id;
  if v_n <> cardinality(p_seen_trade_ids) or v_seen <> v_n then
    return jsonb_build_object('ok', false, 'reason', 'ledger_changed', 'changed', 'trades');
  end if;

  -- CAS 2: drafts, exact set (same argument). Compared as TEXT on purpose:
  -- drafts has no CREATE TABLE in this repo (a prod-only table), so its id
  -- type is inferred (uuid, from the league_activity UNION with trades.id),
  -- not declared. A uuid[] parameter would raise at EXECUTION time if that
  -- inference were ever wrong (PL/pgSQL defers resolution -- CLAUDE.md);
  -- text works for either.
  select count(*) into v_n from drafts d where d.league_id = p_league_id;
  select count(*) into v_seen
    from drafts d
    join (select distinct x from unnest(p_seen_draft_ids) x) s on s.x = d.id::text
   where d.league_id = p_league_id;
  if v_n <> cardinality(p_seen_draft_ids) or v_seen <> v_n then
    return jsonb_build_object('ok', false, 'reason', 'ledger_changed', 'changed', 'drafts');
  end if;

  -- CAS 3: league rules (buy only). Compared by VALUE after casting the seen
  -- side to the column's type, so 10000 and 10000.00 are equal.
  if p_rules is not null and (
       v_league.stake_mode        is distinct from (p_rules ->> 'stake_mode')
    or v_league.budget_amount     is distinct from (p_rules ->> 'budget_amount')::numeric
    or v_league.notional_per_slot is distinct from (p_rules ->> 'notional_per_slot')::numeric
    or v_league.num_rounds        is distinct from (p_rules ->> 'num_rounds')::int
    or v_league.allow_undraftable is distinct from (p_rules ->> 'allow_undraftable')::boolean
  ) then
    return jsonb_build_object('ok', false, 'reason', 'ledger_changed', 'changed', 'rules');
  end if;

  -- CAS 4: slot definitions (buy only). Both sides are normalised through
  -- the same jsonb_build_object with typed values and ordered by id, so the
  -- comparison is by value, independent of key order or numeric formatting.
  if p_slots is not null and
     coalesce((
       select jsonb_agg(jsonb_build_object(
                'id', s.id::text, 'slot_index', s.slot_index, 'slot_count', s.slot_count,
                'price_min', s.price_min, 'price_max', s.price_max, 'category_id', s.category_id::text)
              order by s.id::text)
         from league_draft_slots s
        where s.league_id = p_league_id
     ), '[]'::jsonb)
     is distinct from
     coalesce((
       select jsonb_agg(jsonb_build_object(
                'id', e ->> 'id', 'slot_index', (e ->> 'slot_index')::int,
                'slot_count', (e ->> 'slot_count')::int,
                'price_min', (e ->> 'price_min')::numeric, 'price_max', (e ->> 'price_max')::numeric,
                'category_id', e ->> 'category_id')
              order by e ->> 'id')
         from jsonb_array_elements(p_slots) e
     ), '[]'::jsonb)
  then
    return jsonb_build_object('ok', false, 'reason', 'ledger_changed', 'changed', 'slots');
  end if;

  begin
    insert into trades (league_id, user_id, symbol, action, quantity, price, total_value, funded_by_trade_id)
    values (p_league_id, p_user_id, p_symbol, p_action, p_quantity, p_price, p_total_value, p_funded_by_trade_id)
    returning * into v_trade;
  exception when unique_violation then
    -- Matched by name, not bare SQLSTATE, so a FUTURE unique index on trades
    -- can't be mislabeled as this refusal (same rule record-trade applied).
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'trades_funded_by_trade_id_unique' then
      return jsonb_build_object('ok', false, 'reason', 'proceeds_unavailable');
    end if;
    raise;
  end;

  return jsonb_build_object('ok', true, 'trade', to_jsonb(v_trade));
end;
$$;

revoke all on function public.record_trade_atomic(
  uuid, uuid, text, text, numeric, numeric, numeric, uuid, uuid[], text[], jsonb, jsonb) from public;
revoke all on function public.record_trade_atomic(
  uuid, uuid, text, text, numeric, numeric, numeric, uuid, uuid[], text[], jsonb, jsonb) from anon, authenticated;
grant execute on function public.record_trade_atomic(
  uuid, uuid, text, text, numeric, numeric, numeric, uuid, uuid[], text[], jsonb, jsonb) to service_role;

comment on function public.record_trade_atomic(
  uuid, uuid, text, text, numeric, numeric, numeric, uuid, uuid[], text[], jsonb, jsonb) is
  'record-trade''s INSERT under a league-wide advisory lock + compare-and-swap of every '
  'league-scoped validation input (trades/drafts id sets, rules, slots). Returns '
  '{ok:true, trade} or {ok:false, reason}; ledger_changed means re-read and re-validate. '
  'service_role only; MUST stay VOLATILE. See 20261102000000_record_trade_atomic.sql.';

-- ============================================================================
-- HUMAN ACTION -- Giorgio only. Full steps in the PR / DONE report.
-- 1. db push (from the refreshed deploy checkout) BEFORE deploying the new
--    record-trade: the old function never calls this, so pushing first is
--    safe; the new function calls it and would 500 without it.
-- 2. Verify the lockdown (never assume the REVOKEs worked):
--      SELECT proname, proacl, prosecdef, provolatile, proconfig
--        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public' AND proname = 'record_trade_atomic';
--    EXPECT: proacl has service_role=X and NO anon= / authenticated= / bare =X
--    entry; prosecdef = false; provolatile = 'v';
--    proconfig = {"search_path=public, pg_temp",lock_timeout=5s}.
-- 3. Effect check, WITHOUT placing a real trade. Paste the block below into
--    the SQL editor as ONE statement (the editor shows only the last
--    statement's result). It calls the function with a deliberately STALE
--    view -- an empty seen set for a league that has trades -- asserts
--    ledger_changed AND an unchanged trades count, and ends in RAISE on EVERY
--    path, so the whole block always rolls back: even if the CAS had NOT
--    worked and the function inserted, that row is undone. Read the verdict
--    in the error text: 'RECORD_TRADE_ATOMIC EFFECT TEST: PASS ...'.
--    (supabase/tests/record_trade_atomic.pglite.test.ts runs this exact
--    block and proves it reports PASS on this function and FAIL on one whose
--    CAS is neutered.)
--   DO $$
--   DECLARE
--     v_league  uuid;
--     v_user    text;
--     v_before  bigint;
--     v_after   bigint;
--     v_res     jsonb;
--     v_verdict text;
--   BEGIN
--     -- a completed league that HAS trades, and a UUID-shaped member (never bot-*)
--     SELECT l.id, m.user_id INTO v_league, v_user
--     FROM leagues l
--     JOIN league_members m ON m.league_id = l.id
--     WHERE l.draft_status = 'completed'
--       AND m.user_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
--       AND EXISTS (SELECT 1 FROM trades t WHERE t.league_id = l.id)
--     ORDER BY l.id, m.user_id
--     LIMIT 1;
--     IF v_league IS NULL THEN
--       RAISE EXCEPTION 'RECORD_TRADE_ATOMIC EFFECT TEST: SETUP FAIL -- no completed league with trades and a UUID-shaped member';
--     END IF;
--     SELECT count(*) INTO v_before FROM trades WHERE league_id = v_league;
--     v_res := public.record_trade_atomic(
--       v_league, v_user::uuid, 'EFFECTTEST', 'buy', 1, 1, 1, NULL,
--       '{}'::uuid[], '{}'::text[], NULL, NULL);
--     SELECT count(*) INTO v_after FROM trades WHERE league_id = v_league;
--     IF v_res ->> 'reason' = 'ledger_changed' AND v_res ->> 'changed' = 'trades'
--        AND v_after = v_before THEN
--       v_verdict := format('PASS -- stale view refused (%s), trades %s -> %s, nothing written',
--                           v_res ->> 'changed', v_before, v_after);
--     ELSE
--       v_verdict := format('FAIL -- got %s, trades %s -> %s', v_res, v_before, v_after);
--     END IF;
--     RAISE EXCEPTION 'RECORD_TRADE_ATOMIC EFFECT TEST: %', v_verdict;
--   END $$;
-- ============================================================================
