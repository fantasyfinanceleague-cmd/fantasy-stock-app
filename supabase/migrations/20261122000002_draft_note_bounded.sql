-- ============================================================================
-- public.note_draft_bounded: the bounded-search count, bumped ATOMICALLY
-- (2026-10-13, review L2)
--
-- A search the auto-pick stops on a bound (not an outage, not a proof that
-- nothing is legal) is recorded in draft_stalls as reason 'search_bounded',
-- attempts = consecutive bounded searches; after BOUNDED_ESCALATE_AFTER the
-- commissioner is pushed once (draft-write.ts noteBounded). A read-then-write
-- bump in the edge function could skip or double-count under two concurrent
-- callers (an overlapping sweep, a client auto-pick). This is ONE statement:
-- insert the first row, or bump the existing one, and return the new count.
--   * attempts: +1 when the row is already a bounded search ('search_bounded');
--     otherwise (a legality stall, an outage row) the count restarts at 1, since
--     a bound is a new, different claim.
--   * reason = 'search_bounded'; last_seen_at = now(): re-arms the sweep cron's
--     60 s throttle and recentStall's cooldown, like recordStall's repeat path.
-- The row (attempts climbing, last_seen_at) and the '[draft-bounded]' log are
-- the OPERATOR's signal. There is no commissioner push for a slow or stuck
-- auto-pick (Giorgio, 2026-10-13: "Drop the wrong 'pick manually' notification
-- and don't add a new one. The commissioner can't do anything about it anyway.").
--
-- Service role only. Supabase's default privileges grant EXECUTE to anon AND
-- authenticated separately from PUBLIC, so all three are revoked by name.
--
-- ORDER: apply BEFORE deploying validate-and-record-pick / draft-autopick-sweep.
-- Without it the bounded record fails (logged, never thrown): the turn still
-- retries, without the cooldown or the stalled report.
--
-- HUMAN ACTION (Giorgio), from the deploy checkout only (CLAUDE.md):
--   supabase db push --dry-run   then   supabase db push
-- Effect-verify AFTER push:
--   SELECT proname, proacl FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND proname = 'note_draft_bounded';
--   -- expect postgres and service_role only: no anon, no authenticated, no bare "=X"
-- ============================================================================

create or replace function public.note_draft_bounded(p_league_id uuid, p_pick_number integer, p_picker_id text)
returns table (attempts integer, reason text)
language sql
volatile
security invoker
set search_path = public, pg_temp
as $$
  insert into public.draft_stalls as d (league_id, pick_number, picker_id, reason, attempts)
  values (p_league_id, p_pick_number, p_picker_id, 'search_bounded', 1)
  on conflict (league_id, pick_number) do update
     set attempts = case when d.reason = 'search_bounded' then d.attempts + 1 else 1 end,
         reason = 'search_bounded',
         picker_id = excluded.picker_id,
         last_seen_at = now()
  returning d.attempts, d.reason;
$$;

revoke all on function public.note_draft_bounded(uuid, integer, text) from public;
revoke all on function public.note_draft_bounded(uuid, integer, text) from anon;
revoke all on function public.note_draft_bounded(uuid, integer, text) from authenticated;
grant execute on function public.note_draft_bounded(uuid, integer, text) to service_role;
