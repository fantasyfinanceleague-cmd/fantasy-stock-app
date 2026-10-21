-- Make the 10 s auto-pick cron FIRE for a deleted seat in an unclocked draft (account
-- deletion, decision 16; docs/plans/2026-10-21-account-deletion.md).
--
-- THE PROBLEM: an account deleted in the order-set or live-draft window keeps its seat
-- (league_members.deleted_at, set by scrub_deleted_manager). In a CLOCKED draft the clock
-- expiry auto-picks for it. In an UNCLOCKED one (pick_clock_enabled = false) auto-pick never
-- fires, and the sweep cron only posts WHERE an overdue (clocked) turn or auto-start work
-- exists, so the draft would wait forever for someone who no longer exists. Giorgio's standing
-- rule: "there can never be an instance where a player doesn't get a pick ... like fantasy
-- football, you run out of time and it auto drafts for you".
--
-- WHO OWNS WHAT (the agreed split):
--   * W2 (20261125000009): public.unclocked_deleted_seat_turns() -> (league_id, pick_number),
--     service_role only: every in_progress draft with pick_clock_enabled = false that has at
--     least one deleted seat. get_draft_clock is NOT changed.
--   * the sweep (draft-autopick-sweep + _shared/deleted-seat.ts) iterates those rows, works out
--     in JS whose turn it is (NO TURN MATH IN SQL), and auto-picks ONLY when that picker's seat
--     has deleted_at set. A live seat in an unclocked draft is never auto-picked; a clocked
--     draft is unchanged.
--   * THIS FILE: the cron's post guard. The cron already ORs in public.draft_auto_start_work_due()
--     (20261111000002), an isolated wrapper; this extends it so the cron posts for such a league.
--     The cron's own text is NOT touched (draft_auto_start_cron_wiring.test.ts pins it), and this
--     is the same extension point 20261111000002 used.
--
-- COST, stated plainly: while ANY unclocked live draft has a deleted seat anywhere in it, the guard
-- is true every tick, even when the current turn is a live manager's (SQL cannot say whose turn it
-- is). An unclocked draft has no deadline, so this can last as long as the draft does. Each tick
-- costs one sweep invocation plus, per listed league (at most 10, in random order), the context
-- reads, get_draft_clock and one seat read; no Alpaca call unless it is the deleted seat's turn.
-- Exposure is small: drafts created since 20261010000000 are clocked by default, so only a draft
-- that a commissioner switched to unclocked (or a legacy one) can be listed.
--
-- ISOLATION (same promise as 20261111000000, supabase review #6): a runtime error in the
-- auto-start lists must not hide this list, nor the other way round, and neither may raise into
-- the cron statement, which would take the auto-pick backstop down with it. Each half is its own
-- exception block, raised as a WARNING into the postgres log.
--
-- ORDERING: needs unclocked_deleted_seat_turns() from W2 (20261125000009). plpgsql resolves names
-- at run time, so a push without it would create this cleanly and then the guard would WARN and
-- return false for that half every tick (the auto-start half is unaffected): this is stamped after
-- W2's files on purpose.
--
-- GRANTS (CLAUDE.md "Postgres function grants"): CREATE OR REPLACE does not reset privileges, and
-- REVOKE FROM PUBLIC does not clear Supabase's default anon/authenticated grants, so they are
-- re-asserted by name. Verify:
--   SELECT proname, proacl FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND proname IN ('draft_auto_start_work_due','unclocked_deleted_seat_turns');
--   -- EXPECT service_role=X and NO anon=X / authenticated=X on either row
create or replace function public.draft_auto_start_work_due()
returns boolean
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_start boolean := false;
begin
  -- The auto-start half, exactly as 20261111000000 had it, now its own block.
  begin
    v_start := exists (select 1 from public.due_draft_starts()) or exists (select 1 from public.draft_watch_due());
  exception when others then
    raise warning 'draft_auto_start_work_due (auto-start) failed: % %', sqlstate, sqlerrm;
    v_start := false;
  end;
  if v_start then
    return true;
  end if;

  -- The deleted-seat half.
  begin
    return exists (select 1 from public.unclocked_deleted_seat_turns());
  exception when others then
    raise warning 'draft_auto_start_work_due (deleted seats) failed: % %', sqlstate, sqlerrm;
    return false;
  end;
end;
$$;

revoke all on function public.draft_auto_start_work_due() from public;
revoke all on function public.draft_auto_start_work_due() from anon, authenticated;
grant execute on function public.draft_auto_start_work_due() to service_role;

-- Effect-verify AFTER push (HUMAN ACTION), by DATA:
--   with a throwaway UNCLOCKED in_progress league that has a deleted seat:
--   SELECT * FROM public.unclocked_deleted_seat_turns();      -- EXPECT that league and its next pick_number
--   SELECT public.draft_auto_start_work_due();                -- EXPECT true
--   and when it is the deleted seat's turn, within ~15 s a drafts row appears with
--   pick_source auto_queue/auto_best for that seat (never for a LIVE seat in the same
--   draft), and the sweep's response lists the outcome in results.
