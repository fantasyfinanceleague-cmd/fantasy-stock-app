-- ============================================================================
-- draft_feasibility_pool — the SQL twin of supabase/functions/_shared/
-- draft-feasibility.ts buildPoolGroups (draft-never-skips, 2026-10-05).
--
-- Product rule (Giorgio, 2026-10-05): "a draft pick CAN NEVER be unused". The
-- feasibility model needs the draftable pool grouped by SIGNATURE — the set of
-- slot types a stock robustly fits — with each group's cheapest prices for the
-- budget reserve. Grouping in SQL keeps it to one round trip over ~15k symbols;
-- the JS side then runs the exact flow / reserve on those groups.
--
-- ROBUST MEMBERSHIP (the margin, one place): a stock fits a bracket only when
-- its CACHED price (rounded to cents, tier-price.ts) is >= 110% of the floor and
-- <= 90% of the ceiling. last_price is refreshed by enrich-symbols over ~2 days,
-- so a stock within 10% of a boundary can be on the other side of it live.
-- Prices returned are the cached cents values; the reserve applies its own 10%.
--
-- CATEGORY: the DR-001 three-layer rule, mirrored from
-- public.auto_pick_search_candidates (20261010000000): curated overrides REPLACE
-- the rule-table category when any exist; otherwise the gics_industry rule;
-- unclassified => fits flex types only. supabase/tests/draft_feasibility_pool
-- .pglite.test.ts asserts this RPC and the TS mirror agree on one fixture.
--
-- SERVICE ROLE ONLY: an unthrottled catalog scan. Callers are the edge functions
-- (validate-and-record-pick, draft-autopick-sweep, draft-control) on the service
-- role; there is no client reader. REVOKE ... FROM PUBLIC does not clear
-- Supabase's explicit anon/authenticated default grants (CLAUDE.md), so the
-- revokes name each role.
--
-- Effect-verify after push (HUMAN ACTION; never trust the push):
--   SELECT proname, proacl FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND proname = 'draft_feasibility_pool';
--   -- expect: service_role only; NO anon=X, NO authenticated=X, NO bare =X
--
-- HUMAN ACTION: supabase db push, from the deploy checkout only (CLAUDE.md).
-- Push BEFORE deploying validate-and-record-pick / draft-control /
-- draft-autopick-sweep: the new code calls this RPC.
-- ============================================================================

create or replace function public.draft_feasibility_pool(
  p_types          jsonb,
  p_draftable_only boolean,
  p_exclude        text[],
  p_depth          integer
)
returns table (ordinals integer[], n bigint, prices numeric[])
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with t as (
    select x.ordinal, x.price_min, x.price_max, x.category_id
      from jsonb_to_recordset(coalesce(p_types, '[]'::jsonb))
           as x(ordinal integer, price_min numeric, price_max numeric, category_id uuid)
  ),
  pool as (
    select s.symbol, s.gics_industry, round(s.last_price, 2) as px
      from public.symbols s
     where s.active is true
       and s.price_unsupported is not true
       and (not coalesce(p_draftable_only, true) or s.is_draftable is true)
       and not (upper(s.symbol) = any (coalesce(p_exclude, '{}'::text[])))
       and s.last_price is not null
       and s.last_price > 0
  ),
  sig as (
    select p.px,
           array(
             select t.ordinal
               from t
              where (t.price_min is null or p.px + 0.000000001 >= t.price_min * 1.1)
                and (t.price_max is null or p.px <= t.price_max * 0.9 + 0.000000001)
                and (t.category_id is null or
                     case
                       when exists (select 1 from public.symbol_category_overrides o
                                     where o.symbol = p.symbol)
                         then exists (select 1 from public.symbol_category_overrides o
                                       where o.symbol = p.symbol and o.category_id = t.category_id)
                       else exists (select 1 from public.category_rules r
                                     where r.gics_industry = p.gics_industry
                                       and r.category_id = t.category_id)
                     end)
              order by t.ordinal
           ) as ords
      from pool p
  )
  select ords as ordinals,
         count(*) as n,
         (array_agg(px order by px))[1:greatest(coalesce(p_depth, 1), 1)] as prices
    from sig
   where cardinality(ords) > 0
   group by ords;
$$;

revoke all on function public.draft_feasibility_pool(jsonb, boolean, text[], integer) from public;
revoke all on function public.draft_feasibility_pool(jsonb, boolean, text[], integer) from anon, authenticated;
grant execute on function public.draft_feasibility_pool(jsonb, boolean, text[], integer) to service_role;
