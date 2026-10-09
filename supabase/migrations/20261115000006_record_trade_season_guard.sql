-- ============================================================================
-- record_trade_atomic: refuse a trade in a COMPLETED season (Run it back)
-- ============================================================================
-- Design: docs/migrations/RUN_IT_BACK_DESIGN.md (rev 3.1, section 7).
-- A finished season is frozen: a trade there would change a season that
-- get_league_history already shows. record-trade's pre-read refuses it too
-- (record-trade/gate.ts), but the pre-read can race a season completion, so the
-- authoritative check is HERE, under the league's advisory lock, after the draft
-- check.
--
-- The body is 20261103000000's, verbatim, with exactly two changes:
--   * the league read also selects season_status;
--   * a season_completed refusal after the draft_not_completed refusal.
-- Everything else is kept: the 13-argument signature, VOLATILE, security invoker,
-- the lock_timeout, the READ COMMITTED guard, every CAS, and the grants below.
--
-- The name is QUOTED: the Supabase CLI splitter reads a bare "atomic" as
-- BEGIN ATOMIC and glues the file into one statement (42601; see a02bf46).
--
-- PROVISIONAL TIMESTAMP: re-stamp before release, keeping this file later than
-- every other migration of this change.
-- ============================================================================

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

  select l.draft_status, l.season_status, l.stake_mode, l.budget_amount, l.notional_per_slot,
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
  -- Run it back: a completed season is frozen. Checked HERE, under the lock, so a
  -- season completed between record-trade's pre-read and this call is still refused.
  if v_league.season_status is not distinct from 'completed' then
    return jsonb_build_object('ok', false, 'reason', 'season_completed');
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
  when foreign_key_violation then
    -- The slot was deleted between the guard/CAS reads above and this INSERT
    -- (a commissioner's slot edit takes no lock). Nothing was written; the
    -- slot set the validator read is stale, which is exactly ledger_changed:
    -- record-trade re-reads and re-validates. Matched by NAME so a future FK
    -- on trades can't be mislabeled.
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'trades_slot_id_fkey' then
      return jsonb_build_object('ok', false, 'reason', 'ledger_changed', 'changed', 'slots');
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
