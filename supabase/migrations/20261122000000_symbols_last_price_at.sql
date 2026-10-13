-- ============================================================================
-- symbols.last_price_at + public.record_live_prices (2026-10-13, review H1)
--
-- WHY. After a manager's clock expires only the auto-pick fills the turn
-- (Giorgio: "the auto pick has to work"), so the auto-pick live-prices any
-- stock whose CACHED price (symbols.last_price) may be stale enough to hide a
-- legal pick. To stop re-pricing the same stocks on every tick, it must know a
-- cached price's AGE, and nothing recorded it:
--   * updated_at bumps on ANY substantive column change (name, gics, active,
--     ...) and does NOT bump when a write leaves the price unchanged;
--   * enriched_at is the enrich-symbols cron's cursor and liveness signal
--     (20260811000007) and must not be written by anyone else.
--
-- 1) symbols.last_price_at: when last_price was last written FROM A LIVE
--    PRICE by the draft auto-pick (a trade or minute-bar price). NULL = age
--    unknown, which every reader treats as STALE. It is bookkeeping, so it is
--    deliberately NOT in symbols_touch_updated_at's WHEN list (like
--    enriched_at). enrich-symbols does not write it: its later price write
--    leaves an older last_price_at, which is still a true upper bound on the
--    price's age, so a reader can never think a price fresher than it is.
--
-- 2) public.record_live_prices(p_symbols text[], p_prices numeric[]): ONE
--    batched write of live prices (the auto-pick writes a page of screen
--    prices at a time, never one UPDATE per symbol).
--      * UPDATES EXISTING ROWS ONLY: an unknown symbol is ignored, never
--        inserted (an upsert would run the INSERT path and its NOT NULL checks).
--      * A price that is NULL, <= 0 or not finite is ignored.
--      * Symbols are matched upper-cased; a symbol listed twice takes its
--        LAST price (WITH ORDINALITY).
--      * UNEQUAL ARRAY LENGTHS ARE REFUSED (SQLSTATE 22023, nothing written).
--        Multi-argument unnest() pads the shorter array with NULLs, so a
--        length mismatch is a caller bug that would silently pair prices with
--        the wrong symbols; it is an error, never a guess.
--      * Returns the number of rows updated (the caller logs it; it is a
--        best-effort cache write and never fails a pick).
--      * Rows are LOCKED IN SYMBOL ORDER before the update, so two concurrent
--        writers (overlapping sweeps, a client auto-pick) wait on each other
--        instead of deadlocking (40P01) on rows they reached in different orders.
--    Service role only (draft-write.ts). Supabase's default privileges grant
--    EXECUTE on every new function to anon AND authenticated, separately from
--    PUBLIC, so all three are revoked by name (CLAUDE.md: REVOKE FROM PUBLIC
--    alone leaves the function callable).
--
-- ORDER: apply this migration BEFORE deploying the functions that call it
-- (validate-and-record-pick, draft-autopick-sweep). The callers degrade
-- safely if it is missing (the age read fails soft to "stale", the write is
-- logged and skipped), but the stall fix only takes effect once it is applied.
--
-- HUMAN ACTION (Giorgio), from the deploy checkout only (CLAUDE.md):
--   supabase db push --dry-run   then   supabase db push
-- Effect-verify AFTER push (never trust the push output):
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'symbols' AND column_name = 'last_price_at';
--   -- expect: last_price_at | timestamp with time zone
--   SELECT proname, proacl FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND proname = 'record_live_prices';
--   -- expect proacl to list postgres and service_role only: no anon, no
--   -- authenticated, no bare "=X"
--   SELECT has_function_privilege('anon', 'public.record_live_prices(text[], numeric[])', 'EXECUTE'),
--          has_function_privilege('authenticated', 'public.record_live_prices(text[], numeric[])', 'EXECUTE');
--   -- expect: f | f
-- After the functions are deployed and a draft has auto-picked:
--   SELECT count(*) FROM symbols WHERE last_price_at > now() - interval '1 day';
--   -- expect > 0 (the auto-pick's write-backs land)
-- ============================================================================

alter table public.symbols add column if not exists last_price_at timestamptz;

create or replace function public.record_live_prices(p_symbols text[], p_prices numeric[])
returns integer
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if coalesce(cardinality(p_symbols), 0) <> coalesce(cardinality(p_prices), 0) then
    raise exception 'record_live_prices: % symbols but % prices',
      coalesce(cardinality(p_symbols), 0), coalesce(cardinality(p_prices), 0)
      using errcode = '22023';
  end if;

  perform 1
     from public.symbols s
    where s.symbol in (select upper(t.sym) from unnest(p_symbols) as t(sym) where t.sym is not null)
    order by s.symbol
      for update of s;

  with given as (
    select upper(t.sym) as sym, t.px, t.ord
      from unnest(p_symbols, p_prices) with ordinality as t(sym, px, ord)
     where t.sym is not null
       and t.px is not null
       and t.px > 0
       and t.px < 'Infinity'::numeric
  ), latest as (
    select distinct on (sym) sym, px
      from given
     order by sym, ord desc
  )
  update public.symbols s
     set last_price = l.px,
         last_price_at = now()
    from latest l
   where s.symbol = l.sym;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.record_live_prices(text[], numeric[]) from public;
revoke all on function public.record_live_prices(text[], numeric[]) from anon;
revoke all on function public.record_live_prices(text[], numeric[]) from authenticated;
grant execute on function public.record_live_prices(text[], numeric[]) to service_role;
