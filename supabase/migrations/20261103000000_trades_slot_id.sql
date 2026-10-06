-- ============================================================================
-- trades.slot_id: a slotted-league BUY records the slot it fills.
-- ============================================================================
--
-- THE BUG (found while reviewing #113; ruling: Giorgio 2026-10-06, board
-- #call-tier-trades, option A "Replace in the same tier"). Slot occupancy
-- after the draft was counted from drafts.slot_id ONLY. A position bought in a
-- trade held no slot, so after any trade a manager could buy a second stock
-- into an already-filled one-share tier (picks = NVDA in 'hi'; MSFT bought at
-- $100 filling 'lo'; buying GOOG at $150 was legal). Only num_rounds capped the
-- total. Category-slot leagues had the same hole.
--
-- THE RULE: selling a stock frees THAT stock's slot; a buy must fit a FREE
-- slot by its price and takes it; the tier is set by the ENTRY price and never
-- moves when the price later drifts.
--
-- THE FIX has two halves. This migration is the storage half; the rule itself
-- lives once, in supabase/functions/_shared/draft-validation.ts
-- (userSlotOccupancy / decideBuySlot / validateTradeAdd):
--   1. trades.slot_id, nullable FK to league_draft_slots (mirrors
--      drafts.slot_id), buy-only by CHECK. Write-once like funded_by_trade_id.
--   2. record_trade_atomic gains p_slot_id, so the slot is written through the
--      same lock + compare-and-swap as the trade. Guards, all after CAS 4 so a
--      concurrent slot edit is ledger_changed (retry), not a refusal:
--        - a slot only rides on a BUY;
--        - the slot must belong to THIS league;
--        - a BUY in a league that HAS slots must carry one.
--      The last guard is what keeps the NULL discipline true going forward.
--
-- NULL DISCIPLINE (CLAUDE.md "overloaded NULLs are type tags, and you cannot
-- fill them in"): after this migration + the record-trade deploy, a BUY in a
-- slotted league always has slot_id. So NULL there means exactly one thing:
-- "unattributed: a pre-fix row (or its slot was deleted) -- derive its slot at
-- read time". NO BACKFILL, on purpose, the same call as funded_by_trade_id
-- (20261006000000): the derivation is first-fit by ENTRY price into the slots
-- not held by recorded positions (the same assignSlot the draft uses). A
-- backfill would (a) put a second copy of the tier/category rule in SQL,
-- (b) freeze an overflow (a manager already holding two stocks in a one-share
-- tier) so that selling one twin could never reopen the tier, and (c) rewrite
-- trade history. Reading the derivation live means selling EITHER overflowing
-- stock reopens the tier and nobody is ever stranded (sells never check slots).
--
-- SIGNATURE CHANGE. CREATE OR REPLACE with a NEW signature creates a NEW
-- function and leaves the old overload callable, so the 12-argument version is
-- DROPPED explicitly and only the 13-argument one remains. p_slot_id is LAST
-- and DEFAULT NULL: during the deploy window the OLD record-trade (named-arg
-- rpc, 12 arguments) still resolves to this function; non-slotted trades keep
-- working; a slotted BUY from the old function gets bad_request (-> 500
-- 'unhandled') until the new record-trade is deployed. That fails closed on
-- exactly the path that was buggy. Do the db push, then deploy record-trade.
--
-- Everything else is #113's function verbatim: VOLATILE (the CAS reads must
-- take fresh snapshots after the lock), SECURITY INVOKER, search_path pinned,
-- lock_timeout 5s, the READ COMMITTED check, the single advisory lock taken
-- before any read, CAS 1-4, the unique-index mapping. See
-- 20261102000000_record_trade_atomic.sql for why each is there.
--
-- WHY THE NAME IS QUOTED EVERYWHERE BELOW: the Supabase CLI splitter reads the
-- bare word "atomic" as BEGIN ATOMIC and stops splitting (the first push of
-- 20261102000000 failed with 42601 for exactly this). Quoted identifiers are
-- skipped by it and are the same name to Postgres.
-- supabase/tests/migration_cli_split.test.ts guards this file too.
-- ============================================================================

alter table trades
  add column if not exists slot_id uuid null
    references league_draft_slots(id) on delete set null;

alter table trades
  drop constraint if exists trades_slot_id_buy_only;
alter table trades
  add constraint trades_slot_id_buy_only
    check (slot_id is null or action = 'buy');

create index if not exists trades_slot_id_idx
  on trades(slot_id) where slot_id is not null;

comment on column trades.slot_id is
  'Slotted leagues (price_tiers / category): the league_draft_slots row this BUY '
  'filled, written by record_trade_atomic. Buy-only, write-once. NULL on a buy '
  'means unattributed (a pre-fix row, or its slot was deleted): the slot is '
  'derived at read time from the entry price -- see userSlotOccupancy in '
  '_shared/draft-validation.ts. Not backfilled, on purpose.';

-- The 12-argument overload from 20261102000000 goes; see "SIGNATURE CHANGE".
drop function if exists public."record_trade_atomic"(
  uuid, uuid, text, text, numeric, numeric, numeric, uuid, uuid[], text[], jsonb, jsonb);

create or replace function public."record_trade_atomic"(
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
  p_slots              jsonb,
  p_slot_id            uuid default null  -- slotted-league BUY: the slot it takes
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

  -- A slot only ever rides on a BUY (trades_slot_id_buy_only enforces the
  -- same at the table; refusing here gives the caller a refusal, not a 500).
  if p_slot_id is not null and p_action <> 'buy' then
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

  -- SLOT GUARDS. After CAS 4 on purpose: a slot edited or deleted since the
  -- validator read is ledger_changed above (re-read and retry), so reaching
  -- here with a slot that is not this league's is a caller bug, not a race.
  --   * the slot must belong to THIS league;
  --   * a BUY in a league that HAS slots must carry one. This is what keeps
  --     the NULL discipline true going forward: a NULL trades.slot_id on a
  --     buy then means exactly one thing, "pre-fix row, derive its slot at
  --     read time" (see slotOccupancy in _shared/draft-validation.ts).
  if p_slot_id is not null and not exists (
    select 1 from league_draft_slots s
     where s.id = p_slot_id and s.league_id = p_league_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'bad_request');
  end if;
  if p_action = 'buy' and p_slot_id is null and exists (
    select 1 from league_draft_slots s where s.league_id = p_league_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'bad_request');
  end if;

  begin
    insert into trades (league_id, user_id, symbol, action, quantity, price, total_value, funded_by_trade_id, slot_id)
    values (p_league_id, p_user_id, p_symbol, p_action, p_quantity, p_price, p_total_value, p_funded_by_trade_id, p_slot_id)
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

revoke all on function public."record_trade_atomic"(
  uuid, uuid, text, text, numeric, numeric, numeric, uuid, uuid[], text[], jsonb, jsonb, uuid) from public;
revoke all on function public."record_trade_atomic"(
  uuid, uuid, text, text, numeric, numeric, numeric, uuid, uuid[], text[], jsonb, jsonb, uuid) from anon, authenticated;
grant execute on function public."record_trade_atomic"(
  uuid, uuid, text, text, numeric, numeric, numeric, uuid, uuid[], text[], jsonb, jsonb, uuid) to service_role;

comment on function public."record_trade_atomic"(
  uuid, uuid, text, text, numeric, numeric, numeric, uuid, uuid[], text[], jsonb, jsonb, uuid) is
  'record-trade''s INSERT under a league-wide advisory lock + compare-and-swap of every '
  'league-scoped validation input (trades/drafts id sets, rules, slots), now also writing '
  'trades.slot_id for a slotted-league buy. Returns {ok:true, trade} or {ok:false, reason}; '
  'ledger_changed means re-read and re-validate. service_role only; MUST stay VOLATILE. '
  'See 20261102000000 and 20261103000000.';

-- ============================================================================
-- HUMAN ACTION -- Giorgio only. Full steps in the PR / DONE report.
-- 1. db push (from the refreshed deploy checkout), AFTER 20261102000000 is
--    applied (it creates the function this replaces), and BEFORE deploying the
--    new record-trade (see "SIGNATURE CHANGE" above).
-- 2. Verify the lockdown by proacl (never assume the REVOKEs worked):
--      SELECT proname, pronargs, proacl, prosecdef, provolatile, proconfig
--        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public' AND proname = 'record_trade_atomic';
--    EXPECT exactly ONE row: pronargs = 13; proacl has service_role=X and NO
--    anon= / authenticated= / bare =X entry; prosecdef = false;
--    provolatile = 'v'; proconfig = {"search_path=public, pg_temp",lock_timeout=5s}.
-- 3. Effect check, WITHOUT writing anything. Paste as ONE statement; it ends in
--    RAISE on EVERY path, so it always rolls back. Read the verdict in the
--    error text: 'TIER_TRADE_SLOTS EFFECT TEST: PASS ...'. It checks the
--    schema, the lockdown, that the old overload is gone, and that the new
--    guards REFUSE (every call it makes is a refusal that returns before the
--    insert). If prod has no completed slotted league the league-level guards
--    cannot be exercised and the verdict SAYS SO instead of passing silently.
--    (supabase/tests/record_trade_atomic.pglite.test.ts runs this exact block
--    and proves PASS on this migration and FAIL when the guards or the
--    lockdown are broken.)
--   DO $$
--   DECLARE
--     v_n       int;
--     v_fn      record;
--     v_league  uuid;
--     v_user    text;
--     v_trades  uuid[];
--     v_drafts  text[];
--     v_before  bigint;
--     v_after   bigint;
--     v_res     jsonb;
--     v_fail    text := '';
--     v_note    text := '';
--   BEGIN
--     -- 1. exactly one record_trade_atomic, 13 arguments, locked down
--     SELECT count(*) INTO v_n
--       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--      WHERE n.nspname = 'public' AND p.proname = 'record_trade_atomic';
--     IF v_n <> 1 THEN
--       v_fail := v_fail || format(' overloads=%s (want 1: the 12-arg one must be gone);', v_n);
--     END IF;
--     SELECT p.pronargs, p.proacl::text AS acl, p.prosecdef, p.provolatile INTO v_fn
--       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--      WHERE n.nspname = 'public' AND p.proname = 'record_trade_atomic' AND p.pronargs = 13;
--     IF NOT FOUND THEN
--       v_fail := v_fail || ' no 13-arg function;';
--     ELSE
--       IF v_fn.acl IS NULL OR v_fn.acl !~ 'service_role=X' THEN
--         v_fail := v_fail || format(' service_role lacks EXECUTE (%s);', v_fn.acl);
--       END IF;
--       IF v_fn.acl ~ 'anon=' OR v_fn.acl ~ 'authenticated=' OR v_fn.acl ~ '(^|[{,])=X' THEN
--         v_fail := v_fail || format(' EXECUTE leaked to anon/authenticated/PUBLIC (%s);', v_fn.acl);
--       END IF;
--       IF v_fn.prosecdef OR v_fn.provolatile <> 'v' THEN
--         v_fail := v_fail || ' must be SECURITY INVOKER and VOLATILE;';
--       END IF;
--     END IF;
--     -- 2. the column and its buy-only CHECK
--     IF NOT EXISTS (SELECT 1 FROM information_schema.columns
--                     WHERE table_schema = 'public' AND table_name = 'trades' AND column_name = 'slot_id') THEN
--       v_fail := v_fail || ' trades.slot_id missing;';
--     END IF;
--     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trades_slot_id_buy_only') THEN
--       v_fail := v_fail || ' trades_slot_id_buy_only missing;';
--     END IF;
--     -- 3. a slot on a SELL is refused (no league needed: it fails before the lock)
--     -- (each guard call sits in its own sub-block, so a guard that is MISSING and
--     -- lets the call raise something else reads as FAIL text, not a raw error)
--     BEGIN
--       v_res := public.record_trade_atomic(
--         gen_random_uuid(), gen_random_uuid(), 'EFFECTTEST', 'sell', 1, 1, 1, NULL,
--         '{}'::uuid[], '{}'::text[], NULL, NULL, gen_random_uuid());
--       IF v_res ->> 'reason' IS DISTINCT FROM 'bad_request' THEN
--         v_fail := v_fail || format(' slot-on-sell not refused (%s);', v_res);
--       END IF;
--     EXCEPTION WHEN OTHERS THEN
--       v_fail := v_fail || format(' slot-on-sell raised: %s;', SQLERRM);
--     END;
--     -- 4. league guards: a completed league that HAS slots and a UUID-shaped member
--     SELECT l.id, m.user_id INTO v_league, v_user
--       FROM leagues l
--       JOIN league_members m ON m.league_id = l.id
--      WHERE l.draft_status = 'completed'
--        AND m.user_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
--        AND EXISTS (SELECT 1 FROM league_draft_slots s WHERE s.league_id = l.id)
--      ORDER BY l.id, m.user_id
--      LIMIT 1;
--     IF v_league IS NULL THEN
--       v_note := ' NOTE: league-level slot guards NOT exercised (no completed slotted league with a UUID member).';
--     ELSE
--       SELECT coalesce(array_agg(t.id), '{}'::uuid[]) INTO v_trades FROM trades t WHERE t.league_id = v_league;
--       SELECT coalesce(array_agg(d.id::text), '{}'::text[]) INTO v_drafts FROM drafts d WHERE d.league_id = v_league;
--       SELECT count(*) INTO v_before FROM trades WHERE league_id = v_league;
--       -- a BUY with NO slot in a slotted league is refused
--       BEGIN
--         v_res := public.record_trade_atomic(
--           v_league, v_user::uuid, 'EFFECTTEST', 'buy', 1, 1, 1, NULL,
--           v_trades, v_drafts, NULL, NULL, NULL);
--         IF v_res ->> 'reason' IS DISTINCT FROM 'bad_request' THEN
--           v_fail := v_fail || format(' slotless buy in a slotted league not refused (%s);', v_res);
--         END IF;
--       EXCEPTION WHEN OTHERS THEN
--         v_fail := v_fail || format(' slotless buy raised: %s;', SQLERRM);
--       END;
--       -- a BUY naming a slot that is not this league's is refused
--       BEGIN
--         v_res := public.record_trade_atomic(
--           v_league, v_user::uuid, 'EFFECTTEST', 'buy', 1, 1, 1, NULL,
--           v_trades, v_drafts, NULL, NULL, gen_random_uuid());
--         IF v_res ->> 'reason' IS DISTINCT FROM 'bad_request' THEN
--           v_fail := v_fail || format(' foreign slot not refused (%s);', v_res);
--         END IF;
--       EXCEPTION WHEN OTHERS THEN
--         v_fail := v_fail || format(' foreign slot raised: %s;', SQLERRM);
--       END;
--       SELECT count(*) INTO v_after FROM trades WHERE league_id = v_league;
--       IF v_after <> v_before THEN
--         v_fail := v_fail || format(' trades %s -> %s (a refusal wrote a row);', v_before, v_after);
--       END IF;
--     END IF;
--     IF v_fail = '' THEN
--       RAISE EXCEPTION 'TIER_TRADE_SLOTS EFFECT TEST: PASS -- one 13-arg function, locked down, slot guards refuse.%', v_note;
--     ELSE
--       RAISE EXCEPTION 'TIER_TRADE_SLOTS EFFECT TEST: FAIL --%', v_fail;
--     END IF;
--   END $$;
-- ============================================================================
